import sys
from datetime import datetime
from pathlib import Path

import cerberus
import yaml
from sty import fg, bg


authors_ids = [x.stem for x in Path("db/authors/").glob("*.yml")]

class AuthorValidator(cerberus.Validator):

	def _check_with_mydate(self, field, value):

		value = value.strip().split("/")
		day = '0'
		month = '0'
		year = '0'

		if len(value) == 3:
			day, month, year = value
		elif len(value) == 2:
			month, year = value
		elif len(value) == 1:
			year = value[0]
		else:
			self._error(f"Non valid format for value '{value}'")

		try:
			day = int(day)
			month = int(month)
			year = int(year)

		except:
			self._error(f"Non valid format for value '{value}'")


	def _normalize_coerce_tolower(self, value):
		return value.lower()

	def _normalize_coerce_tocapitalized(self, value):
		valuesplit = value.strip().split()
		normalized_value = [x[0].upper()+x[1:].lower() for x in valuesplit]
		return " ".join(normalized_value)

class OperaValidator(cerberus.Validator):

	def _check_with_mydate(self, field, value):

		value = str(value)

		value = value.strip().split("/")
		day = '0'
		month = '0'
		year = '0'

		if len(value) == 3:
			day, month, year = value
		elif len(value) == 2:
			month, year = value
		elif len(value) == 1:
			year = value[0]
		else:
			self._error(f"Non valid format for value '{value}'")

		try:
			day = int(day)
			month = int(month)
			year = int(year)

		except:
			self._error(f"Non valid format for value '{value}'")

	def _normalize_coerce_todate(self, value):
		pass

	def _normalize_coerce_tolower(self, value):
		return value.lower()

	def _normalize_coerce_tocapitalized(self, value):
		valuesplit = value.strip().split()
		normalized_value = [x[0].upper()+x[1:].lower() for x in valuesplit]
		return " ".join(normalized_value)

	def _check_with_authors_id(self, field, value):
		if not value in authors_ids:
			self._error(field, f"Value '{value}' not among known creators")


	# def _check_with_CClist_construction(self, field, value):
	# 	if value is not None:
	# 		if value.startswith("cc"):
	# 			cc, category, name_str = value.split(":")
	# 			cc_id = f"{category}:{name_str}"
	# 			if not category in ["cxn", "str"]:
	# 				self._error(field, f"(W) Value '{cc_id}' has type '{CC_LIST[cc_id]}' in list of comparative concepts, types 'str' or 'cxn' required")

	# 			if not cc_id in CC_LIST:
	# 				self._error(field, f"Value '{cc_id}' not in list of comparative concepts")

	# 		else:
	# 			self._error(field, f"(W) Value '{value}' defined by author")
	# 			# self._warnings.append((field, f"DOUBLE CHECK: Value '{value}' created by author"))


	# def _check_with_CClist_meaning(self, field, value):

	# 	if value is not None:
	# 		if value.startswith("cc"):
	# 			cc, category, name_str = value.split(":")
	# 			cc_id = f"{category}:{name_str}"
	# 			if not category in ["inf", "sem"]:
	# 				self._error(field, f"(W) Value '{cc_id}' has type '{CC_LIST[cc_id]}' in list of comparative concepts, types 'inf' or 'sem' required")

	# 			if not cc_id in CC_LIST:
	# 				self._error(field, f"Value '{cc_id}' not in list of comparative concepts")

	# 		else:
	# 			self._error(field, f"(W) Value '{value}' defined by author")



	# def _check_with_conllc_path(self, field, value):
	# 	p = Path("cxns_conllc").joinpath(value)
	# 	if not p.exists():
	# 		self._error(field, f"Value '{value}' is not a file in 'cxn_conllc folder'")

	# def _check_with_conllu_path(self, field, value):
	# 	p = Path("UD_examples").joinpath(value+".conllu")
	# 	if not p.exists():
	# 		self._error(field, f"Value '{value}' is not a file in 'UD_examples folder'")

	# 	#TODO validate conllu file with example

	# def _check_with_bibentry(self, field, value):

	# 	if not value in BIB.entries:
	# 		self._error(field, f"Value '{value}' is not a valid bibliographical identifier'")

if __name__ == "__main__":

	new_files = sys.argv[1:]

	author_v = AuthorValidator(yaml.safe_load(open("db/schemes/author-machine-readable.yml", encoding="utf-8")))
	opera_v = OperaValidator(yaml.safe_load(open("db/schemes/opera-machine-readable.yml", encoding="utf-8")))

	# input()

	validator = opera_v

	n_warnings = 0
	for file in new_files:
		print(file)
		with open(file, encoding="utf-8") as stream:
			try:
				instance = yaml.safe_load(stream)
			except yaml.YAMLError as exc:
				print(exc)

			# print(instance)
			# input()

			print(f"Examining Author ID. {Path(file).stem}: {instance['id']}")

			validation_test = validator.validate(instance)

			if validation_test:
				continue
				output_str = fg.green + \
					f"[PASSED] AUTHOR ID. {Path(file).stem}: {instance['id']}" + \
						fg.rs
				print(output_str)
				# input()

			else:
							# print(validation_test)
				print(validator.errors)
				output_str = fg(255, 10, 10) + \
					f"[FAILED] AUTHOR ID. {Path(file).stem}: {instance['id']}" + \
						fg.rs

				print(output_str)
				# input()


			# else:

			# 	n_errors = 0
			# 	n_warning = 0

			# 	for field, value in author_v.errors.items():
			# 		print(f"Issue with field {field}")
			# 		for x in value:
			# 			if len(x) > 0:
			# 				if type(x) == str:
			# 					if x.startswith("(W)"):
			# 						n_warnings += 1
			# 					else:
			# 						n_errors += 1
			# 					print(f"\t{x}")
			# 				else:
			# 					for element, err_string in x.items():
			# 						err_string = err_string[0]
			# 						if err_string.startswith("(W)"):
			# 							n_warnings += 1
			# 						else:
			# 							n_errors += 1
			# 						print(f"\t{err_string}")
			# 			else:
			# 				if x.startswith("(W)"):
			# 					n_warnings += 1
			# 				else:
			# 					n_errors += 1
			# 				print(f"\t{x}")
			# 	print()

			# 	if n_errors > 0:
			# 		output_str = fg(255, 10, 10) + \
			# 			f"[FAILED] AUTHOR ID. {Path(file).stem}: {instance['id']}" + \
			# 				fg.rs
			# 	elif n_warning > 0:
			# 		output_str = fg.blue + \
			# 			f"[WARNING] AUTHOR ID. {Path(file).stem}: {instance['id']}" + \
			# 				fg.rs


