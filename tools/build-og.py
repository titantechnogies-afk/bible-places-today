# Builds a 1200x630 share picture for every place (og/<id>.jpg): the place's photo, its name and the app's branding.
import json, os, re, subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageFont
def load_js(path, var):
    s = open(path, encoding='utf8').read()
    out = subprocess.run(['node', '-e', f"const vm=require('vm');const c={{window:{{}}}};vm.createContext(c);vm.runInContext(require('fs').readFileSync('{path}','utf8'),c);process.stdout.write(JSON.stringify(c.window.{var}||{{}}))"], capture_output=True, text=True)
    return json.loads(out.stdout or '{}')
P = load_js('data/places.js', 'BPT_PLACES'); IM = load_js('data/images.js', 'JOM_IMAGES')
FB = next((f for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'] if os.path.exists(f)), None)
FR = next((f for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'] if os.path.exists(f)), None)
font = lambda f, n: ImageFont.truetype(f, n) if f else ImageFont.load_default()
os.makedirs('og', exist_ok=True); icon = Image.open('icons/icon-192.png').convert('RGBA').resize((84, 84))
W, H = 1200, 630; n = 0
for p in P:
    bg = Image.new('RGB', (W, H), (2, 10, 16))
    x = IM.get(p['id'])
    if x and os.path.exists(x['f']):
        ph = Image.open(x['f']).convert('RGB'); r = max(W / ph.width, H / ph.height); ph = ph.resize((int(ph.width * r) + 1, int(ph.height * r) + 1)); l = (ph.width - W) // 2; t = (ph.height - H) // 2; bg.paste(ph.crop((l, t, l + W, t + H)))
    else:
        g = Image.new('RGB', (W, H), (0, 0, 0)); d = ImageDraw.Draw(g); d.ellipse([650, -200, 1400, 500], fill=(0, 90, 120)); d.ellipse([-200, 300, 500, 900], fill=(110, 80, 10)); bg = Image.blend(bg, g.filter(ImageFilter.GaussianBlur(120)), .9)
    shade = Image.new('L', (W, H)); sd = ImageDraw.Draw(shade)
    for y in range(H): sd.line([(0, y), (W, y)], fill=int(40 + 190 * (y / H) ** 1.4))
    bg = Image.composite(Image.new('RGB', (W, H), (2, 10, 16)), bg, shade)
    d = ImageDraw.Draw(bg); name = p['n']; size = 92
    while d.textlength(name, font=font(FB, size)) > W - 140 and size > 44: size -= 4
    d.text((70, H - 230), name, font=font(FB, size), fill=(255, 255, 255))
    sub = re.split(r'[;.]', p.get('loc') or p.get('mn') or '')[0][:70]
    d.text((72, H - 120), sub, font=font(FR, 34), fill=(200, 235, 242))
    d.rectangle([72, H - 70, 260, H - 64], fill=(255, 199, 44))
    bg.paste(icon, (W - 170, 50), icon); bt = 'Just One More Lord'; d.text((W - 190 - d.textlength(bt, font=font(FB, 30)), 78), bt, font=font(FB, 30), fill=(0, 209, 255))
    bg.save(f"og/{p['id']}.jpg", quality=84); n += 1
print(f'Share pictures: {n}')
