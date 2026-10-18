# Bannerfield

A stylized, walkable low-poly 3D world rendered with a custom "banner" engine:
every rounded body part — animal limbs, tree crowns, butterfly wings — is a
single camera-facing quad whose mathematically perfect silhouette is drawn by
a signed-distance-function shader. Flat fills with formula shading (no lights), an optional 1px outline (Shift+O), no lighting pass,
no tessellation. A whole forest, herd, or crowd is one instanced draw call.

On top of that engine: a town of real-dimension buildings (Greek temples with
painted polychromy, the Colosseum, three Gothic cathedrals, Versailles,
Egyptian Dendera, a crenellated water castle, medieval houses, a working
water mill and a tavern with its company on a riverside street), 42 animal
species plus monsters (some of them flyable), fish, a lake, generative
people, riders, ox- and horse-drawn carts hauling barrels and grain sacks
on a two-lane highway, a river flowing into the lake, flowers,
weather, day/night, and serverless WebRTC multiplayer. Everything
procedural — no textures, no model files.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — file layout, the part vocabulary, the three interchangeable render engines, the demo orchestrator
- [`docs/engines.md`](docs/engines.md) — the banner SDF math, perspective-correct flattening, per-pixel depth, the instanced pipeline, shader patterns
- [`docs/world.md`](docs/world.md) — terrain, buildings and walkability, species/flora/people generators, wandering AI, weather/night/seasons, interactions
- [`docs/networking.md`](docs/networking.md) — the WebRTC session, the presence protocol, what is and is not synchronized

## Layout

```
index.html        dev entry point — the demo orchestrator (module script): world layout, sim tick, player, UI
paths.js          the path network: lanes (carts, riders), highway, every track kept out of the water, the track mesh
freight.js        the freight chain: goods and their states (one table), barge, dock hands, freight stops, goods riding moving floors
weather.js        the rain and snow curtains (the weather's state stays with the world)
geom.js           small vector maths and the aim rotation shared by the generators
species.js        42 animal defs + generative butterflies/fish/shark/dolphin
mammals.js        the mammal rig: metaball bodies, IK legs, arc tails, walk/run gaits for the 22 mid-to-large mammals
people.js         the human rig + wardrobe: metaball torso, IK knees, clothes as cut shells (poses: stand, sit, ride, carry, lie)
carts.js          carts and wagons: bodies, wheels, barrels, yoked teams, the fleet mix
flora.js          trees grown by recursive branching (6 species), bushes, mushrooms, flowers, grass, clouds
foliage.js        the trees' leaf cards: one draw for the forest, alpha cut-out with alpha-to-coverage, wind
architecture.js   building generators + procedural material patterns
banner.js         per-part SDF quad engine (one draw call per part)
instanced.js      one-draw-call herd engine (shared silhouette shaders)
composite.js      one-quad-per-animal herd engine: all parts smooth-unioned per pixel into one silhouette
textures.js       pattern tiles calculated at startup (brick, tiles, checker, grass...), mipmapped + anisotropic
skeleton.js       shared CPU pose: compiled skeletons, transform walk, two-bone leg IK, gait bob
anim.js           engine-independent skeletal animation
rtc.js            WebRTC transport + presence session
speech.js         formant speech synthesis (IPA phonemes, 8 languages, 23 voice presets incl. old men and women, voiceFor(kind))
calls.js          synthesized creature calls, a distinct recipe per species (birds included); WILD = sounds for the environment only
environment.js    the world's ambience: rain on leaves or roof, wind, surf, brook, hearth, birds by day, crickets and owls by night, thunder
instruments.js    11 instruments x 10 songs, any song on any instrument (the village bard plays them)
squirrels.js      squirrels: dash between neighbouring trees, climb the trunks head first up and down
paintings.js      the palace's paintings: views of the world from the towers, taken once at the start
mirrors.js        planar mirrors (the palace's Hall of Mirrors): reflections on a budget, the nearest three
tools.js          what people hold: items (a scythe, a halberd, a heater shield...) put in the hand by their grip, instanced per kind and material
items.js          the items builder: weapons, shields, tools, furniture and their components from assets/items -- materials, holds, markers, kits (docs/items.md)
defs.js           how definitions stand on each other (`use`) and merge: shared by the creatures and the items
catalogue.js      assets/index.json loaded once for the world: the animals, the people, the items in hands and rooms
dsp.js            shared DSP for the four sound engines: filters, loudness, loops, buffer playback
town.js           the town by seed: a style (stone, roof, timbers, plasters, tower tops) and a plan -- streets, houses, shops, inn, church, the wall ring with towers and gates, the farms
village.js        MAX_PIER_DEPTH (the village's land and riverside are definitions now: assets/architecture/village, tools/archgen/village.py, riverside.py)
terrain_lab.html  the terrain lab: a region grown by its geology on the GPU (plates, volcanoes, rain, rivers, falls, lakes, the sea; layered rock) -- docs/terrain_lab.md
mapgen.js         the world's land grown at load: a window of the lab's river country, settled for the town and the monument, every stream at its own level -- docs/world.md
village-life.js   the villagers' day: homes and beds, jobs, sleep at night, church at the bell, the inn, the market, sacks to the mill
speech.html       the speech test page: every word in every language, four voices
wardrobe.html     the people test page: every garment, hat, hairstyle and pose, plus a walking crowd
textures.html     the pattern tiles as baked, alone and repeated, and the leaf atlas
menagerie.html    the animal test page: chosen species in a row (default: the ones built from curved tubes)
grove.html        the tree test page: every species twice, autumn and re-roll keys
texture/          the tiles saved as PNGs by build/textures.py -- for looking at only, the game calculates them
docs/             architecture, engines, world, networking, items
build/            single-file distribution build
dist/             generated — bannerfield.html, fully self-contained
```

## Running locally

The page uses ES modules plus an import map pointing at unpkg for three.js,
so it needs to be served over HTTP (not `file://`):

```
python3 -m http.server 8471
# open http://localhost:8471/index.html
```

Useful URL parameters: `?near=10` (3D-marched fillets within that distance, off by default), `?mode=banner|instanced` (instanced = composite for the animals), `?species=cow`,
`?building=none|parthenon|cologne|...` (which landmarks; otherwise three at random), `?seed=N` (the random three: picked when absent and
written into the address), `?n=1000` (herd size), `?trees=0`, `?people=0`, `?textures=0` (patterns per pixel instead of baked tiles), `?smooth=0` (raw sim ticks), `?billboard=0` (leaf cards fixed instead of facing the camera), `?carts=N` (fleet size), `?butterflies=0`, `?autumn=1`, `?weather=1|2`, `?intensity=0-2`,
`?night=1`, `?villagers=N` (the village's people, default 32), `?townstyle=timbered|stone|brick|plastered`, `?freeze=<t>` (pin the animation clock), `?cam=orbit`,
`?cx/cy/cz/tx/ty/tz` (camera), `?depth=flat` (disable per-pixel depth).

Controls: WASD + mouse (click to grab), Shift run on/off (like C crouch), Space jump, Shift+Space
dash. Click a horse to ride it, a door to open it; click a dragon or
manticore to fly it (E climbs, Q descends). P cycles rain/snow,
O intensity, I autumn, N night, M multiplayer panel, L / K / J the
people's language / voice / word (they speak a word now and then when near),
C crouch (toggle), Tab the full controls list.

## Building the distribution file

```
pip install -r build/requirements.txt   # once
python3 build/build.py
```

Produces `dist/bannerfield.html` — one self-contained minified file with
three.js and all modules bundled in, no CDN or server needed: open it from
disk, send it to a friend.

## Configuration

`config.json` holds the settings that decide what rendering costs: the
renderer (antialiasing, pixel-ratio cap, the camera's near / far clipping
distances -- near kept below the player's collision radius, and the FRAME
BUDGET: `targetFps` is what the ms/frame readout is judged against -- 90 fps
is 11.1 ms, and the HUD says what share of it a frame spends -- while
`uncapped` drives the loop off a timer instead of the display's refresh, so
the fps number shows the real ceiling on a screen that refreshes slower than
the machine can draw; `?fps=90`, `?fps=max`, live `__dbg.setFps(90)`), the SDF figures (the
half-resolution pass for near figures -- off by default, Shift+M toggles
it live -- screen cells, pose LOD distances, marched fillets), baked
textures (and their parallax relief: `parallax`, `parallaxSteps`,
`parallaxFar`), mirrors (planes reflecting at once, reach), the paintings' size,
the crowd sizes and the player's own body (`player`: `selfBody` on/off,
`eyeBehind` -- how far behind the camera its eyes sit, 0.10 m;
`collisionRadius` -- how close you get to walls, 0.25 m). Each section carries an `_about` line. Served from
source, edit it and reload; the dist file bundles it, so rebuild with
`python3 build/build.py`. URL options (`?half=1`, `?cells=2`,
`?people=10` ...) still override it per visit.

