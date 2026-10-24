"""Stable production facade batches; no API calls or game-state access."""
from pathlib import Path
import json
OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
catalog=json.loads((ROOT/'apps/server/internal/catalog/definitions.json').read_text())
ROUTES={**{s:'belt' for s in ['conveyor','hand_belt','mechanical_belt','hydraulic_belt','electric_belt','precision_belt','flexible_belt']},'pipe':'pipe','return_pipe':'pipe','shaft':'shaft','cable':'cable','hydraulic_line':'hydraulic'}
APPROVED=['m05','m11','m35','m51','bus','chest','steam_tank','pump']
MACHINE_BRIEFS='''manual workbench facade with one broad work surface, tool clamp and drawer
manual sorting table facade with three large rectangular sorting trays
dismantling bench facade with a broad vise, wrench-shaped mechanical fixture and lower tray
hand-cranked crusher facade with a pair of broad jaws and one small side crank
square charcoal kiln facade with large hatch and three broad warm grate slots
simple smelting furnace facade with a large crucible opening and side vents
anvil forge facade with central anvil silhouette, squared support and hammer fixture
manual assembly bench facade with clamping jaws and two tool sockets
solid-fuel power engine facade with a large round flywheel and rectangular fuel chamber
mechanical screening machine facade with large diagonal mesh panel and two material outlets
mechanical press facade with two guide columns, piston and lower anvil
mechanical lathe facade with horizontal spindle, chuck and carriage rail
high-temperature casting furnace facade with central crucible and two thick side heat shields
steam boiler facade with broad pressure vessel, pipe manifold and unmarked circular gauge
mechanical assembly-line facade with two short opposing assembly arms around a work platform
gear crusher facade with two large meshing toothed wheels inside the square housing
mechanical splitter facade with central drive cog and three compact flush output sockets
early robot charging station facade with a winding-key docking post and square platform
plastic pyrolysis furnace facade with squared hopper mouth, heat chamber and condenser coil
frontal distillation tower enclosure with three stacked column chambers and side return line
hydraulic power-station facade with one tank, one broad pump and two pressure sockets
hydraulic press facade with twin thick cylinders and a heavy lower platen
chemical reactor facade with central rounded pressure chamber and overhead mixer spindle
centrifuge facade with large circular bowl and simple radial rotor inside a square casing
wet leaching bath facade with broad rectangular basin window and a side circulation pipe
alloy furnace facade with a tilted crucible silhouette inside a square heat-shield frame
hydraulic robot assembly bench facade with one piston-driven arm over an empty robot cradle
liquid-fuel generator facade with engine block, vertical exhaust channel and flush fuel reservoir
electrolysis cell facade with two broad upright electrodes dipping into a rectangular bath
cable extruder facade with a large circular reel and squared extrusion nozzle
PCB etching-machine facade with a broad shallow bath window and upper processing rail
electronic soldering bench facade with a short soldering tool and central board holder
motor assembler facade with central rotor shaft and circular stator ring
battery assembler facade with three cylindrical cell holders in a square assembly fixture
CNC facade with left inspection bay, vertical spindle and right control column
electrical assembly-line facade with one short articulated tool arm and large flat work bed
logistics control-console facade with two large flat screens and two socket rows
quartz purification furnace facade with a broad crystal chamber and thick heat-shield panels
wafer cutting-machine facade with one large vertical saw disc and wafer support tray
photolithography machine facade with a central optical column and broad sealed exposure chamber
thin-film deposition machine facade with central dome chamber and two flush side flanges
chip packaging-machine facade with a central square chip socket and short upper press head
optical calibration station facade with a large lens ring facing a simple target plate
servo assembly-line facade with central motor flange and one mechanical tool spindle
firmware programmer facade with a central chip socket, broad connection strip and one screen
multi-robot coordination dock facade with three identical docking bays and a central bus line
ultrapure purification tower facade with three stacked clean chambers inside one square enclosure
nanomaterial reactor facade with central circular reaction vessel and three broad short manifolds
neural chip packaging-line facade with a central diamond chip socket and twin assembly heads
high-density energy factory facade with four large cell chambers and broad overhead collector bus
AI training cluster facade with six server cartridges in two columns and one central interconnect
bionic limb assembly-station facade with an articulated robot leg in a central assembly fixture
intelligent robot final-assembly facade with an upright robot body fixture and two side assembly rails
terminal robot acceptance pod facade with an upright empty inspection chamber and sensor arch
rotary calcining kiln facade with one broad angled drum and circular front furnace mouth'''.splitlines()
briefs={f'm{n:02d}':v for n,v in enumerate(MACHINE_BRIEFS,1)}
briefs.update({
'miner':'legacy mining machine facade with a broad central drill spindle and reinforced lower base',
'furnace':'legacy furnace facade with a squared firebox and two simple side vent panels',
'assembler':'legacy assembler facade with one central gear chuck and two broad manipulator fixtures',
'item_output':'legacy output port facade with left source compartment and right open transfer socket, no arrows',
'item_input':'legacy input port facade with left open transfer socket and right receiving compartment, no arrows',
'feeder':'automatic feeder facade with broad hopper above and short mechanical feeding chute below',
'waste_port':'waste extraction dock facade with a large recycling hatch and coarse scrap intake, no recycling lettering',
'buffer_chest':'logistics buffer warehouse facade with three horizontal drawers and a broad square outer shell',
'valve':'fluid valve facade with a large cross-shaped handwheel, central circular valve body and three flush side sockets',
'pressure_valve':'pressure regulating valve facade with a compact round regulator, adjustment knob and two flush sockets',
'tank':'fluid storage tank facade with broad upright cylinder, long unmarked level window and flush side sockets',
'hydraulic_station':'hydraulic robot dock facade with a broad pressure charging cradle and two vertical small reservoirs',
'charge_station':'robot battery-swap station facade with one empty docking bay and two visible spare battery slots',
'battery':'energy storage-box facade with three large rectangular cell windows and two flush terminal blocks',
'dense_battery':'high-density storage-box facade with six compact cell windows and a broad collector panel',
'electric_feeder':'electric feeder-arm facade with one short articulated grabber and a compact side motor block',
'precision_feeder':'precision feeder-arm facade with slim two-joint manipulator and small twin-finger gripper',
'flexible_feeder':'flexible feed-node facade with a segmented flexible manipulator and four flush connector sockets',
'smart_gate':'smart sorting gate facade with one broad sliding shutter and two small sensor blocks, no arrows',
})
style='''Generate ONE production atlas for BakaFactory matching the supplied STYLE REFERENCE: medium-detail straight-front 16-bit pixel-art industrial machine facades. Exactly FOUR columns and FOUR rows; each cell square, same footprint; ideally 2048x2048 output.
Each machine is a 56x56 logical pixel square facade on a 64x64 logical cell, exported enlarged with nearest neighbor. Dead straight FRONT VIEW, face parallel to screen, no top or side plane, no perspective, no isometric drawing. Keep all machinery inside an identical square housing. No protruding chimney, feet or pipes outside the square. Leave four logical pixels transparent margin on all sides of each cell. No overlap.
Retain steel casing, structural frame, main working mechanism and 2-3 supporting functional details. Moderate detail BETWEEN technical pictograms and dense industrial miniature illustration. Major mechanisms need clear different silhouettes. No many tiny bolts, dense vents or ornamental circuit grids. Pixel art: deliberate square clusters, limited palette, clean stepped corners, no antialiasing, no smooth gradients, no texture noise, no dithering. One highlight band and one shadow band per steel edge. Dark navy recesses, slate blue steel, sparse pale metal highlights, cyan #46eff2 and small pink #ff62cb functional parts. Furnace apertures can have muted warm amber. Calm industrial sci-fi, NOT cartoon toys or comic illustration.
The reference is STYLE ONLY. Draw the EXACT different subjects below, not repeated copies of reference machines. NO text, numbers, labels, arrows, chevrons, operating indicator dots, stage-colored outline, ground glow, cast shadows, background, grid or card borders. Genuine transparent alpha background and gutters. Direction/status/stage are rendered in GAME CODE.
'''
items=[b for b in catalog['buildings'] if b['id'] not in ROUTES]
pending=[b for b in items if b['id'] not in APPROVED]
assert len(items)==78 and len(pending)==70 and len(MACHINE_BRIEFS)==55
plan={'version':1,'size':128,'logicalSize':64,'style_reference':'../building-logistics-v3/source-sheet.png','approved':APPROVED,'routes':ROUTES,'batches':[]}
for index,start in enumerate(range(0,len(pending),16),1):
 rows=pending[start:start+16]
 entries=[{'id':b['id'],'name':b['name'],'tier':b.get('tier'),'slot':n,'brief':briefs[b['id']]} for n,b in enumerate(rows)]
 lines=[f"Row {n//4+1}, column {n%4+1}: "+(entries[n]['brief'] if n<len(entries) else 'EMPTY transparent cell, no object')+'.' for n in range(16)]
 prompt=style+'\nEXACT SUBJECT ORDER:\n'+'\n'.join(lines)+'\n'
 name=f'batch-{index}'
 (OUT/f'{name}-prompt.txt').write_text(prompt)
 plan['batches'].append({'name':name,'source':f'{name}-source.png','prompt':f'{name}-prompt.txt','items':entries})
(OUT/'plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
print('Prepared',len(items),'facades; 8 approved, new batches:',[len(b['items']) for b in plan['batches']])
