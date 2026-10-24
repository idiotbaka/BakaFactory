"""Review-only machine image export and procedural logistics previews.

Run from repository root with Python + Pillow. --font accepts a CJK font.
No files under apps/ are written, and no application services/tests are run.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

sys.dont_write_bytecode=True
OUT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('route_style',OUT/'route_style.py')
routes=importlib.util.module_from_spec(spec);spec.loader.exec_module(routes)
ENTRIES=[('m05','炭化炉',1),('m11','冲压机',2),('m35','数控加工中心',4),('m51','AI 训练集群',6),
         ('bus','工厂仓库 WH',0),('chest','分拣料箱',1),('steam_tank','蒸汽储压罐',2),('pump','化工投料泵',3)]
PALETTE=['#080d18','#172333','#24394b','#344b65','#526380','#718ba3','#9db4c6','#dce3f1',
         '#096a80','#14a9ba','#46eff2','#a6f8f7','#803967','#ae4389','#ff62cb','#ffa0db',
         '#81411f','#c87936','#ffad4d']


def crop_grid(source):
    w,h=source.size
    groups=[[] for _ in ENTRIES]
    # The atlas has only two rows, with generous gutters. Components preserve
    # disconnected dial/metal highlights while discarding matte fringe noise.
    mask=source.getchannel('A').point(lambda a:255 if a>=220 else 0)
    data=mask.tobytes()
    seen=bytearray(len(data))
    from collections import deque
    for start,val in enumerate(data):
        if not val or seen[start]:continue
        q=deque([start]);seen[start]=1;part=[]
        while q:
            p=q.popleft();part.append(p);x,y=p%w,p//w
            neighbors=[]
            if x:neighbors.append(p-1)
            if x+1<w:neighbors.append(p+1)
            if y:neighbors.append(p-w)
            if y+1<h:neighbors.append(p+w)
            for n in neighbors:
                if data[n] and not seen[n]:seen[n]=1;q.append(n)
        if len(part)<24:continue
        cx=sum(p%w for p in part)/len(part);cy=sum(p//w for p in part)/len(part)
        groups[min(1,int(cy*2/h))*4+min(3,int(cx*4/w))].append(part)
    result=[]
    for parts in groups:
        if not parts:raise ValueError('Missing facade')
        main=max(parts,key=len)
        main_box=(min(p%w for p in main),min(p//w for p in main),max(p%w for p in main),max(p//w for p in main))
        pixels=[]
        for part in parts:
            cx=sum(p%w for p in part)/len(part);cy=sum(p//w for p in part)/len(part)
            if len(part)>=len(main)*0.03 or (main_box[0]<=cx<=main_box[2] and main_box[1]<=cy<=main_box[3]):pixels.extend(part)
        box=(min(p%w for p in pixels),min(p//w for p in pixels),max(p%w for p in pixels)+1,max(p//w for p in pixels)+1)
        crop=source.crop(box);alpha=bytearray(crop.width*crop.height)
        for p in pixels:alpha[(p//w-box[1])*crop.width+p%w-box[0]]=255
        crop.putalpha(Image.frombytes('L',crop.size,bytes(alpha)))
        result.append((crop,box))
    return result


def export_icon(crop):
    # Preserve the steel frame and main mechanism in a 64px logical working
    # canvas, rather than forcing the approved medium detail down to 32px.
    crop=crop.resize((56,56),Image.Resampling.NEAREST)
    alpha=crop.getchannel('A').point(lambda a:255 if a>=220 else 0)
    palette=Image.new('P',(1,1))
    flat=[int(c[i:i+2],16) for c in PALETTE for i in (1,3,5)]
    palette.putpalette((flat*14)[:768])
    crop=crop.convert('RGB').quantize(palette=palette,dither=Image.Dither.NONE).convert('RGBA');crop.putalpha(alpha)
    icon=Image.new('RGBA',(64,64));icon.alpha_composite(crop,(4,4))
    black=Image.new('RGBA',icon.size,'#050509');black.putalpha(icon.getchannel('A').filter(ImageFilter.MaxFilter(3)));black.alpha_composite(icon)
    result=Image.new('RGBA',icon.size);result.paste(black,mask=black.getchannel('A'))
    return result.resize((128,128),Image.Resampling.NEAREST)


def gui(icon,color):
    result=Image.new('RGBA',(48,48));d=ImageDraw.Draw(result);rgb=tuple(bytes.fromhex(color[1:]))
    d.ellipse((3,41,45,48),fill=(*rgb,40));d.ellipse((8,43,40,47),fill=(*rgb,80))
    result.alpha_composite(icon.resize((44,44),Image.Resampling.NEAREST),(2,0))
    return result


def placed(icon,color,working=False,with_arrow=True):
    # A code frame follows the alpha contour at the final map resolution;
    # arrow/status pixels are intentionally separate from the image asset.
    image=icon.resize((30,30),Image.Resampling.NEAREST)
    alpha=image.getchannel('A');rim=ImageChops.subtract(alpha.filter(ImageFilter.MaxFilter(3)),alpha)
    result=Image.new('RGBA',image.size,color);result.putalpha(rim);result.alpha_composite(image)
    d=ImageDraw.Draw(result)
    if with_arrow:d.line([(22,7),(25,3),(28,7)],fill='#eeedf9',width=1)
    d.rectangle((4,4,5,5),fill='#74edce' if working else '#526380')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--font');args=parser.parse_args()
    candidates=[args.font] if args.font else ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf','/System/Library/Fonts/PingFang.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','C:/Windows/Fonts/msyh.ttc']
    font=next((p for p in candidates if p and Path(p).is_file()),None)
    if not font:raise RuntimeError('Pass --font with a CJK font')
    fs={size:ImageFont.truetype(font,size) for size in (14,18,22,30)}
    (OUT/'textures128').mkdir(exist_ok=True)
    source=Image.open(OUT/'source-sheet.png').convert('RGBA');regions=crop_grid(source)
    icons=[];items=[]
    for entry,(crop,box) in zip(ENTRIES,regions):
        id,name,stage=entry;icon=export_icon(crop);icons.append(icon);path=OUT/'textures128'/f'{id}.png';icon.save(path,optimize=True)
        assert icon.size==(128,128) and set(icon.getchannel('A').tobytes())=={0,255}
        assert icon.resize((64,64),Image.Resampling.NEAREST).resize((128,128),Image.Resampling.NEAREST).tobytes()==icon.tobytes()
        assert len({p for p in icon.get_flattened_data() if p[3]})<=20
        items.append({'id':id,'name':name,'tier':stage or None,'file':f'textures128/{id}.png','size':[128,128],'logical_working_size':[64,64],'source_region':box,'phase_or_status_baked':False,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    preview=Image.new('RGBA',(1152,736),'#070912');d=ImageDraw.Draw(preview)
    d.text((24,16),'建筑 / 独立物流：中等细节正视像素机壳',font=fs[30],fill='#eeedf9')
    d.text((24,62),'左：128px 素材    右上：GUI 48px＋阶段光影    右下：地图 30px＋代码描边 / 方向 / 状态',font=fs[18],fill='#b9c3d8')
    d.text((24,96),'保留金属框架与主要结构；仅样稿，尚未接入游戏。连接线路另由代码生成。',font=fs[18],fill='#46eff2')
    for k,(entry,icon) in enumerate(zip(ENTRIES,icons)):
        id,name,stage=entry;x,y=24+k%4*280,144+k//4*272;color=routes.COLORS.get(stage,'#46eff2')
        d.rectangle((x,y,x+263,y+255),fill='#101220',outline='#343b52');d.rectangle((x+1,y+1,x+262,y+3),fill=color)
        preview.alpha_composite(icon,(x+10,y+18));preview.alpha_composite(gui(icon,color),(x+184,y+29))
        d.text((x+174,y+83),'GUI 48px',font=fs[14],fill='#b9c3d8')
        base=Image.new('RGBA',(40,40),'#070c18');base.alpha_composite(placed(icon,color,working=k<4,with_arrow=id!='bus'),(5,5));preview.alpha_composite(base,(x+188,y+112))
        d.text((x+174,y+159),'地图 30px',font=fs[14],fill='#b9c3d8')
        d.text((x+10,y+186),name,font=fs[22],fill='#eeedf9')
        d.text((x+10,y+220),f"{'固定设施' if not stage else 'P'+str(stage)} / {id}",font=fs[14],fill=color)
    d.text((24,704),'正式尺寸 128×128 RGBA · 此稿用 64 格工作底稿保留结构 · 阶段、方向、状态均为独立代码叠层',font=fs[18],fill='#b9c3d8')
    preview.convert('RGB').save(OUT/'machine-preview.png')
    checks=routes.validate();routes.previews(font)
    (OUT/'manifest.json').write_text(json.dumps({'status':'style-sample-awaiting-review','generator':'built-in image_gen for facades; procedural code for connected logistics','runtime_integrated':False,'machine_source':'source-sheet.png','prompt':'prompt.txt','machine_items':items,'routes':{'source':'route_style.py','native_size':30,'mask_bits':{'N':1,'E':2,'S':4,'W':8},'masks_per_family':16,'configurations_checked':sum(c['masks'] for c in checks),'runtime_adapter':'pending approval; preserve existing directional neighbor logic'}},ensure_ascii=False,indent=2)+'\n')
    print('8 transparent 128px facades and procedural connection studies exported; app files untouched')


if __name__=='__main__':main()
