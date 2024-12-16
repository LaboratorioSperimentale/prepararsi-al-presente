##########################################
## UTILIZZANDO L'API.php #################
##########################################


# pip install requests entro il virtual environment
import requests

url = "https://www.wikidata.org/w/api.php"
params = {
    "action": "wbsearchentities",
    "search": "Albert Einstein",
    "language": "en",
    "format": "json",
}

response = requests.get(url, params=params)
data = response.json()

# Print results
for entity in data.get("search", []):
    print(f"{entity['id']}: {entity['label']} - {entity.get('description', 'No description')}")
set