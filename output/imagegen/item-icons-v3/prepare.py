"""Build stable batch manifests and the exact ImageGen prompts from catalog IDs."""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
catalog = json.loads((ROOT / 'apps/server/internal/catalog/definitions.json').read_text())
BRIEFS = {
1: '''tied dark garbage sack with a pink patch
three jagged broken steel shards
pile of cyan and pink broken plastic shells
loose copper wire loops with stripped blue tip
sharp cyan glass and cream ceramic shards
soggy green organic clump with a leaf
broken tiny electronic parts and plugs
crumpled thin silver foil scraps
black rubber curls and crumbs
small gray sand and ash mound
short curled iron machining shavings
rust red powder mound
bundle of dry pale twigs and leaves
squat bottle of murky gray-blue water
one uneven rough gray iron sheet
simple L-shaped bolted metal support
small dismantling workbench with wrench
spool of rough copper wire
ragged pink insulating sheet scraps
broken green circuit board with missing corner
dented old battery with two terminals
three mismatched metal alloy plates
crushed small silver aluminum nuggets
stack of reusable colorful plastic pieces
purple contaminated sludge clump
compact hand-cranked jaw crusher
pile of sparkling pale glass sand
cream ceramic powder mound
pink and cyan plastic pellets
small warm tan sand pile
small dark gray ash powder pile
iron-bearing brown mineral powder
stubby charcoal kiln with short chimney
three irregular black biochar chunks
thick dark purple tar lump
stack of two solid black fuel briquettes
small brick melting furnace with orange opening
rough rectangular gray iron ingot
crusty dark furnace slag lump
rough warm copper ingot
rough pale silver aluminum ingot
solid cyan recycled glass brick
small sharp transparent glass chips
two orange refractory bricks
stack of flat basic iron plates
long thick copper bar
hollow square aluminum frame
three large round-head iron rivets
simple eight-tooth metal gear with open hole
thick black rubber sealing ring
small anvil on a wooden stump
small manual assembly bench with vise
short hand-cranked conveyor belt segment
open sorting crate with two compartments
mechanical two-finger grabber claw
small solid-fuel engine with flywheel
short plain low-speed drive shaft
tiny mechanical counter with three blank rollers
small hopper feeder with crank
jointed small production robot arm and claw
small manual sorting table with trays
simple hand crafting workbench with hammer
hardened gray waste residue brick''',
2: '''industrial mechanical screening machine with mesh tray
pile of rich green circuit board fragments
white quartz sand mound with cyan grains
compact mechanical stamping press with upper die
three clean flat steel plates
small triangular metal offcuts
pale blue aluminum alloy plate
rolled warm copper foil ribbon
three hexagonal bolts and nuts
sealed square steel housing with rim
compact mechanical lathe with spindle
polished stepped drive shaft
round bearing with visible inner ring
bolted triangular frame connector bracket
small terminal block with three copper posts
precise steel gear with many clear teeth
small high-temperature casting furnace with crucible
rectangular dark alloy steel billet
warm copper-aluminum alloy billet
glossy cyan high-temperature glass slab
gray slag cement sack with simple block emblem
compact steam boiler with smokestack and pipe
clear blue water flask
small brown filter cake
white steam puff with cyan curls
mechanical assembly line bench with paired arms
thick dark industrial steel plate
pair of meshing standard gears
rounded pressure vessel with two pipe stubs
lightweight four-wheel empty chassis
rough tan insulation panel
short brass pneumatic cylinder with hose
compact twin-gear pulverizer
small mound of bright white quartz powder
coarse brown tailings mound
cool slate nickel-cobalt powder pile
soft silver tin-lead powder pile
irregular dark impurity clump
warm orange copper powder mound
purple metallic electronic dust
small mound of purple cathode powder
black negative-electrode carbon powder mound
T-shaped mechanical conveyor splitter
small brass robot charging dock with winding post
squat wind-up hauling cart with cargo tray
small red mechanical alarm bell with gear
round steam pressure gauge with clear needle
short blue steam pressure tank with valve
closed hydraulic industrial kit case with pipe emblem
small rotary kiln drum with short furnace
brick-red calcined mineral powder
gray exhaust gas cloud with two curls
porous activated black carbon residue
square ivory ceramic substrate
small pile of pale heat-resistant packing rings
solid gray building block with two holes
short industrial mechanical conveyor belt segment
long precision high-speed shaft with two collars
mechanical dosing gate with sliding shutter
small vertical freight elevator mast and platform
square logistics buffer bin with opening
L-shaped cyan fluid pipe with two flanges''',
3: '''plastic pyrolysis furnace with angled hopper
flask of dark purple crude pyrolysis oil
small mound of jet-black carbon black powder
crusty yellow-green acid residue lump
small mound of dark graphite industrial carbon
slim distillation column with side pipe loops
short flask of pale pink light hydrocarbons
jerrycan of vivid pink liquid fuel
short dark heavy-oil barrel with cyan rim
glossy dark oil sludge clump
ivory industrial wax block with a drip
small lavender solvent flask
bottle of dark murky wastewater
hydraulic power station with tank and pump
squat flask of purple hydraulic working fluid
reinforced pressure bottle of cyan working fluid
small hydraulic press with twin cylinders
thick clean high-strength steel slab
bottle of dirty brown-purple working fluid
flat pale corrosion-resistant aluminum plate
pair of precise metal pipe couplings
long diagonal hydraulic piston with eyelets
chemical reactor pot with domed lid and mixer
flask of dilute yellow acid
glossy pink polymer resin beads
small round bottle of violet organic solvent
small roll of dark insulating adhesive
short bottle of cyan etching solution
compact centrifuge with round covered bowl
rectangular wet-leaching bath with pipe
bottle of golden precious-metal solution
bottle of greenish spent acid
flask of violet nickel-cobalt solution
flask of pale mint rare-earth solution
clear brine bottle with salt crystal emblem
sealed cake of safe gray sludge
alloy smelting furnace with tilted crucible
warm gold heat-resistant alloy ingot
cool silver heat-conducting alloy ingot
clear pale blue silicate glass plate
small mound of shining gold metal powder
pale lavender rare-earth oxide powder
hydraulic robot assembly table with piston arm
small hydraulic hauling robot with treads
slim pipe-inspection robot with probe eye
metal pressure regulating valve with pink handwheel
stacked plate heat exchanger with pipe sockets
hydraulic demonstration skid with paired tanks
closed electrification kit case with lightning emblem
small pile of white industrial salt crystals
greenish environmental storage brick
dark gas-adsorbing sludge cake
upright fluid tank with side level window
three-way liquid valve with blue handle
short cyan hydraulic conveyor belt segment
chemical automatic dosing pump with hose
U-shaped return fluid pipe with two flanges''',
4: '''small liquid-fuel generator with exhaust and pink tank
electrolysis bath with two upright electrodes
light cyan hydrogen gas bubble cluster
pale blue oxygen gas cloud with paired round bubbles
bottle of cyan electrolyte brine
small pile of violet nickel-cobalt salt crystals
small mound of dark magnetic rare-earth powder
cable extrusion machine with reel
neat thin bright copper wire coil
thick coiled pink insulated power cable with cyan plug
spool of pink enamel winding wire
three bundled industrial cables with connector ends
circuit etching machine with shallow tray
simple cyan circuit board with three large copper pads
bottle of dark used etching fluid
plain copper-clad fiberglass board with tan edge
stack of three purple circuit boards
small soldering bench with iron and stand
three salvaged tiny capacitors and resistor blocks
silver solder wire spool
small bag of resistor and capacitor blocks
simple logic board with one central chip
industrial controller board with chip and socket
motor assembly bench with rotor
small DC motor with simple shaft
large industrial motor with ribbed shell
motor driver block with heatsink
copper winding stator assembly
battery assembly machine with cell holder
one cylindrical rechargeable cell
rectangular cyan battery module with pink lightning
large energy storage box with three cell windows
compact paired robot battery pack
small enclosed CNC machining center
rectangular precision metal frame
curved lightweight torso shell
stack of silver heat dissipation fins
compact precision gearbox module
industrial multi-pin plug connector
small electrical automatic assembly line with screen
short electric actuator with shaft
three-joint general-purpose robotic arm
sensor control box with two probe leads
small wheeled electric logistics robot with cargo
compact sorting robot with twin claws
small logistics central console with cyan screen
small beacon-like logistics address node
compact router box with three antenna stubs
robot battery-swap dock with spare pack
smart logistics demonstration unit with two linked carts
microelectronics permit card with chip emblem
red-purple heat-resistant circuit board
heat-rated servo driver with copper heatsink
short electric conveyor belt segment with side motor
smart sorting gate with sensor arch
robot navigation beacon with cyan diamond lamp
compact uninterruptible power unit with battery and plug''',
5: '''quartz purification furnace with crystal chamber
rough pale blue polysilicon chunks
small gray carbon-monoxide exhaust cloud
long smooth silver-blue high-purity silicon rod
bottle of cloudy waste solvent
clear pale optical glass blank
three dark magnet blocks with pink poles
wafer cutting machine with visible saw wheel
round lavender silicon wafer with notch and four colored blocks
small irregular silicon wafer offcuts
smooth reflective pale polished silicon wafer
clear round convex optical lens
small photolithography machine with optical chamber
small amber bottle of pink photoresist
wafer with one large cyan exposure cross
wafer with three broad magenta exposure stripes
pair of tiny cyan optical prisms
thin-film deposition chamber with dome
small dark logic die with pink central square
small memory die with three pale bars
small power die with gold cross
small sensor die with cyan eye dot
rolled flexible pink sensing film
chip packaging machine with square socket
square processor with pink core and three pins per side
long memory chip with three magenta windows
square power controller chip with gold connector bar
square vision chip with cyan camera-eye symbol
small embedded compute board with chip and connector
optical calibration bench with target lens
camera module with large cyan lens
small round ranging radar with side plug
round pressure-touch sensor with pink contact pad
small environmental sensor with three probe prongs
multi-sensor board with lens and two probe posts
servo assembly line with motor and arm
compact servo motor with square flange
precision robot rotary joint with central bolt
slender precision robotic arm with small gripper
small high-speed sorter robot with paired wide claws
small repair robot with wrench arm
firmware programming station with chip socket
path-planning firmware cartridge with three route dots
maintenance firmware cartridge with wrench symbol
collaborative scheduling cartridge with three linked blocks
vision firmware cartridge with camera-eye symbol
multi-robot coordination dock with three posts
sorting robot upgrade kit with claw module
repair robot upgrade kit with wrench and spare joint
route sample tile with bent path and three bright dots
inspection log data scroll with three cyan marks
vision training sample slide with eye and pixel blocks
unmanned demonstration system console with two robot heads
cognitive project kit case with neural diamond emblem
heat-resistant control module with large gold heatsink
heat-rated repair robot with shielded wrench arm
short high-speed precision conveyor with twin drive rollers
smart routing node with four connected bright dots
open repair spares toolbox with gear and wrench''',
6: '''ultrapure purification tower with layered clean chamber
bright pale electronic-grade silicon crystal chunks
small pile of pale green rare-earth salt crystals
one bright pale gold ultrapure precious metal ingot
clear bright cyan ultrapure electrolyte bottle
small bright ivory ultrapure quartz powder mound
nanomaterial reactor with round chamber and three pipes
folded dark graphene conductive sheet with cyan edge
small bottle of vivid pink nanoscale photo material
three thin flexible magenta neural wires
flexible cyan tactile mesh with four large nodes
small magnetic actuator material block with pink poles
neural chip packaging line with glowing diamond socket
neural computation die with three connected magenta nodes
wide memory die with four cyan segments
neural compute module with large pink diamond
long-term memory module with paired lavender storage blocks
multimodal perception module with lens and side prongs
high-density energy cell production machine
single reinforced high-cycle rechargeable cell
three bundled high-density battery cells
energy management board with pink power node
paired redundant power modules with separate plugs
small AI training cluster of three server blocks
multimodal dataset cartridge with eye and waveform symbols
basic cognitive model capsule with one pink node
training error report sheet with jagged red graph and no text
perception-planning model tile with eye and route arrow
safety decision model tile with shield and check symbol
cyan diamond cognitive core capsule with pink central node
bionic limb assembly station with robotic leg
round bionic drive joint with visible central hub
upright five-finger articulated white robotic hand
pair of small biped robot legs on hip frame
hollow white bionic torso frame with pink center socket
detached white robot head with cyan visor and pink eyes
paired white bionic arm assemblies
smart robot assembly line with upright robot silhouette
plain unconfigured robot body with dark empty chest
complete AI core with pink diamond and cyan cradle
upright robot waiting in small testing frame
terminal acceptance pod with robot-sized opening
complete friendly white intelligent biped robot
acceptance certificate plate with simple cyan check badge
intelligent repair robot with wrench forearm
intelligent logistics robot with small cargo pack
precision assembly robot with narrow twin-finger grippers
expandable factory license card with factory silhouette
sealed ivory carbonate storage block
large permanent dark storage building brick
shielded extreme-duty repair robot with wrench and visor
short flexible three-dimensional conveyor with raised bend
neural dispatch node with pink hub and four cyan branches
self-repair production module with gear and tiny wrench'''
}
style = '''Create ONE sprite atlas for BakaFactory in authentic 1990s SEGA Mega Drive / Super Famicom Japanese RPG inventory pixel art, matching the supplied visual STYLE REFERENCE only.
CRITICAL COMPOSITION: EXACTLY EIGHT columns and EIGHT rows, 64 equal square cells. Prefer 2048x2048 output. Treat the sheet as a REAL 256x256 LOGICAL PIXEL canvas enlarged with nearest neighbor. Every cell is 32x32 logical pixels; each sprite fits in its central 24x24 pixels with FOUR empty logical pixels on every side. All 64 cell centers are on a perfectly regular grid. No item may overlap its cell or neighbor. Unused cells MUST stay completely EMPTY.
Each object must be drawn as a genuine tiny 16-bit console sprite: big solid square pixels, consistent pixel grid, simple unique silhouette, broad flat color clusters, maximum 6-12 colors per item, two shadows per material, one crisp dark navy/black pixel contour. NO tiny lines or microdetails. No fine circuit grids, no dozens of bolts, no realistic glints, no gradients, no smooth lighting, no painterly texture, no anti-aliasing, no bloom, no blur, no dithering. The asset must remain readable at native 32x32. Radically simplify.
Palette: dark navy/black contours, slate/lavender metal, warm cream highlights, vivid pink and bright cyan accents. Copper remains warm orange; glass/liquid identifiable by shape. Different items need different shapes and features, NOT identical templates recolored.
ALL background and gutters TRANSPARENT alpha. NO stage-colored outlines, NO halos, NO floor shadows. NO labels, NO numbers, NO letters, NO text, NO UI panels, NO cell borders or guide lines. Reference is for pixel style and material treatment, NOT for repeating the same objects. Use the exact new object list below. Each listed item appears ONCE in its specified cell.
'''
plan={'version':3,'export_size':128,'logical_size':32,'black_outline_logical_px':1,'batches':[]}
for stage, text in BRIEFS.items():
 items=sorted([i for i in catalog['items'] if i['id'].startswith('i') and i['tier']==stage],key=lambda i:i['id'])
 briefs=text.splitlines()
 assert len(briefs)==len(items),(stage,len(briefs),len(items))
 entries=[{'id':i['id'],'name':i['name'],'tier':stage,'brief':brief,'slot':n} for n,(i,brief) in enumerate(zip(items,briefs))]
 lines=[]
 for n in range(64):
  subject=entries[n]['brief'] if n<len(entries) else 'EMPTY transparent cell, no object'
  lines.append(f'Row {n//8+1}, column {n%8+1}: {subject}.')
 prompt=style+'\nOBJECTS IN STRICT ROW-MAJOR ORDER:\n'+'\n'.join(lines)
 filename=f'p{stage}-prompt.txt'
 (OUT/filename).write_text(prompt+'\n')
 plan['batches'].append({'stage':stage,'source':f'p{stage}-source.png','prompt':filename,'items':entries})
(OUT/'plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
print('Prepared',[(b['stage'],len(b['items'])) for b in plan['batches']])
