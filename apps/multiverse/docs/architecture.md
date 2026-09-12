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

Species are pure data (`species.js`); people, butterflies, fish, trees,
bushes, flowers, mushrooms and clouds are tiny generator functions that
return the same structure with seeded variation. `anim.wing: true` marks
parts that beat on a second clock (`wingT`) so a flying mount can flap
while its legs hang still. A bat wing is four flat triangles whose one
cross-frame seam runs along the spar's hinge axis, so it never gaps.

## Three interchangeable engines

| engine | file | draw calls | what it builds |
|---|---|---|---|
| rig | `rig.js` | 2 per part | real polygon meshes + inverted-hull outline (baseline for comparison) |
| banner | `banner.js` | 1 per part | one 2-triangle quad per part; SDF silhouette in the fragment shader |
| instanced | `instanced.js` | **1 per herd** | every part everywhere is a row in instanced buffers; the CPU walks skeletons and uploads world-space segments |

`?mode=` picks the engine; the default demo uses banner for the display herd
and instanced for everything numerous (forest, crowd, butterflies, fish,
riders, remote avatars). `anim.js` animates the rig/banner scene-graph form;
the instanced engine replays the same `anim` data as matrix math per frame.
See [`engines.md`](engines.md) for the shader details.

## Buildings

`village.js` adds the farm village in the same vocabulary — `stoneBridge`
(built to the river's half-width, its `floorY` carrying deck and ramps),
`bakery`, `farmyard` (exporting the animals' `pen`), `cropField`,
`berryRows`, `orchard` — merged by the same `buildBuilding`.

`architecture.js` is a set of parameterized generators — `greekTemple`,
`romanAmphitheatre`, `gothicCathedral`, `egyptianTemple`, `medievalHouse`,
`baroquePalace` — that emit a richer part vocabulary (`box`, `cyl`, `arch`,
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

## The orchestrator

`index.html` holds the single demo: town layout, terrain (layered sines,
flattened under buildings and the lake bowl), the lake and its swimmers,
paths and the highway loop, wanderer AI, riders, the cart fleet, the FPS
controller with collision, stairs and mounted flight,
weather/night/season state, interaction (mount, doors), the multiplayer
session, and the render loop. It is deliberately one file: the world is
assembled here, the libraries above stay generic.

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
