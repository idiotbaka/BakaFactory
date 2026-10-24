"""Present production PNGs and actual runtime route pixels, without a browser."""
from pathlib import Path
import json, sys, importlib.util
from PIL import Image, ImageDraw, ImageFont
sys.dont_write_bytecode = True
OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
ASSETS = ROOT / 'apps/web/src/assets/buildings/v1'
spec = importlib.util.spec_from_file_location('pixel_helpers', OUT.parent / 'item-icons-v3/process.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
font = helpers.find_font(None)
fonts = {n: ImageFont.truetype(font, n) for n in (12, 16, 20, 26)}
catalog = json.loads((ROOT / 'apps/server/internal/catalog/definitions.json').read_text())
lookup = {b['id']: b for b in catalog['buildings']}
manifest = json.loads((ASSETS / 'manifest.json').read_text())['buildings']
colors = {1:'#ffc879',2:'#a5d4b2',3:'#74edce',4:'#46eff2',5:'#b69aff',6:'#ff72cf'}
def color(id):
    b = manifest[id]
    return colors.get(b['tier'], b['color'])
def text(draw, point, value, size=16, fill='#eeedf9'):
    draw.text(point, value, font=fonts[size], fill=fill)

# All facades, in catalog order; no state / phase markings baked into images.
ids = [id for id, art in manifest.items() if art['renderer'] == 'image']
atlas = Image.new('RGBA', (1320, 1060), '#070912')
d = ImageDraw.Draw(atlas)
text(d, (20, 14), '全量建筑 / 独立物流：78 张透明正视贴图', 26)
text(d, (20, 54), '128px 正式资源的 64px 查看；阶段线为预览卡片标识，PNG 不含阶段 / 方向 / 状态', 16, '#b9c3d8')
for n, id in enumerate(ids):
    x, y = 12 + (n % 10) * 130, 92 + (n // 10) * 120
    d.rectangle((x, y, x+123, y+112), fill='#101220', outline='#343b52')
    d.line((x+2,y+2,x+121,y+2), fill=color(id), width=2)
    icon = Image.open(ASSETS/f'{id}.png').resize((64,64), Image.Resampling.NEAREST)
    atlas.alpha_composite(icon,(x+30,y+5))
    name = lookup[id]['name']
    text(d,(x+4,y+73),name[:9],12)
    if len(name)>9:text(d,(x+4,y+87),name[9:18],12)
    text(d,(x+4,y+99),id,12,color(id))
atlas.convert('RGB').save(OUT/'all-facades.png')

show = Image.new('RGBA',(1120,850),'#070912')
d=ImageDraw.Draw(show)
text(d,(24,16),'霓虹工厂 · 建筑 / 物流正式资源',26)
text(d,(24,58),'128px 透明 PNG · 64 格像素结构 · 地图正视外壳与代码方向分离',16,'#b9c3d8')
for n,id in enumerate(['m05','m11','m23','m35','m41','m51','chest','bus']):
    x,y=24+(n%4)*274,100+(n//4)*210
    d.rectangle((x,y,x+258,y+192),fill='#101220',outline='#343b52')
    icon=Image.open(ASSETS/f'{id}.png').convert('RGBA')
    show.alpha_composite(icon,(x+8,y+8))
    d.ellipse((x+171,y+76,x+221,y+85),fill=color(id))
    show.alpha_composite(icon.resize((48,48),Image.Resampling.NEAREST),(x+172,y+30))
    d.rectangle((x+182,y+105,x+211,y+134),fill='#070912')
    show.alpha_composite(icon.resize((30,30),Image.Resampling.NEAREST),(x+182,y+105))
    d.rectangle((x+183,y+106,x+210,y+133),outline=color(id))
    text(d,(x+8,y+144),lookup[id]['name'],16)
    text(d,(x+8,y+171),id,12,color(id))
    text(d,(x+165,y+144),'48 / 30px',12,'#b9c3d8')
text(d,(24,530),'可拼接物流 · 实际运行时整数几何的静态快照',20)
data=json.loads((OUT/'runtime-pixels.json').read_text())
names={'belt':'传送带','pipe':'物料管道','shaft':'传动轴','hydraulic':'液压动力线','cable':'电缆'}
for n,(kind,tiles) in enumerate(data['routes'].items()):
    x,y=24+n*220,574
    net=Image.new('RGBA',(120,90))
    channel={'shaft':'#a0b2c7','hydraulic':'#ad92ff','cable':'#ff62cb'}.get(kind,'#a6f8f7')
    palette=[(0,0,0,0),'#46eff2','#050509','#6f89a5','#344b65','#37cbd9','#142136','#526380',channel,'#a0b2c7']
    for i,pixels in enumerate(tiles):
        tile=Image.new('RGBA',(30,30));tile.putdata([Image.new('RGBA',(1,1),palette[v]).getpixel((0,0)) for v in pixels])
        net.alpha_composite(tile,((i%4)*30,(i//4)*30))
    show.alpha_composite(net.resize((200,150),Image.Resampling.NEAREST),(x,y))
    text(d,(x,y+157),names[kind],16)
    show.alpha_composite(net,(x,y+184))
# Leave the native-size networks fully visible.
extended=Image.new('RGBA',(1120,880),'#070912');extended.alpha_composite(show)
text(ImageDraw.Draw(extended),(24,854),'静态资源核对，不代表浏览器 / 运输测试已执行。全部 90 个目录 ID 已映射。',12,'#b9c3d8')
extended.convert('RGB').save(OUT/'showcase.png')
print('Saved all-facades.png and showcase.png from production assets / route pixels')
