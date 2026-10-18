# The world

## Cultural periods (2026-10-09)

A world is set in one PERIOD, decided at startup (`?period=NAME`, else drawn from the seed by weight):
greek, roman, egyptian, chinese, medieval, byzantine, ottoman, islamic, industrial. Everything with a time and
place follows it, all declared in `assets/world/periods.json`: the monuments (`landmarks`, from architecture.js
LANDMARKS), what people wear (`dress`: wardrobe styles by weight, `""` the village's own -- each style brings its
hair and jewelry), the town (`town.styles`: a medieval town style; or `town.houses`: the period's dwellings in the
street rows, at the inn and on the farms; `church`, `walls` [pattern, palette], `without` farm plots such as the
windmill), the fisherman's boat, the trees (flora.js species; the palm is a warm one, never in the wild mix) and the
`ground` -- `grounds` gives its colours into grass.js GRADE, whether blades grow on it (sand: none, no fringe) and how
many flowers it keeps. `?townstyle=` still forces a town style.

## The grown map (2026-09-28)

By default the land is GROWN at load (`mapgen.js`): the terrain lab (`terrain_lab.js`, docs/terrain_lab.md) runs its
"river country" preset -- 2.6 km at 20 m cells, a big river (10 m³/s) coming in from beyond the region and cutting
down through a layer cake with a basalt sill in it as the land rises, its side streams, its falls -- for 150,000
years on the renderer's own GPU device, and the world is a window cut out of it. `?map=0` keeps the old world below
(the sines, the lake, three landmarks); `?trees=0` scenes have no room for a map and keep it too; `?mapyears=`
grows a shorter history (the headless checks: a software GPU takes minutes).

- **The window**: the world's size (2 x groundR and a margin), along the big river where its banks, the herd's
  meadow and the facade line are gentlest, turned so the river runs east (+x) about `extent + 120` south of the
  middle -- where the old river ran -- so the town, the landing, the mill and the barge still find a river running
  east along `z = riverZ(x)`.
- **The ground**: the lab's, bicubic onto a 2 m grid with a little detail, then SETTLED -- the land shifted so the
  river stands at the old -2.2 m at the bridge, and eased (a smooth warp ~110 m wide) so the town, its farms, the
  meadow and the monument's stretch stand at 0. Everything built is laid out on 0 and stays there; the land round it
  rises and falls. Plots are levelled toward 0 as before, but never under water (`wet`).
- **The water has no one level any more.** Every channel -- the big river and each side stream with water enough
  (a brook, 0.016 m³/s) -- is carved at ITS OWN level, falling downstream, never rising: the bed under it, a low bank
  raised above it where the land is lower. The lakes the lab held keep their levels, the moats the old one. The
  water is one mesh over the wet samples of the grid, each vertex at its water's height (and a ring round it, sunk
  under the banks, so the shore is where the land rises through it); `river` on it says how much flows (the waves
  slide downstream there), `fall` how steep it is (white water down a fall). The grass's mask reads the same
  surface as a texture (grass.js `WATER_LEVEL`). `waterY(x, z)` (ground.js) is the surface anywhere (-Infinity:
  dry) and `riverLevel(x)` the river's: swimmers, fish, birds, the barge, the rowing boat, arrows, a struck
  animal, the swimming player and the underwater view all ask them. The reflection's plane follows the river's
  level under the camera.
- **The town** goes where both banks are flattest and the river quiet (falling 2.5 m at most past it, the banks
  about 2.2 m over the water: a terrace over a gorge would be cut down to it): the bridge there, the town south of
  it, the farms and the mill north and 95 m down.
- **ONE landmark, the monument**, on the facade line where it is flattest; the highway along it reaches the
  meadow's path at x = 0 wherever it stands.

The lab is deterministic on one machine (every pass reads one state and writes another), so a seed grows the same
land every time there. Different GPUs may round differently, so peers of one session on different hardware can
grow different maps -- a shared session would have to send the host's.

## Terrain and layout (the old world, `?map=0`)

Ground height is an analytic function: three layered sines, blended flat
(smoothstep over 20m) under every building footprint, the herd meadow, and
the lake's surroundings. **There is one water level for the whole world**
(-2.2m): the plain is held softly above it (a smooth floor at -1.4m), and
only what is deliberately carved fills with water -- the lake (a bowl
5.5m deep), the river (a 16m groove 4.4m deep), the castle moat. One
translucent water sheet at that level covers the whole ground; it shows
wherever terrain dips below it and hides under the plain elsewhere. The
rendered ground is a 400x400 plane displaced by the same function (cells
~4m in the full town, so the river groove survives sampling),
vertex-colored by elevation (lush valleys → dry crests) with faint contour
bands, plus a per-pixel grass overlay (blade flecks + tone patches)
injected into the toon material. Because mesh interpolation can sit a hair
above the analytic surface, walkers stand 4cm proud and paths float 12cm.

The **river** meanders in from the west edge (a sine of 12m amplitude) and
flows east into the lake's west arm, fading into the lake bowl over its
last 25m. Flow is in the water shader: inside the river band the whole
wave pattern slides downstream at 1.6 m/s and fine streaks stretch along
the current; the lake stays still.

Zones: buildings line up along a north road; the fenced nature range holds
animals and people; a smaller fenced pen to the east holds the monsters;
the lake lies south, the river runs into it from the west, and the water
mill stands on the river's north bank (the one building off the facade
row: sites carry an optional `z`). Packed-earth paths (one merged mesh with wheel
ruts, stone specks and a worn grassy verge) connect the road, every building
door, the meadow and the lake.

**Roads cut into the terrain (2026-10-06).** The roads are planned BEFORE the
ground is built (paths.js `planRoads`): each route laid out and kept dry,
sampled every ~1.5 m, its centreline's height following the natural ground
along it (smoothed over ~6 m), pinned where it runs onto a wider road already
laid (a spur meets the street at its height), and LEVEL ACROSS -- both edges
at the centre's height. The ground then adjusts to the road, not the road to
the ground: inside a road `groundH` is the road's surface, and over a 3 m
shoulder beyond its edge it eases back to the land (ground.js `roads`,
`naturalH` the land without them). The terrain is CUT along the roads' edges
(terrain_data.js `roadTileData`): a tile a road or its shoulder touches is
built at its finest level, and each cell a road touches is the cell less the
road -- the square cut by every road piece over it, convex pieces fanned into
triangles; the road's edges are split where they cross the lattice's lines, so
the cut's points ARE the road's points, shared by the road mesh
(buildPathNetwork) and the terrain, at the same heights. No terrain lies under
a road; the skirts skip the stretches of a tile's border a road crosses.
`?roadcut=0` lays the roads over the uncut ground as before (the comparison).
Where a road runs over one laid before it (a door's spur on the street it leaves) its surface sinks up to 3 cm under
that road's, in the mesh only: at one height the two drew over each other, the spur's verge flickering on the street.

The road itself is a 6m **highway** in the Roman manner: two lanes 3.5m
apart, right-hand traffic, running the whole facade line and ending in a
9m-radius turning loop past the last building at each end (the ground
plane is widened to hold them). The closed lane loop is the carts' route,
sampled by arc length so teams bend around the loops.

## Walkability

The FPS controller is a 0.25m circle at eye height 1.5m: wall collision
with sliding, climb ≤ 0.5m (stairs are real 0.25m steps with a 1m landing),
gravity with anti-tunneling landing checks, Space jump (~0.9m of rise, 2026-10-03: was 1.2, so
with the step-up a 1.4m sill is reachable), Shift+Space 10m dash. Every
wall opening is real: doors from the floor, windows between sill and
lintel -- open a window, jump, and you are through it: in the air the body
tucks (collides `duck`: 60cm of gap instead of 1.2m), lands on the sill,
and where only a ducked body fits (`wedged`: on a sill under its lintel) it
ducks on through and down; a closed pane blocks at its own height. Steps
are judged with the feet where they will stand: going down a stair the
headroom is from the lower tread (and a ring sample that meets stone is
asked again from the floor under it). A straight flight's sides and
underside are in the wall field: it is walked up, not through. Support is footprint-aware (five probes) so hairline seams can't
swallow you. Colliders derive automatically from building data — boxes and
closed cylinders over 1.2m tall, `hwall` segments with passable door holes —
plus closed doors and tree trunks. `floorY` fields make every storey,
staircase, bowl and gallery walkable, with headroom cutouts sized for a 2m
walker. The big animals are bodies too: every mount (and anything with a
trunk over .35m) carries one collision circle round its trunk -- cheaper
and steadier than testing every part -- that you cannot walk into, though
you can always walk out of one that has stepped onto you.

## Life

- **Species** (`species.js`): 42 animals with real sizes, mirrored
  symmetry, surface-snapped eyes with real colors, gaits whose cadence
  follows actual travel speed. The 22 mid-to-large mammals (cat, fox, dog,
  wolf, sheep, pig, boar, deer, tiger, lion, cow, ox, zebra, horse, camel,
  bear, hippo, giraffe, elephant, unicorn, centaur, manticore) use the
  mammal rig (`mammals.js`, see architecture.md): two-lobe metaball
  bodies, head and muzzle, two-bone legs with knees and hocks from IK,
  hooves or paws, curved tails (a cat's curl, a pig's corkscrew), and walk
  and run gaits -- walk or run by one Froude rule (`runs()`: every
  wanderer, and a ridden mount at 2.5x its speed, 7x with Shift), head and
  tail on the same stretched gait clock as the legs, a standing
  animal fades its stride out onto straight legs. The small and odd ones
  keep their classic capsule parts (still a trot of diagonal leg pairs);
  monsters (hydra, dragon, manticore, unicorn, beast-men, tauric beasts) with
  jointed bat wings -- all on the rig: the dragon (a long raised neck,
  horns and frill, spines, a sweeping tail with a spade), the hydra (three
  slender necks splaying apart, each an arc chain with its head), the
  beast-men (species.js `beastman`: the human rig with an animal's own
  rig head -- its head sphere and everything hung on it, muzzle, ears,
  eye marks, horns, tusks, fangs -- scaled to a human-sized head, in the
  animal's hide with its tail, hooves for the hoofed, dressed by `outfit`
  -- kilts, tunics, breeches, never headwear; they call as the animal): the minotaur (ox, red-eyed), wolfman, boarman, catman,
  foxman, bearman, ramman, smilodonman; tauric beasts (species.js
  `tauric`: an animal's trunk, legs and tail without its head, neck and
  mane, optionally scaled, with a person's upper body -- makePerson's
  `upper` -- standing on its chest): the centaur (horse), the drider (the
  spider at 25x) and the sphinx (lion); winged people (winged.js, kind
  "winged" in assets/creatures/monsters: makePerson's whole figure with a
  pair of wings from the back of the chest, on a root bone turned up the
  back so the wings spread behind it, chord hanging down, flapping about
  the spine): the angel (mammals.js `birdWing`: primaries rooted ON the
  hand's axis, secondaries along the forearm, coverts over their roots)
  and the demon (`batWing`: the arm to the wrist, three fingers fanned
  from it in the hand's frame, the skin between them scalloped and from
  the last finger back to the flank -- the dragon and the manticore have
  the same wing -- red skin, two horns); two camels, the dromedary and the
  two-humped bactrian; dinosaurs (`dinosaur: true`, in the monster pen)
  on the rig's `biped` option -- the tyrannosaur at real size (12.7m,
  hips at 3.3m, knees folding forward, tiny arms, the tail held out as a
  counterweight) and the triceratops (9.1m: brow and nose horns, a parrot
  beak, the frill as three flat triangles fanned into a shield) -- one
  `ceratopsian()` family: the styracosaurus is its frame at .6 (5.5m) with a
  long nose horn and a crown of frill spikes; the stegosaurus (9.1m: two
  rows of plates, the tail's riding its links, the four-spiked
  thagomizer) and the ankylosaurus (8.2m, twin side lobes for its width,
  scutes, flank spikes, a tail club); all but the stegosaurus
  mountable; riders sit at one shared `saddle(def)` point, a third
  of the way from rump to chest; generative
  butterflies, pond fish, a shark and a dolphin. The small and odd ones:
  a snake whose chained segments carry a travelling wave, rat, wild boar
  with bristle mane and tusks, hedgehog under a coat of spine cones,
  scorpion with pincers and a tail curled over its back, a tarantula-sized
  spider stepping its eight legs in two alternating sets, a peacock whose
  seven-plume train is eyespotted in the shader; on the lake three swans
  and three mallards (`swim`: they ride the shared water level
  half-submerged) and on
  the lagoon's grassy heart a crocodile, a frog, a turtle and a beaver
  with its paddle tail (`shore`).
- **Ranges**: a wanderer's range is a rectangle, or a shape: the lake range
  tests the carved bottom for water and steers home toward the arc, so
  fish, swans and ducks spread over the whole C instead of one belly.
- **Wanderers**: every creature alternates walking and standing at random
  intervals; hoppers (the frog) travel in bursts, airborne on a little
  parabola for each hop and still between. All are
  steered back inside their fence; standers settle legs perfectly
  straight. Fliers cruise at per-individual altitudes and glide instead of
  standing: twenty parrots, fifty owls, twenty eagles, a hundred bats and 140 butterflies
  (`?butterflies=N`) range over the whole sky, spawned across the ground
  (butterflies PERCH, 2026-10-09: at the end of a flight one may make
  for the nearest free flower head within 18m, land on its bloom, fan its
  wings there 4-14s and fly on -- one butterfly a flower; picking the
  flower sends it off; `perchStep`, the flowers' `perches`)
  disc like the people, parrots up to 60m, owls 45m, eagles up to 155m
  -- the cathedral spires (bats swarm low around the buildings they roost
  in, town row and riverside); parrots and eagles fly by day, owls and bats
  only at night (N), roosting out of sight otherwise; swimmers do the same between lake floor and surface. Terrain is
  sampled under nose, center and tail so long bodies never bury a nose.
- **People** (`people.js`, see architecture.md): seeded kind -- man, woman, ten-year-old,
  five-year-old (children with bigger heads and shorter legs; working people are adults) -- height,
  build, skin, face (nose, ears), hair style and a medieval wardrobe: shirts, tunics, dresses,
  kirtle + surcoat, hose, trousers, skirts, hoods, caps, brimmed, pointed and straw hats,
  belts, boots or shoes, aprons, in patterned cloth with trims, pleats and seams. They walk on
  IK knees with counter-swinging arms and settle when they stop; poses —
  standing, sitting (cathedral pews, cart boxes), riding, carrying (a load in both arms), lying. 66 wanderers by default (`?people=N`), spread uniformly over
  the whole open country -- every patch of grass on the ground that is not
  water, moat or a building -- and kept out of those as they roam.
  Cathedrals export `folkSpots` and get a static congregation.
- **Dragonflies** (`makeDragonfly` in `species.js`): 70 generative
  darters, 7-8cm with a 10cm span in four colorings, beating four glassy
  wings fast and low (0.3-2.2m) over water only -- their range is the 5m
  band along the lake's shores and the river; every flier now rides above
  the water surface rather than the carved bed beneath it.
- **Animal calls** (`calls.js`, standalone): 35 species have a
  synthesized call -- moo, bleat, grunt, bark, meow, howl, neigh, bray,
  roar, trumpet, cluck, quack, hoot, screech, squawk, croak, hiss, squeak,
  the peacock's scream, the dragon's roar -- each a recipe of notes (a
  buzzing, pulsing, pure or noisy source through a resonance standing in
  for the mouth, with pitch glide, envelope, vibrato, tremolo or
  roughness). What keeps them from sounding like game bleeps is chaos:
  every voiced note carries random pitch jitter and loudness flicker,
  growls pulse at a subharmonic, mouths can glide between two shapes
  (a "mee-ow"), and all calls sound in a light outdoor reverb. No two
  repeats are the same bark: each is a shade higher or lower, shorter or
  longer, its gap uneven; the slow pitch wander and the growl/bleat
  wobble rates drift too. Every recipe carries a measured `level` (make-up
  gain) so all species sound about equally loud at the source (a sheep's
  narrow mouth swallowed 12 dB, a horse's broad one gave 7 back). Every such creature calls now and then within earshot (up
  to ~55m, louder species carry further but are not louder up close --
  a mount is right under the ear -- and all animals sit ~8 dB under the
  people), from where it stands, pitched to its own size. The Colosseum's lions and tigers roar. Mounting an
  animal rouses it; creatures with a voice that cannot be ridden offer
  "click to rouse" when you stand close and look at them.
- **Cobwebs**: some ceiling corners (houses, tavern, mill, castle hall,
  palace wings) carry a web: an inclined triangle with a vertex a little
  way along each of the three edges meeting in the corner, so it really
  spans the corner; one mesh for all of them, spokes and rings from the
  shader, translucent.
- **Speech** (`speech.js`, see architecture.md): every person -- walkers,
  the tavern's company, riders in the saddle, cart drivers on the box, the
  Colosseum's gladiators, the dock hands and the boatman -- has a
  language (English, German, French, Spanish, Russian) drawn from their
  seed and a voice that follows their body -- man, woman, ten-year-old or
  five-year-old, with a seeded pitch jitter -- and a mood per utterance
  (normal, excited, angry: key, pace, how hard the stresses land, how the
  line falls, loudness), and says
  a word -- sometimes a two-word phrase, sometimes a question -- from the
  shared 18-word lexicon every ~30s while you are within
  ~40m -- full within 3m, then about 4 dB per doubling of distance, and
  panned to where they stand. Standing
  within reach of someone and looking at them offers "click to greet
  them": they answer "hello, <word>!" at once, turn to you, and a walker stands still
  for half a minute before wandering on. **L** cycles a
  language override for everyone, **K** a voice override (kid, woman,
  man), **J** pins the word everyone says (random, then each of the 18 in
  turn -- for testing pronunciation), **H** pins a mood; "random" gives
  each their own. The label shows all four.
- **The mine** (2026-10-03; `tools/archgen/mine.py` -> assets/architecture/village/mine.json, finishes mine-silver,
  mine-copper, mine-salt; `?mine=silver|copper|salt` picks, `?mine=0` none): one a world, its ore by the town's seed,
  placed after the town on open land away from every site and the water (its galleries too), where the ground over
  the galleries never dips below -6.5 (they lie 10 m down), the higher the better. The surface: the shaft house over the
  hauling shaft with its windlass (two men at the cranks) and kibbles, the walking shaft with steep flights (25 cm on
  25 cm) under a roof, the spoil heap, the dressing bench, pit timber. Ten metres down: the shaft bottom, two galleries
  with door sets every 1.5 m (none in the salt) and a plank track, carts, stopes with the vein and hewers, oil lamps.
  Its CREW (the spots with `crew: "miner"`) is its own: men in the wardrobe's `miner` outfit (linen smock and hood,
  leather apron), at work day and night with the spot's gesture and tool (index.html crewHerd); village-life leaves those
  spots alone. The ground over the deep galleries stays a floor (`DIG`: only a floor within 4 m of the surface opens
  the ground, and a building's `dig` rectangles -- the shafts' mouths); colliders reach the whole `extent`.
- **The forest** (config.json `forest`, `?forest=N`): one dense wood -- `trees` trees `spacing` (6.6 m, 2026-10-03: was 4.4) apart, thinning
  to an irregular edge `radius` (46 m) across, spruce, pine, oak, birch and maple with an undergrowth of bushes and
  mushrooms -- on the clearest patch of open land nearest the world's middle (away from the sites with a margin for
  their streets, the water and the meadow). Same herd and foliage mesh as the woods: no extra draw calls (+~140k
  triangles in view at 130 trees; 60 now).
- **Riders**: a person in riding pose fused onto a horse skeleton, patrolling
  one grand tour of the whole path network; loose horses roam free and can
  be mounted. Where a rider sits is ONE placement (index.html `riderOrigin` /
  `riderEye`, from the saddle `fuseRider` hangs the fused riders at): your
  eyes when you ride anything -- a horse or a diplodocus -- your own body on
  the saddle, a peer's rider and a clone all sit there. Your own body is
  placed right after the move, before its head and the bow read it.
- **Water mill** (`assets/architecture/village/watermill`, tools/archgen/riverside.py): a 9 x 6.5m stone
  mill house with a 6.1m undershot wheel standing off the river wall on a
  piled frame, its axle only .5m above the floor so the paddles reach the
  stream 2.35m below (the wheel turns at flow speed over radius, bottom
  running with the current). Inside, walkable: the axle's pit wheel turns
  in a fenced pit cut through the floor and drives the wallower on the
  upright shaft; the runner stone turns over the bedstone on the hurst
  frame under a hopper, meal runs down a chute; wheat waits in sacks by
  the door, flour leaves in barrels along the wall. The door opens east
  onto the riverside street.
- **Fire**: a hearth's fire is live -- a handful of cones that sway, stretch and flicker in a vertex shader on
  the render clock (far faster than the water), yellow core to orange tips; any building may export `fires`
  (a definition's `fire` markers) and get one.
- **Riverside street**: a 1.5m track along the north bank 4m up from the water, from the lake path to the
  mill's door, then on round the landing yard to the bridge's north ramp.
- **Stone bridge** (`assets/architecture/village/bridge`, tools/archgen/village.py): 35m west of the basin
  a three-arch bridge crosses the river, built to the river's width where
  it stands. The middle arch (4.3m radius) springs .3m over the water, so
  its crown clears the barge and its boatman by more than a metre; the side
  arches reach the abutments on the bank lines; two piers with cutwaters
  stand on footings below the bed. The 4.4m deck sits 2.9m over the banks
  behind .95m parapets, reached by 14m stone-faced ramps (11.7 degrees) at
  either end, all walkable through its `floorY`. The barge passes under it
  coming and going. Roads: from the mill west along the quay, round the
  landing yard, up the north ramp; down the south ramp into the town's bridge street.
- **The town** (`town.js`, 2026-09-27): a walled market town on the south bank at the bridge's head, and its
  farms over the river -- laid out and styled by the world's seed, built of the village definitions alone
  (`assets/architecture/village`, docs/arch.md "The village"). The seed draws a STYLE first -- timbered (framed
  upper storeys over plastered or stone ground storeys), stone (grey ashlar or rubble under slate), brick, or
  plastered -- and every building shares it: one stone for the walls, the church, cellars and flagstones, ONE
  roof covering on every roof in town, one wood, two or three plasters and one or two timber colours the houses
  choose among, the house kinds the town favours, and the tops of its church tower (spire, pyramid, saddleback,
  onion, battlements), its wall towers (open behind merlons, or a room under a cone, an ogee bell or a tent
  roof) and its gatehouses (hipped roof or battlements). `?townstyle=timbered|stone|brick|plastered` forces one.
  THE PLAN: the main street runs east-west 30m south of the bridge's foot from the west gate to the east gate;
  the bridge street runs from the south ramp's foot past the square to the south gate; the south street 36m
  beyond the main street, two lanes between them. Every house faces its street, set 1.2m back from its edge,
  eaves-drip alleys between them and now and then a passage to the yards; each is its own definition --
  frontage, depth, two or three storeys, pitch, jetty, a cellar or not, turned to its street (`yaw`) -- and its
  own look within the style. Eight of them on the main and bridge streets are SHOPS (the ground storey an open
  arch, a trade's furniture in the front room and its worker at it: smithy, bakery, pottery, weaver, tailor,
  carpenter, cooper, butcher). The SQUARE at the bridge's head holds the market (stalls, market cross, vendors)
  and the fountain; the INN (`tavern`: the eaves house at its largest, a cellar, the tavern room with the keeper
  at the bar and two tables of guests) faces it from the east, the CHURCH (`church`: nave, chancel, west tower
  with a spiral turret to the belfry, pews, the altar and the priest) from across the main street, its door in
  the tower toward the bridge street. The fisherman's hut stands on the bank east of the square (its jetty, and
  the fisherman's boat: rowed out, fished from, rowed back on the sim tick like the barge).
  THE WALL: west, south and east, open to the river; a gatehouse where each street leaves (the west and east
  gates watched: two soldiers in mail and steel caps outside each, armed out of the watch's kit -- a spear or a
  sword and a shield, a halberd, a bill, an axe, a crossbow, a musket (assets/items/kits/guard, docs/items.md) -- the
  gatehouse's `guard` markers), a round tower at each corner, at each river end and between, every stretch at
  most 34m. The walk runs along the top all the way round -- behind the towers (their doors face it), through
  the gatehouses' upper storeys -- behind a crenellated parapet on the field side and a low one on the town
  side, which run into the corner towers and meet the gatehouses' faces; a flight climbs to it beside each gate.
  THE LONGHOUSE: 3m walls under a thatched shell roof, a boarded loft over the whole house at the eaves (a stair up the
  middle under the ridge, a smoke hole over the hearth), arched doors in both long sides.
  THE FARMS: over the river, two longhouse farmsteads west of the bridge road (a farm track from the north
  ramp's foot along their doors) and one east of the landing on the quay road, each with its plots in rows
  behind it: rye and barley (14 x 12m), cabbage, beans on poles and garlic (12 x 10 / 10 x 8m), the plowed
  field, three rows of currant bushes, the orchard (apples and cherries on a 5m grid), the pig yard (a
  pigsty with lean-to roof, trough and wallow), the hen yard (a hen house on legs), the stable yard (a stable
  block with four stalls, a trough, a hitching rail, hay) and the beekeeper's garden -- five pigs, eight hens
  and four horses in their yards, penned by their own ranges. The currant bushes and the orchard trees are
  PLANTS, not building parts (`plants`: the flora builder grows them with the woods' `makeBush` / `makeTree`);
  fields are tilled slabs whose crops are shader cut-outs, so a field costs a few dozen boxes. Nothing in a
  field obstructs walking.
  THE GROUND UNDER THE BUILDINGS is cut away (grass.js `GROUND_HOLES`): wherever a town building has a floor of its own
  at or below its ground floor -- its rooms, a cellar, the stair down -- read from its own floors on a 20cm grid, the
  ground's material, the grass mask and the water plane all leave it out, so a stairwell opens onto the cellar and not
  onto the lawn, nothing grows indoors, and a cellar dug below the water level stays dry.
  The town's ground is level from the river to past the south wall; every building levels its own plot too
  (`flatZones` with `level`, which also suppresses the river-bank carve under it) except what reaches over the
  water -- landing, mill, fisherman's jetty, bridge -- and the wall, whose ends stand by the river. The
  streets are paths.js tracks (`TOWN.routes`: gate to gate, the bridge to the south gate, the lanes, a spur to
  every door, the farm tracks) and the villagers walk them. The town's buildings are drawn in the finish
  material and merged across buildings (merge.js `mergeAcross`, taking the meshes from under each building's
  translated groups): some 45 meshes for the whole town, about 2-3s of building at startup (pregen/ holds
  every style's tiles, `town/<style>`; the houses' geometry is made per seed).
- **Goods** (`architecture.js`): barrels at two real sizes (the ~225 l
  barrique and the ~40 l keg) and full grain sacks (~1m long, ~.5m
  across, standing or lying) -- shared by the mill and the cart loads.
- **Carts** (`carts.js`): three real-dimension vehicles -- a two-wheeled
  cart on 1.5m wheels behind a single animal in shafts, a 2.8m farm wagon
  (one pair, or a single), and a 4.2m freight wagon behind two or three
  pairs -- drawn by oxen (a new draft species) or horses under a yoke, ox
  pairs with their neck bows, the first pair on the pole, further pairs on
  trace chains. Loads come in five variants per size: barrels in lying
  rows chocked into pyramids, standing casks, kegs in the gaps, grain
  sacks laid across the bed in two courses, and mixed sack-and-cask
  loads. A driver sits on the front board. Bodies are merged
  polygon groups (architecture materials), wheels are shared instanced
  meshes rolled by distance / radius (three sizes for the whole fleet),
  teams and drivers are banner skeletons in one herd, so a dozen carts
  cost a few dozen draw calls. Carts circle the highway on the sim tick,
  spaced evenly, oxen at .85 m/s and horses at 1.25 m/s, slowing behind a
  slower cart instead of driving through it. Bodies pitch over the terrain
  between their axle probes. `?carts=N` sets the fleet (default one per
  ~200m of lane, 2-12). Carts are placed every frame at their fractional
  position between sim ticks, so they glide; a bed is a floor -- jump on
  and it carries you, turning with it, at its own pace -- and the body is
  solid: below the bed you are blocked, the side boards are stepped over
  when low and jumped when high (the freight wagon keeps you in). The
  barge's hull and gunwales work the same way. The walker's
  physics itself sub-steps at 50Hz whatever the frame rate. ONE FRAME
  OF REFERENCE (2026-10-09): `frameBody` advances the simulation and
  places every mover (carts, barge, boat) and every rider first, then
  moves the walker and the camera, so the cart, its driver, its load and
  you on its bed all stand in the same frame; the bed's height is taken
  on its tilted floor (`bedY`), the eye sits fixed on it (no easing while
  carried), and figures on a mover (`moving`) are posed every frame
  whatever their distance.
- **Freight** (the transport chain): 60m west of the mill the river
  widens into a ~36m basin with a **landing** -- a gravel yard on the
  quay top, a plank deck on piles out over the bank, stairs down to a
  floating stage at barge-deck height, bollards -- joined to the highway
  by a 4m freight road. A **barge** (11m, raked ends, cabin, tiller,
  gangplank) sails in from downriver, moors at the stage, is unloaded,
  sails out, waits out of sight, refills and returns. Two **dock hands**
  carry each barrel or sack from the hold, over the plank, up the stairs
  to the yard's storage rows, one at a time, and wait when the barge is
  away. Five **freight carts** run their own loop -- yard, freight road,
  the highway east, into the palace yard and the castle yard, round the
  east loop, back west -- halting at the quay to load (a piece every 3s,
  2-5 per cart by size) and at the yards to unload; delivered goods are
  consumed after 90s and return to the pool for the barge's next trip.
  Goods are one pool of 14 barrels and 14 sacks, two instanced meshes,
  each piece always somewhere: hold, hands, quay, bed, yard, ground or
  your arms. Cart beds and the barge deck are moving floors. The whole
  chain runs on the deterministic tick.
- **Flora** (`flora.js`): trees GROWN from a seed by recursive branching
  (after the trees lab): six species -- oak (random forks), birch
  (alternate, drooping twigs), Scots pine (whorled crown on a long bole),
  spruce (a leader with whorls of near-level branches, conical), willow
  (weeping), maple (dichotomous) -- each a mode plus depth, fork count and
  angle, jitter, length/radius ratios, curvature, wobble and lean, grown in
  trunk units and scaled to its real height. The wood is capsule banners
  in the trunk's bark out to the thinnest twig; the outer
  levels carry leaf cards painted from the leaf atlas (oval, round, lobed,
  needles, willow; textures.js), cut out by alpha with alpha-to-coverage
  edges, shaded by facing and depth in the crown, swaying in the wind, all
  cards of the forest in one draw (`foliage.js`). By default every card is
  a banner turned to the camera (each by its own angle in the screen
  plane; its grown orientation still shades it) -- `?billboard=0` stands
  them fixed in space. Autumn turns each card on its own, so a crown turns
  mottled. Bushes (1.6-3.2m) are a few bark stems fanning out of the ground
  with a rounded clump of the same leaf cards; about a third bear fruit --
  berry-cluster cards in currant, blueberry, blackberry, gooseberry or rose
  hip colour on the clump's surface alongside the leaves. Five flower kinds at
  generous real sizes, mushrooms; drifting multi-tone clouds. The wood and
  undergrowth share one instanced draw; everything rebuilds
  deterministically when the season changes. `grove.html` shows every
  species (A: autumn, R: re-roll).

## Village life

`village-life.js` gives the town and its farms their people (`?villagers=32`):
every villager has a home -- a house and a place in one of its double beds
(each house exports `beds` and, when the beds are upstairs, `ways.up` -- the
walk up the stairs) -- and a job: a work spot a building exports (folkSpots
with `role: "work"`: miller, inn keeper, market vendors, baker, potter, smith,
weaver, spinner, tailor, priest, a fisher on the jetty), two sack carriers
(home to the mill's `drop` with wheat, or back with flour), and farming for
everyone else (places spread over the fields, the orchard, the currants).

- Night (N): home to bed; the keeper stays at the inn, a quarter first go
  to the inn to eat if a seat is free.
- The bell (the real clock's hours): half of those awake -- a different half
  each hour, never the sleepers -- sit ten minutes in church (the rest stand
  at the back), then go on.
- Work: arms busy by trade -- `GESTURES` in `people.js` (dig, hoe, mow,
  hammer, knead, sell, fish, strum, bless, eat, pick, weave, sew, lift), named by
  the spot, swung by `skeleton.js` on the world clock (`an.gesture`, `an.work`);
  a worker whose spot names a `tool` holds it in the right hand -- a low-poly
  mesh (`tools.js`, one instanced draw per kind, placed each frame from the
  posed hand and forearm; SDF shafts smeared the one-quad engine): the
  scythe in the rye and barley, the spade on the plowed field, the hoe among
  the vegetables, the smith's hammer, the fisher's rod, the bard's lute. Seated
  hands work too (potter, weaver, spinner; guests eat). Between spells a small
  chance to go and eat (a seat free) or to buy at the market or a shop.
- The trades work in their shops on the main and bridge streets (town.js); the
  beekeeper tends straw skeps in the garden behind a farmstead over the river.
- What a site IS comes from the town plan, never from its key: `home`, `role`
  ("inn": its keeper and its guests' seats; "church": the pews and the back),
  `farm` (land the farmers work; the tool by the field's `crop`).
- Homes: every site the town plan marks `home` (the houses, the inn, the
  longhouses) with beds; two sleepers to a bed, laid along the bed however it is
  turned; an upstairs bed's way up is the house's `way` markers only as far as
  its own storey. A house's own table is its household's: only a place where
  someone works (a shop, the market) takes customers.
- The inn is never empty: at least three guests, day and night -- one whose
  meal is over waits until someone new has come in and sat down.
- Shutters stand open by day and close at night; glass (palace, church) stays.
- The bard at the fountain plays a random song on a random instrument of the
  day (lute, lyre, harp, flute, recorder, fiddle), then another -- heard from
  where they stand (`instruments.js`).
- Walking: out of the door (down the stairs first), the shortest way over the
  path network (`routeGraph` in `paths.js`; the bridge deck is its one link
  over the water), in at the door; doors open as they pass.
- Each villager is four composite entries (walking, seated, lying, carrying a
  sack), one shown; it moves on the fixed tick by its own seeded stream and is
  drawn between ticks by the shared tracks. `__dbg.life.census()` lists where
  everyone is; `__dbg.life.bell(h)` rings the bell for them.

Sound: `environment.js` is fed the world's state each frame (weather,
intensity, wind, night, indoors, distance to lake, river and hearth); `calls.js`
gives every creature its own call; `speech.js` gives every person a seeded
voice preset of their kind (`voiceFor`: men, women, children, and some old
voices) and they say one to three random words when you are near.

Wandering animals follow ROUTES planned once (`wanderLoop` in paths.js): a loop of waypoints inside
their range, every leg checked when planned; per tick they only advance along it (walking and
standing, hops, gliding and swimming as before), their heights sampled along the route the first time
they pass and read back ever after -- no range tests or terrain probes per step (about 4.5 ms -> 1 ms a
tick for ~520 of them). One moved by something else (a ridden horse let go) plans a new loop from there.

Squirrels (`squirrels.js`, `?squirrels=14`) live in the groves -- trunks with a neighbour within a
dash: across the ground to the next tree, up the trunk head first along its real bole (makeTree exports the trunk's centreline;
the skeleton's root takes a pitch, `an.pitch`, matched to the trunk's slant, the feet on the bark), a pause up there, down head first, a watch at the foot.

Behind the mirrors, on the salon side of the partition, hang gilt-framed paintings whose canvases are
views of the world itself: on the third frame `paintings.js` draws the scene once from ten lookouts
(on the town wall's walk, the middle of each stretch, spread round the town, each looking at its heart) into 640 x 480 pictures, which the frames take in turn.

The lake is 6.6 m deep at its deepest (the bowl carved 8.8 m below the plain), with 30 fish. In water
deeper than you stand you swim: afloat with the head just above the surface, E rises, Q dives to the
bottom (Shift faster), a little slower than walking; a mount swims the same way, and a winged one
lands on the water going down onto it and takes off from its surface. Bees hum round the beekeeper's
hives by day in dry weather (the environment's `hives` distance).

The palace's gallery is a Hall of Mirrors: sixteen tall gilt-framed mirrors on the partition opposite
the windows (`mirror` markers in versailles.json, each with the gallery it reflects in: tools/archgen/versailles.py). `mirrors.js` makes them reflect with three's
Reflector -- the scene drawn again from the mirrored camera. The reflection through a plane is the same
for every mirror on it, so all the mirrors of one wall are ONE Reflector over their merged panes: one
extra draw of the scene lights all sixteen. Up to two planes reflect (the largest on screen, in view,
within 60 m), at half resolution, dulled like old glass, one bounce only; a plane off the budget shows
still glass of the same tone. During a reflection the composite figures are drawn in full.

Grain sways in the wind: the rye and barley cut-outs bend as rows on the
leaves' wind clock (`FOLIAGE_T`), gusts running over the field.

## Environment switches

- The church bell strikes the hours by the real clock: on the hour, as
  many strikes as the hour shows, the same moment on every peer's wall
  clock.
- **P** rain → snow → clear; **O** intensity -- which on a clear day also
  sets the cloud cover: few, half or all of the 28 clouds; rain and snow
  always bring them all. Precipitation is three
  depth-tested billboard curtains 4/10/22m ahead of the camera, so walls
  occlude it and interiors stay dry (each curtain also hides itself when its
  anchor point is under a roof). Snow raises a shared uniform that whitens
  roofs, spires and grass while keeping relief shading; light rain shows a
  rainbow -- by day only, since it needs rain AND sun.
- **N** night: one multiply pass dims the frame, sky/fog swap, four
  brightness classes of stars, a crescent moon, occasional shooting stars.
- **I** season: summer → half → full autumn (flora rebuilds in place).
- Underwater (below the water level over carved ground: lake, river or
  moat), the whole view washes blue-green with drifting light bands.

## Interactions

At most one action is available at a time, shown bottom-center:

- **mount / dismount** — click a loose horse within ~1m while looking at
  it. The camera sits at the rider's head (2.35m), movement drives the horse
  at double speed, its legs trot in step; click again to dismount.
- **lie down** — on a bed you lie flat: peers and your Shift+N copies show
  the lying figure (pose "lie" in `people.js`), not a seated one.
- **fly** — the dragon, the manticore and the hydra are mountable too
  (visit the monster pen). On a winged mount **E** climbs and **Q**
  descends (running, Shift on/off: faster); in the air gravity is off, the mount never
  sinks below the ground it crosses, walls still block, and it moves 1.5x
  faster. In flight the wings beat on their own clock and the legs hang
  still, while head and tail keep the pace of movement (faster with
  Shift, as on the ground); on the ground the legs trot and the wings
  rest folded. Landing
  is holding Q down onto support; dismounting needs solid ground. Peers
  see a flying mount beat its wings from the pose altitude alone.
- **pick up / put down** — a barrel or sack lying on the quay, in a yard,
  on the ground, on a cart bed or on the barge's deck offers "click to pick up"
  (not one a dock hand is already heading for); you carry it in front of you
  (it rides carts and the barge with you) and "click to put down" sets it
  on whatever is in front of you. A piece in your arms is out of the
  chain until you drop it; drop it on the quay rows and the carts take it.
- **open / close** — every building exports its doorways and its windows
  (all storeys, palace included); a hinged panel swings ~110° on click.
  Closed doors are genuine walls. Glass was a luxury: only buildings
  flagged `glazed` (the palace, the church) have glass panes, every other
  window is a wooden shutter. All panes share two InstancedMeshes (glass,
  shutters): each hinge is a bare transform whose matrix feeds its
  instance when it swings, so hundreds of openable windows cost two draws.
- Stairs whose one side is open carry a balustrade along the flight (a
  baluster per step, close enough to stop the walker, plus the handrail);
  the top landing stays open so you can step off, and stairs against a
  wall need none. Stairwell openings in upper floors are railed the same
  way (`wellRail`): the drop edges get posts and a rail, the landing's
  stretch stays free.

## The bow (archery.js)

B takes the bow out or puts it away (a counter shows the quiver, 24 to
start). With it out the mouse is the bow: hold to draw (~0.8 s to full
draw, the view closing in a little, the player's own body in the draw
pose with the bow in its left hand), release to loose, right button to
lower it; clicking a stuck or fallen arrow close by takes it back. An
arrow leaves at 14-50 m/s by the draw (the square root of it: a half draw
already carries it past 100m, a full one about 240m at 45 degrees, as a
real war bow), falls under gravity with a little
drag and is traced every frame in steps of at most a metre against the
ground, the water, the buildings' colliders (only the sites its path
crosses), tree trunks, moving decks and every composite figure (a
bounding sphere, then each part as a capsule). It sticks where it hits,
a little way in: still targets keep it in the world; a cart, the barge
or a figure keep it in their own frame -- a figure's in the very part it
struck -- so it goes along. In water it floats a while and is gone.
People and animals are struck alike, no reactions yet. All arrows are
one InstancedMesh; the twang and the impacts (wood, body, earth, splash)
are synthesised once. A shot is sent to peers (op `arrow`), who fly it
too.

## Tableware (tableware.js)

The inn's mugs and jugs and the food on its plates are not building parts
but data the building exports (`vessels`, `dishes`), built as separate
objects because they change: each vessel an open stoneware shell (seen
into) with a floor and the drink inside as a disc at its level -- 90%, 60%
or 30% of the way up, or none when empty (dealt out in turn; ale in mugs,
ale or wine in the jugs), the disc as wide as the inside at that height.
Within reach and looked at -- standing, or seated at the table (the drink
comes before "stand up": look away to rise) -- a click drinks one level
down, or eats the bread, cheese or sausage off its plate. Both go to peers
(ops `drink`, `eat`). Water vessels are the same thing: the fountain's two
buckets on its rim and the stable yard's stone trough (a box vessel, an
unseen solid box keeping you out of it) show their water at the same
empty / 30% / 60% / 90% levels and can be drunk from.



## A rider is parted once (2026-09-25)

A rider on the tour is ONE figure -- the horse's parts and the man's, fused in a single def -- so a blow has to
part it: the struck one falls and the other goes on (the horse riderless, the man on foot). `onStrike` decides
whether the figure it was handed is still that fused one, and the test used to be a count of parts: more parts
than a horse has, so it must be horse-and-man. It is not. A man in a hat with a braid has thirty parts and a
horse twenty-five -- so felling the horse and then shooting the man who walked on parted him a second time,
and a fresh horse appeared out of nowhere under him.

The rider now remembers the figure it was MADE as (`fused`), and only that one can be parted; parting clears
it. `ref/rider.html` shoots both orders and counts the figures in the world: the first blow adds two (the horse
and the man, the fused one hidden), the second adds none.
