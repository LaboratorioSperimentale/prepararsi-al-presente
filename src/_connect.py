from pymongo import MongoClient

def get_database():

   # Provide the mongodb atlas url to connect python to mongodb using pymongo
   CONNECTION_STRING = "mongodb+srv://ellepannitto:13Ottobre!@prepararsi-al-presente.bvduv97.mongodb.net"

   # Create a connection using MongoClient. You can import MongoClient or use pymongo.MongoClient
   client = MongoClient(CONNECTION_STRING)

   # Create the database for our example (we will use the same database throughout the tutorial
   return client

# This is added so that many files can reuse the function get_database()
if __name__ == "__main__":
	import yaml
	import glob

	dbname = get_database()
	distopia = dbname["Distopia"]
	prova = distopia["prova"]

	for file in glob.glob("db/authors/*"):
		with open(file) as fin:
			author = yaml.safe_load(fin)
			prova.insert_one(author)
			# print(author)


#    with open("example.yaml") as stream:
#     try:
#         print(yaml.safe_load(stream))

#    # Get the database


#    prova.insert_one({"Name": "Mario", "Surname": "Rossi"})
#    prova.insert_one({"Name": "Giuseppe", "Surname": "Verdi", "Origin": "ITA"})

#    print(collection_name)

# 	create_collection


#    item_1 = {
# 	"Name" : "Mario",
# 	"Surname" : "Rossi",
# 	"Area" : "Italy"
# 	}

#    item_2 = {
#   	"Name" : "Giuseppe",
#   	"Surname" : "Verdi"
# 	}

#    collection_name.insert_one(item_1)