#python ./corpus.py language_folder

import re
import os
import sys
import glob

def parseDictionary(folder):
  words = []
  for file_name in set(glob.glob(folder + '**/**', recursive=True)):
    if os.path.isdir(file_name) or '/_' in file_name:
      continue
    file = open(file_name, "r")
    words.extend(parseFile(file))
  return words

def parseFile(file):
    print('Processing file: ' + file.name)
    words = []
    lines = file.readlines()
    file_name = file.name.split('/languages/')[1]
    language = file_name.split('/', 1)[0]
    path = file_name.split('/', 1)[1]
    for line in lines:
      parts = re.split(', ', line.strip())
      if len(parts) == 2:
        frequent = False
        derived = False
        if parts[0].startswith('='):
          frequent = True
        elif parts[0].startswith('- '):
          derived = True
        source = re.sub('=|- |', '', parts[0])

        target_raw = re.sub('\|', '', parts[1])
        target_parts = re.split('[', target_raw]
        target = target_parts[0]
        pronunciation = ''
        if len(target_parts) == 2:
          pronunciation = re.sub('\[\]', '', target_parts[1])

        word = {'language': language, 'path': path, 'source': source, 'target': target, 'pronunciation': pronunciation, 'frequent': frequent, 'derived': derived}
        words.append(word)
    return words

corpus = open('corpus', "w")

words = parseDictionary(sys.argv[1])
for word in words:
  corpus.write(word['language'] + '|' + word['path'] + '|' + word['source'] + '|' + word['target'] + '|' + str(word['frequent']) + '|' + str(word['derived']) + '\n')

corpus.close()

