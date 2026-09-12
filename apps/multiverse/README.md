# Bannerfield

A stylized, walkable low-poly 3D world rendered with a custom "banner" engine:
every rounded body part — animal limbs, tree crowns, butterfly wings — is a
single camera-facing quad whose mathematically perfect silhouette is drawn by
a signed-distance-function shader. Flat fills, dark borders, no lighting pass,
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
index.html        dev entry point — the whole demo orchestrator (module script)
species.js        27+ animal defs + generative butterflies/fish/shark/dolphin
people.js         generative people (poses: stand, sit, ride)
carts.js          carts and wagons: bodies, wheels, barrels, yoked teams, the fleet mix
flora.js          trees, bushes, mushrooms, flowers, grass, clouds
architecture.js   building generators + procedural material patterns
banner.js         per-part SDF quad engine (one draw call per part)
instanced.js      one-draw-call herd engine (shared silhouette shaders)
rig.js            classic polygon-mesh engine (comparison baseline)
anim.js           engine-independent skeletal animation
rtc.js            WebRTC transport + presence session
speech.js         formant speech synthesis: rich IPA phoneme table, 5 languages x 18 words, accents (standalone)
calls.js          synthesized animal calls, one recipe per species (standalone)
village.js        the village: stone bridge, bakery, yards with sheds and stables, fields, orchard, fisherman, smithy, pottery, church, market, town wall and palisade
speech.html       the speech test page: every word in every language, four voices
docs/             architecture, engines, world, networking
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

Useful URL parameters: `?mode=rig|banner|instanced`, `?species=cow`,
`?building=none|parthenon|cologne|...`, `?n=1000` (herd size), `?trees=0`,
`?people=0`, `?carts=N` (fleet size), `?butterflies=0`, `?autumn=1`, `?weather=1|2`, `?intensity=0-2`,
`?night=1`, `?freeze=<t>` (pin the animation clock), `?cam=orbit`,
`?cx/cy/cz/tx/ty/tz` (camera), `?depth=flat` (disable per-pixel depth).

Controls: WASD + mouse (click to grab), Shift run, Space jump, Shift+Space
dash. Click a horse to ride it, a door to open it; click a dragon or
manticore to fly it (E climbs, Q descends). P cycles rain/snow,
O intensity, I autumn, N night, M multiplayer panel, L / K / J the
people's language / voice / word (they speak a word now and then when near).

## Building the distribution file

```
pip install -r build/requirements.txt   # once
python3 build/build.py
```

Produces `dist/bannerfield.html` — one self-contained minified file with
three.js and all modules bundled in, no CDN or server needed: open it from
disk, send it to a friend.
