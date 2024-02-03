#python ./corpus.py language_folder

import re
import os
import sys
import glob

skip_prefix = '/__'

def parseDictionary(folder):
  words = []
  for file_name in set(glob.glob(folder + '**/**', recursive=True)):
    if os.path.isdir(file_name) or skip_prefix in file_name:
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
        targets = re.sub('\|', '', parts[1])
        type = 'other'
        article = ''

        for target_raw in targets.split('+'):
          position = target_raw.find('[')
          if position == -1:
            position = len(target_raw)
          target = target_raw[:position].strip()
          pronunciation = re.sub('\[|\]', '', target_raw[position:])

          word = {'language': language, 'path': path, 'source': source, 'target': target, 'pronunciation': pronunciation, 'frequent': frequent, 'derived': derived, 'type': type, 'article': article}
          word = processWordInLanguage(word, language)
          words.append(word)
    return words

def processWordInLanguage(word, language):
  if language == 'deutsch':
    if word['target'].startswith(('r ', 's ', 'e ')):
      word['type'] = 'noun'
      word['article'] = word['target'][0:1]
      word['target'] = word['target'][2:]
    elif word['target'].split('/\(')[0].endswith(('en', 'ern', 'eln')):
      word['type'] = 'verb'

  return word

corpus = open('corpus', "w")

words = parseDictionary(sys.argv[1])
lines = []
for word in words:
  lines.append(word['language'] + '|' + word['path'] + '|' + word['source'] + '|' + word['target'] + '|' + word['pronunciation'] + '|' + str(word['frequent']) + '|' + str(word['derived']) + '|' + word['type'] + '|' + word['article'] + '\n')
for line in sorted(lines):
  corpus.write(line)

corpus.close()

