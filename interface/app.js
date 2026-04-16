/* ══════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════ */
const MODELS = ['claude', 'chatgpt', 'gemini'];
const LANGS  = ['global', 'en', 'es', 'jp'];
const MODEL_LABEL = { claude:'Claude', chatgpt:'ChatGPT', gemini:'Gemini' };
const LANG_LABEL  = { global:'Global', en:'English', es:'Spanish', jp:'Japanese' };
const MODEL_COLOR = { claude:'#7155a0', chatgpt:'#10A37F', gemini:'#4285F4' };

const CAT_COLORS = {
  agency:'#4e79a7', alteration:'#59a14f', antisocial:'#f28e2b',
  authoritarianism:'#e15759', censorship:'#76b7b2', conflict:'#edc948',
  depletion:'#b07aa1', event:'#ff9da7', familism:'#9c755f',
  government:'#6b6ecf', kernel:'#c2a030', ontological:'#5b8db8',
  pollution:'#8cd17d', population:'#86bcb6', prosocial:'#f1ce63',
  scale:'#499894', segregationism:'#e8a0b4', type:'#e6522c',
  use:'#fd7f6f', wmd:'#b0b0b0',
};

const DEGREE_PART_COLORS = ['#a6cee3', '#1f78b4', '#fb9a99', '#e31a1c'];

const COMMUNITY_COLORS = [
  '#e41a1c','#377eb8','#4daf4a','#984ea3',
  '#ff7f00','#a65628','#f781bf','#888888',
  '#00bcd4','#8bc34a','#ff5722','#9c27b0',
];
function communityColor(id) { return COMMUNITY_COLORS[id % COMMUNITY_COLORS.length]; }

function getCategory(name) {
  if (/^antisocial_into_prosocial/.test(name)) return 'antisocial';
  if (/^prosocial_into_antisocial/.test(name)) return 'prosocial';
  if (/^use_of_force/.test(name))              return 'use';
  if (/^wmd_use/.test(name))                   return 'wmd';
  return name.split('_')[0];
}
function colorFor(name) { return CAT_COLORS[getCategory(name)] || '#aaa'; }

/* ══════════════════════════════════════════════
   CSV CACHE & PARSING
══════════════════════════════════════════════ */
const csvCache = new Map();

async function fetchParsed(model, lang) {
  const key = `${model}_${lang}`;
  if (csvCache.has(key)) return csvCache.get(key);
  const url = `../db/cooccurences/${model}_cooccurrence_atomic_attributes_${lang}.csv`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const parsed = parseCSV(await resp.text());
  csvCache.set(key, parsed);
  return parsed;
}

function parseCSV(csvText) {
  const { data: rows } = Papa.parse(csvText.trim(), { skipEmptyLines: true });
  if (rows.length < 2) return { nodes: [], edges: [] };

  const colNames = rows[0].slice(1).map(s => s.trim()).filter(Boolean);
  const nodeSet = new Set();
  const edgeMap = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowName = (row[0] || '').trim();
    if (!rowName) continue;
    nodeSet.add(rowName);

    for (let j = 1; j < row.length; j++) {
      const colIdx = j - 1;
      if (colIdx >= colNames.length) continue;
      const colName = colNames[colIdx];
      if (!colName || colName === rowName) continue;
      const w = parseInt(row[j], 10) || 0;
      if (w <= 0) continue;
      const key = [rowName, colName].sort().join('\x00');
      if (!edgeMap.has(key)) edgeMap.set(key, { source: rowName, target: colName, weight: w });
      nodeSet.add(colName);
    }
  }

  const strength = {};
  nodeSet.forEach(n => { strength[n] = 0; });
  edgeMap.forEach(({ source, target, weight }) => {
    strength[source] += weight; strength[target] += weight;
  });

  const maxStr    = Math.max(...Object.values(strength), 1);
  const maxWeight = Math.max(...[...edgeMap.values()].map(e => e.weight), 1);

  const nodes = [...nodeSet].map(name => ({
    id: name, category: getCategory(name), color: colorFor(name),
    strength: strength[name] || 0, ns: (strength[name] || 0) / maxStr,
  }));

  const edges = [...edgeMap.values()].map(({ source, target, weight }, i) => ({
    id: `e${i}`, source, target, weight, nw: weight / maxWeight,
  }));

  computeEigenvectorCentrality(nodes, edges);
  computeClusteringCoefficient(nodes, edges);
  computeHITS(nodes, edges);
  const { numCommunities, modularity } = detectCommunities(nodes, edges);

  return { nodes, edges, numCommunities, modularity };
}

/* ══════════════════════════════════════════════
   EIGENVECTOR CENTRALITY  (power iteration)
══════════════════════════════════════════════ */
function computeEigenvectorCentrality(nodes, edges, maxIter = 200, tol = 1e-7) {
  const n = nodes.length;
  if (n === 0) return;

  const idx = new Map(nodes.map((node, i) => [node.id, i]));
  let scores = new Array(n).fill(1.0 / n);

  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Array(n).fill(0);
    edges.forEach(({ source, target, weight }) => {
      const i = idx.get(source);
      const j = idx.get(target);
      if (i === undefined || j === undefined) return;
      next[i] += weight * scores[j];
      next[j] += weight * scores[i];
    });

    // L2 normalization
    const norm = Math.sqrt(next.reduce((s, v) => s + v * v, 0)) || 1;
    const nextNorm = next.map(v => v / norm);

    // Convergence check
    const diff = nextNorm.reduce((s, v, i) => s + Math.abs(v - scores[i]), 0);
    scores = nextNorm;
    if (diff < tol) break;
  }

  const maxScore = Math.max(...scores, 1e-10);
  nodes.forEach((node, i) => {
    node.ec     = scores[i];
    node.ecNorm = scores[i] / maxScore;   // 0–1 for visual encoding
  });
}

/* ══════════════════════════════════════════════
   CLUSTERING COEFFICIENT
══════════════════════════════════════════════ */
function computeClusteringCoefficient(nodes, edges) {
  const adj      = new Map(nodes.map(n => [n.id, new Set()]));
  const edgeSet  = new Set();

  edges.forEach(({ source, target }) => {
    adj.get(source)?.add(target);
    adj.get(target)?.add(source);
    edgeSet.add([source, target].sort().join('\x00'));
  });

  nodes.forEach(node => {
    const nbrs = [...(adj.get(node.id) || [])];
    const k = nbrs.length;
    if (k < 2) { node.cc = 0; return; }
    let triangles = 0;
    for (let i = 0; i < k; i++)
      for (let j = i + 1; j < k; j++)
        if (edgeSet.has([nbrs[i], nbrs[j]].sort().join('\x00'))) triangles++;
    node.cc = (2 * triangles) / (k * (k - 1));
  });
}

/* ══════════════════════════════════════════════
   HITS  (Hub & Authority scores)
══════════════════════════════════════════════ */
function computeHITS(nodes, edges, maxIter = 100, tol = 1e-6) {
  const n = nodes.length;
  if (n === 0) return;

  const adj = new Map(nodes.map(nd => [nd.id, []]));
  edges.forEach(({ source, target, weight }) => {
    adj.get(source)?.push({ id: target, weight });
    adj.get(target)?.push({ id: source, weight });
  });

  let hub  = new Map(nodes.map(nd => [nd.id, 1 / n]));
  let auth = new Map(nodes.map(nd => [nd.id, 1 / n]));

  for (let iter = 0; iter < maxIter; iter++) {
    const newAuth = new Map();
    nodes.forEach(nd => {
      newAuth.set(nd.id, adj.get(nd.id).reduce((s, { id, weight }) => s + weight * hub.get(id), 0));
    });
    const newHub = new Map();
    nodes.forEach(nd => {
      newHub.set(nd.id, adj.get(nd.id).reduce((s, { id, weight }) => s + weight * newAuth.get(id), 0));
    });

    const normA = Math.sqrt([...newAuth.values()].reduce((s, v) => s + v * v, 0)) || 1;
    const normH = Math.sqrt([...newHub.values()].reduce((s, v) => s + v * v, 0)) || 1;
    let diff = 0;
    nodes.forEach(nd => {
      newAuth.set(nd.id, newAuth.get(nd.id) / normA);
      newHub.set(nd.id,  newHub.get(nd.id)  / normH);
      diff += Math.abs(newAuth.get(nd.id) - auth.get(nd.id));
    });
    auth = newAuth; hub = newHub;
    if (diff < tol) break;
  }

  const maxA = Math.max(...auth.values(), 1e-10);
  const maxH = Math.max(...hub.values(),  1e-10);
  nodes.forEach(nd => {
    nd.auth     = auth.get(nd.id);
    nd.authNorm = nd.auth / maxA;
    nd.hub      = hub.get(nd.id);
    nd.hubNorm  = nd.hub  / maxH;
  });
}

/* ══════════════════════════════════════════════
   MODULARITY  (Louvain, phase 1)
══════════════════════════════════════════════ */
function detectCommunities(nodes, edges) {
  const n = nodes.length;
  if (n === 0) return { numCommunities: 0, modularity: 0 };

  const idx = new Map(nodes.map((node, i) => [node.id, i]));
  const adj = nodes.map(() => new Map());
  const k   = new Array(n).fill(0); // weighted degree

  edges.forEach(({ source, target, weight }) => {
    const i = idx.get(source), j = idx.get(target);
    if (i === undefined || j === undefined) return;
    adj[i].set(j, (adj[i].get(j) || 0) + weight);
    adj[j].set(i, (adj[j].get(i) || 0) + weight);
    k[i] += weight;
    k[j] += weight;
  });

  const twoM = k.reduce((s, v) => s + v, 0);
  if (twoM === 0) {
    nodes.forEach((node, i) => { node.community = i; });
    return { numCommunities: n, modularity: 0 };
  }

  // Each node starts in its own community
  const community = nodes.map((_, i) => i);
  const sigmaTot  = [...k];
  const sigmaIn   = new Array(n).fill(0);

  let improved = true;
  let pass = 0;
  while (improved && pass++ < 50) {
    improved = false;
    for (let i = 0; i < n; i++) {
      const ci = community[i];

      // Weights from i to its current community (excluding self)
      let ki_in_ci = 0;
      adj[i].forEach((w, j) => { if (community[j] === ci) ki_in_ci += w; });

      // Remove i from ci temporarily
      sigmaTot[ci] -= k[i];
      sigmaIn[ci]  -= 2 * ki_in_ci;
      community[i]  = -1;

      // Aggregate weights per neighboring community
      const commWeights = new Map();
      adj[i].forEach((w, j) => {
        const cj = community[j];
        if (cj >= 0) commWeights.set(cj, (commWeights.get(cj) || 0) + w);
      });

      // Best option defaults to going back to ci
      let bestComm = ci;
      let bestGain = (commWeights.get(ci) || 0) - sigmaTot[ci] * k[i] / twoM;

      commWeights.forEach((w, c) => {
        if (c === ci) return;
        const gain = w - sigmaTot[c] * k[i] / twoM;
        if (gain > bestGain) { bestGain = gain; bestComm = c; }
      });

      // Move i to bestComm and update stats
      community[i] = bestComm;
      let ki_in_best = 0;
      adj[i].forEach((w, j) => { if (community[j] === bestComm) ki_in_best += w; });
      sigmaTot[bestComm] += k[i];
      sigmaIn[bestComm]  += 2 * ki_in_best;

      if (bestComm !== ci) improved = true;
    }
  }

  // Renumber community IDs from 0
  const commMap = new Map();
  let nextId = 0;
  nodes.forEach((node, i) => {
    const c = community[i];
    if (!commMap.has(c)) commMap.set(c, nextId++);
    node.community = commMap.get(c);
  });

  // Compute modularity Q = Σ_c [ sigmaIn_c/2m - (sigmaTot_c/2m)² ]
  const qIn  = new Map();
  const qTot = new Map();
  nodes.forEach((node, i) => {
    const c = node.community;
    qIn.set(c,  (qIn.get(c)  || 0));
    qTot.set(c, (qTot.get(c) || 0) + k[i]);
  });
  edges.forEach(({ source, target, weight }) => {
    const i = idx.get(source), j = idx.get(target);
    if (i === undefined || j === undefined) return;
    if (nodes[i].community === nodes[j].community) {
      const c = nodes[i].community;
      qIn.set(c, qIn.get(c) + 2 * weight);
    }
  });
  let Q = 0;
  qIn.forEach((sIn, c) => { Q += sIn / twoM - Math.pow(qTot.get(c) / twoM, 2); });

  return { numCommunities: nextId, modularity: +Q.toFixed(4) };
}

/* ══════════════════════════════════════════════
   GRAPH SIMILARITY METRICS
══════════════════════════════════════════════ */
function computeWeightedJaccard(edges1, edges2) {
  const w1 = new Map(edges1.map(e => [[e.source, e.target].sort().join('\x00'), e.weight]));
  const w2 = new Map(edges2.map(e => [[e.source, e.target].sort().join('\x00'), e.weight]));
  const allKeys = new Set([...w1.keys(), ...w2.keys()]);
  let sumMin = 0, sumMax = 0;
  allKeys.forEach(k => {
    const a = w1.get(k) || 0, b = w2.get(k) || 0;
    sumMin += Math.min(a, b); sumMax += Math.max(a, b);
  });
  return sumMax === 0 ? 0 : +(sumMin / sumMax).toFixed(4);
}

function computeCosineSimilarityEC(nodes1, nodes2) {
  const v1 = new Map(nodes1.map(n => [n.id, n.ec || 0]));
  const v2 = new Map(nodes2.map(n => [n.id, n.ec || 0]));
  const allIds = new Set([...v1.keys(), ...v2.keys()]);
  let dot = 0, norm1 = 0, norm2 = 0;
  allIds.forEach(id => {
    const a = v1.get(id) || 0, b = v2.get(id) || 0;
    dot += a * b; norm1 += a * a; norm2 += b * b;
  });
  return (norm1 === 0 || norm2 === 0) ? 0 : +(dot / (Math.sqrt(norm1) * Math.sqrt(norm2))).toFixed(4);
}

/* ══════════════════════════════════════════════
   DEGREE PARTITION
══════════════════════════════════════════════ */
function computeDegreePartition(edges) {
  const strengthMap = new Map();
  edges.forEach(e => {
    strengthMap.set(e._src, (strengthMap.get(e._src) || 0) + e.weight);
    strengthMap.set(e._tgt, (strengthMap.get(e._tgt) || 0) + e.weight);
  });
  const vals = [...strengthMap.values()];
  const qScale = d3.scaleQuantile().domain(vals).range([0, 1, 2, 3]);
  const part = new Map();
  strengthMap.forEach((v, id) => part.set(id, qScale(v)));
  return part;
}

/* ══════════════════════════════════════════════
   EDGE COLOR
══════════════════════════════════════════════ */
function computeEdgeColor(edge, mode, degPart) {
  if (mode === 'weight')       return d3.interpolateGreys(0.2 + edge.nw * 0.65);
  if (mode === 'source-cat')   return colorFor(edge._src);
  if (mode === 'degree-part')  return DEGREE_PART_COLORS[degPart.get(edge._src) ?? 0];
  return '#aaa';
}

/* ══════════════════════════════════════════════
   DRAG BEHAVIOR
══════════════════════════════════════════════ */
function dragBehavior(simulation) {
  return d3.drag()
    .on('start', (event) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    })
    .on('drag', (event) => {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    })
    .on('end', (event) => {
      if (!event.active) simulation.alphaTarget(0);
      // keep pinned (Gephi-like); double-click to unpin
    });
}

/* ══════════════════════════════════════════════
   D3 GRAPH FACTORY
══════════════════════════════════════════════ */
function createD3Graph(container, graphData, { mini = false, edgeColorMode = 'weight', nodeSizeMode = 'uniform', nodeColorMode = 'category' } = {}) {
  const width  = container.clientWidth  || 800;
  const height = container.clientHeight || 600;

  // Deep-clone to avoid shared mutation between views
  const nodeData = graphData.nodes.map(d => ({ ...d }));
  const edgeData = graphData.edges.map(d => ({
    ...d,
    _src: d.source,  // preserve string IDs before D3 replaces them with objects
    _tgt: d.target,
  }));

  let _nodeSizeMode  = nodeSizeMode;
  let _nodeColorMode = nodeColorMode;
  const BASE_R  = mini ? 3 : 5;
  const MAX_ADD = mini ? 9 : 18;
  function nodeRadius(d) {
    if (_nodeSizeMode === 'centrality') return BASE_R + (d.ecNorm   ?? 0) * MAX_ADD;
    if (_nodeSizeMode === 'cc')         return BASE_R + (d.cc       ?? 0) * MAX_ADD;
    if (_nodeSizeMode === 'hub')        return BASE_R + (d.hubNorm  ?? 0) * MAX_ADD;
    if (_nodeSizeMode === 'authority')  return BASE_R + (d.authNorm ?? 0) * MAX_ADD;
    return BASE_R;
  }
  function nodeColor(d) {
    if (_nodeColorMode === 'community') return communityColor(d.community ?? 0);
    return d.color; // category color
  }

  const degPart = computeDegreePartition(edgeData);

  // ── SVG ──
  const svg = d3.select(container).append('svg')
    .attr('width', '100%').attr('height', '100%')
    .style('display', 'block');

  const zoomBehavior = d3.zoom()
    .scaleExtent([0.05, 15])
    .on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoomBehavior);

  // Transparent background rect (catches background clicks)
  const bgRect = svg.append('rect')
    .attr('width', '100%').attr('height', '100%')
    .attr('fill', 'transparent');

  const g = svg.append('g');

  // ── Force simulation ──
  const linkForce = d3.forceLink(edgeData)
    .id(d => d.id)
    .distance(d => (mini ? 50 : 100) + (1 - d.nw) * (mini ? 60 : 120))
    .strength(d => 0.04 + d.nw * 0.3);

  const simulation = d3.forceSimulation(nodeData)
    .force('link',    linkForce)
    .force('charge',  d3.forceManyBody().strength(mini ? -200 : -500).distanceMax(500))
    .force('center',  d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide(d => nodeRadius(d) + (mini ? 2 : 4)))
    .alphaDecay(0.022);

  // ── Edges ──
  let _edgeMode = edgeColorMode;
  const linkG = g.append('g').attr('class', 'links');
  const linkSel = linkG.selectAll('line').data(edgeData).join('line')
    .attr('stroke',         d => computeEdgeColor(d, _edgeMode, degPart))
    .attr('stroke-opacity', d => 0.35 + d.nw * 0.55)
    .attr('stroke-width',   d => mini ? 0.8 + d.nw * 2 : 1.5 + d.nw * 5);

  // ── Nodes ──
  const nodeG = g.append('g').attr('class', 'nodes');
  const nodeSel = nodeG.selectAll('circle').data(nodeData).join('circle')
    .attr('r',    nodeRadius)
    .attr('fill', nodeColor)
    .style('cursor', 'pointer')
    .call(dragBehavior(simulation))
    .on('dblclick', (event, d) => {
      d.fx = null; d.fy = null;
      simulation.alphaTarget(0.1).restart();
    });

  // ── Persistent labels (toggle) ──
  let _showLabels = false;
  const labelG = g.append('g').attr('class', 'labels');
  const labelSel = labelG.selectAll('text').data(nodeData).join('text')
    .attr('pointer-events', 'none')
    .style('display', 'none')
    .attr('font-size', mini ? '7px' : '11px')
    .attr('fill', '#1c1c2e')
    .attr('font-family', "'Segoe UI', system-ui, sans-serif")
    .attr('paint-order', 'stroke')
    .attr('stroke', 'rgba(255,255,255,0.85)')
    .attr('stroke-width', mini ? 2 : 3)
    .attr('dy', '-7px')
    .text(d => d.id);

  // ── Hover label ──
  let _hoveredNode = null;
  const hoverLabel = g.append('text')
    .attr('pointer-events', 'none')
    .style('display', 'none')
    .attr('font-size', mini ? '8px' : '12px')
    .attr('fill', '#1c1c2e')
    .attr('font-family', "'Segoe UI', system-ui, sans-serif")
    .attr('paint-order', 'stroke')
    .attr('stroke', 'rgba(255,255,255,0.9)')
    .attr('stroke-width', mini ? 2 : 3)
    .attr('dy', '-7px');

  // ── Tick ──
  simulation.on('tick', () => {
    linkSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
           .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    nodeSel.attr('cx', d => d.x).attr('cy', d => d.y);
    if (_showLabels) labelSel.attr('x', d => d.x).attr('y', d => d.y);
    if (_hoveredNode) hoverLabel.attr('x', _hoveredNode.x).attr('y', _hoveredNode.y);
  });

  // ── Neighbor & edge lookup maps (using _src/_tgt) ──
  const neighborMap = new Map(nodeData.map(n => [n.id, new Set()]));
  const nodeEdgeMap = new Map(nodeData.map(n => [n.id, []]));
  edgeData.forEach(e => {
    neighborMap.get(e._src)?.add(e._tgt);
    neighborMap.get(e._tgt)?.add(e._src);
    nodeEdgeMap.get(e._src)?.push(e);
    nodeEdgeMap.get(e._tgt)?.push(e);
  });

  // ── Internal state ──
  let _minWeight  = 1;
  let _hiddenCats = new Set();

  function isEdgeVisible(e) {
    return e.weight >= _minWeight
      && !_hiddenCats.has(getCategory(e._src))
      && !_hiddenCats.has(getCategory(e._tgt));
  }

  // ── Controller ──
  const ctrl = {
    nodes: nodeData,
    edges: edgeData,
    nodeEdgeMap,

    destroy() {
      simulation.stop();
      svg.remove();
    },

    applyFilter(minWeight, hiddenCats = new Set()) {
      _minWeight  = minWeight;
      _hiddenCats = new Set(hiddenCats);

      linkSel.attr('visibility', d => isEdgeVisible(d) ? 'visible' : 'hidden');

      const visNodes = new Set();
      edgeData.forEach(e => { if (isEdgeVisible(e)) { visNodes.add(e._src); visNodes.add(e._tgt); } });
      nodeSel.attr('visibility', d =>
        !_hiddenCats.has(d.category) && visNodes.has(d.id) ? 'visible' : 'hidden');
    },

    getMinWeight() { return _minWeight; },

    setEdgeColor(mode) {
      _edgeMode = mode;
      linkSel.attr('stroke', d => computeEdgeColor(d, mode, degPart));
    },

    highlightNode(id) {
      if (!id) { ctrl.resetHighlight(); return; }
      const neighbors = new Set([id]);
      const connEdgeSet = new Set();
      edgeData.forEach(e => {
        if (!isEdgeVisible(e)) return;
        if (e._src === id || e._tgt === id) {
          neighbors.add(e._src); neighbors.add(e._tgt); connEdgeSet.add(e);
        }
      });
      nodeSel.attr('opacity', d => neighbors.has(d.id) ? 1 : 0.07);
      linkSel.attr('opacity', d => {
        if (!isEdgeVisible(d)) return 0;
        return connEdgeSet.has(d) ? 0.85 : 0.03;
      });
    },

    resetHighlight() {
      nodeSel.attr('opacity', 1);
      linkSel.attr('opacity', d => isEdgeVisible(d) ? 0.12 + d.nw * 0.55 : 0);
    },

    getStats() {
      let visEdges = 0;
      const visNodes = new Set();
      edgeData.forEach(e => {
        if (isEdgeVisible(e)) { visEdges++; visNodes.add(e._src); visNodes.add(e._tgt); }
      });
      return { nodes: visNodes.size, edges: visEdges };
    },

    setNodeSize(mode) {
      _nodeSizeMode = mode;
      nodeSel.attr('r', nodeRadius);
      simulation.force('collide', d3.forceCollide(d => nodeRadius(d) + (mini ? 2 : 4)));
      simulation.alphaTarget(0.1).restart();
      setTimeout(() => simulation.alphaTarget(0), 600);
    },

    setNodeColor(mode) {
      _nodeColorMode = mode;
      nodeSel.attr('fill', nodeColor);
    },

    setLabels(show) {
      _showLabels = show;
      if (show) {
        labelSel.attr('x', d => d.x).attr('y', d => d.y).style('display', null);
      } else {
        labelSel.style('display', 'none');
      }
    },

    onBgClick(handler)   { bgRect.on('click', handler); },
    onNodeClick(handler) { nodeSel.on('click', handler); },
    onNodeOver(handler)  { nodeSel.on('mouseover.ext', handler); },
    onNodeMove(handler)  { nodeSel.on('mousemove.ext', handler); },
    onNodeOut(handler)   { nodeSel.on('mouseout.ext', handler); },
  };

  // Label events (namespaced so external handlers don't override)
  nodeSel
    .on('mouseover.label', (event, d) => {
      if (_showLabels) return;
      _hoveredNode = d;
      const parts = [];
      if (d.ec   != null) parts.push(`EC:${d.ec.toFixed(3)}`);
      if (d.cc   != null) parts.push(`CC:${d.cc.toFixed(3)}`);
      if (d.hub  != null) parts.push(`Hub:${d.hub.toFixed(3)}`);
      const suffix = parts.length ? ` (${parts.join(' · ')})` : '';
      hoverLabel.style('display', null).attr('x', d.x).attr('y', d.y).text(d.id + suffix);
    })
    .on('mouseout.label', () => {
      _hoveredNode = null;
      hoverLabel.style('display', 'none');
    });

  container.addEventListener('mouseleave', () => {
    _hoveredNode = null;
    hoverLabel.style('display', 'none');
  });

  return ctrl;
}

/* ══════════════════════════════════════════════
   TOOLTIP
══════════════════════════════════════════════ */
function showTooltip(event, d, ctrl) {
  const tip = document.getElementById('tooltip');

  // Name + color dot
  const dot  = tip.querySelector('.tt-dot');
  const name = tip.querySelector('#tt-name span');
  dot.style.background = d.color;
  name.textContent = d.id;

  // Meta
  const { nodes: vn, edges: ve } = ctrl.getStats();
  document.getElementById('tt-meta').textContent =
    `${d.category} · strength ${d.strength} · degree ${ctrl.nodeEdgeMap.get(d.id)?.filter(e => e.weight >= ctrl.getMinWeight()).length ?? 0}`;

  // Top connections
  const edges = (ctrl.nodeEdgeMap.get(d.id) || [])
    .filter(e => e.weight >= ctrl.getMinWeight())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  const connsDiv = document.getElementById('tt-conns');
  if (edges.length === 0) {
    connsDiv.innerHTML = '<em style="color:#ccc">no visible connections</em>';
  } else {
    connsDiv.innerHTML = edges.map(e => {
      const other = e._src === d.id ? e._tgt : e._src;
      return `<div class="tt-row"><span>${other}</span><span class="tt-w">${e.weight}</span></div>`;
    }).join('');
  }

  positionTooltip(event);
  tip.style.display = 'block';
}

function positionTooltip(event) {
  const tip = document.getElementById('tooltip');
  const margin = 14;
  let x = event.clientX + margin;
  let y = event.clientY - margin;
  const tw = tip.offsetWidth || 240;
  const th = tip.offsetHeight || 120;
  if (x + tw > window.innerWidth  - 4) x = event.clientX - tw - margin;
  if (y + th > window.innerHeight - 4) y = event.clientY - th - margin;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}
function moveTooltip(event) { positionTooltip(event); }
function hideTooltip() { document.getElementById('tooltip').style.display = 'none'; }

/* ══════════════════════════════════════════════
   STATE
══════════════════════════════════════════════ */
const state = {
  view: 'landing',
  minWeightSingle: 3,
  minWeightMulti:  3,
  hiddenCats: new Set(),
  singleGraph: null,
  multiGraphs: [],   // [{ ctrl, model, lang }]
  selectedNodeId: null,
  graphData: null,
  allGraphResults: null,
};

function destroyAllGraphs() {
  if (state.singleGraph) { state.singleGraph.destroy(); state.singleGraph = null; }
  state.multiGraphs.forEach(({ ctrl }) => ctrl.destroy());
  state.multiGraphs = [];
}

/* ══════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════ */
function navigate(view, params = {}) {
  destroyAllGraphs();
  hideTooltip();
  state.selectedNodeId = null;
  state.hiddenCats = new Set();

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  state.view = view;

  document.getElementById('back-btn').classList.toggle('hidden', view === 'landing');
  document.getElementById('header-stats').textContent = '';

  if (view === 'landing')    showLanding();
  if (view === 'single')     showSingle(params.model, params.lang);
  if (view === 'dimension')  showDimension(params.axis, params.fixed);
  if (view === 'compare')    showCompare(params.a, params.b);
  if (view === 'similarity') showSimilarity();
  if (view === 'about')      { setBreadcrumb(['About']); }
}
document.getElementById('back-btn').addEventListener('click', () => navigate('landing'));

function setBreadcrumb(parts) {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = parts.map(p => `<span>›</span> ${p}`).join('');
}

/* ══════════════════════════════════════════════
   LANDING VIEW
══════════════════════════════════════════════ */
function showLanding() {
  setBreadcrumb([]);
  const table = document.getElementById('card-table');
  table.innerHTML = '';

  // Corner
  table.appendChild(div('ct-corner'));

  // Column headers (languages)
  LANGS.forEach(lang => {
    const th = div('ct-col-header');
    th.textContent = LANG_LABEL[lang];
    table.appendChild(th);
  });

  // Rows (models)
  MODELS.forEach(model => {
    const rowLbl = div('ct-row-label');
    const badge  = el('span');
    badge.textContent = MODEL_LABEL[model];
    badge.style.background = MODEL_COLOR[model] + '22';
    badge.style.color = MODEL_COLOR[model];
    rowLbl.appendChild(badge);
    table.appendChild(rowLbl);

    LANGS.forEach(lang => {
      const card = div('graph-card');
      const lbdg = div('card-lang-badge'); lbdg.textContent = LANG_LABEL[lang]; card.appendChild(lbdg);
      const sts  = div('card-stats'); sts.id = `cs-${model}-${lang}`;
      sts.innerHTML = '<span class="card-stat loading">loading…</span>';
      card.appendChild(sts);
      const arr = div('card-arrow'); arr.textContent = '→ explore'; card.appendChild(arr);
      card.addEventListener('click', () => navigate('single', { model, lang }));
      table.appendChild(card);
    });
  });

  // Load stats async + build similarity matrices when all loaded
  const allFetches = MODELS.flatMap(model => LANGS.map(lang =>
    fetchParsed(model, lang).then(data => {
      const el2 = document.getElementById(`cs-${model}-${lang}`);
      if (el2) el2.innerHTML =
        `<span class="card-stat"><strong>${data.nodes.length}</strong> nodes</span>
         <span class="card-stat"><strong>${data.edges.length}</strong> edges</span>`;
      return { model, lang, data };
    }).catch(() => {
      const el2 = document.getElementById(`cs-${model}-${lang}`);
      if (el2) el2.innerHTML = '<span class="card-stat" style="color:#c44">error</span>';
      return null;
    })
  ));

  Promise.all(allFetches).then(results => {
    state.allGraphResults = results.filter(Boolean);
  });
}

/* ══════════════════════════════════════════════
   SIMILARITY VIEW
══════════════════════════════════════════════ */
function showSimilarity() {
  setBreadcrumb(['Similarity']);

  // If data already loaded, render immediately
  if (state.allGraphResults && state.allGraphResults.length >= 2) {
    renderSimilaritySection(state.allGraphResults);
    return;
  }

  // Otherwise load all 12 graphs first
  const jWrap = document.getElementById('sim-jaccard');
  const cWrap = document.getElementById('sim-cosine');
  if (jWrap) jWrap.innerHTML = '<p style="padding:16px;color:#888">Loading…</p>';
  if (cWrap) cWrap.innerHTML = '';

  const fetches = MODELS.flatMap(model => LANGS.map(lang =>
    fetchParsed(model, lang)
      .then(data => ({ model, lang, data }))
      .catch(() => null)
  ));
  Promise.all(fetches).then(results => {
    state.allGraphResults = results.filter(Boolean);
    if (state.allGraphResults.length >= 2) renderSimilaritySection(state.allGraphResults);
  });
}

/* ══════════════════════════════════════════════
   SIMILARITY MATRICES
══════════════════════════════════════════════ */
const MODEL_ABBR = { claude:'CL', chatgpt:'GP', gemini:'GE' };

function renderSimilaritySection(results) {

  const n = results.length;
  const labels = results.map(r => `${MODEL_ABBR[r.model]}/${r.lang.substring(0,2)}`);

  // Build matrices
  const jMatrix = results.map((r1, i) => results.map((r2, j) =>
    i === j ? 1 : computeWeightedJaccard(r1.data.edges, r2.data.edges)
  ));
  const cMatrix = results.map((r1, i) => results.map((r2, j) =>
    i === j ? 1 : computeCosineSimilarityEC(r1.data.nodes, r2.data.nodes)
  ));

  renderHeatmap('sim-jaccard', labels, jMatrix, '#2166ac');
  renderHeatmap('sim-cosine',  labels, cMatrix, '#1a9850');

  // Toggle buttons
  ['jaccard','cosine'].forEach(type => {
    document.getElementById(`sim-btn-${type}`).onclick = () => {
      ['jaccard','cosine'].forEach(t => {
        document.getElementById(`sim-${t}`).style.display     = t === type ? '' : 'none';
        document.getElementById(`sim-btn-${t}`).classList.toggle('active', t === type);
      });
    };
  });
}

function renderHeatmap(containerId, labels, matrix, baseColor) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.innerHTML = '';

  const n = labels.length;
  const table = document.createElement('table');
  table.className = 'sim-table';

  // Header row
  const thead = document.createElement('thead');
  const hrow  = document.createElement('tr');
  hrow.appendChild(document.createElement('th')); // corner
  labels.forEach(lbl => {
    const th = document.createElement('th');
    th.textContent = lbl;
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  // Data rows
  const tbody = document.createElement('tbody');
  matrix.forEach((row, i) => {
    const tr = document.createElement('tr');
    const rowLbl = document.createElement('th');
    rowLbl.textContent = labels[i];
    tr.appendChild(rowLbl);
    row.forEach((val, j) => {
      const td = document.createElement('td');
      td.textContent = val.toFixed(2);
      td.title = `${labels[i]} vs ${labels[j]}: ${val.toFixed(4)}`;
      if (i === j) {
        td.style.background = '#1c1c2e';
        td.style.color = '#fff';
      } else {
        // interpolate white → baseColor
        const t = val;
        td.style.background = `color-mix(in srgb, ${baseColor} ${Math.round(t*100)}%, #f8f8f6)`;
        td.style.color = t > 0.55 ? '#fff' : '#333';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

/* ══════════════════════════════════════════════
   SINGLE VIEW
══════════════════════════════════════════════ */
function showSingle(model, lang) {
  setBreadcrumb([`${MODEL_LABEL[model]} — ${LANG_LABEL[lang]}`]);

  const spinner = document.getElementById('single-spinner');
  spinner.classList.remove('hidden');

  const edgeColorSel = document.getElementById('s-edge-color');
  edgeColorSel.value = 'weight';
  document.getElementById('s-deg-legend').style.display = 'none';

  const nodeColorSel = document.getElementById('s-node-color');
  nodeColorSel.value = 'category';
  nodeColorSel.onchange = function () {
    if (state.singleGraph) {
      state.singleGraph.setNodeColor(this.value);
      buildSingleLegend(state.singleGraph, this.value);
    }
  };

  const nodeSizeSel = document.getElementById('s-node-size');
  nodeSizeSel.value = 'uniform';
  nodeSizeSel.onchange = function () {
    if (state.singleGraph) state.singleGraph.setNodeSize(this.value);
  };

  const slider = document.getElementById('s-weight-slider');
  slider.value = state.minWeightSingle;
  document.getElementById('s-weight-value').textContent = state.minWeightSingle;

  // Labels toggle
  const labelsBtn = document.getElementById('s-labels-toggle');
  labelsBtn.classList.remove('active');
  labelsBtn.textContent = 'Show labels';
  labelsBtn.onclick = () => {
    const on = labelsBtn.classList.toggle('active');
    labelsBtn.textContent = on ? 'Hide labels' : 'Show labels';
    if (state.singleGraph) state.singleGraph.setLabels(on);
  };

  fetchParsed(model, lang).then(data => {
    state.graphData = data;
    const container = document.getElementById('single-cy');

    // Ensure container is laid out before measuring
    setTimeout(() => {
      const ctrl = createD3Graph(container, data, {
        mini: false,
        edgeColorMode: edgeColorSel.value,
      });
      state.singleGraph = ctrl;
      spinner.classList.add('hidden');

      ctrl.applyFilter(state.minWeightSingle, state.hiddenCats);
      updateHeaderStats();

      // Restore labels state if toggle was already active
      if (labelsBtn.classList.contains('active')) ctrl.setLabels(true);

      buildSingleLegend(ctrl, nodeColorSel.value);
      bindSingleInteractions(ctrl);
    }, 0);
  });

  // Slider
  slider.oninput = function () {
    state.minWeightSingle = +this.value;
    document.getElementById('s-weight-value').textContent = this.value;
    if (state.singleGraph) {
      state.singleGraph.applyFilter(state.minWeightSingle, state.hiddenCats);
      updateHeaderStats();
    }
  };

  // Edge color
  edgeColorSel.oninput = function () {
    document.getElementById('s-deg-legend').style.display =
      this.value === 'degree-part' ? 'flex' : 'none';
    if (state.singleGraph) state.singleGraph.setEdgeColor(this.value);
  };
}

function bindSingleInteractions(ctrl) {
  let selectedId = null;

  ctrl.onNodeOver((event, d) => {
    if (!selectedId) ctrl.highlightNode(d.id);
  });
  ctrl.onNodeMove(() => {});
  ctrl.onNodeOut(() => {
    if (!selectedId) ctrl.resetHighlight();
  });
  ctrl.onNodeClick((event, d) => {
    event.stopPropagation();
    selectedId = d.id;
    ctrl.highlightNode(d.id);
    showSingleNodeInfo(d.id, ctrl);
    document.getElementById('header-stats').textContent =
      `selected: ${d.id}`;
  });
  ctrl.onBgClick(() => {
    selectedId = null;
    ctrl.resetHighlight();
    clearSingleNodeInfo();
    updateHeaderStats();
  });
}

function buildSingleLegend(ctrl, colorMode = 'category') {
  const leg = document.getElementById('s-legend');
  leg.innerHTML = '';

  if (colorMode === 'community') {
    // Group nodes by community
    const comms = new Map();
    ctrl.nodes.forEach(n => {
      if (!comms.has(n.community)) comms.set(n.community, []);
      comms.get(n.community).push(n.id);
    });
    [...comms.entries()].sort((a, b) => a[0] - b[0]).forEach(([id, members]) => {
      const item = div('legend-item');
      const color = communityColor(id);
      item.innerHTML = `<div class="legend-dot" style="background:${color}"></div><span>Community ${id} <small style="color:#aaa">(${members.length})</small></span>`;
      item.title = members.slice(0, 8).join(', ') + (members.length > 8 ? '…' : '');
      leg.appendChild(item);
    });
  } else {
    const cats = new Map();
    ctrl.nodes.forEach(n => { if (!cats.has(n.category)) cats.set(n.category, n.color); });
    [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([cat, color]) => {
      const item = div('legend-item');
      item.dataset.cat = cat;
      item.innerHTML = `<div class="legend-dot" style="background:${color}"></div><span>${cat}</span>`;
      item.addEventListener('click', () => {
        if (state.hiddenCats.has(cat)) { state.hiddenCats.delete(cat); item.classList.remove('dimmed'); }
        else { state.hiddenCats.add(cat); item.classList.add('dimmed'); }
        if (state.singleGraph) {
          state.singleGraph.applyFilter(state.minWeightSingle, state.hiddenCats);
          updateHeaderStats();
        }
      });
      leg.appendChild(item);
    });
  }
}

function showSingleNodeInfo(nodeId, ctrl) {
  document.getElementById('s-placeholder').style.display = 'none';
  document.getElementById('s-node-detail').style.display = 'block';
  document.getElementById('s-node-title').textContent = nodeId;

  const node = ctrl.nodes.find(n => n.id === nodeId);
  const metricLines = [`category: ${getCategory(nodeId)}`];
  if (node) {
    if (node.ec   != null) metricLines.push(`EC: ${node.ec.toFixed(4)}`);
    if (node.cc   != null) metricLines.push(`clustering coeff: ${node.cc.toFixed(4)}`);
    if (node.hub  != null) metricLines.push(`hub: ${node.hub.toFixed(4)}  ·  authority: ${node.auth.toFixed(4)}`);
    if (node.community != null) metricLines.push(`community: ${node.community}`);
  }
  document.getElementById('s-node-cat').innerHTML = metricLines.join('<br>');

  const edges = (ctrl.nodeEdgeMap.get(nodeId) || [])
    .filter(e => e.weight >= ctrl.getMinWeight())
    .sort((a, b) => b.weight - a.weight);

  document.getElementById('s-conn-label').textContent = `${edges.length} connection(s)`;
  const ul = document.getElementById('s-conn-list');
  ul.innerHTML = '';
  edges.forEach(e => {
    const other = e._src === nodeId ? e._tgt : e._src;
    const li = document.createElement('li');
    li.innerHTML = `<span class="cn">${other}</span><span class="cw">${e.weight}</span>`;
    ul.appendChild(li);
  });
}

function clearSingleNodeInfo() {
  document.getElementById('s-placeholder').style.display = 'block';
  document.getElementById('s-node-detail').style.display = 'none';
}

function updateHeaderStats() {
  if (!state.singleGraph) return;
  const { nodes: n, edges: e } = state.singleGraph.getStats();
  const d = state.graphData;
  const extra = d ? `  ·  ${d.numCommunities} communities  ·  Q = ${d.modularity}` : '';
  document.getElementById('header-stats').textContent = `${n} nodes · ${e} edges${extra}`;
}

/* ══════════════════════════════════════════════
   DIMENSION VIEW
══════════════════════════════════════════════ */
function showDimension(axis, fixed) {
  const label = axis === 'model'
    ? `Compare models — ${LANG_LABEL[fixed]}`
    : `Compare languages — ${MODEL_LABEL[fixed]}`;
  setBreadcrumb([label]);

  // Build controls bar
  const bar = document.getElementById('dim-controls');
  bar.innerHTML = '';

  // Axis select
  const axGrp = mcGroup('Axis');
  const axSel = mcSelect([['model','Fix language, compare models'],['lang','Fix model, compare languages']], axis);
  axGrp.appendChild(axSel); bar.appendChild(axGrp);

  // Fixed value select
  const fxGrp = mcGroup(axis === 'model' ? 'Language' : 'Model');
  const opts   = axis === 'model' ? LANGS : MODELS;
  const lbls   = axis === 'model' ? LANG_LABEL : MODEL_LABEL;
  const fxSel  = mcSelect(opts.map(v => [v, lbls[v]]), fixed);
  fxGrp.appendChild(fxSel); bar.appendChild(fxGrp);

  // Edge color select
  const ecGrp = mcGroup('Edge colour');
  const ecSel = mcSelect([['weight','By weight'],['source-cat','Category'],['degree-part','Degree partition']], 'weight');
  ecGrp.appendChild(ecSel); bar.appendChild(ecGrp);

  // Weight slider
  const { slInput, slVal } = addSlider(bar, 'Min weight', state.minWeightMulti);

  // Node color select
  const dimNcGrp = mcGroup('Node color');
  const dimNcSel = mcSelect([['category','Category'],['community','Community']], 'category');
  dimNcGrp.appendChild(dimNcSel); bar.appendChild(dimNcGrp);

  // Node size select
  const dimNsGrp = mcGroup('Node size');
  const dimNsSel = mcSelect([['uniform','Uniform'],['centrality','Eigenvector centrality'],['cc','Clustering coeff.'],['hub','Hub score'],['authority','Authority score']], 'uniform');
  dimNsGrp.appendChild(dimNsSel); bar.appendChild(dimNsGrp);

  // Labels toggle
  const dimLabelsBtn = addToggleBtn(bar, 'Labels');

  // Stats span
  const statSpan = el('span'); statSpan.id = 'dim-stat';
  statSpan.style.cssText = 'font-size:.68rem;color:#bbb;margin-left:auto;';
  bar.appendChild(statSpan);

  // Reload on axis/fixed change
  axSel.addEventListener('change', () => showDimension(axSel.value, fxSel.value));
  fxSel.addEventListener('change', () => showDimension(axSel.value, fxSel.value));

  ecSel.addEventListener('change', () => {
    state.multiGraphs.forEach(({ ctrl }) => ctrl.setEdgeColor(ecSel.value));
  });

  slInput.addEventListener('input', function () {
    state.minWeightMulti = +this.value;
    slVal.textContent = this.value;
    state.multiGraphs.forEach(({ ctrl }) => ctrl.applyFilter(state.minWeightMulti));
    updateMultiStats('dim-stat');
  });

  dimNcSel.addEventListener('change', () => {
    state.multiGraphs.forEach(({ ctrl }) => ctrl.setNodeColor(dimNcSel.value));
  });

  dimNsSel.addEventListener('change', () => {
    state.multiGraphs.forEach(({ ctrl }) => ctrl.setNodeSize(dimNsSel.value));
  });

  dimLabelsBtn.addEventListener('click', () => {
    const on = dimLabelsBtn.classList.toggle('active');
    state.multiGraphs.forEach(({ ctrl }) => ctrl.setLabels(on));
  });

  // Build graph grid
  const varying   = axis === 'model' ? MODELS : LANGS;
  const grid      = document.getElementById('dim-grid');
  const panel     = document.getElementById('dim-panel');
  grid.innerHTML  = '';
  panel.classList.add('hidden');
  grid.className  = `multi-graph-area cols-${varying.length === 3 ? 3 : 4}`;

  state.multiGraphs.forEach(({ ctrl }) => ctrl.destroy());
  state.multiGraphs = [];

  varying.forEach((v, i) => {
    const model = axis === 'model' ? v    : fixed;
    const lang  = axis === 'model' ? fixed : v;
    const cell  = buildGraphCell(model, lang);
    grid.appendChild(cell);

    setTimeout(() => {
      const wrap    = cell.querySelector('.cell-d3-wrap');
      const spinner = cell.querySelector('.cy-spinner');
      spinner.classList.remove('hidden');

      fetchParsed(model, lang).then(data => {
        const ctrl = createD3Graph(wrap, data, { mini: true, edgeColorMode: ecSel.value });
        spinner.classList.add('hidden');
        state.multiGraphs.push({ ctrl, model, lang });

        ctrl.applyFilter(state.minWeightMulti);
        updateCellStat(cell, ctrl);
        updateMultiStats('dim-stat');

        ctrl.onNodeClick((event, d) => {
          event.stopPropagation();
          selectNodeAcrossGraphs(d.id, 'dim');
        });
        ctrl.onBgClick(() => clearCrossHighlight('dim'));
      });
    }, i * 120);
  });
}

/* ══════════════════════════════════════════════
   COMPARE VIEW (custom ×2)
══════════════════════════════════════════════ */
function showCompare(a, b) {
  const defA = a || { model: 'claude',   lang: 'global' };
  const defB = b || { model: 'chatgpt',  lang: 'global' };
  setBreadcrumb(['Custom comparison ×2']);

  const bar = document.getElementById('cmp-controls');
  bar.innerHTML = '';

  // Two selectors
  function addSelector(prefix, init) {
    const grp  = div('mc-group'); grp.style.gap = '5px';
    const lbl  = el('span', 'mc-label'); lbl.textContent = prefix === 'cmp-a' ? 'Graph A' : 'Graph B';
    const mSel = mcSelect(MODELS.map(m => [m, MODEL_LABEL[m]]), init.model);
    const lSel = mcSelect(LANGS.map(l  => [l, LANG_LABEL[l]]),  init.lang);
    mSel.id = `${prefix}-model`; lSel.id = `${prefix}-lang`;
    grp.append(lbl, mSel, lSel);
    return grp;
  }

  bar.appendChild(addSelector('cmp-a', defA));
  const vs = el('span'); vs.textContent = 'vs'; vs.style.cssText = 'color:#ccc;font-size:.8rem;';
  bar.appendChild(vs);
  bar.appendChild(addSelector('cmp-b', defB));

  const applyBtn = el('button', 'chip-cta'); applyBtn.textContent = 'Apply';
  applyBtn.style.padding = '5px 14px'; bar.appendChild(applyBtn);

  // Edge color
  const ecGrp = mcGroup('Edge colour');
  const ecSel = mcSelect([['weight','By weight'],['source-cat','Category'],['degree-part','Degree partition']], 'weight');
  ecGrp.appendChild(ecSel); bar.appendChild(ecGrp);

  ecSel.addEventListener('change', () => {
    state.multiGraphs.forEach(({ ctrl }) => ctrl.setEdgeColor(ecSel.value));
  });

  // Weight slider
  const { slInput, slVal } = addSlider(bar, 'Min weight', state.minWeightMulti);
  slInput.addEventListener('input', function () {
    state.minWeightMulti = +this.value;
    slVal.textContent = this.value;
    state.multiGraphs.forEach(({ ctrl }) => ctrl.applyFilter(state.minWeightMulti));
  });

  // Node color select
  const cmpNcGrp = mcGroup('Node color');
  const cmpNcSel = mcSelect([['category','Category'],['community','Community']], 'category');
  cmpNcGrp.appendChild(cmpNcSel); bar.appendChild(cmpNcGrp);
  cmpNcSel.addEventListener('change', () => {
    state.multiGraphs.forEach(({ ctrl }) => ctrl.setNodeColor(cmpNcSel.value));
  });

  // Node size select
  const cmpNsGrp = mcGroup('Node size');
  const cmpNsSel = mcSelect([['uniform','Uniform'],['centrality','Eigenvector centrality'],['cc','Clustering coeff.'],['hub','Hub score'],['authority','Authority score']], 'uniform');
  cmpNsGrp.appendChild(cmpNsSel); bar.appendChild(cmpNsGrp);
  cmpNsSel.addEventListener('change', () => {
    state.multiGraphs.forEach(({ ctrl }) => ctrl.setNodeSize(cmpNsSel.value));
  });

  // Labels toggle
  const cmpLabelsBtn = addToggleBtn(bar, 'Labels');
  cmpLabelsBtn.addEventListener('click', () => {
    const on = cmpLabelsBtn.classList.toggle('active');
    state.multiGraphs.forEach(({ ctrl }) => ctrl.setLabels(on));
  });

  function renderCells(a2, b2) {
    state.multiGraphs.forEach(({ ctrl }) => ctrl.destroy());
    state.multiGraphs = [];
    document.getElementById('cmp-panel').classList.add('hidden');

    const grid = document.getElementById('cmp-grid');
    grid.innerHTML = '';

    [a2, b2].forEach((item, i) => {
      const cell = buildGraphCell(item.model, item.lang);
      grid.appendChild(cell);

      setTimeout(() => {
        const wrap    = cell.querySelector('.cell-d3-wrap');
        const spinner = cell.querySelector('.cy-spinner');
        spinner.classList.remove('hidden');

        fetchParsed(item.model, item.lang).then(data => {
          const ctrl = createD3Graph(wrap, data, { mini: true, edgeColorMode: ecSel.value });
          spinner.classList.add('hidden');
          state.multiGraphs.push({ ctrl, model: item.model, lang: item.lang });

          ctrl.applyFilter(state.minWeightMulti);
          updateCellStat(cell, ctrl);

          ctrl.onNodeClick((event, d) => {
            event.stopPropagation();
            selectNodeAcrossGraphs(d.id, 'cmp');
          });
          ctrl.onBgClick(() => clearCrossHighlight('cmp'));
        });
      }, i * 130);
    });
  }

  applyBtn.addEventListener('click', () => {
    renderCells(
      { model: document.getElementById('cmp-a-model').value, lang: document.getElementById('cmp-a-lang').value },
      { model: document.getElementById('cmp-b-model').value, lang: document.getElementById('cmp-b-lang').value }
    );
  });

  renderCells(defA, defB);
}

/* ══════════════════════════════════════════════
   CROSS-GRAPH HIGHLIGHT
══════════════════════════════════════════════ */
function selectNodeAcrossGraphs(nodeId, panelId) {
  state.selectedNodeId = nodeId;
  hideTooltip();

  const connsPerGraph = state.multiGraphs.map(({ ctrl, model, lang }) => {
    ctrl.highlightNode(nodeId);
    const edges = (ctrl.nodeEdgeMap.get(nodeId) || [])
      .filter(e => e.weight >= ctrl.getMinWeight())
      .sort((a, b) => b.weight - a.weight);
    return { model, lang, edges, present: ctrl.nodes.some(n => n.id === nodeId) };
  });

  // Show panel
  const panel    = document.getElementById(`${panelId}-panel`);
  const nameEl   = document.getElementById(`${panelId}-snp-name`);
  const catEl    = document.getElementById(`${panelId}-snp-cat`);
  const connsEl  = document.getElementById(`${panelId}-snp-conns`);

  nameEl.textContent  = nodeId;
  catEl.textContent   = `category: ${getCategory(nodeId)}`;
  connsEl.innerHTML   = '';
  panel.classList.remove('hidden');

  connsPerGraph.forEach(({ model, lang, edges, present }) => {
    const chip = el('span', 'snp-chip');
    chip.style.background = present ? MODEL_COLOR[model] + '22' : '#f0f0ee';
    chip.style.color       = present ? MODEL_COLOR[model] : '#bbb';
    chip.style.border      = `1px solid ${present ? MODEL_COLOR[model] + '55' : '#eee'}`;

    if (!present) {
      chip.textContent = `${MODEL_LABEL[model]} ${LANG_LABEL[lang]}: absent`;
    } else {
      let txt = `<strong>${MODEL_LABEL[model]} ${LANG_LABEL[lang]}</strong>: ${edges.length} conn.`;
      if (edges.length > 0) {
        const top   = edges[0];
        const other = top._src === nodeId ? top._tgt : top._src;
        txt += ` · top: <em>${other}</em> (${top.weight})`;
      }
      chip.innerHTML = txt;
    }
    connsEl.appendChild(chip);
  });
}

function clearCrossHighlight(panelId) {
  state.selectedNodeId = null;
  state.multiGraphs.forEach(({ ctrl }) => ctrl.resetHighlight());
  document.getElementById(`${panelId}-panel`).classList.add('hidden');
}

/* ══════════════════════════════════════════════
   GRAPH CELL BUILDER (multi views)
══════════════════════════════════════════════ */
function buildGraphCell(model, lang) {
  const cell  = div('graph-cell');
  const title = div('cell-title');
  const badge = el('span', 'cell-model-badge');
  badge.textContent = MODEL_LABEL[model];
  badge.style.background = MODEL_COLOR[model];
  const langLbl = el('span', 'cell-lang'); langLbl.textContent = LANG_LABEL[lang];
  const stat    = el('span', 'cell-stat cell-stat-display');
  title.append(badge, langLbl, stat);

  const wrap    = div('cell-d3-wrap');
  const spinner = div('cy-spinner hidden'); spinner.innerHTML = '<div class="spinner"></div>';
  wrap.appendChild(spinner);

  cell.append(title, wrap);
  return cell;
}

function updateCellStat(cell, ctrl) {
  const s = cell.querySelector('.cell-stat-display');
  if (!s) return;
  const { nodes: n, edges: e } = ctrl.getStats();
  s.textContent = `${n}N · ${e}E`;
}

function updateMultiStats(id) {
  const sp = document.getElementById(id);
  if (!sp) return;
  sp.textContent = state.multiGraphs.map(({ ctrl, model, lang }) => {
    const { nodes: n, edges: e } = ctrl.getStats();
    return `${MODEL_LABEL[model]}/${LANG_LABEL[lang]}: ${n}N·${e}E`;
  }).join('  ·  ');
}

/* ══════════════════════════════════════════════
   CONTROLS HELPERS
══════════════════════════════════════════════ */
function mcGroup(label) {
  const g = div('mc-group');
  const l = el('span', 'mc-label'); l.textContent = label;
  g.appendChild(l);
  return g;
}

function mcSelect(options, selected) {
  const sel = el('select', 'mc-select');
  options.forEach(([value, text]) => {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = text;
    if (value === selected) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

function addToggleBtn(parent, label) {
  const btn = el('button', 'toggle-btn mc-toggle');
  btn.textContent = label;
  btn.style.cssText = 'padding:4px 10px;font-size:.78rem;white-space:nowrap;';
  parent.appendChild(btn);
  return btn;
}

function addSlider(parent, label, initialValue) {
  const grp = mcGroup(label);
  const row = div('mc-slider-row');
  const slInput = el('input'); slInput.type = 'range';
  slInput.min = 1; slInput.max = 50; slInput.value = initialValue;
  slInput.className = 'mc-slider';
  const slVal = el('span', 'mc-slider-val'); slVal.textContent = initialValue;
  row.append(slInput, slVal);
  grp.appendChild(row);
  parent.appendChild(grp);
  return { slInput, slVal };
}

/* ══════════════════════════════════════════════
   DOM HELPERS
══════════════════════════════════════════════ */
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function div(cls) { return el('div', cls); }

/* ══════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════ */
navigate('landing');
