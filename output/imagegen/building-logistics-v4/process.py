"""Export production facade PNGs and stable provenance; requires Pillow."""
from pathlib import Path
import sys,json,importlib.util,hashlib,shutil
from collections import deque
from PIL import Image,ImageDraw,ImageFont
sys.dont_write_bytecode=True
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
ASSETS=ROOT/'apps/web/src/assets/buildings/v1'

def module(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
art=module('facade_samples',OUT.parent/'building-logistics-v3/process.py')
shared=module('pixel_helpers',OUT.parent/'item-icons-v3/process.py')


def extract(source,entries):
 w,h=source.size
 groups=[g for g in shared.components(source.getchannel('A').point(lambda a:255 if a>=220 else 0)) if len(g)>=24]
 dominant=[g for g in groups if len(g)>=max(map(len,groups))*0.15]
 xs=shared.anchors([(sum(p%w for p in g)/len(g),len(g)) for g in dominant],4)
 ys=shared.anchors([(sum(p//w for p in g)/len(g),len(g)) for g in dominant],(len(entries)+3)//4)
 slots={e['slot']:[] for e in entries}
 for part in groups:
  cx=sum(p%w for p in part)/len(part);cy=sum(p//w for p in part)/len(part)
  col=min(range(4),key=lambda k:abs(cx-xs[k]));row=min(range(len(ys)),key=lambda k:abs(cy-ys[k]))
  if row*4+col in slots:slots[row*4+col].append(part)
 result={}
 for entry in entries:
  parts=slots[entry['slot']]
  if not parts:raise ValueError('Missing sprite '+entry['id'])
  main=max(parts,key=len);mb=(min(p%w for p in main),min(p//w for p in main),max(p%w for p in main),max(p//w for p in main))
  pixels=[]
  for part in parts:
   cx=sum(p%w for p in part)/len(part);cy=sum(p//w for p in part)/len(part)
   if len(part)>=len(main)*0.03 or (mb[0]<=cx<=mb[2] and mb[1]<=cy<=mb[3]):pixels.extend(part)
  box=(min(p%w for p in pixels),min(p//w for p in pixels),max(p%w for p in pixels)+1,max(p//w for p in pixels)+1)
  if box[2]-box[0]>w/4*1.35:raise ValueError('Joined sprite '+entry['id'])
  crop=source.crop(box);alpha=bytearray(crop.width*crop.height)
  for p in pixels:alpha[(p//w-box[1])*crop.width+p%w-box[0]]=255
  crop.putalpha(Image.frombytes('L',crop.size,bytes(alpha)));result[entry['id']]=(crop,box)
 return result


def preview(entries,icons,name,font):
 rows=(len(entries)+3)//4;im=Image.new('RGBA',(1048,rows*208+92),'#070912');d=ImageDraw.Draw(im)
 heading=ImageFont.truetype(font,24);label=ImageFont.truetype(font,16);small=ImageFont.truetype(font,12)
 d.text((18,14),name+' / 128px 正视像素机壳',font=heading,fill='#eeedf9')
 d.text((18,50),'正式 PNG 无阶段、方向或状态叠层；GUI / 地图标识由代码绘制',font=label,fill='#b9c3d8')
 for n,e in enumerate(entries):
  x,y=16+n%4*258,88+n//4*208;color=art.routes.COLORS.get(e.get('tier'),'#46eff2')
  d.rectangle((x,y,x+247,y+195),fill='#101220',outline='#343b52');d.rectangle((x+1,y+1,x+246,y+3),fill=color)
  im.alpha_composite(icons[e['id']],(x+10,y+10));im.alpha_composite(art.gui(icons[e['id']],color),(x+175,y+45))
  d.text((x+10,y+144),e['name'],font=label,fill='#eeedf9');d.text((x+10,y+174),f"{e['id']} / {('P'+str(e['tier'])) if e.get('tier') else '固定 / 兼容'}",font=small,fill=color)
 im.convert('RGB').save(OUT/f'{name}-preview.png')


def main():
 plan=json.loads((OUT/'plan.json').read_text());catalog=json.loads((ROOT/'apps/server/internal/catalog/definitions.json').read_text())
 lookup={b['id']:b for b in catalog['buildings']};ASSETS.mkdir(parents=True,exist_ok=True)
 font=shared.find_font(None)
 if not font:raise RuntimeError('CJK preview font required')
 icons={};provenance=[];records={}
 for batch in plan['batches']:
  regions=extract(Image.open(OUT/batch['source']).convert('RGBA'),batch['items'])
  for entry in batch['items']:
   crop,box=regions[entry['id']];icon=art.export_icon(crop);icons[entry['id']]=icon
   icon.save(ASSETS/f"{entry['id']}.png",optimize=True)
   provenance.append({**entry,'source':batch['source'],'source_region':box})
  preview(batch['items'],icons,batch['name'],font)
 for id in plan['approved']:
  source=OUT.parent/'building-logistics-v3/textures128'/f'{id}.png';shutil.copyfile(source,ASSETS/f'{id}.png');icons[id]=Image.open(source).convert('RGBA')
  provenance.append({'id':id,'name':lookup[id]['name'],'source':'approved-v3'})
 preview([lookup[id] for id in plan['approved']],icons,'approved',font)
 report=[];hashes=set()
 for id,b in lookup.items():
  renderer=plan['routes'].get(id,'image');records[id]={'renderer':renderer,'tier':b.get('tier'),'color':b['color']}
  if renderer!='image':continue
  p=ASSETS/f'{id}.png';im=Image.open(p);digest=hashlib.sha256(p.read_bytes()).hexdigest()
  assert im.size==(128,128) and im.mode=='RGBA' and set(im.getchannel('A').tobytes())=={0,255},id
  assert im.resize((64,64),Image.Resampling.NEAREST).resize((128,128),Image.Resampling.NEAREST).tobytes()==im.tobytes(),id
  colors={c for c in im.get_flattened_data() if c[3]};assert len(colors)<=20 and (5,5,9,255) in colors,id
  assert digest not in hashes,('Duplicate facade',id);hashes.add(digest)
  report.append({'id':id,'size':[128,128],'colors':len(colors),'alpha':[0,255],'sha256':digest})
 assert len(icons)==78 and len(records)==90
 (ASSETS/'manifest.json').write_text(json.dumps({'version':1,'size':128,'logicalSize':64,'buildings':records},ensure_ascii=False,indent=2)+'\n')
 (OUT/'manifest.json').write_text(json.dumps({'generator':'built-in image_gen','items':provenance,'procedural':plan['routes']},ensure_ascii=False,indent=2)+'\n')
 (OUT/'validation.json').write_text(json.dumps({'facades':78,'procedural':12,'catalog_ids':90,'images':report},indent=2)+'\n')
 print('Exported and validated 78 unique 128px facades; 90 catalog IDs covered with 12 procedural definitions')

if __name__=='__main__':main()
