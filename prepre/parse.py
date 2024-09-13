import spacy


def parse(filename, output_folder, model):

	stem = filename.stem

	fout_parsed = open(output_folder.joinpath(f"{stem}.conllu"), "w", encoding="utf-8")
	fout_entities = open(output_folder.joinpath(f"{stem}.entities"), "w", encoding="utf-8")

	nlp = spacy.load(model)

	chap_n = 0
	with open(filename, encoding="utf-8") as fin:

		for line in fin:
			if line.startswith("###"):
				chap_n += 1

			else:
				line = line.strip()

				doc = nlp(line)
				for sent_i, sent in enumerate(doc.sents):
					print(f"# chapter: {chap_n}", file=fout_parsed)
					print(f"# sent n.: {sent_i}", file=fout_parsed)

					for token in sent:
						to_print = [token.i, token.text, token.lemma_, token.pos_, token.dep_, token.head.i]
						to_print_srt = '\t'.join(str(x) for x in to_print)
						print(f"{to_print_srt}", file=fout_parsed)
						# input()
					print("", file=fout_parsed)

					for token in doc.ents:
						print(f"{chap_n}\t{token.text}\t{token.label_}", file=fout_entities)
						# input()


			# print("###########", line, "###############")
			# input()


			# doc = nlp(line)

			# for sent_i, sent in enumerate(doc.sents):
			# 	for token in sent:
			# 		print(token.text, token.lemma_, token.pos_, token.tag_, token.dep_,
			# 				token.shape_, token.is_alpha, token.is_stop)
			# 		# input()
			# 	for token in doc.ents:
			# 		print(token.text,token.label_)
			# 		# input()