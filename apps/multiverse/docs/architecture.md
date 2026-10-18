# Architecture

## The core idea

Everything round in this world — a cow's body, an oak's crown, a butterfly's
antenna — is described as data first and rendered by whichever engine is
active. A **part** is one entry in a flat list:

```js
{ id: "legFL", parent: "body", shape: "capsule", size: { r: .09, len: .75 },
  pos: [.55, -.35, .22], rot: [0, 0, 0], pivot: [0, -.375, 0],
  color: 0x6e452a, pat: "spots", anim: { axis: "z", deg: 24, speed: .8, phase: 0 } }
```

- `shape`: `sphere | capsule | cone | tri` (tri = flat triangle membrane:
  three local corner points, used for wings, fins, petals)
- `parent`: another part's id, or `null` for the root — parts form a
  skeleton, and parents always precede children in the list
- `pivot`: where the geometry hangs relative to the group origin, so `anim`
  (a sine swing about one axis) rotates limbs about hips and shoulders
- `pat`: procedural surface pattern id (leaf, bark, stripes, bands, spots,
  wingspots), resolved in the shaders
- **Units are meters.** 1 = 1m everywhere: species, buildings, physics.

Species are pure data (`species.js`, the rigged mammals via `mammals.js`); people, butterflies, fish, trees,
bushes, flowers, mushrooms and clouds are tiny generator functions that
return the same structure with seeded variation. `anim.wing: true` marks
parts that beat on a second clock (`wingT`) so a flying mount can flap
while its legs hang still. A bat wing is four flat triangles whose one
cross-frame seam runs along the spar's hinge axis, so it never gaps.

## Three interchangeable engines

| engine | file | draw calls | what it builds |
|---|---|---|---|
| banner | `banner.js` | 1 per part | one 2-triangle quad per part; SDF silhouette in the fragment shader |
| instanced | `instanced.js` | **1 per herd** | every part everywhere is a row in instanced buffers; the CPU walks skeletons and uploads world-space segments |
| composite | `composite.js` | **1 per herd** (+1 pre-pass) | one quad per *animal* (split into on-screen cells that each evaluate only nearby parts); all its parts come from a float texture (camera-space endpoints) and are smooth-unioned per pixel into one metaball silhouette, exact ray hits per primitive, and within `?near=` metres a raymarched pre-pass supplies the true 3D fillets; every stage switchable via `PIPE` (engines.md) |

`?mode=` picks the engine; the default demo uses composite for the animals
and people (the cast, loose horses and riders, cart teams and drivers, the
arena, mount copies, the crowd, dock hands, the fisherman, remote avatars)
and instanced for everything numerous that is neither (the forest's wood,
bushes, flowers, butterflies, dragonflies, fish, clouds); the trees' leaves
are alpha cut-out cards in one mesh of their own (`foliage.js`). `anim.js` animates the rig/banner
scene-graph form; `skeleton.js` is the shared CPU pose (compile a def, walk
its transform chain, two-bone leg IK, gait bob) that both instanced and
composite replay per frame. See [`engines.md`](engines.md) for the shader
details.

## The mammal rig

`mammals.js` builds the 22 mid-to-large mammals (cat to elephant, plus the
unicorn, centaur and manticore) from a compact root-space description --
metres, feet on y = 0 -- into the same part list: two body lobes (rump and
chest), a tapered neck pill, a head sphere with a muzzle ellipsoid, ears,
eyes, nose, four legs of two bones each with a hoof or paw, a tail as an
arc of chained tapered links, and extras (horns, manes, humps, tusks,
wings, a rider's torso). The rump stays the root capsule named `body`, so
riders, collision circles and terrain probes read it as before. Parts of
the rig carry `k` (blend radius) and `edge: 0` (no outline band of their
own); torso pieces carry `frame: "body"` so their coat pattern is one
solid texture in the animal's frame; a capsule may taper (`size.r` at its
+y end, `size.r2` at the other).

Legs: the upper bone carries `ik: { leg, upper, lower, side, foot }`, the
lower bone `ik: { leg, follow: true }`; every frame the foot is placed by
the gait (stride forward and back, lift on the swing half of the cycle)
and two-bone IK puts the knee where the bone lengths meet -- `side` says
whether it folds forward (a knee) or backward (a hock). `def.gaits` holds
a walk and a run set (leg phase offsets in the order FL, FR, HL, HR,
stride, lift, body bob), defaulting from the leg length; the giraffe and
camel pace. An animal's `amp` fades the stride out when it stands, its
`run` blends walk into run: wanderers walk, ridden mounts, riders on the
tour and hurrying cart teams run. `gaitBase(def)` (species.js) is the
travel distance per gait-clock unit: for rig legs 3.2 x the walk's stride
(a foot sweeps two strides per stance, half a cycle, at .8 cycles per
unit), so a walking foot stays planted. A run covers more ground per
stride: the skeleton stretches the gait clock by the run/walk stride ratio
(`an._tg`), so the cadence follows the speed instead of pedalling. Whether
something runs is its Froude number: `runs(speed, base)` is v^2 > 4.8 x base
(~ v^2/gL > .5), so a cat trots where a horse still walks.

## The human rig and wardrobe

`people.js` builds a person the mammal rig's way, from root-space
proportions by kind (man, woman, ten- and five-year-old: children have
bigger heads and shorter legs): a torso of one flattened pill
from the hips to the shoulders (composite `flat`, on the pelvis -- the
root, an x-capsule so the "body frame" points forward, an undrawn bone), a neck pill, a head with an optional nose
(a round cone; config.json people.nose, off by default; no ears), eyes, eyebrows and a mouth drawn as flat face marks (not
SDF parts: white, iris and pupil in real-life colours; the lips a lens), arms of two bones with a hand, legs of two bones with a
foot. Knees come from the shared two-bone IK on a biped walk and run (legs
in antiphase, the hips dropping at double support via the gait's
`bobPh`); feet are `level` (oriented by the root alone, so they stay flat);
arms, the shoulders' twist, skirts and plaits swing on the gait clock with
`anim.amp`, fading with the stride when a person stops.

Clothing follows the clothing lab (garments are shells round the body):
a garment that covers a whole piece is that piece's colour, slightly
thicker; anything else is an extra shell part the engine's nearest-surface
rule puts on top -- short sleeves, boot shafts, skirts (round cones cut
flat at waist and hem, swinging behind the stride), the surcoat over a
kirtle (a chest shell cut at the shoulders: arm holes), hair caps cut at
the hairline, bob and long hair, plaits, buns, ponytails, hoods with a
capelet, caps, pointed hats, brims and straw hats (a sphere cut to a
disc), belts, aprons (two flat triangles). Under a skirt the legs it covers
are cut away entirely, as in the lab, so a knee never pokes through, and
skirted people take shorter steps. Seated, a short skirt becomes a lap
ending round at the knees and a long one stays one piece, tilted forward
from the waist to drape over the knees to the floor; the reported `hipY`
puts the lowest seated point just on the board, and a shorter thigh sits
further forward (a child near the front edge). Long hair is five thick
tapered locks fanned round the back of the head, blending into one mass. The wardrobe is drawn from its own seeded
stream by kind and can be overridden (`makePerson({ outfit })`);
`wardrobe.html` shows every garment, hat, hairstyle and pose.

## Buildings

The village's land and its riverside -- the stone bridge, the yards, the market, the apiary, the fountain, the fields,
the currant rows, the orchard, the fisherman's hut, the water mill, the landing -- and the town's buildings -- houses,
shops, inn, church, walls, towers, gatehouses, longhouses -- are component-engine definitions
(`assets/architecture/village`, written by `tools/archgen/village.py` and `riverside.py`), laid out and finished by
`town.js` and the demo (docs/world.md, docs/arch.md). So are the landmarks, Caerphilly and Versailles among them.

`architecture.js` still holds two parameterized generators — `amphitheatre` (its colliders) and the unused
`gothicCathedral` — that emit a richer part vocabulary (`box`, `cyl`, `arch`,
`spandrel`, `hwall` = wall with real cut openings, `capsule`, `gable`; a part
with `collide: false` is drawn but never blocks, one with `render: false`
blocks but is never drawn -- the level stand-ins under a sloped
handrail) consumed by
`buildBuilding`. Real dimensions, restrained-to-bold polychromy per era, and
procedural shader patterns instead of textures. Each generator also returns:

- `footprint` — for town layout, terrain flattening and tree exclusion
- `floorY(x, z)` — walkable floor heights (multi-storey: an array), including
  staircases step by step
- optionally `doors` (clickable door panels) and `folkSpots` (where static
  people belong — cathedral pews and altars)

Blocks of the baroque palace that stand face to face share a *party
wall*: the generator detects coplanar contact, drops windows and facade
trim on the shared stretch, and makes each passage one doorway (the later
block snaps its doorway onto the earlier block's and leaves the door panel
to it). Floors carry `checker` marble downstairs and `parquet` (pattern
11) above; partitions are `marble`- or `ornament`-paneled.

`buildInstanced(def, count)` is the same merged build as `InstancedMesh`
copies (the material's vertex shader honors `instanceMatrix`), one draw
per material for any number of identical movable objects — cart wheels.
`carts.js` composes both worlds: polygon cart bodies, barrels and wheels
via architecture, teams and drivers as banner skeletons.

`outline.js` is the world's one outline switch (Shift+O, off by default):
banner, instanced and composite quads compare its uniform, the polygon
rig's and the buildings' hull copies show or hide through its hook. On,
everything gets a one-pixel line; off, nothing is drawn for outlines at
all.

## The orchestrator

`index.html` holds the single demo: town layout, terrain (layered sines,
flattened under buildings and the lake bowl), the lake and its swimmers,
wanderer AI, riders, the cart fleet, the FPS controller with collision,
stairs and mounted flight, weather/night/season state, interaction (mount,
doors), the multiplayer session, and the render loop. The world is
assembled here; self-contained subsystems live in their own modules and
are handed the world they need as one explicit object, so each has one
owner and no second copy:

- `paths.js` -- `buildPathNetwork(world)`: route layout, dry routing round
  the lake and river, the highway lane loop, the track mesh; `laneFrom`
  (arc-length lanes with `at` / `heading`) is what carts AND riders drive
- `village-life.js` -- `createVillageLife(world)`: the villagers' day on the world tick -- homes and
  beds (`beds`/`ways` from the houses), jobs (folkSpots with `role: "work"`, fields, sacks to the
  mill's `drop`), four composite poses per villager (one shown), routes from `paths.js`
  `routeGraph(pathRoutes, links)` (Dijkstra over the dry lines; `links` = the bridge deck)
- sound: `calls.js` (creature calls, `animalCall`), `speech.js` (formant speech, `VOICES`,
  `voiceFor(kind)`), `environment.js` (`createEnvironment(ctx).update(state)`: the world's
  ambience from weather, night, indoors and distances to water and fire), `instruments.js`
  (`playSong`: any song on any instrument), all rendering through the shared `dsp.js`
- `freight.js` -- `createFreight(world)`: goods with ONE state table
  (`GOODS`, changed only through `goodsTo`), the barge, the dock hands,
  the freight carts' stops, goods riding moving floors
- `weather.js` -- `createWeather(scene)`: the rain and snow curtains
- `geom.js` -- the vector maths and the aim rotation the generators share
- people's seating goes through `sitAt` / `rideAt` from `people.js`

Refactors are checked with the deterministic sim: hashes of every herd,
the freight chain, the paths and the generators' output after a fixed
number of ticks must stay byte-identical.

## Speech (`speech.js`, standalone)

Klatt-style formant synthesis on Web Audio, independent of the engine: a
glottal sawtooth (with a mild high shelf) and white noise through a
CASCADE vocal tract -- peaking resonators F1..F3 in series that move,
F4/F5 fixed -- so formant bandwidths and relative levels come out as a
real tract makes them; a fricative path -- a highpass corner then a resonant peak,
so /s/ has nothing below 4 kHz and reads as a sibilant rather than wind
-- for noise and bursts, and a low murmur resonator for nasals. Gains
move by exponential approach, never by steps, so nothing clicks. `PHONEMES` is an IPA-keyed table rich enough
for English, German, French, Spanish and Russian together -- vowels as
formant targets (nasal vowels, diphthongs), glides and liquids (trill,
tap, uvular, English r), nasals, fricatives with their noise band,
plosives with closure/burst/aspiration and formant loci, affricates.
Consonant loci drive the formant ramps into and out of each vowel, which
is where intelligibility mostly lives: a vowel snaps out of a stop in
~20 ms (a slow sweep out of /b/ is a /w/) but eases out of a glide, and
velars (/k/, /g/) take their locus and burst from the vowel beside them
-- low by a back vowel, high by a front one. Length is real: lax vowels are short, a marked long vowel (ː) is 1.7x
a plain one, and a length mark on a consonant makes a geminate -- a held
fricative, nasal or liquid, or a long closure before a stop's release.
`LANGS[l]` gives each language its
phoneme subset, the transcription of the shared 18-word lexicon (`WORDS`),
and a prosody set -- rate, stress lengthening and pitch, final fall or
lift -- that is most of what an accent is. Intonation is a contour over the whole
utterance: each vowel glides from an onset to an offset pitch along a
line that declines across the sentence and steps up a little at every
new word, rising through stressed vowels to their accent peaks, lifting
before a comma, and shaped at the end by the mark -- a fall for a
statement, a higher peak and deeper fall for "!", a rise for "?" -- in a
slightly different key every utterance. Words join legato (a brief dip,
not a silence). `sayText("hello, beer please!", lang, at, mood)` speaks a sentence:
lexicon keys become their transcriptions, anything else is read as IPA;
`MOODS` (normal, excited, angry) scale one utterance's key, pace, stress
height, fall and loudness. `createSpeaker(ctx, { pitch,
scale, rate })` is one voice (formant scale = throat size); `say(word,
lang, at)` schedules an utterance, `renderWord` renders one offline.
`speech.html` is the test page.

What keeps the voice from sounding like a machine is measured, not
guessed (offline renders through `renderWord`, analysed for pitch
jitter, drift, harmonics-to-noise ratio, formant tracks and levels):
the pitch wanders ~1.3% slowly and jitters ~.4% cycle to cycle (the
modulators are lowpassed noise, which keeps only a few percent of its
amplitude -- the gains are scaled by that, and an unscaled version
measured .04% and sounded like a buzzer), the level shimmers a few
percent, the vibrato is faint; the breath noise is gated by the glottal
cycle so breathiness is a throat and not a hiss laid on top; every
segment's length varies a few percent; a vowel starts a little high out
of a voiceless consonant and low out of a voiced one; a stressed vowel
rises to its peak and turns down instead of sliding; and an unstressed
short vowel undershoots its target by a fifth toward its neighbours,
the way a tongue already on its way to the next sound does.

## Build targets

- **dev**: `index.html` + separate module files over any static server;
  real files and line numbers in devtools.
- **dist**: `build/build.py` bundles the inline module script, all local
  modules and three.js itself into `dist/bannerfield.html` — one minified,
  fully offline file. See the build script header for how.
