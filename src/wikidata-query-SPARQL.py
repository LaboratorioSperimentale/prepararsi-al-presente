########################
## UTILIZZANDO SPARQL ##
########################


# pip install requests entro il virtual environment
import requests

# Define the SPARQL query
sparql_query = """
SELECT ?person ?personLabel ?birthDate ?nationalityLabel ?notableWorkLabel WHERE {
  # Specify the list of names and surnames
  VALUES ?personLabel {
    "Ada Palmer"@en
    "Alan Friel"@en
    "Ali Smith"@en
    "Ben Smith"@en
    "Bethany Clift"@en
    "CD Projekt RED "@en
    # Add the rest of your list here...
    "Yūya Satō"@en
  }

  # Retrieve the entity for the person
  ?person rdfs:label ?personLabel.

  # Retrieve birth date, nationality, and notable works if available
  OPTIONAL { ?person wdt:P569 ?birthDate. }       # Birth date
  OPTIONAL { ?person wdt:P27 ?nationality. }      # Nationality
  OPTIONAL { ?person wdt:P800 ?notableWork. }     # Notable works

  # Ensure labels are retrieved in English and Spanish
  SERVICE wikibase:label { 
    bd:serviceParam wikibase:language "en,es". 
  }
}
"""

# Define the endpoint URL
import requests
import json
from datetime import datetime


# Define the SPARQL query
sparql_query = """
SELECT ?person ?personLabel ?birthDate ?nationalityLabel ?notableWorkLabel WHERE {
  # Specify the list of names and surnames
  VALUES ?personLabel {
    "Ada Palmer"@en
    "Alan Friel"@en
    "Ali Smith"@en
    "Ben Smith"@en
    "Bethany Clift"@en
    # Add the rest of your list here...
    "Yūya Satō"@en
  }

  # Retrieve the entity for the person
  ?person rdfs:label ?personLabel.

  # Retrieve birth date, nationality, and notable works if available
  OPTIONAL { ?person wdt:P569 ?birthDate. }       # Birth date
  OPTIONAL { ?person wdt:P27 ?nationality. }      # Nationality
  OPTIONAL { ?person wdt:P800 ?notableWork. }     # Notable works

  # Ensure labels are retrieved in English and Spanish
  SERVICE wikibase:label { 
    bd:serviceParam wikibase:language "en,es". 
  }
}
"""

# Get the current date and time
now = datetime.now()

# Format the date and time as day-month-year-hh-mm-ss
formatted_date_time = now.strftime("%d-%m-%Y-%H-%M-%S")

# Print the formatted date and time
print(formatted_date_time)

# Define the endpoint URL
endpoint_url = "https://query.wikidata.org/sparql"

# Send the request to the SPARQL endpoint
response = requests.get(
    endpoint_url,
    headers={"Accept": "application/json"},
    params={"query": sparql_query}
)

# Check for errors
if response.status_code == 200:
    # Parse the JSON response
    data = response.json()
    
    # Extract the results and transform into a simpler structure
    results = []
    for result in data['results']['bindings']:
        results.append({
            "person": result.get("person", {}).get("value", ""),
            "personLabel": result.get("personLabel", {}).get("value", ""),
            "birthDate": result.get("birthDate", {}).get("value", ""),
            "nationality": result.get("nationalityLabel", {}).get("value", ""),
            "notableWork": result.get("notableWorkLabel", {}).get("value", ""),
        })
    


    # Save the simplified results to a JSON file
    with open("wikidata-query-SPARQL-output-"+formatted_date_time+".json", "w", encoding="utf-8") as json_file:
        json.dump(results, json_file, ensure_ascii=False, indent=4)
    
    print("Results saved to output.json")
else:
    print("Error: Unable to fetch data from Wikidata")
    print("Status code:", response.status_code)
    print("Response:", response.text)
