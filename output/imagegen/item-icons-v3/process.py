"""Export the approved pixel style as 128px production assets. Requires Pillow.

Run from the repository root: python3 output/imagegen/item-icons-v3/process.py
Optional: --font path/to/a/CJK/font.ttf for contact sheet labels.
No game data, servers or application tests are used.
"""
import argparse
import hashlib
import json
import textwrap
from collections import deque
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
ASSETS = ROOT / 'apps/web/src/assets/items/v3'
STAGES = {1:'#ffc879',2:'#a5d4b2',3:'#74edce',4:'#46eff2',5:'#b69aff',6:'#ff72cf'}
BLACK = (5, 5, 9, 255)


def components(mask):
    width, height = mask.size
    data = mask.tobytes()
    seen = bytearray(len(data))
    for start, value in enumerate(data):
        if not value or seen[start]:
            continue
        queue = deque([start])
        seen[start] = 1
        group = []
        while queue:
            pos = queue.popleft()
            group.append(pos)
            x, y = pos % width, pos // width
            neighbors = []
            if x: neighbors.append(pos - 1)
            if x + 1 < width: neighbors.append(pos + 1)
            if y: neighbors.append(pos - width)
            if y + 1 < height: neighbors.append(pos + width)
            for nxt in neighbors:
                if data[nxt] and not seen[nxt]:
                    seen[nxt] = 1
                    queue.append(nxt)
        yield group


def anchors(samples, count):
    """Calibrate the generated grid: outer margins are not always equal cells."""
    low, high = min(p[0] for p in samples), max(p[0] for p in samples)
    centers = [low + (high-low)*i/(count-1) for i in range(count)]
    for _ in range(30):
        buckets = [[] for _ in centers]
        for point, weight in samples:
            k = min(range(count), key=lambda n: abs(point-centers[n]))
            buckets[k].append((point,weight))
        updated = [sum(p*w for p,w in b)/sum(w for _,w in b) if b else centers[k]
                   for k,b in enumerate(buckets)]
        if max(abs(a-b) for a,b in zip(centers,updated)) < 0.01:
            return updated
        centers = updated
    return centers


def extract(source, entries):
    width, height = source.size
    mask = source.getchannel('A').point(lambda a: 255 if a >= 220 else 0)
    groups = [g for g in components(mask) if len(g) >= 24]
    dominant = [g for g in groups if len(g) >= max(map(len,groups))*0.15]
    xs = anchors([(sum(p%width for p in g)/len(g),len(g)) for g in dominant],8)
    ys = anchors([(sum(p//width for p in g)/len(g),len(g)) for g in dominant],(len(entries)+7)//8)
    slots = {item['slot']: [] for item in entries}
    for group in groups:
        cx = sum(p % width for p in group) / len(group)
        cy = sum(p // width for p in group) / len(group)
        row = min(range(len(ys)),key=lambda n:abs(cy-ys[n]))
        col = min(range(8),key=lambda n:abs(cx-xs[n]))
        slot = row*8+col
        if slot in slots:
            slots[slot].append(group)
    result = {}
    for item in entries:
        groups = slots[item['slot']]
        if not groups:
            raise ValueError(f"Missing generated sprite: {item['id']} slot {item['slot']}")
        main = max(groups, key=len)
        box = (min(p % width for p in main), min(p // width for p in main),
               max(p % width for p in main), max(p // width for p in main))
        pixels = []
        for group in groups:
            cx = sum(p % width for p in group) / len(group)
            cy = sum(p // width for p in group) / len(group)
            # Small internal islands include eyes, core nodes and open gear holes.
            interior = box[0] <= cx <= box[2] and box[1] <= cy <= box[3]
            if len(group) >= len(main) * 0.03 or interior:
                pixels.extend(group)
        bounds = (min(p % width for p in pixels), min(p // width for p in pixels),
                  max(p % width for p in pixels) + 1, max(p // width for p in pixels) + 1)
        crop = source.crop(bounds)
        alpha = bytearray(crop.width * crop.height)
        for p in pixels:
            alpha[(p // width - bounds[1]) * crop.width + p % width - bounds[0]] = 255
        crop.putalpha(Image.frombytes('L', crop.size, bytes(alpha)))
        # Reject accidentally joined neighboring objects rather than exporting a pair.
        if crop.width > width / 8 * 1.35 or crop.height > height / 8 * 1.35:
            raise ValueError(f"Oversized region, inspect source: {item['id']} {bounds}")
        result[item['id']] = (crop, bounds)
    return result


def icon32(source):
    bounds = source.getchannel('A').point(lambda a: 255 if a >= 220 else 0).getbbox()
    if not bounds:
        raise ValueError('Empty source item')
    body = source.crop(bounds)
    scale = min(26 / body.width, 26 / body.height)
    body = body.resize((max(1, round(body.width*scale)), max(1, round(body.height*scale))), Image.Resampling.NEAREST)
    alpha = body.getchannel('A').point(lambda a: 255 if a >= 220 else 0)
    rgb = body.convert('RGB').point(lambda v: round(round(v*7/255)*255/7))
    colors = [color for color, a in zip(rgb.get_flattened_data(), alpha.tobytes()) if a]
    samples = Image.new('RGB', (len(colors), 1))
    samples.putdata(colors)
    palette = samples.quantize(colors=15, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    body = rgb.quantize(palette=palette, dither=Image.Dither.NONE).convert('RGBA')
    body.putalpha(alpha)
    image = Image.new('RGBA', (32,32))
    image.alpha_composite(body, ((32-body.width)//2, (32-body.height)//2))
    silhouette = image.getchannel('A')
    outline = silhouette.filter(ImageFilter.MaxFilter(3))
    black = Image.new('RGBA', (32,32), BLACK)
    black.putalpha(outline)
    black.alpha_composite(image)
    clean = Image.new('RGBA', (32,32))
    clean.paste(black, mask=black.getchannel('A'))
    return clean


def find_font(override):
    paths = [override] if override else [
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
        '/System/Library/Fonts/PingFang.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        'C:/Windows/Fonts/msyh.ttc',
    ]
    return next((p for p in paths if p and Path(p).is_file()), None)


def grounded(icon, color, size):
    """Review-only approximation of the CSS floor glow; never baked in assets."""
    result = Image.new('RGBA', (size,size))
    draw = ImageDraw.Draw(result)
    rgb = tuple(bytes.fromhex(color[1:]))
    for n in range(10,0,-1):
        w, h = size*(0.36+n*0.035), size*(0.04+n*0.012)
        x, y = (size-w)/2, size*0.89-h/2
        draw.ellipse((x,y,x+w,y+h), fill=(*rgb, max(5, 55-n*4)))
    result.alpha_composite(icon.resize((size,size), Image.Resampling.NEAREST))
    return result


def contacts(entries, icons, font, name, columns=8):
    rows=(len(entries)+columns-1)//columns
    card_w, card_h = 166, 188
    image=Image.new('RGB',(columns*card_w+24,rows*card_h+110),'#070912')
    draw=ImageDraw.Draw(image)
    title=ImageFont.truetype(font,26)
    normal=ImageFont.truetype(font,14)
    small=ImageFont.truetype(font,12)
    draw.text((16,12),name,font=title,fill='#eeedf9')
    draw.text((16,52),'128px PNG / 32 格像素结构 / 黑色轮廓 / 阶段脚下光影为预览合成',font=normal,fill='#a9b2c8')
    for n,item in enumerate(entries):
        x,y=12+n%columns*card_w,92+n//columns*card_h
        draw.rectangle((x,y,x+card_w-8,y+card_h-8),fill='#101220',outline='#31364b')
        draw.rectangle((x+1,y+1,x+card_w-9,y+3),fill=STAGES[item['tier']])
        sprite=grounded(icons[item['id']],STAGES[item['tier']],112)
        image.paste(sprite,(x+23,y+8),sprite)
        for line_no,line in enumerate(textwrap.wrap(item['name'],width=10)[:2]):
            draw.text((x+8,y+124+line_no*17),line,font=normal,fill='#eeedf9')
        draw.text((x+8,y+163),f"P{item['tier']} / {item['id']}",font=small,fill=STAGES[item['tier']])
    image.save(OUT/name.replace(' / ','-').replace(' ','-').__add__('.png'))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font')
    args=parser.parse_args()
    font=find_font(args.font)
    if not font: raise RuntimeError('Pass --font with a CJK font for review images')
    plan=json.loads((OUT/'plan.json').read_text())
    catalog=json.loads((ROOT/'apps/server/internal/catalog/definitions.json').read_text())
    lookup={item['id']:item for item in catalog['items']}
    approved=ROOT/'output/imagegen/item-icons-v2/icons32'
    approved_ids={p.stem for p in approved.glob('*.png')}
    ASSETS.mkdir(parents=True,exist_ok=True)
    icons, index, report, provenance = {}, {}, [], []
    for batch in plan['batches']:
        source=Image.open(OUT/batch['source']).convert('RGBA')
        regions=extract(source,batch['items'])
        batch = {**batch, 'items': [item for item in batch['items'] if item['id'] in lookup]}
        for item in batch['items']:
            item_id=item['id']
            region,bounds=regions[item_id]
            origin=batch['source']
            if item_id in approved_ids:
                region=Image.open(approved/f'{item_id}.png').convert('RGBA')
                origin='approved-v2'
            icon=icon32(region)
            icons[item_id]=icon
            index[item_id]={'tier':item['tier']}
            provenance.append({**item,'source':origin,'source_bounds':bounds})
        contacts(batch['items'],icons,font,f"P{batch['stage']}-items")
        print(f"P{batch['stage']}: exported {len(batch['items'])} items")
    # Supplemental assets (such as DLC items) have their own source batches.
    # Keep their existing PNGs and manifest entries without rewriting them.
    for item_id in set(lookup)-set(icons):
        if not (ASSETS/f'{item_id}.png').is_file():
            raise RuntimeError('Missing supplemental item sprite: '+item_id)
        index[item_id]={'tier':lookup[item_id]['tier']}
        provenance.append({'id':item_id,'source':'supplemental asset'})
    assert set(index)==set(lookup), ('Catalog coverage mismatch',set(lookup)-set(index))
    duplicates={}
    for item_id,icon in icons.items():
        production=icon.resize((128,128),Image.Resampling.NEAREST)
        path=ASSETS/f'{item_id}.png'
        production.save(path,optimize=True)
        alpha=set(production.getchannel('A').tobytes())
        colors={p for p in production.get_flattened_data() if p[3]}
        bounds=icon.getbbox()
        assert alpha=={0,255} and bounds and min(bounds[:2])>=2 and max(bounds[2:])<=30,item_id
        assert BLACK in colors and len(colors)<=16,item_id
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        duplicates.setdefault(digest,[]).append(item_id)
        report.append({'id':item_id,'size':[128,128],'logical_size':[32,32],
                       'alpha':sorted(alpha),'opaque_colors':len(colors),'bounds32':bounds,
                       'black_pixels32':sum(p==BLACK for p in icon.get_flattened_data()),'sha256':digest})
    repeated=[v for v in duplicates.values() if len(v)>1]
    assert not repeated,repeated
    (ASSETS/'manifest.json').write_text(json.dumps({'version':3,'size':128,'logicalSize':32,'items':dict(sorted(index.items()))},ensure_ascii=False,indent=2)+'\n')
    (OUT/'manifest.json').write_text(json.dumps({'version':3,'generator':'built-in image_gen','items':provenance},ensure_ascii=False,indent=2)+'\n')
    (OUT/'validation.json').write_text(json.dumps({'count':len(report),'current_items':len(index),'duplicates':repeated,'items':report},indent=2)+'\n')
    showcase=[lookup[i] for i in ['i0001','i0002','i0004','i0049','i0110','i0108','i0139','i0146','i0192','i0213','i0248','i0264','i0328','i0331','i0334','i0341']]
    contacts(showcase,icons,font,'showcase',columns=4)
    print(f"Validated {len(icons)} unique IDs; 128px production PNGs written to {ASSETS.relative_to(ROOT)}")


if __name__=='__main__':
    main()
