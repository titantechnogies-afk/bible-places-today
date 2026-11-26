"""Smoke test: opens the main screens on a phone-sized and a desktop-sized window and fails if the app throws a JavaScript error.
Run: python3 -m http.server 8765 &  then  python3 tests/smoke.py"""
import sys, os
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8765/')
ROUTES = ['home', 'atlas', 'journeys', 'discoveries', 'read-Jhn.3', 'read-Mal.3', 'concordance', 'people', 'timeline', 'study', 'grace',
          'plans', 'quiz', 'library', 'teachings', 'community', 'books', 'tabernacle', 'learn', 'daily', 'notifications', 'settings', 'profile', 'prayer', 'kids', 'parallel-Jhn.3', 'search-adv', 'rainbow', 'written', 'progress', 'friends', 'testimonies', 'churches', 'partner']
bad = []
with sync_playwright() as pw:
    exe = next((p for p in ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'] if os.path.exists(p)), None)
    b = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
    for vp in [{'width': 390, 'height': 844}, {'width': 1366, 'height': 900}]:
        p = b.new_page(viewport=vp); errs = []
        p.on('pageerror', lambda e: errs.append(str(e)))
        for r in ROUTES:
            n = len(errs)
            try: p.goto(BASE + '#' + r, wait_until='domcontentloaded', timeout=30000); p.wait_for_timeout(1800)
            except Exception as e:
                if 'REFUSED' in str(e): bad.append((vp['width'], r, ['server not reachable'])); break
                print('slow:', r, str(e)[:80]); continue
            if len(errs) > n: bad.append((vp['width'], r, errs[n:]))
            if 'Not found' in (p.text_content('main') or '')[:200]: bad.append((vp['width'], r, ['route shows Not found']))
            w = p.evaluate('document.documentElement.scrollWidth')
            if w > vp['width'] + 2: bad.append((vp['width'], r, [f'page is wider than the screen ({w}px)']))
        p.close()
    b.close()
for x in bad: print('FAIL', x)
print('smoke test:', 'FAILED' if bad else 'passed', f'({len(ROUTES)} screens x 2 sizes)')
sys.exit(1 if bad else 0)
