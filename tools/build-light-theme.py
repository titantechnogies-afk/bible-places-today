"""Builds css/light.css: a light theme generated from css/style.css.
Every rule that sets a colour is repeated under :root[data-theme=light] with dark surfaces made light,
light text made dark, and neon text deepened so it stays readable on a light background.
Hand-written fixes live in css/light-fixes.css and are appended at the end. Run: python3 tools/build-light-theme.py"""
import re, colorsys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
css = open(os.path.join(ROOT, 'css/style.css'), encoding='utf-8').read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
PRE = ':root[data-theme=light]'
COL = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b')

def parse(c):
    c = c.strip().lower()
    if c == 'white': return 255, 255, 255, 1.0
    if c == 'black': return 0, 0, 0, 1.0
    if c.startswith('#'):
        h = c[1:]
        if len(h) in (3, 4): h = ''.join(x * 2 for x in h)
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4)); a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return r, g, b, a
    n = [x.strip() for x in re.split(r'[,\s/]+', c[c.index('(') + 1:-1]) if x.strip()]
    if len(n) < 3 or any('var' in x for x in n): return None
    r, g, b = (float(x) for x in n[:3]); a = float(n[3]) if len(n) > 3 else 1.0
    return r, g, b, a

def fmt(r, g, b, a):
    r, g, b = (max(0, min(255, round(x))) for x in (r, g, b))
    return f'#{r:02x}{g:02x}{b:02x}' if a >= 0.999 else f'rgba({r},{g},{b},{round(a, 3)})'

def hls(r, g, b): return colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
def rgb(h, l, s): return tuple(x * 255 for x in colorsys.hls_to_rgb(h, l, s))

def surface(c):
    """A colour used as a background, border or shadow."""
    p = parse(c)
    if not p: return c
    r, g, b, a = p; h, l, s = hls(r, g, b)
    if l < 0.3:                      # dark surface -> light surface, keep the hue
        return fmt(*rgb(h, min(0.985, 1 - l * 0.75), min(s, 0.45)), max(a, 0.55) if a > 0.3 else a)
    if l > 0.85 and a < 0.35:        # faint white highlight -> faint dark tint
        return fmt(0, 50, 70, min(a * 1.4, 0.12))
    return c

def ink(c):
    """A colour used for text, icons or strokes."""
    p = parse(c)
    if not p: return c
    r, g, b, a = p; h, l, s = hls(r, g, b)
    if l < 0.3: return c             # already dark
    if s < 0.35 or l > 0.8:          # white / pale text -> dark ink, keep the tint
        return fmt(*rgb(h, max(0.1, min(0.32, (1 - l) * 0.9 + 0.08)), min(s, 0.6)), a)
    return fmt(*rgb(h, 0.3 if l > 0.45 else l * 0.7, min(1, s)), a)   # neon accent -> deep accent

def shadow(v):
    if 'none' in v: return v
    return COL.sub(lambda m: (lambda p: fmt(0, 40, 60, p[3] * 0.25) if p and hls(*p[:3])[1] < 0.3 else (fmt(p[0], p[1], p[2], p[3] * 0.45) if p else m.group(0)))(parse(m.group(0))), v)

def convert(prop, val):
    imp = '!important' in val
    p = prop.strip().lower()
    if p in ('color', 'fill', 'stroke', 'caret-color', '-webkit-text-fill-color', 'text-decoration-color', 'outline-color'):
        nv = COL.sub(lambda m: ink(m.group(0)), val)
    elif p in ('background', 'background-color', 'background-image', 'border', 'border-color', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'outline'):
        if 'url(' in val and 'gradient' not in val: return None
        nv = COL.sub(lambda m: surface(m.group(0)), val)
    elif p == 'box-shadow':
        nv = shadow(val)
    elif p == 'text-shadow':
        nv = 'none' + (' !important' if imp else '')
    elif p.startswith('--'):
        return None
    else:
        return None
    return nv if nv != val else None

def scope(sel):
    out = []
    for s in sel.split(','):
        s = s.strip()
        if not s: continue
        if s.startswith(':root'): s = s.replace(':root', PRE, 1) if '[data-theme' not in s else None
        elif s.startswith('html'): s = 'html' + PRE.replace(':root', '') + s[4:]
        elif s.startswith('body'): s = PRE + ' ' + s
        else: s = PRE + ' ' + s
        if s: out.append(s)
    return ','.join(out)

def walk(text):
    out, i = [], 0
    while i < len(text):
        j = text.find('{', i)
        if j < 0: break
        head = text[i:j].strip(); depth, k = 1, j + 1
        while depth and k < len(text):
            depth += {'{': 1, '}': -1}.get(text[k], 0); k += 1
        body = text[j + 1:k - 1]; i = k
        if head.startswith('@media') or head.startswith('@supports'):
            inner = walk(body)
            if inner: out.append(f'{head}{{{inner}}}')
        elif head.startswith('@'):
            continue
        else:
            decls = []
            for d in re.split(r';(?![^(]*\))', body):
                if ':' not in d: continue
                prop, val = d.split(':', 1)
                nv = convert(prop, val.strip())
                if nv: decls.append(f'{prop.strip()}:{nv}')
            if decls and '[data-theme=light]' not in head:
                sc = scope(head)
                if sc: out.append(f'{sc}{{{";".join(decls)}}}')
    return '\n'.join(out)

VARS = PRE + '''{color-scheme:light;--bg:#f3fbfd;--bg2:#e7f4f8;--card:#ffffff;--card2:#eaf6fa;--line:#c4dde5;--ink:#0b2530;--mute:#4d6873;--sand:#1d3d49;
--gold:#007f9c;--gold2:#006a83;--clay:#c2521b;--olive:#0a8a4f;--sky:#2f5fc4;--rose:#c2185b;--cyan:#007f9c;--vio:#0a8f85;--mag:#a87500;
--neon:linear-gradient(90deg,#00a9cf,#13b8aa 50%,#e0a800);--glass:linear-gradient(180deg,rgba(255,255,255,.92),rgba(240,249,252,.92));
--ok:#0a8a4f;--int:#9a7400;--dis:#c2521b;--spec:#c2185b;--trad:#2f5fc4;--shadow:0 10px 30px rgba(0,50,70,.12)}'''
gen = walk(css)
fixes = open(os.path.join(ROOT, 'css/light-fixes.css'), encoding='utf-8').read() if os.path.exists(os.path.join(ROOT, 'css/light-fixes.css')) else ''
open(os.path.join(ROOT, 'css/light.css'), 'w', encoding='utf-8').write('/* GENERATED by tools/build-light-theme.py from style.css — edit light-fixes.css, then re-run. */\n' + VARS + '\n' + gen + '\n/* hand fixes */\n' + fixes)
print('light.css:', len(gen.splitlines()), 'rules')
