"""Builds data/gracech/<Code>.json (one Grace lens note per chapter) from tools/gracech/*.txt and checks every chapter is covered."""
import json, glob, os, sys
books = json.load(open('data/concordance/books.json')); need = {b[0]: len(b[2]) for b in books}
got = {}; cur = None
for f in sorted(glob.glob('tools/gracech/*.txt')):
    for line in open(f, encoding='utf8'):
        line = line.strip()
        if not line: continue
        if line.startswith('@'): cur = line[1:]; got.setdefault(cur, []); continue
        got[cur].append(line)
os.makedirs('data/gracech', exist_ok=True); bad = []
for c, notes in got.items():
    if c not in need: bad.append(f'unknown book {c}'); continue
    if len(notes) != need[c]: bad.append(f'{c}: {len(notes)} notes for {need[c]} chapters')
    json.dump(notes, open(f'data/gracech/{c}.json', 'w', encoding='utf8'), ensure_ascii=False)
missing = [c for c in need if c not in got]
print(f'{sum(len(v) for v in got.values())} notes in {len(got)} books; missing books: {len(missing)}')
for b in bad: print('PROBLEM', b)
sys.exit(1 if bad else 0)
