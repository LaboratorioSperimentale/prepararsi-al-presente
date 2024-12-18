#!/bin/bash

# questo script permette di fare un conteggio delle parole di un file che viene passato come parametro

# Prompt the user for input
read -p "rispetto alla directory di lavoro dove devi filtrare: " directory

echo "digita la directory in cui vuoi eseguire la query in $directory"

ls $directory

echo "quelli sopra sono i file (yaml) da cui si estrae Nome e Cognome" 

dt=$(date '+%d-%m-%Y-%H-%M-%S');
echo "$dt"

#file name

fileToSave="names_and_surnames$dt.txt"

# richiede: apt install yp
for file in $directory/*.yml; do
  yq '.Name + " " + .Surname' "$file"
done > $fileToSave
