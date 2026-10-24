"""Generate review assets only; does not modify runtime building/logistics art.

Run from repository root with Python + Pillow. Uses shared image processing
helpers from the accepted item-art pipeline. Preview overlays are not baked in PNGs.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
helper_path = OUT.parent/'item-icons-v3/process.py'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('item_art_helpers', helper_path)
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
STAGES = helpers.STAGES
ENTRIES = [
 ('m05','炭化炉',1,'machine','方形炉体 / 正视'),
 ('m11','冲压机',2,'machine','框架与压头 / 正视'),
 ('m35','数控加工中心',4,'machine','加工窗与控制区 / 正视'),
 ('m51','AI 训练集群',6,'machine','模块机柜 / 正视'),
 ('bus','工厂仓库 WH',0,'machine','固定设施 / 中性青色示意'),
 ('chest','分拣料箱',1,'machine','方形储箱 / 正视'),
 ('steam_tank','蒸汽储压罐',2,'machine','方框支撑 / 正视'),
 ('pump','化工投料泵',3,'machine','方形泵座 / 正视'),
 ('belt-straight','传送带 · 直线',2,'route','独立拓扑 / 箭头由代码添加'),
 ('belt-elbow','传送带 · 拐角',2,'route','独立拓扑 / 朝下示意'),
 ('belt-tee','传送带 · T 形',2,'route','独立拓扑 / 朝下示意'),
 ('belt-cross','传送带 · 十字',2,'route','独立拓扑 / 中央连续带面'),
 ('pipe-straight','流体管道 · 直线',2,'route','中性基础纹理 / 无流动状态'),
 ('pipe-elbow','流体管道 · 拐角',2,'route','独立拓扑 / 朝下示意'),
 ('pipe-tee','流体管道 · T 形',2,'route','独立拓扑 / 亮度由代码控制'),
 ('pipe-cross','流体管道 · 十字',2,'route','独立拓扑 / 亮度由代码控制'),
]


def extract(source):
    w,h = source.size
    groups=[g for g in helpers.components(source.getchannel('A').point(lambda a:255 if a>=220 else 0)) if len(g)>=24]
    dominant=[g for g in groups if len(g)>=max(map(len,groups))*0.15]
    xs=helpers.anchors([(sum(p%w for p in g)/len(g),len(g)) for g in dominant],4)
    ys=helpers.anchors([(sum(p//w for p in g)/len(g),len(g)) for g in dominant],4)
    slots=[[] for _ in ENTRIES]
    for group in groups:
        cx=sum(p%w for p in group)/len(group)
        cy=sum(p//w for p in group)/len(group)
        col=min(range(4),key=lambda n:abs(cx-xs[n]))
        row=min(range(4),key=lambda n:abs(cy-ys[n]))
        slots[row*4+col].append(group)
    result=[]
    for slot,parts in enumerate(slots):
        if not parts: raise ValueError(f'Missing sprite slot {slot}')
        main=max(parts,key=len)
        main_bounds=(min(p%w for p in main),min(p//w for p in main),max(p%w for p in main),max(p//w for p in main))
        pixels=[]
        for part in parts:
            cx=sum(p%w for p in part)/len(part)
            cy=sum(p//w for p in part)/len(part)
            inside=main_bounds[0]<=cx<=main_bounds[2] and main_bounds[1]<=cy<=main_bounds[3]
            if len(part)>=len(main)*0.03 or inside: pixels.extend(part)
        box=(min(p%w for p in pixels),min(p//w for p in pixels),max(p%w for p in pixels)+1,max(p//w for p in pixels)+1)
        crop=source.crop(box)
        mask=bytearray(crop.width*crop.height)
        for p in pixels: mask[(p//w-box[1])*crop.width+p%w-box[0]]=255
        crop.putalpha(Image.frombytes('L',crop.size,bytes(mask)))
        # The generated kiln had a protruding chimney; remove that top region so
        # the selected review facade is square like the other machine housings.
        if slot==0: crop=crop.crop((0,round(crop.height*0.20),crop.width,crop.height))
        result.append((crop,box))
    return result


def texture(crop,square):
    size=(28,28) if square else (max(1,round(crop.width*min(28/crop.width,28/crop.height))),max(1,round(crop.height*min(28/crop.width,28/crop.height))))
    crop=crop.resize(size,Image.Resampling.NEAREST)
    alpha=crop.getchannel('A').point(lambda a:255 if a>=220 else 0)
    rgb=crop.convert('RGB').point(lambda v:round(round(v*7/255)*255/7))
    visible=[c for c,a in zip(rgb.get_flattened_data(),alpha.tobytes()) if a]
    samples=Image.new('RGB',(len(visible),1));samples.putdata(visible)
    palette=samples.quantize(colors=15,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE)
    body=rgb.quantize(palette=palette,dither=Image.Dither.NONE).convert('RGBA');body.putalpha(alpha)
    icon=Image.new('RGBA',(32,32))
    icon.alpha_composite(body,((32-size[0])//2,(32-size[1])//2))
    black=Image.new('RGBA',(32,32),(5,5,9,255));black.putalpha(icon.getchannel('A').filter(ImageFilter.MaxFilter(3)))
    black.alpha_composite(icon)
    clean=Image.new('RGBA',(32,32));clean.paste(black,mask=black.getchannel('A'))
    return clean


def map_overlay(icon,stage,direction='right',working=False,arrow=True):
    color=STAGES.get(stage,'#46eff2')
    alpha=icon.getchannel('A')
    rim=ImageChops.subtract(alpha.filter(ImageFilter.MaxFilter(3)),alpha)
    result=Image.new('RGBA',icon.size,color);result.putalpha(rim)
    result.alpha_composite(icon)
    draw=ImageDraw.Draw(result)
    if arrow:
        points=[(12,12),(18,16),(12,20)] if direction=='right' else [(12,12),(16,18),(20,12)]
        draw.line(points,fill='#eeedf9',width=1)
    if working: draw.rectangle((4,4,6,6),fill='#74edce')
    return result


def main():
    source=Image.open(OUT/'source-sheet.png').convert('RGBA')
    regions=extract(source)
    font_path=helpers.find_font(None)
    if not font_path: raise RuntimeError('A CJK system font is required for the preview')
    fonts={size:ImageFont.truetype(font_path,size) for size in [14,18,22,30]}
    (OUT/'textures128').mkdir(exist_ok=True)
    icons=[];metadata=[]
    for n,((id,name,stage,kind,note),(crop,box)) in enumerate(zip(ENTRIES,regions)):
        icon=texture(crop,kind=='machine');icons.append(icon)
        final=icon.resize((128,128),Image.Resampling.NEAREST)
        path=OUT/'textures128'/f'{id}.png';final.save(path,optimize=True)
        assert set(final.getchannel('A').tobytes())=={0,255}
        assert len({p for p in final.get_flattened_data() if p[3]})<=16
        metadata.append({'id':id,'name':name,'stage':stage or None,'kind':kind,'note':note,'source_region':box,'file':f'textures128/{id}.png','size':[128,128],'logical_size':[32,32],'phase_baked':False,'arrow_baked':False,'status':'style-sample-awaiting-review','sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    canvas=Image.new('RGBA',(1152,1272),'#070912');d=ImageDraw.Draw(canvas)
    d.text((24,16),'建筑 / 物流 · 方形正视像素科幻线条 · 风格样稿',font=fonts[30],fill='#eeedf9')
    d.text((24,62),'左：128px 纯素材    右上：GUI 48px＋阶段光影    右下：地图 30px＋代码描边 / 箭头',font=fonts[18],fill='#b4bdd1')
    d.text((24,94),'仅作美术与代码叠层示意，尚未接入游戏；连接端口尺寸与拼接规范待风格确认后统一。',font=fonts[18],fill='#46eff2')
    for n,(entry,icon) in enumerate(zip(ENTRIES,icons)):
        id,name,stage,kind,note=entry
        x,y=24+n%4*280,144+n//4*272
        color=STAGES.get(stage,'#46eff2')
        d.rectangle((x,y,x+263,y+255),fill='#101220',outline='#343b52')
        d.rectangle((x+1,y+1,x+262,y+3),fill=color)
        large=icon.resize((128,128),Image.Resampling.NEAREST)
        canvas.alpha_composite(large,(x+10,y+20))
        gui=helpers.grounded(icon,color,48);canvas.alpha_composite(gui,(x+184,y+29))
        d.text((x+174,y+83),'GUI 48px',font=fonts[14],fill='#b4bdd1')
        direction='down' if id.endswith(('elbow','tee')) else 'right'
        mapped=map_overlay(icon,stage,direction,working=n<4,arrow=id!='bus')
        base=Image.new('RGBA',(40,40),'#070c18');base.alpha_composite(mapped.resize((30,30),Image.Resampling.NEAREST),(5,5))
        canvas.alpha_composite(base,(x+188,y+112))
        d.text((x+174,y+159),'地图 30px',font=fonts[14],fill='#b4bdd1')
        d.text((x+10,y+186),name,font=fonts[22],fill='#eeedf9')
        d.text((x+10,y+220),f"{'固定设施' if not stage else 'P'+str(stage)} / {id}",font=fonts[14],fill=color)
    d.text((24,1242),'128×128 RGBA · 32 格像素结构 · 黑色基础轮廓 · 原图不含方向、阶段边框或状态亮点',font=fonts[18],fill='#b4bdd1')
    canvas.convert('RGB').save(OUT/'preview.png')
    study=Image.new('RGBA',(640,270),'#070912');s=ImageDraw.Draw(study)
    s.text((16,8),'同一机身 PNG 的代码状态 / 管道亮度示意',font=fonts[22],fill='#eeedf9')
    for k,(label,image) in enumerate([
        ('停止：代码灰点',map_overlay(icons[1],2,working=False)),
        ('运行：代码绿点',map_overlay(icons[1],2,working=True)),
        ('空管：基础素材',map_overlay(icons[12],2)),
        ('有液：通道增亮',map_overlay(icons[12],2)),
    ]):
        if k==0:
            ImageDraw.Draw(image).rectangle((4,4,6,6),fill='#526380')
        if k==3:
            # Overlay only the static inner cyan channel; no fluid event is inferred.
            draw=ImageDraw.Draw(image);draw.line([(5,16),(26,16)],fill='#b6fbff',width=1)
        study.alpha_composite(image.resize((128,128),Image.Resampling.NEAREST),(16+k*156,65))
        s.text((16+k*156,214),label,font=fonts[18],fill='#eeedf9')
    study.convert('RGB').save(OUT/'state-study.png')
    (OUT/'manifest.json').write_text(json.dumps({'status':'style-sample-only','generator':'built-in image_gen','source':'source-sheet.png','prompt':'prompt.txt','runtime_integrated':False,'items':metadata,'validation':{'count':16,'format':'128x128 RGBA','alpha':[0,255],'opaque_colors_max':16,'integer_upscale':4,'connection_alignment':'pending after style approval'}},ensure_ascii=False,indent=2)+'\n')
    print('Exported 16 review-only 128px textures, named preview and separate code-overlay state study')


if __name__=='__main__': main()
