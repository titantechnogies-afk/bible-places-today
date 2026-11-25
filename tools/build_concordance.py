"""Builds the Strong's concordance data for Just One More Lord.

Sources (free):
  * STEPBible-Data (https://github.com/STEPBible/STEPBible-Data), CC BY 4.0, by STEPBible.org / Tyndale House Cambridge:
      TAHOT (Translators Amalgamated Hebrew OT) and TAGNT (Translators Amalgamated Greek NT) -
      every word with its Strong's number, transliteration, English translation and grammar.
  * OpenScriptures Strong's dictionaries (https://github.com/openscriptures/strongs): Strong's 1890/1894 dictionary
      text (public domain), JSON edition CC BY-SA.

Usage: python3 -I tools/build_concordance.py <STEPBible-Data dir> <openscriptures strongs dir> <output dir>
Output: lex-h.json, lex-g.json, books.json, occ/<H|G>-<n>.json, text/<Book>.<chapter>.json
"""
import json, os, re, sys, glob, collections

STEP, STRONGS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
NAMES = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation']
REF = re.compile(r'^([1-3A-Z][A-Za-z0-9]{2})\.(\d+)\.(\d+)(?:\([^)]*\))?#(\d+)=(\S+)')
ACCENTS = re.compile('[֑-ֽ֯׀׃׆]')  # Hebrew cantillation marks, meteg, paseq, sof pasuq
STOP = set('the a an of to in into and he she it they his her its their you your ye thee thou thy i me my we us our him them was were is are be been being will shall have has had did do does not no for from with by on at as that this these those which who whom whose what so then there o or but upon unto out up s'.split())

def base(s):
    m = re.search(r'([HG])0*(\d+)', s)
    return f'{m.group(1)}{int(m.group(2))}' if m else None

def words(eng):
    eng = re.sub(r'\[[^\]]*\]|<[^>]*>|\([^)]*\)', ' ', eng.lower())
    return [w for w in re.findall(r"[a-z]+(?:'[a-z]+)?", eng) if w not in STOP and len(w) > 1]

def phrase(eng):
    return re.sub(r'\s+', ' ', re.sub(r'\[[^\]]*\]|<[^>]*>|[^\w\s\'-]', ' ', eng)).strip().lower()

books, chapters = [], collections.OrderedDict()   # chapters[(book, ch)] -> {verse: [rows]}
occ = collections.defaultdict(list)                # strongs -> [(book, ch, v, eng)]
count = collections.Counter()
wordc = collections.defaultdict(collections.Counter)
phrc = collections.defaultdict(collections.Counter)
gloss = {}
glossc = collections.defaultdict(collections.Counter)

def add_book(b):
    if b not in books: books.append(b)

# ---------- Hebrew OT ----------
for fn in sorted(glob.glob(os.path.join(STEP, 'Translators Amalgamated OT+NT', 'TAHOT *.txt')), key=lambda f: ['Gen', 'Jos', 'Job', 'Isa'].index(os.path.basename(f)[6:9])):
    for line in open(fn, encoding='utf-8'):
        m = REF.match(line)
        if not m: continue
        b, c, v, _, typ = m.groups()
        if typ.startswith('K') or typ == 'X': continue
        col = line.rstrip('\n').split('\t')
        if len(col) < 6: continue
        add_book(b)
        heb = ACCENTS.sub('', col[1]).replace('\\', '').strip(); tr = col[2]; eng = col[3]; ds = col[4]; morph = col[5]
        parts = ds.split('/'); eparts = eng.split('/')
        mains = [i for i, p in enumerate(parts) if p.startswith('{')]
        nums = []
        for i, p in enumerate(parts):
            bb = base(p)
            if not bb: continue
            n = int(bb[1:])
            nums.append(('{' + bb + '}') if p.startswith('{') else bb)
            if p.startswith('{') and n < 9000:
                e = eparts[i].strip() if i < len(eparts) and len(eparts) == len(parts) else eng.replace('/', ' ').strip()
                occ[bb].append((b, int(c), int(v), e))
                count[bb] += 1
                for w in words(e): wordc[bb][w] += 1
                ph = phrase(e)
                if ph: phrc[bb][ph] += 1
        # gloss from expanded column
        if len(col) > 11:
            for g in re.finditer(r'\{?([HG]\d+[A-Za-z]?)=([^=/{}]+)=([^/{}»]+)', col[11]):
                bb = base(g.group(1))
                if bb:
                    glossc[bb][g.group(3).strip(' :')] += 1
                    if bb not in gloss: gloss[bb] = (ACCENTS.sub('', g.group(2)), '')
        chapters.setdefault((b, int(c)), collections.OrderedDict()).setdefault(int(v), []).append([heb, tr, eng, '/'.join(nums), morph, 0])

# ---------- Greek NT ----------
for fn in sorted(glob.glob(os.path.join(STEP, 'Translators Amalgamated OT+NT', 'TAGNT *.txt')), key=lambda f: ['Mat', 'Act'].index(os.path.basename(f)[6:9])):
    for line in open(fn, encoding='utf-8'):
        m = REF.match(line)
        if not m: continue
        b, c, v, _, typ = m.groups()
        col = line.rstrip('\n').split('\t')
        if len(col) < 6: continue
        ed = col[5]
        if 'NA28' not in ed and 'TR' not in ed: continue
        add_book(b)
        gm = re.match(r'(.*?)\s*\((.*)\)\s*$', col[1])
        grk, tr = (gm.group(1), gm.group(2)) if gm else (col[1], '')
        eng = col[2]; sm = col[3].split('=', 1); bb = base(sm[0]); morph = sm[1] if len(sm) > 1 else ''
        variant = 0 if 'NA28' in ed else 1
        if bb:
            occ[bb].append((b, int(c), int(v), eng.strip()))
            count[bb] += 1
            for w in words(eng): wordc[bb][w] += 1
            ph = phrase(eng)
            if ph: phrc[bb][ph] += 1
            lg = col[4].split('=', 1)
            if len(lg) == 2:
                glossc[bb][lg[1].strip()] += 1
                if bb not in gloss: gloss[bb] = (lg[0].strip(), '')
        chapters.setdefault((b, int(c)), collections.OrderedDict()).setdefault(int(v), []).append([grk, tr, eng, '{' + bb + '}' if bb else '', morph, variant])

assert len(books) == 66, (len(books), books)
code2name = dict(zip(books, NAMES))

# ---------- versification & verse ids ----------
vmax = collections.OrderedDict()
for (b, c), vs in chapters.items():
    vmax.setdefault(b, {})[c] = max(vs)
book_rows, vid0, start = [], {}, 0
for b in books:
    chs = vmax[b]; counts = [chs.get(c, 0) for c in range(1, max(chs) + 1)]
    book_rows.append([b, code2name[b], counts])
    acc = start
    for ci, n in enumerate(counts, 1):
        vid0[(b, ci)] = acc; acc += n
    start = acc
def vid(b, c, v): return vid0[(b, c)] + v - 1

os.makedirs(os.path.join(OUT, 'occ'), exist_ok=True); os.makedirs(os.path.join(OUT, 'text'), exist_ok=True)
json.dump(book_rows, open(os.path.join(OUT, 'books.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

# ---------- lexicon ----------
def load_js(path, var):
    t = open(path, encoding='utf-8').read(); i = t.index('{', t.index(var)); j = t.rindex('}')
    return json.loads(t[i:j + 1])
heb = load_js(os.path.join(STRONGS, 'hebrew', 'strongs-hebrew-dictionary.js'), 'strongsHebrewDictionary')
grk = load_js(os.path.join(STRONGS, 'greek', 'strongs-greek-dictionary.js'), 'strongsGreekDictionary')
for lang, src in (('h', heb), ('g', grk)):
    out = {}
    keys = set(k for k in src) | set(k for k in count if k[0].lower() == lang and int(k[1:]) < 9000)
    for k in sorted(keys, key=lambda k: int(k[1:])):
        d = src.get(k, {})
        gl = gloss.get(k, ('', ''))
        gtop = wordc[k].most_common(1)[0][0] if wordc[k] else (glossc[k].most_common(1)[0][0] if glossc[k] else '')
        out[k] = [d.get('lemma') or gl[0], d.get('xlit') or d.get('translit') or '', d.get('pron') or '', gtop,
                  (d.get('strongs_def') or '').strip(), (d.get('kjv_def') or '').strip(), (d.get('derivation') or '').strip(),
                  count.get(k, 0), [[w, n] for w, n in phrc[k].most_common(8)], [[w, n] for w, n in wordc[k].most_common(14)]]
    json.dump(out, open(os.path.join(OUT, f'lex-{lang}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(lang, 'lexicon entries', len(out))

# ---------- occurrences (sharded by 250 numbers) ----------
shards = collections.defaultdict(dict)
for k, lst in occ.items():
    n = int(k[1:]);
    if n >= 9000: continue
    shards[f'{k[0]}-{n // 250}'][k] = [[vid(b, c, v), e] for b, c, v, e in lst]
for s, d in shards.items():
    json.dump(d, open(os.path.join(OUT, 'occ', s + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('occurrence shards', len(shards), 'total occurrences', sum(count.values()))

# ---------- interlinear chapters ----------
for (b, c), vs in chapters.items():
    json.dump([[v, rows] for v, rows in vs.items()], open(os.path.join(OUT, 'text', f'{b}.{c}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('chapters', len(chapters), 'books', len(books))
