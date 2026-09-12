# The world

## Terrain and layout

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
row: sites carry an optional `z`). Packed-earth paths (one merged ribbon mesh with wheel
ruts, stone specks and ragged edges, mitered so bends stay clean) connect
the road, every building door, the meadow and the lake.

The road itself is a 6m **highway** in the Roman manner: two lanes 3.5m
apart, right-hand traffic, running the whole facade line and ending in a
9m-radius turning loop past the last building at each end (the ground
plane is widened to hold them). The closed lane loop is the carts' route,
sampled by arc length so teams bend around the loops.

## Walkability

The FPS controller is a 0.25m circle at eye height 1.5m: wall collision
with sliding, climb ≤ 0.5m (stairs are real 0.25m steps with a 1m landing),
gravity with anti-tunneling landing checks, Space jump (~0.8m of rise, so
with the step-up a 1.3m sill is reachable), Shift+Space 10m dash. Every
wall opening is real: doors from the floor, windows between sill and
lintel -- open a window, jump, and you are through it; a closed pane
blocks at its own height. Support is footprint-aware (five probes) so hairline seams can't
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
  symmetry, surface-snapped eyes with real colors, trot gaits (diagonal leg
  pairs) whose cadence follows actual travel speed; monsters (hydra, dragon,
  manticore, unicorn, centaur, minotaur) with jointed bat wings; generative
  butterflies, pond fish, a shark and a dolphin. The small and odd ones:
  a snake whose chained segments carry a travelling wave, rat, wild boar
  with bristle mane and tusks, hedgehog under a coat of spine cones,
  scorpion with pincers and a tail curled over its back, a peacock whose
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
  disc like the people, parrots up to 60m, owls 45m, eagles up to 155m
  -- the cathedral spires (bats swarm low around the buildings they roost
  in, town row and riverside); parrots and eagles fly by day, owls and bats
  only at night (N), roosting out of sight otherwise; swimmers do the same between lake floor and surface. Terrain is
  sampled under nose, center and tail so long bodies never bury a nose.
- **People** (`people.js`): seeded kind -- man, woman, ten-year-old,
  five-year-old (children with bigger heads and shorter legs, women
  slighter with long hair or a bun; working people are adults) -- height,
  build, skin, hair and clothes, walking arm counter-swing, and poses —
  standing, sitting (cathedral pews), riding, carrying (arms held out
  level with a load). 66 wanderers by default (`?people=N`), spread uniformly over
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
- **Riders**: a person in riding pose fused onto a horse skeleton, patrolling
  one grand tour of the whole path network; loose horses roam free and can
  be mounted.
- **Water mill** (`watermill` in `architecture.js`): a 9 x 6.5m stone
  mill house with a 6.1m undershot wheel standing off the river wall on a
  piled frame, its axle only .5m above the floor so the paddles reach the
  stream 2.35m below (the wheel turns at flow speed over radius, bottom
  running with the current). Inside, walkable: the axle's pit wheel turns
  in a fenced pit cut through the floor and drives the wallower on the
  upright shaft; the runner stone turns over the bedstone on the hurst
  frame under a hopper, meal runs down a chute; wheat waits in sacks by
  the door, flour leaves in barrels along the wall. The door opens east
  onto the riverside street.
- **Tavern** (`tavern` in `architecture.js`): a 14 x 9m riverside inn --
  stone taproom under a jettied timber-framed guest floor, chimney on the
  east gable. Downstairs the bar runs along the back wall with the keeper
  behind it and casks on tap; the hearth holds a log fire with a cook-pot
  on its chain; four trestle tables with benches seat the company over
  mugs, jugs and plates of bread, cheese and sausage (`folkSpots` seat the
  guests and stand the keeper). The fire is live: a handful of cones that
  sway, stretch and flicker in a vertex shader on the render clock (far
  faster than the water), yellow core to orange tips -- any building may
  export `fires` and get one. All furniture wood and every hinged door
  carry a slight grain pattern (`wood`; doors keep theirs in their own
  space so it does not slide when they swing). A straight stair up the west wall reaches
  a corridor and three guest rooms, each with a bed (you can lie down), a
  chair, a chest or wardrobe and a bedside board. Outside: the inn sign,
  a bench under the windows, casks by the door.
- **Riverside street**: a 1.5m track along the north bank 4m up from
  the water, from the lake path to the mill's door, with every riverside
  building set 2m behind it and reached by its own spur. Buildings here
  are listed by x alone (`RIVERSIDE` in `index.html`) -- the place to add
  more of them.
- **Stone bridge** (`stoneBridge` in `village.js`): 35m west of the basin
  a three-arch bridge crosses the river, built to the river's width where
  it stands. The middle arch (4.3m radius) springs .3m over the water, so
  its crown clears the barge and its boatman by more than a metre; the side
  arches reach the abutments on the bank lines; two piers with cutwaters
  stand on footings below the bed. The 4.4m deck sits 2.9m over the banks
  behind .95m parapets, reached by 14m stone-faced ramps (11.7 degrees) at
  either end, all walkable through its `floorY`. The barge passes under it
  coming and going. Roads: from the mill west along the quay, round the
  landing yard, up the north ramp; down the south ramp into the village.
- **Farm village** (`village.js`, south bank west of the basin): three
  farmhouses (the town house at farm sizes) and the bakery back onto the
  river 1m off the bank line with their doors on a 2.2m street 14m behind
  the bank; the bridge lands among them. Beyond the street lie two rows of
  farm plots: the pig yard (20 x 15m) and hen yard (15 x 12m) -- post-and-rail
  fences with a gate open to the street, a pigsty with lean-to roof,
  trough and wallow, a hen house on legs with a ladder plank and water bowl
  -- then rye and barley (14 x 12m), and in the back row cabbage, beans on
  poles and garlic (12 x 10 / 10 x 8m) and three rows of currant bushes (red,
  white, black). The orchard (22 x 16m) closes the east end: apples and
  cherries alternating on a 5m grid, fruit on the crowns, trunks solid.
  Fields are tilled slabs 12cm high; the plants themselves are shader
  cut-outs (`architecture.js` patterns 13-16): thin see-through slabs
  across the plot both ways carry rows of rye/barley stalks with ears,
  bean poles with leaves or garlic leaf-fans and are discarded between
  them, so a field costs a few dozen boxes rather than thousands of
  stalks; currants, apples (~8cm) and cherries (~2.5cm) are sharp dot
  patterns (17-19) over the foliage. Nothing in a field obstructs walking.
  Behind the back row a stable yard (22 x 16m): a 12 x 5m stable block --
  stone plinth, boarded walls, tiled gable roof, four 3m stalls opening
  onto the paddock through half-doors with hay showing over them -- plus a
  stone water trough, a hitching rail and stacked hay bales. Five pigs,
  eight hens and four horses live in the yards, penned by their own ranges
  (the yard inside the rails minus the sheds), grunting, clucking and
  neighing; the horses can be ridden out.
- **Bakery** (`bakery` in `village.js`): a 9 x 8m stone bakehouse where the
  mill's flour becomes bread -- brick oven with a domed top, a live fire in
  its mouth and a chimney through the ridge, the peel leaning beside it,
  the kneading table with dough, a flour heap and rolling pin, three racks
  of long and round loaves on the west wall, five flour sacks stacked in
  the corner, a bench and a golden ring sign outside. The baker works at
  the table and a customer waits by the door; all four windows open.
- **Crafts and trades** (`village.js`): a fisherman's hut on the south
  bank east of the farmhouses (boarded 5 x 4m hut with nets and a drying
  rack, a plank jetty out over the bank you can walk, and the fisherman's
  rowing boat: moored alongside for half a minute, then rowed -- oars
  sweeping, the rower facing the stern -- 22m downstream to the river's
  middle, where he sits turned to the side with a rod over the water for
  fifty seconds, a fish coming up the line every so often, then rowed back
  and moored; phases run on the shared sim tick like the barge); on
  the north bank flanking the landing a smithy (open bay, hearth with fire
  and hood, chimney, anvil on its stump with hot iron and hammer, bellows,
  quench barrel, tool rack, bar stock, horseshoes; the smith at the anvil)
  and a pottery (kick wheel with the potter seated at it, three shelves of
  jugs and bowls raw and glazed, a clay heap, the kiln outside with its
  fire, ware on a bench by the door). At the south village's east end a
  marketplace (cobbled 14 x 12m square open to the street, a market cross,
  eight striped-awning stalls with vendors: pottery, vegetables, fish,
  meat, eggs, bread, fruit, cheese, and three shoppers) faces the village
  church across the street: 18 x 9m nave with round-arched openable windows,
  west tower with bell openings, 5.5m pyramid spire and cross, ten pews
  with a seated congregation, chancel step, altar with candles, the priest.
  Beyond the market the street runs on through the village's east end:
  five cottages and houses along the river (with two more among the farms,
  seven in all, single- and two-storey, so the village counts twenty roofs
  with its crafts and church), and on the south side, past the church, a
  weaver's (a treadle loom with the warp sloping from the beam through
  heddle and beater to the cloth rolling up in front, the weaver on the
  bench; a spinning wheel with the spinner; baskets of wool, shelves of
  dyed bolts, dyed cloth drying on a line), a tailor's (cutting table with
  cloth and shears, the tailor at it; a dress form; a rail of tunics; shelves
  of folded cloth; a counter under the shop window with a customer) and the
  public fountain: a paved square on a path from the street, an octagonal
  basin on a step (its wall and coping are eight boxes each, so it is solid
  to walk against and open to the water), a column with a small basin round
  its foot a step above the pool, an upper bowl, and four spouts under the
  bowl whose jets fall straight down into the small basin. The water is
  live: pools ripple with their own ring shader, jets are cylinders with
  streaks running down them (`flows` export, built by the demo like `fires`).
  Every trade hangs its sign the tavern's way (`hangingSign`: a bracket over
  the door, a painted board edge-on to the street, the emblem on both faces
  -- shuttle, shears, jug, horseshoe). Hearth fires burn INSIDE their ovens:
  the bakery oven and the pottery kiln have a real mouth cut through a front
  slab (an `hwall`), a firebox of floor, cheeks, lintel and sooted back
  behind it, and the flames in the firebox seen through the opening.
  Every building levels its plot fully (`flatZones` entries carry `level`,
  which also suppresses the river-bank carve out to 1m past the footprint),
  so no house corner hangs over a falling bank; only what is built out over
  the water -- landing, mill, fisherman's jetty, bridge -- keeps the bank.
  The barge eases onto the river's center line for 30m either side of the
  bridge and passes the middle arch straight, clear of both piers.
- **Enclosures** (`village.js`, built in world coordinates at a site of
  0,0 -- `blocks` lists the bands they occupy so trees and people are kept
  off the wall line only, not the whole village): the SOUTH village has a
  stone town wall -- 4.5m to a walkway you can patrol (parapet with merlons
  outside), towers projecting outward every ~40m and at the corners with
  arrow slits and pyramid roofs, and a gatehouse where the street leaves at
  either end (arched 4.4m passage between two 11m towers) with a solid
  stair, landing and timber handrail up to the walk beside each gate; a
  timber handrail runs the whole inner edge of the walk, broken only where
  a landing arrives. The NORTH hamlet has a timber palisade -- 4m of
  sharpened logs on a rail with inner posts, post-frame towers (platform,
  boarded cabin with a lookout opening on each side, hip roof) outside the
  line at the corners and every ~35m, and gatehouses (a gallery over the
  passage between two towers) where the freight road and the quay street
  cross it. Each tower has a ladder up its yard side: stand at its foot and
  "click to climb the ladder" puts you on the platform inside the cabin
  (a real floor; the hatchway faces the ladder), "climb down" returns you.
  Both enclosures sink 2m below grade on levelled bands, and are open to
  the river.
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
  physics itself sub-steps at 50Hz whatever the frame rate.
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
- **Flora** (`flora.js`): four branchy tree species with autumn palettes,
  big bushes, five flower kinds at generous real sizes, mushrooms; drifting
  multi-tone clouds. All static flora shares one instanced draw and rebuilds
  deterministically when the season changes.

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
  descends (Shift: faster); in the air gravity is off, the mount never
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
  Closed doors are genuine walls. Every window pane in the world is one
  InstancedMesh: each hinge is a bare transform whose matrix feeds its
  instance when it swings, so hundreds of openable windows cost one draw.
- Stairs whose one side is open carry a balustrade along the flight (a
  baluster per step, close enough to stop the walker, plus the handrail);
  the top landing stays open so you can step off, and stairs against a
  wall need none. Stairwell openings in upper floors are railed the same
  way (`wellRail`): the drop edges get posts and a rail, the landing's
  stretch stays free.
