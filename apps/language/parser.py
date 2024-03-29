#python ./parser.py book_file language_folder stats_file

import re
import os
import sys
import glob
from collections import Counter

total = 0
incorrect = 0

def evaluateGender(noun):
  global total
  global incorrect

  test = ''
  bits = re.split(' ', re.sub('\/.*', '', noun))
  if re.match('.*ung$', bits[1]):
    test = 'e'
  elif re.match('.*heit$', bits[1]):
    test = 'e'
  elif re.match('.*keit$', bits[1]):
    test = 'e'
  elif re.match('.*in$', bits[1]):
    test = 'e'
  elif re.match('.*e$', bits[1]):
    test = 'e'
  elif re.match('.*ie$', bits[1]):
    test = 'e'
  elif re.match('.*ei$', bits[1]):
    test = 'e'
  elif re.match('.*oo.*$', bits[1]):
    test = 's'
  elif re.match('.*schaft$', bits[1]):
    test = 'e'
  elif re.match('.*ät$', bits[1]):
    test = 'e'
  elif re.match('.*sel$', bits[1]):
    test = 'e'
  elif re.match('.*o$', bits[1]):
    test = 's'
  elif re.match('.*eid$', bits[1]):
    test = 's'
  elif re.match('.*eier$', bits[1]):
    test = 'r'
  elif re.match('.*uer$', bits[1]):
    test = 's'
  elif re.match('.*ier$', bits[1]):
    test = 's'
  elif re.match('.*il$', bits[1]):
    test = 's'
  elif re.match('.*der$', bits[1]):
    test = 'r'
  elif re.match('.*er$', bits[1]):
    test = 'r'
  elif re.match('.*kum$', bits[1]):
    test = 's'
  elif re.match('.*irn$', bits[1]):
    test = 's'
  elif re.match('.*ekt$', bits[1]):
    test = 's'
  elif re.match('.*ukt$', bits[1]):
    test = 's'
  elif re.match('.*cht$', bits[1]):
    test = 'e'
  elif re.match('.*nis$', bits[1]):
    test = 's'
  elif re.match('.*en$', bits[1]):
    test = 's'
  elif re.match('.*z$', bits[1]):
    test = 'r'
  elif re.match('.*itt$', bits[1]):
    test = 'r'
  elif re.match('.*tt$', bits[1]):
    test = 's'
  elif re.match('.*l$', bits[1]):
    test = 'r'
  elif re.match('.*r$', bits[1]):
    test = 'r'
  elif re.match('.*m$', bits[1]):
    test = 'r'
  elif re.match('.*d$', bits[1]):
    test = 'r'
  elif re.match('.*t$', bits[1]):
    test = 'r'
  elif re.match('.*ig$', bits[1]):
    test = 'r'
  elif re.match('.*ing$', bits[1]):
    test = 'r'
  else:
    test = 'r'

  if test != bits[0]:
    incorrect = incorrect + 1

  total = total + 1

def evaluatePlural(noun):
  global total
  global incorrect

  test = ''
  parts = re.split(' ', noun)
  bits = re.split('/', parts[1])
  if len(bits) == 1:
    return

  if re.match('.*ung$', bits[0]):
    test = 'en'
  elif re.match('.*heit$', bits[0]):
    test = 'en'
  elif re.match('.*keit$', bits[0]):
    test = 'en'
  elif re.match('.*is$', bits[0]):
    test = 'se'
  elif re.match('.*in$', bits[0]):
    test = 'nen'
  elif re.match('.*e$', bits[0]):
    test = 'n'
  elif re.match('.*a$', bits[0]):
    test = 's'
  elif re.match('.*o$', bits[0]):
    test = 's'
  elif parts[0] == 'e':
    test = 'en'
  else:
    test = 'e'

  if test != bits[1]:
    incorrect = incorrect + 1

  total = total + 1

class Statistics:
  def __init__(self, stats):
    self.total = 0
    self.cats = {}
    for stat in stats:
      cat_name = stat.label
      cat = {}
      for item in stat.items:
        cat[item] = 0
      cat['total'] = 0
      cat['none'] = 0
      self.cats[cat_name] = cat

class LOL:
  def __init__(self, label, items):
    self.label = label
    self.items = items

  def __str__(self):
    data = self.label + ' : ' + ' '.join(self.items)
    return data
  def __repr__(self):
    return self.__str__()

def readLOLs(file_name):
  lols = []
  l = []
  l_name = None

  file = open(file_name, "r")
  lines = file.readlines()
  for line in lines:
    if line.isspace():
      continue

    line = line.strip()
    if line.startswith('='):
      if l_name != None:
        lols.append(LOL(l_name, l))
      l = []
      l_name = line.removeprefix('=')
    else:
      l.append(line)

  if l_name != None:
    lols.append(LOL(l_name, l))
    
  print('Read LOLs: ' + str(lols))
  return lols

def evalType(word, types):
  for type in types:
    for item in type.items:
      if re.match(item + '$', word):
        return type.label

def evalForms(word, verbs):
  forms = []
  for verb in verbs:
    if re.match(verb.label, word):
      for item in verb.items:
        forms.append(re.sub(verb.label, item, word))
      break
  return forms

# parse grammar
types = readLOLs('/home/martin/store/welle/languages/deutsch/_grammar/types')
verbs = readLOLs('/home/martin/store/welle/languages/deutsch/_grammar/verb')
nouns = readLOLs('/home/martin/store/welle/languages/deutsch/_grammar/noun')
adjectives = readLOLs('/home/martin/store/welle/languages/deutsch/_grammar/adjective')

stats = readLOLs(sys.argv[3])
statistics = Statistics(stats)

def readSegments():
  segments = {}
  file = open('regex', "r")
  lines = file.readlines()
  for line in lines:
    parts = line.split(':')
    segments['<'+parts[0]+'>'] = parts[1].strip()
  return segments
segments = readSegments()
print(segments)

def evaluateRegex(regex, word):
  regex = regex.translate(segments)
  for key in segments.keys():
    regex = regex.replace(key, segments[key])

  for reg in regex.split(' AND '):
    negate = False
    if (reg.startswith('NOT ')):
      negate = True
      reg = reg.removeprefix('NOT ')
    if bool(re.match(reg, word.lower())) == negate:
      return False
  return True

def calcStats(w):
  global statistics
  matchAll = False
  for stat in stats:
    if evaluateRegex(stat.label, w):
      statistics.total = statistics.total + 1
      statistics.cats[stat.label]['total'] = statistics.cats[stat.label]['total'] + 1
      match = False
      for item in stat.items:
        if evaluateRegex(item, w):
          match = True
          matchAll = True
          statistics.cats[stat.label][item] = statistics.cats[stat.label][item] + 1
      if not match:
        statistics.cats[stat.label]['none'] = statistics.cats[stat.label]['none'] + 1
        print(w)
  #if not matchAll:
    #print(w)

def notBasic(w):
  type = evalType(w.lower(), types)
  return type != 'article' and type != 'number'

# parse dictionary
# word, e singular/plural + r singular/plural
def parseDictionary():
  words = set()
  for file_name in set(glob.glob(sys.argv[2] + '**/**', recursive=True)):
    if os.path.isdir(file_name):
      continue

    file = open(file_name, "r")
    lines = file.readlines()
    print(file_name)
    for line in lines:
      parts = re.split(', ', line.strip())
      if len(parts) == 2:
        ws = re.split('\+', parts[1])
        for w in ws:
          w = re.sub(' sich', '', w)
          w = re.sub('\([^\(\)]+\)', '', w)
          w = w.strip()
          calcStats(w)
          word_type = evalType(w, types)
          if word_type == 'verb':
            words.update(evalForms(w, verbs))
          elif word_type == 'noun':
            words.update(evalForms(w, nouns))
            evaluatePlural(w)
          elif word_type == 'adjective':
            words.update(evalForms(w, adjectives))

  #print(statistics.total) 
  for cat in statistics.cats:
    print(cat + ': ' + str(statistics.cats[cat]['total']))
    print(cat + ': ' + str(statistics.cats[cat]['none']))
    for cond in statistics.cats[cat]:
      ratio = round(statistics.cats[cat][cond]/(statistics.cats[cat]['total'] + 0.01)*100, 2)
      print('  ' + cond + ': ' + str(statistics.cats[cat][cond]) + ' (' + str(ratio) + '%)')
# parse book
parseDictionary()

book_name = sys.argv[1]
book_file = open(book_name, "r")

def listIgnoredWords(book_name):
  ignored_words = []
  ignore_file = open(book_name + '.ignore', "r")
  ignore_words = re.compile('[\W]+').split(ignore_file.read())
  for word in ignore_words:
    ignored_words.append(word)
    ignored_words.append(word + 's')
  return ignored_words

file_content = book_file.read()
file_words = re.compile('[\W]+').split(file_content)


# filter words

ignored_words = listIgnoredWords(book_name)
#file_words = [w for w in file_words if len(w) > 1 and w not in ignored_words and notBasic(w) and w not in words and (w[0].lower() + w[1:]) not in words]

# count words

#word_counts = Counter(file_words)
#print(word_counts.most_common(500))

#print(str(total) + ' / ' + str(incorrect))
