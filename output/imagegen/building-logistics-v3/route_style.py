"""Review-only procedural 30px belt/pipe styling. No generated route bitmaps.

N/E/S/W bit masks share one cross-section. All openings reach the exact tile
edge, have no transverse rail/cap, and keep identical boundary RGBA samples.
This is geometry/style code, not game flow simulation or a production adapter.
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
import json

OUT = Path(__file__).resolve().parent
SIZE = 30
N,E,S,W = 1,2,4,8
COLORS = {1:'#ffc879',2:'#a5d4b2',3:'#74edce',4:'#46eff2',5:'#b69aff',6:'#ff72cf'}


def silhouette(ports,width):
    lo=(SIZE-width)//2; hi=lo+width-1
    mask=Image.new('L',(SIZE,SIZE));d=ImageDraw.Draw(mask)
    d.rectangle((lo,lo,hi,hi),fill=255)
    if ports&N:d.rectangle((lo,0,hi,14),fill=255)
    if ports&E:d.rectangle((15,lo,29,hi),fill=255)
    if ports&S:d.rectangle((lo,15,hi,29),fill=255)
    if ports&W:d.rectangle((0,lo,14,hi),fill=255)
    return mask


def paint(image,color,mask):
    image.paste(color,(0,0,SIZE,SIZE),mask)


def route_tile(kind,ports,stage=2,filled=False,phase=True):
    core=silhouette(ports,20 if kind=='belt' else 10)
    image=Image.new('RGBA',(SIZE,SIZE))
    # Rank filters clamp at open tile boundaries, so no end cap is introduced.
    if phase:paint(image,COLORS[stage],core.filter(ImageFilter.MaxFilter(5)))
    paint(image,'#050509',core.filter(ImageFilter.MaxFilter(3)))
    paint(image,'#6f89a5',core)
    paint(image,'#344b65',core.filter(ImageFilter.MinFilter(3)))
    inner=core.filter(ImageFilter.MinFilter(5))
    if kind=='belt':
        paint(image,'#37cbd9',inner)
        bed=core.filter(ImageFilter.MinFilter(7))
        paint(image,'#142136',bed)
        ribs=Image.new('L',(SIZE,SIZE));d=ImageDraw.Draw(ribs)
        if ports&E:d.rectangle((24,9,25,20),fill=255)
        if ports&W:d.rectangle((4,9,5,20),fill=255)
        if ports&N:d.rectangle((9,4,20,5),fill=255)
        if ports&S:d.rectangle((9,24,20,25),fill=255)
        paint(image,'#526380',ImageChops.multiply(ribs,bed))
    else:
        paint(image,'#142136',inner)
        paint(image,'#a6f8f7' if filled else '#287d96',core.filter(ImageFilter.MinFilter(9)))
        # Metal collars affect only the outer wall, never block the inner channel.
        collars=Image.new('L',(SIZE,SIZE));d=ImageDraw.Draw(collars)
        if ports&E:d.rectangle((25,0,26,29),fill=255)
        if ports&W:d.rectangle((3,0,4,29),fill=255)
        if ports&N:d.rectangle((0,3,29,4),fill=255)
        if ports&S:d.rectangle((0,25,29,26),fill=255)
        wall=ImageChops.subtract(core,inner)
        paint(image,'#a0b2c7',ImageChops.multiply(collars,wall))
    return image


def arrow(image,direction):
    result=image.copy();d=ImageDraw.Draw(result)
    points={E:[(12,11),(17,15),(12,19)],S:[(11,12),(15,17),(19,12)],
            W:[(17,11),(12,15),(17,19)],N:[(11,17),(15,12),(19,17)]}
    d.line(points[direction],fill='#eeedf9',width=1)
    return result


def edges(image,side):
    if side in (E,W):return tuple(image.getpixel((29 if side==E else 0,y)) for y in range(SIZE))
    return tuple(image.getpixel((x,29 if side==S else 0)) for x in range(SIZE))


def validate():
    checks=[]
    for kind in ['belt','pipe']:
        for filled in ([False] if kind=='belt' else [False,True]):
            for stage in range(1,7):
                tiles={ports:route_tile(kind,ports,stage,filled) for ports in range(16)}
                for ports,tile in tiles.items():
                    for side in (N,E,S,W):
                        edge=edges(tile,side)
                        if ports&side:
                            assert edge==edges(tiles[side],side),(kind,ports,side,'profile mismatch')
                            opposite={N:S,E:W,S:N,W:E}[side]
                            assert edge==edges(tiles[opposite],opposite),(kind,ports,side,'seam mismatch')
                            assert any(p[3] for p in edge)
                        else:assert not any(p[3] for p in edge),(kind,ports,side,'closed edge leak')
                checks.append({'kind':kind,'filled':filled,'stage':stage,'masks':16,'edge_profiles':'exact match'})
    (OUT/'route-validation.json').write_text(json.dumps({'tile_size':30,'mask_bits':{'N':1,'E':2,'S':4,'W':8},'checks':checks,'tile_configurations_checked':sum(c['masks'] for c in checks)},indent=2)+'\n')
    return checks


def as_svg(image):
    """Export the procedurally drawn pixels as crisp SVG runs for inspection."""
    groups={}
    for y in range(image.height):
        x=0
        while x<image.width:
            color=image.getpixel((x,y));start=x;x+=1
            while x<image.width and image.getpixel((x,y))==color:x+=1
            if color[3]:groups.setdefault(color,[]).append(f'M{start} {y}h{x-start}v1h{start-x}z')
    paths=''.join(f'<path fill="#{c[0]:02x}{c[1]:02x}{c[2]:02x}" d="{"".join(runs)}"/>' for c,runs in groups.items())
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {image.width} {image.height}" shape-rendering="crispEdges">{paths}</svg>'


def network(kind):
    cells={(x,2) for x in range(8)}|{(3,y) for y in range(5)}|{(6,y) for y in range(2,5)}|{(x,4) for x in range(3,7)}
    result=Image.new('RGBA',(8*SIZE,5*SIZE),'#080d18')
    for x,y in cells:
        mask=0
        for side,dx,dy in [(N,0,-1),(E,1,0),(S,0,1),(W,-1,0)]:
            if (x+dx,y+dy) in cells:mask|=side
        result.alpha_composite(route_tile(kind,mask,2 if kind=='belt' else 3,filled=kind=='pipe'),(x*SIZE,y*SIZE))
    return result


def previews(font):
    title=ImageFont.truetype(font,26);text=ImageFont.truetype(font,16);small=ImageFont.truetype(font,12)
    atlas=Image.new('RGBA',(16*SIZE,2*SIZE))
    for row,kind in enumerate(['belt','pipe']):
        for mask in range(16):atlas.alpha_composite(route_tile(kind,mask),(mask*SIZE,row*SIZE))
    (OUT/'route-atlas.svg').write_text(as_svg(atlas))
    canvas=Image.new('RGBA',(1048,660),'#070912');d=ImageDraw.Draw(canvas)
    d.text((24,14),'连接设施：同一套代码生成 16 种端口组合',font=title,fill='#eeedf9')
    d.text((24,58),'30px 整数坐标 · 开口直达格边 · 相邻端口逐像素一致 · 阶段线 / 箭头另行叠加',font=text,fill='#46eff2')
    for group,kind in enumerate(['belt','pipe']):
        for mask in range(16):
            x,y=24+mask%8*128,104+(group*2+mask//8)*132
            d.rectangle((x,y,x+115,y+123),fill='#101220',outline='#30384d')
            tile=route_tile(kind,mask,2 if kind=='belt' else 3,filled=kind=='pipe')
            canvas.alpha_composite(tile.resize((90,90),Image.Resampling.NEAREST),(x+12,y+5))
            ports=''.join(label for side,label in [(N,'N'),(E,'E'),(S,'S'),(W,'W')] if mask&side) or 'isolated'
            d.text((x+8,y+100),f'{kind} / {ports}',font=small,fill='#b9c3d8')
    canvas.convert('RGB').save(OUT/'connections-preview.png')
    scene=Image.new('RGBA',(1512,780),'#070912');d=ImageDraw.Draw(scene)
    d.text((24,16),'连续拼接：代码传送带 / 代码流体管道',font=title,fill='#eeedf9')
    d.text((24,56),'上：3 倍整数放大看接缝    下：实际 30px 网格    仅验证几何外观，不模拟运输或流量',font=text,fill='#b9c3d8')
    for n,kind in enumerate(['belt','pipe']):
        im=network(kind)
        scene.alpha_composite(im.resize((720,450),Image.Resampling.NEAREST),(24+n*744,96))
        scene.alpha_composite(im,(264+n*744,580))
        d.text((24+n*744,744),'传送带 / P2 灰绿描边' if kind=='belt' else '流体管道 / P3 薄荷描边 / 亮度示意',font=text,fill='#a5d4b2' if kind=='belt' else '#74edce')
        (OUT/f'{kind}-network.svg').write_text(as_svg(im))
    scene.convert('RGB').save(OUT/'network-preview.png')
    states=Image.new('RGBA',(960,410),'#070912');d=ImageDraw.Draw(states)
    d.text((20,12),'同一几何：阶段、方向、有液亮度均由代码参数控制',font=title,fill='#eeedf9')
    examples=[('P2 传送带',route_tile('belt',E|W,2)),('P5 传送带',route_tile('belt',E|W,5)),
              ('代码方向箭头',arrow(route_tile('belt',E|S,2),S)),('空管 / 低亮',route_tile('pipe',E|W,3)),
              ('有液 / 通道增亮',route_tile('pipe',E|W,3,filled=True)),('T 形管 / 箭头',arrow(route_tile('pipe',E|W|S,3,True),S))]
    for k,(label,im) in enumerate(examples):
        states.alpha_composite(im.resize((120,120),Image.Resampling.NEAREST),(20+k*156,66))
        d.text((20+k*156,207),label,font=text,fill='#eeedf9')
    d.text((20,256),'GUI 48px：同一代码图形不加阶段描边，阶段色仅作脚下光影',font=text,fill='#b9c3d8')
    gui_examples=[('belt',E|W,2,False),('belt',E|W,5,False),('belt',E|S,2,False),
                  ('pipe',E|W,3,False),('pipe',E|W,3,True),('pipe',E|W|S,3,False)]
    for k,(kind,mask,stage,filled) in enumerate(gui_examples):
        thumbnail=Image.new('RGBA',(48,48));g=ImageDraw.Draw(thumbnail)
        rgb=tuple(bytes.fromhex(COLORS[stage][1:]))
        g.ellipse((3,41,45,48),fill=(*rgb,40));g.ellipse((8,43,40,47),fill=(*rgb,80))
        thumbnail.alpha_composite(route_tile(kind,mask,stage,filled,phase=False).resize((44,44),Image.Resampling.NEAREST),(2,0))
        states.alpha_composite(thumbnail,(56+k*156,298))
        d.text((42+k*156,366),f'GUI / P{stage}',font=text,fill=COLORS[stage])
    states.convert('RGB').save(OUT/'route-state-study.png')


if __name__=='__main__':
    import sys
    font=sys.argv[1] if len(sys.argv)>1 else '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
    validate();previews(font)
    print('Generated procedural route studies; 288 tile configurations have matching edge pixels')
