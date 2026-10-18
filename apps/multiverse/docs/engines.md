# The banner engines

> **THE FIGURES ARE POLYGONS, AND THE SDF THAT DREW THEM IS GONE (2026-09-24).** Animals, monsters and people
> are swept by shell.js and nothing else; `composite.js` is now their data path alone (the skeleton walk, the
> part textures, the herd) and `composite_wgsl.js` what the surface still shares with it (the part encoding,
> cloth, fur). Deleted with the SDF: the per-figure quad and its screen cells, the solid-cell test, the
> nearest-first part order, the stencil bound, the half-resolution pass and its blit, the marched 3D fillet
> pre-pass, the occlusion buffer the figures tested against, and every `PIPE` switch but `viewSpace`
> (`?cells=`, `?half=`, `?early=`, `?solid=`, `?flatdepth=`, `?stencilcull=`, `?near=`, `?occlude=`).
> **Everything below about them is kept as the record of what was tried and what it cost** -- the measurements
> are still true of the code that was there, and several of them are the reason the polygons look the way they
> do. The SDF itself is alive and unchanged in `instanced.js`, which draws the trees, plants, clouds and
> butterflies as banners.

> The world runs on **WebGPU**, and every shader here is **WGSL** through three's node materials. The shapes of
> the engines are unchanged -- what follows describes them as they are -- but the crossing had traps of its own,
> and those are in [webgpu.md](webgpu.md).

## Why banners

A capsule tessellated the classic way costs ~600 triangles, twice (fill +
outline hull). A banner costs 2 triangles and draws a *mathematically
perfect* silhouette at any zoom: the fragment shader evaluates a 2D signed
distance function and discards outside pixels. Flat fill (plus an optional
1px outline, Shift+O) replaces lighting, matching the 2D game's look. That's a ~300x geometry
reduction per part, and the instanced variant collapses draw calls too.

## From part to silhouette

Every primitive reduces to a canonical **segment** `(A, B, r1, r2)` in part
space (`segmentFor` in `banner.js`):

- capsule → its axis endpoints, equal radii
- sphere → degenerate segment (a point) — a circle; non-uniformly scaled
  spheres approximate as a capsule along the longest semi-axis
- cone → base-to-apex segment, `r2` near zero → the uneven-capsule SDF draws
  a triangular-ish sail (iq's `sdUnevenCapsule`)
- tri → three explicit corner points (`sdTriangle`), for genuinely flat
  membranes: bat wings, fish fins, flower petals, butterfly wings

## Perspective-correct flattening

The quad lives in the camera-parallel plane through the segment's midpoint
depth `zc`. Each endpoint is projected onto that plane by scaling its view
xy *and its radius* by `zc / z`. Without this, depth-slanted limbs shift by
different amounts and gaps open at joints that genuinely overlap in 3D; with
it, a slanted capsule correctly becomes an uneven pill (near cap fatter).
The fragment shader then works entirely in that 2D plane.

## Per-pixel depth: the exact surface

The 2D silhouette only decides which pixels a part covers. For each covered
pixel the fragment shader intersects the pixel's view ray with the actual
3D primitive -- a round cone from A (radius r1) to B (radius r2), a capsule
when the radii match, a sphere when A = B (`hitCone`, iq's rounded-cone
intersection: one closed-form hit, no marching) -- and writes that depth to
`gl_FragDepth`. Costs early-z, buys exact intersection curves where parts
interpenetrate: eyes sit *on* heads, a leg meets the belly along the true
curve, and the solid textures get the true surface point, so a stripe
crossing from rump to chest lands on the same 3D point in both parts and
never jumps. Where the flattened silhouette overhangs the solid by a
sliver the ray misses; that pixel is the primitive's limb and takes the
depth of the ray's closest approach to the axis (`approachT`), the same
depth as the hit pixels beside it, so a nearer part never loses its own
rim to a farther one (the cause of a brief "double layer" look). Fillet
pixels of the composite's smooth union use the same limb depth. Triangle
membranes stay at plane depth (they are flat skins). `?depth=flat`
disables all of it.

## Shading without lights

Banners are no longer flat: every pixel is shaded by the same
term the buildings use, on the world-space normal, so a back reads lighter
than a belly and animals, people and trees sit in the same light as the
town. Since 2026-10-02 that term is LAMBERT under one static sun
(`light.js`, `config.json` `light`: `dir`, `ambient`, `sky`):
`k = ambient * (1 - sky + sky * (.5 + .5 n_y)) + (1 - ambient) * max(0, n . dir)`
-- written once (`lightWGSL`) and spliced into `shadeOf` (banners, instanced
flora, shells), the buildings' and furniture's `SHADE_K`, the leaves, the
arrows (`litMaterial`) and the ground's key light's direction. The mesh
FACES are HALF-LAMBERT under the same sun (`heads.js faceMaterial`: `(n . dir
+ 1) / 2` through a 256-texel ramp of `people.faceShade` -- dark/gamma or a
curve), shaded in the shader with the world normal, so a head turning
toward the sun lights up. (Before: `k = .82 + .2n_y + .1n_x + .06n_z`, a
light so flat a shadowed side kept 70% -- and the faces and arrows baked
theirs in their own frame, so it turned with them.) The
normal costs nothing extra: for a capsule it is the direction from the
nearest point of the axis to the exact surface point the ray hit, for a
membrane the plane of its three corners, and in the marched 3D pre-pass
the gradient of the smooth-union field. Because normals are per
primitive, the shading shows where two blended parts meet (a shoulder
lobe against the chest); the `?near=` pre-pass smooths exactly those
fillets. The outline band is never shaded.

## Outline and patterns

Banners are flat fills with no outline by default -- the cheapest thing a
fragment can be. **Shift+O** turns on a 1px outline: the fragment shader
compares the silhouette distance with its screen-space derivative
(`fwidth`), so the band is one pixel wide at any distance, still capped at
half the smallest radius so a thin tail keeps its fill. It costs one
comparison per pixel and no extra pass; off, not even that (the shared
`OUTLINE` uniform is the switch, `setRigOutline` shows or hides the polygon
engine's inverted-hull copies). In the composite engine the outline runs
round the whole animal's silhouette; parts flagged `edge` (a rider, a
classic species) also get their own band inside it.

Patterns are SOLID textures: functions of a 3D point in metres, never of
the screen plane, so a tiger's stripes keep their spacing from any angle
and wrap round the chest seen head-on instead of squashing. Each shaded
pixel's surface point is the exact ray hit above, taken back to world
space through the camera's matrix (`uInvView`, refreshed in
`onBeforeRender`). Limbs, tails and every
classic part evaluate the pattern in their own frame (x along the segment
from A, `partLocal`), so leg rings swing with the leg; the mammal rig's
torso pieces are flagged `frame: "body"` and use the animal's frame,
rebuilt from the root part's world segment, so rump, chest, neck and head
wear one continuous coat with no seams. `patternAt` (in `banner_wgsl.js`, shared
by all three banner engines): `1` leaf mottle, `2` bark streaks running
along the axis and wavering round it, `3` wavy tiger stripes, `4` straight
zebra bands (~18cm), `5` giraffe patches (3D voronoi cell borders), `6`
butterfly wing spots, `7` turtle scutes, `8` beaver-tail diamonds.

## The instanced engine

`instanced.js` erases the scene graph: `compileDef` (in `skeleton.js`,
shared with the composite engine) flattens a species'
skeleton once (parents before children), and `herd.update(t)` walks each
animal's transform chain in plain JS — the same T·R·S chain the THREE groups
would perform, including the per-part `anim` swing — writing final
world-space segment endpoints into two big Float32Arrays (`aA`, `aB`, plus
`aC` for triangles). One buffer upload per frame, one draw call for the whole
herd; radii, colors and pattern ids are written once at `add()` time. Each
animal carries its own gait clock (`animT`) so individuals can stop, trot at
their own speed, or be driven externally (riders, mounted horse, remote
avatars), plus an optional wing clock (`wingT`) for parts flagged
`anim.wing` -- a flying mount beats its wings without trotting. Draw order inside the call is arbitrary: banners are opaque
cutouts, so the z-buffer sorts every pixel.

## The composite engine

`composite.js` draws ONE quad per animal. Per frame the shared skeleton
walk (`skeleton.js`) writes every part's world-space endpoints into a
float texture -- three texels per part: (A, r1), (B, r2), (C, k) -- next
to two static texels, (colour, pattern + frame/edge/seam flags) and
(second colour, cloth code); each instance carries
where its parts start and how many there are. The vertex shader loops over
them once to fit the quad to their projected bounding box in the plane of
the nearest part (perspective-correct, as above), the fragment shader
loops again: every part's 2D silhouette distance is evaluated and joined
into one distance by a smooth minimum with that part's `k` (0 = hard
union), so a rump and chest, neck, head and muzzle read as one metaball
torso and legs and tail fillet into it. The optional outline (Shift+O) is
drawn once around that union's silhouette; parts flagged `edge` (a fused
rider, any classic species) also draw their own band inside it, so a
person in the saddle keeps their outline. There is no raymarching: ~25
pill distances per pixel, no loop over steps.

Which part a covered pixel shows is decided by depth, exactly what the
z-buffer did between separate banners: each covering part's plane depth
plus its round bulge, nearest wins and writes `gl_FragDepth` -- eyes sit on
heads, a far leg stays behind the belly. Fillet pixels that no part covers
take the nearest part's colour at its plane. Still one buffer upload and
one draw call per herd; the textures grow if a herd outruns its hint. Two details of the single plane: a part's blend
radius `k` is world metres, so it is scaled by the plane depth over the
part's own depth before the smooth minimum (otherwise the head seen from
the saddle, far behind the plane through the body under the camera, would
melt with a radius many times its own); and a segment with one end behind
the camera is clipped at the near plane rather than dropped, so the
mount's body still shows its front half under the rider.

The quad's plane never comes nearer than the camera's near plane (read
from the projection matrix): a part closer than that -- the withers under
a rider's eye -- would otherwise put the whole animal's quad in front of
the near plane, and the GPU would clip every part of it at once. The
fragment shader then clips only the surfaces that really are nearer, the
way a mesh would be cut.

### The pipeline and its switches

Every stage of the composite engine is general -- animals, people and
fused riders go through the same path -- and each is switched by one
condition in `PIPE` (composite.js), so any of them can be turned off to
compare or debug; `setPipe({...})` changes them live (the shaders recompile,
the grids rebuild) and `?viewspace=0|1 ?cells=N ?cellmin= ?pipedebug=1` set
them from the URL (index.html also exposes `__dbg.setPipe`; wardrobe.html
toggles them with C, V, X):

1. **pose** -- the CPU skeleton walk writes world-space endpoints into a
   mirror array (always).
2. **viewSpace** -- just before a herd draws (`onBeforeRender`), the CPU
   takes the endpoints into camera space once, so the vertex and fragment
   shaders never multiply a matrix per part per pixel (off: they are copied
   as they are and the shaders transform them). Only the winning part's
   endpoints go back to the world, once per pixel, for patterns and shading.
3. **cells** (`PIPE.cells = N`, default 4, 1 = off) -- the animal's quad is
   drawn as N x N cells laid over its ON-SCREEN part (the frustum's
   cross-section at the plane's depth). Each cell's vertices test every
   part against the cell -- box overlap, then the capsule's own 2D distance
   from the cell -- padded by the animal's largest blend radius at that
   part's depth (beyond it a part cannot change the smooth union, the
   colour, the depth or a seam), and hand the survivors to the pixels as a
   128-bit mask; a pixel skips every other part. Empty cells are dropped;
   animals smaller on screen than `PIPE.cellMin` stay one cell. This is
   what keeps close-ups cheap: a rider looking at the mount's neck evaluates
   a few parts per pixel instead of all of them.
3b. **occlude** (`OCC.on`, off by default until it is measured on a GPU; `?occlude=1`) -- the world's
   occluders (the buildings and the ground, opted in by `OCC_LAYER`; never a transparent pane, which would
   hide what is seen through it) draw their DEPTH ALONE into a buffer a quarter of the canvas, in the same
   frame and from the same camera as the figures, so there is nothing to reproject. A figure whose whole
   bounding sphere lies behind all 4 x 4 samples over its own screen box culls every one of its cells in the
   vertex shader. This is the one thing `gl_FragDepth` costs us: writing depth turns off early-z, so a
   villager behind a house is otherwise shaded in full and only then thrown away by the depth test. It is
   conservative by construction -- the sphere's NEAREST point must be behind the occluder (so the ground
   running up to a figure's feet never hides it), a sample that saw nothing reads the far plane and refuses,
   a figure crossing the screen's edge is left alone, and figures taller than `OCC.big` of the screen are not
   tested at all. `__dbg.bench(n, ["life"])` in the game measures what it saves from where you stand.
4. **near** (`NEAR.dist`, off by default) -- the raymarched fillet pre-pass.
5. **main pass** -- silhouettes, exact hits, cuts, cloth, seams, outline.

`PIPE.debug` tints each pixel by the share of parts it evaluated (green few,
red all). Verified headless: renders with each switch on and off differ
only by float noise at pattern edges (clusters of a few pixels).

### People: cut shells, cloth and seams

People (`people.js`) are composite figures too, and they add three things
to the engine, all of them per part and all still closed-form:

- **Cuts.** A non-triangle part may carry a slab along its own axis --
  `C.xyz = (lo, hi, mode)`, metres from A along A->B. Only an exact ray hit
  that survives the cut covers a pixel; the ray's exit from the round cone
  (the same `hitCone` run backwards from beyond the solid) gives the far
  wall. Mode 1 is an open shell: where the near side is cut away the far
  wall's inside shows, darkened (a hood's lining, a hair cap that leaves the
  face free). Mode 2 is a solid: the cone intersected with the slab, with flat
  caps that shade by the axis (a belt, a hat's brim disc, a skirt's
  waistband and hem). This is the clothing lab's "shell cut by a plane" --
  here the plane is always square to the part's axis, which is why a hair
  cap is a sphere whose (1 cm long) axis points up-and-back at the hairline.
- **Cloth.** Patterns 9-15 (horizontal and vertical stripes, checks, twill
  weave, leather mottle, mail rings, a plait's chevrons) mix the part's two
  colours in a wrapped frame -- the ANGLE round the axis times ONE radius for
  the whole part, chosen so a whole number of the pattern's periods fits the
  turn (2026-09-15), and height, in the
  person's frame for torso pieces so a shirt's stripes run on across the
  lobes. The cloth code adds uneven dye, wear toward a hem (by the fraction
  along the axis up to the cut), pleat folds darkening the valleys, a trim
  above the hem or cuff (plain band, embroidered, scalloped; not on caps),
  and a bodice's front lacing in the chest lobe's own frame.
- **Relief** (2026-09-15, `gRelief`). What a surface shows in the LIGHT without
  showing it in the silhouette. Every producer adds the surface (tangential)
  gradient of its own height field in metres, and the shading tilts the normal
  by it just before `shadeOf`; one shared gain carries it, because the world's
  light was deliberately flat when it was set (`shadeOf`'s gradient was .23 -- Lambert's is up to 1 - ambient, ~.4, so the relief now reads about twice as strong -- and only ~.08 along
  the horizontal tangents a skirt's folds run across, so an honest slope would
  move the shade by about 1%). It costs no geometry and no part, and the same
  field that tilts the normal shades the colour, so the two cannot drift apart.
  Three wear it: a skirt's PLEATS (the valleys that were only darkened before
  now catch the light, and fade out once a fold falls under a few pixels, as
  fur and scales do), an EYEBALL (a parabolic cap inside the mark's outline, so
  the white and the iris shade as a ball, with the upper lid's shadow over the
  top of it) and a BROW RIDGE (`dot.relief: 1` on the eyebrow mark, with
  `dot.reach` saying how far past the mark the cells must list it) -- which is
  the forehead a head that is one sphere has no shape for. The nose is the
  other half of that face and is a real part again (`people.nose`, on by
  default): a ridge in the light and a nose in the silhouette.
- **The head** (2026-09-15). A person's head is an OVOID, not a ball: a round
  cone standing on its own axis. The CRANIUM is the sphere it always was -- the
  cone's top cap centre sits at the part's own origin, so the hair, the hats and
  the eyes keep exactly the places they had -- and below it the head runs on for
  `hL` (.40 `hr`) and narrows to `hJaw` (.74 `hr`): a jaw and a chin. That, not a
  symmetric stretch, is what makes a head read as a head: a stretch hides under
  the hair, the jaw is the part a face shows. (Round about its axis: it cannot
  also be narrower across than deep.) Everything anchored on that surface -- every
  face mark, the nose -- is placed by `onHead`, which bisects for where the ray
  from the head's origin leaves the ovoid (inside a round cone is "within the
  tapered radius of some point of its axis"), at build time, once. It keeps each
  feature's ANGLE, so the face's layout is the one the sphere gave. Without it a
  mark placed at `hr` would sit a centimetre inside the skin at the chin, and the
  composite -- which paints a mark only within a hair of its own plane -- would
  silently drop it (the mouth goes first). A beast wears its own animal head, a
  sphere as before.
- **Panels** (2026-09-15). A part may carry a PANEL painted on it -- a sector
  about the figure's forward, from one fraction down its axis to another, in
  another colour, with no shape of its own (`panel: { color, half, from, to }`,
  the third static texel). The APRON is one: it was two triangle membranes hung
  2cm in front of the skirt with a `1/cos` correction for the cone's slope, and
  a width and a height is all it ever was. Painted, it rides the skirt's swing
  exactly, no knee can poke through it, and it takes every shading term the
  cloth has -- dye, wear, the pleats' valleys and their relief -- so it lies ON
  the folds instead of floating over them. Its own edge is darkened: that is
  what a silhouette used to do for it. Two parts fewer on every woman in an
  apron, and the same mechanism would serve a tabard or a surcoat's front panel.
- **Hair caps are SOLID cuts**, not open shells. A shell shows the far wall's
  inside at its cut, darkened, which at a hairline reads as a gap between the
  hair and the skin -- hollow hair. Solid, the cut is a filled face and the hair
  meets the skin along an edge, the way the chiton demo's cap does. (A hood
  stays a shell: you are meant to see its lining.)
- **Seams.** The main loop keeps the second-nearest covering surface too;
  where a part flagged `seam` shows within one pixel of its own silhouette
  or of its cut, and the surface behind it there has another colour, the
  pixel is darkened -- the lab's id-edge post pass without a second pass.
  Membranes (triangles) take their depth from their own plane along the
  ray, so a slanted apron sits exactly in front of the skirt it hangs over.
- **Bones.** A part flagged `bone` is posed like any other (what hangs on
  it, `ends()` for what rides on it, the root's axis for the figure's
  forward) but never drawn: it compiles with a blend radius of -1, and the
  vertex shader's cell mask, the pixel loop and the near pass all skip it.
  A person's pelvis is one (the hips carry its girth).
- **Two texel reads, adaptive cells, early exit** (composite.js stages 3
  and 7). A part's first radius, its blend radius and whether its third
  texel carries anything are packed into A.w (`unpackAw`), so a plain
  capsule is read with two texel fetches, not three. The cell grid goes up
  to `PIPE.cells` (8) each way for figures at least `PIPE.cellBig` of the
  screen tall (from a per-figure bounding sphere, `aBound`, before any
  work), half that otherwise. Stage 7 (`PIPE.early`, off by default: no
  gain measured in the software renderer) sorts each figure's parts
  nearest-first per camera -- the root stays in slot 0, the body frame
  (coat patterns, forward, a flat part's squash) is read from it -- and a
  pixel stops once deep inside the surface it has won; its union keeps the
  eight nearest parts and blends them in the figure's own list order
  (`tOrd`), identical to the running union.
- **Fur, rosettes, twist** (2026-09-14). Mammals' coat parts carry a fur
  flag (stat flags + 256, set by `mammal()` -- off for dinosaurs, elephant,
  hippo, rhino, dragon, hydra): the composite lays short strands along the
  body and down the limbs over any colour or pattern (`furAt`, two
  stretched value noises, fading out beyond a couple of pixels per
  strand). Pattern 18 `rosettes` (leopard: broken rings on a regular
  staggered grid, jittered, laid out on the coat's own surface -- unwrapped
  round the body's or limb's axis, since a 3D grid sliced by the curved skin
  showed rings cut short -- fading out on a part's rounded ends) and 19 `twist` (spiral ridges round a part's
  axis: the blackbuck's horns, the ram's tube-built curls).
- **Solid cells and the CPU's share** (2026-09-14). A screen cell lying
  wholly inside one solid part's outline (all four corners a few pixels
  deep) whose far bound is nearer than the near bound of every part whose
  own outline reaches the cell lists that part alone (plus face marks):
  big shapes filling the screen test one part per pixel -- an elephant
  seen from its back went 1333 -> 800 ms per frame in the software
  renderer, pixel-identical (`PIPE.solidCells`, config `solidCells`,
  `?solid=0`). On the CPU, figures outside the camera's view are neither
  posed, synced nor drawn (`LOD.camera`; off while a mirror or the
  paintings look elsewhere), and a part that never moves in its parent
  keeps its local transform cached (skeleton.js).
- **Reptile scales** (pattern `scales`, 17 -- after the cloth ids, so the
  cloth routing skips it): pebbly scales in a 3D voronoi, each a dome
  lighter in its middle with a dark seam and its own tone, sized by the
  limb's girth, patches of bigger feature scales under a slow mottle; the
  composite sets `gPatPx` (the pixel's size at the surface) before
  `patternAt`, and the scales fade to the mottle once they fall under ~2
  pixels (vertex shaders share the code but have no derivatives). The
  composite reads the cells from a baked, tiling 64^3 volume (`scaleVolume`:
  seam distance, tone, centre distance per texel; one mipmapped lookup
  instead of a 27-cell search; the other engines keep the search). The
  dinosaurs wear it; the ankylosaurus keeps `scutes`.
- **Flat parts.** `flat: f` squashes a capsule along the figure's forward
  (the root segment, square to the part's axis) to f of its width: the
  outline narrows with the view's angle to that axis, the exact hit is the
  round cone's in the unsquashed space, the normal is carried back through
  the squash (the near pass marches it round). Marked by a negative first
  radius, f in the spare clip slot (so a flat part cannot also be cut; the
  slot's other two carry a PAINTED BAND -- a person's belt, with a buckle
  at the front -- instead of a shape of its own). A
  person's torso is one flat pill from the hips to the shoulders (and a
  surcoat a thicker copy of it) -- it replaced four lobes, measured ~5-7%
  cheaper per figure; the waist, the bust and the trousers' colour above
  the crotch went with them.
- **Face marks.** A part flagged `dot` is no SDF at all: its two posed
  endpoints are the corners of a mark on its parent sphere (eyes, a mouth).
  After posing, the herd turns its rows into the mark's frame on the
  parent's surface (centre, half-width, half-height); the cells list it
  like a part, and once a pixel knows its winning surface point, the
  fragment shader paints the mark there if that point lies within a hair
  of the mark's touching plane and inside its outline -- so the mark is
  only ever on the head's own surface, never on hair, a brim or a nose in
  front, and needs no depth tricks (it is exact in the half-resolution pass
  too). `dot: { iris, pupil, round }`: an eye -- a lens with pointed corners
  (people) or round (animals, `mammals.js eyeMark`: iris inside a dark
  rim), a pupil round, a bar (grazers) or a slit (small cats, reptiles), a
  glint; `dot: {}` a plain mark (the lips). A classic species' eye sits on
  whatever stands proud of the head where it looks out (an owl's face
  disc, a parrot's cheek patch: `species.js snapEyes`), and an animal's
  round eye takes a surface a little farther off its plane than a
  person's, whose marks keep tight to the skin (hair stands 5-8mm out).
- **Facial expressions** (2026-09-14, `faces.js`). What a face shows is
  its own module in two levels: FEATURES -- what one kind of mark can do
  (an eye open, wide or closed; a brow level, raised, angry or sad; a mouth
  at rest, smiling, frowning, open round or showing teeth), each a small
  recipe (w, h scale, lift, tilt, a style code) -- and EMOTIONS, a feature
  per kind of mark: neutral, happy, sad, angry, surprised, grin, asleep.
  A figure shows `an.expr` (`expression(name)`; its def's resting face:
  a sleeper's closed eyes). The marks carry `role` (eye, brow, mouth) and
  `side`; `markRows` applies the recipe to the mark's frame (tilt in the
  face's plane, the outer end up, mirrored per side; lift up the face; the
  half-height always pointing up it) and writes the style code into the
  mark's B.w, which the mark shader draws: a smile's or frown's curve, the
  teeth, the round open mouth, the closed lid's lash line.
  `createFaces().speak(an, seconds, mood)` (index.html's speech) pulls one
  to three random faces across an utterance, leaned by the voice's mood,
  then returns to the resting face. Crying (sad brows, a frown, a tear per
  eye running down the cheek, fading, then the next: the eye's code carries
  the tear's phase, its reach grows so the cells cover the cheek), laughing
  (eyes squeezed shut in arcs, a wide toothy mouth), coughing and sneezing go
  with speech.js's NON-VERBAL SOUNDS (`sp.vocal(kind)`, VOCALS laugh, cry,
  cough, sneeze -- frames built straight for render(), so in the speaker's
  own voice; each built from what makes it recognisable: a laugh's regular
  ~5/s breath pulses, twice the speaking pitch, decaying and slowing, the
  noisy inhaled voice after; a cry's shaking stuffed-nose wail with a voice
  break into creak, the "hu-hu" stutter, gasps cut off by a glottal catch,
  sniffs; a cough's shut glottis, broadband blast with chest rumble and rough
  voiced tail; a sneeze's rising jerky inhales, held breath, crack, "tsch"
  hiss and falling "oo". render() gained per-frame pop (a blast, rolled off
  above ~2.6 kHz), rumble (chest noise), creak (fry) and jit (roughness), and
  normAll (the level set by the whole sound, so a blast may be loudest)): now and then a talker laughs, cries, coughs or sneezes instead
  of speaking, and `faces.show(an, VOCAL_FACES[kind], seconds)` holds the
  face exactly as long as the sound; a sleeper only coughs or sneezes, its
  eyes shut again after. A wink shuts only one eye (a feature's `side`),
  for .4s while talking, the smile staying. `wardrobe.html?row=6` shows each emotion.

### Fewer parts for the same shape (2026-09-15)

Every part costs per pixel in the cells it touches, so a curve built out of
short pills is the expensive way to draw one. Two went:

- **Arcs are tubes.** `arcChain` (tails, an elephant's trunk, a hydra's necks)
  emitted five or six aimed pills; it now emits one quadratic Bezier per 1.2
  radians of turn, its control where the arc's end tangents cross
  (`R / cos(dA/2)`), which holds a circular arc to well under a millimetre at
  this size. Most tails are one tube and a tuft -- three to five parts fewer
  each. The links never bent against each other (only the first carried the
  sway), so the motion is unchanged, and each segment keeps the pills' own
  frame -- aimed with +y along its chord, far end at `[0, len, 0]` -- so
  anything parented to a link still hangs where it did. A tail whose links
  CARRY other parts by id declares `links: true` and keeps its n: a dragon's
  spades, a stegosaur's plates and thagomizer, an ankylosaur's club.
- **A blackbuck's horns are pattern, not geometry.** Nine short pills a side
  wobbled along a corkscrew; a helix is not planar, so no tube could hold it
  either -- but the wobble was two centimetres, which is what a pattern is for.
  One tapering horn a side now wears `twist` (the ridges the ram's curls
  already had): 18 parts a pair became 2. `twist` also became two-sided
  (x.62 .. x1.30 instead of x.55 .. x1.0), because a ridge catches the light as
  well as its groove loses it -- on a near-black horn the darkening alone was
  invisible.

### The 3D LOD: marched fillets near the camera

Every pixel whose ray exactly hits a primitive is already a true 3D
result, so the only place the composite still differs from a real
raymarched metaball is the smooth-union FILLET, where the surface is the
blend of two parts and no primitive is hit. For animals nearer than
`?near=` metres (off by default: it costs more than it shows; `?near=10`
turns it on) a pre-pass (`renderNearPass`, before
the main render) marches exactly those pixels: it re-evaluates the 2D
silhouette, discards pixels with an exact hit or far outside the union,
culls to the few parts the ray passes within blending reach of, and
sphere-traces the smooth union of their exact rounded-cone distance
fields (iq's `sdRoundCone`), writing colour with pattern, coverage,
view depth and the field's normal to a shared two-target buffer. The main pass takes colour and
depth from it for its fillet pixels and lets the marched coverage decide
the silhouette there, so near animals have the real 3D fillet surface,
depth and outline while everything else keeps the exact per-primitive
result at full resolution. Only a few percent of pixels march, so the
buffer runs at full size (`?scale3d=`, a fraction of the canvas, exists
for experiments; below 1 the fillets go soft). Visually the difference
from the plain composite is small by design: it is the same surface
almost everywhere.

## Building materials

### Grass: blades in the tile, bending with the wind (2026-09-15)

The ground's grass was blade-scale FLECKS -- two binary masks per 14cm cell.
It is blades now, and they move, with no geometry, no pass and no CPU per
frame. Three tiles hold the same blades leaning three ways (bent left,
upright, bent right, `grassL` / `grass` / `grassR`, one pattern baked three
times through `gTilePhase`), and every ground pixel blends the TWO that
bracket the wind where it stands -- two slow waves crossing the meadow, so
gusts travel instead of the whole field pulsing. That is one extra mipmapped
sample per ground pixel; the mip chain is what keeps blades from shimmering
at distance, which is the whole reason the tiles are baked.

A blade is three to a 6cm cell, tapering from 8mm at the root, leaning far
enough to read as a stroke, its tip pushed along the wind by the tile's
phase. A texel tests the 3 x 3 cells around it (cells stay big enough that no
blade reaches further) and the NEAREST blade wins it: R is its coverage, G and
B its place along the blade and its own tone, both PREMULTIPLIED by the
coverage so the mip chain averages them the way it averages the coverage --
the ground divides them back out. The tile is 1m to 512 texels, .2cm each,
because a blade has to be a few texels wide; it therefore repeats every metre,
which the broad tone patches and the per-blade tone hide.

One thing it cannot do: a real blade is 4mm wide, which from standing eye
height is about ONE PIXEL at the nearest ground you can see (~4m at the bottom
of the screen) -- so these are painted wider than life, or they would be
invisible. `?grass=flecks` brings the old flecks back to compare.

**The fringe** (`grass.js`) is the other thing a texture cannot do: STAND UP.
One pass after the world, no copy of the frame. Each pixel looks a few pixels
DOWN; where it finds visible ground, a stalk rooted in that ground may reach
up this far, and the pixel is painted as a blade. That is right far more often
than it sounds, because on a ground plane seen from above, DOWN THE SCREEN IS
NEARER: grass found below a cart is grass in FRONT of the cart, and a stalk
over its wheels is what really happens -- likewise over boots, a barrel's foot,
and along the skyline. The one case that inverts, a far lawn seen below a near
ridge, is settled by perspective, which we want anyway: a stalk's height in
PIXELS is its height in metres over the distance of the ground it grows from,
so far grass shrinks to nothing. Every step down is nearer ground and so taller
stalks, which is why a step that grows nothing never ends the search -- only a
stalk that covers the pixel does.

Its own pass writes the only depth it reads: the ground alone (`GRASS_LAYER`),
depth-tested against the world's occluders (`OCC_LAYER`, the same set the
occlusion cull uses), into a half-size buffer -- R marks visible grass, GB its
distance from the eye, and A is ONE BIT saying whether the pixel's own surface
may be painted over at all. A stalk reaches a hand's breadth off the ground, so
it may cover a cart's wheel or a wall's footing but must never climb them. The
bit is cleared to 1 (paintable) and only the occluders write 0, where they
stand higher than `FRINGE.height` -- which needs no terrain lookup, because a
building, a cart, a barrel is placed with its base on the ground, so the mesh's
own LOCAL Y already is its height above it. Clearing to paintable is what keeps
the figures: they cannot go through an override material, so they write no bit,
and the grass still closes over their boots. The SDF figures are not in that set: their materials
write their own `gl_FragDepth` and an override material would hand back their
whole quad's depth instead, so a figure standing in grass does not stop the
ground behind it growing a fringe. Those stalks are farther, hence shorter, and
grass over someone's feet is what should happen anyway. The wind is the tile's
wind -- `grassWind`, one definition both halves read -- so a stalk agrees
with the lawn it rises out of. `?fringe=0` turns it off, `FRINGE` holds the
knobs (height in metres, roots per metre, the share that grow one).

### Pattern tiles (textures.js)

The flat repeating patterns of the building materials -- ashlar, brick,
marble joints, roof tiles, checker floors, parquet, gothic bands, grooves,
stars, ornament, scrollwork -- and the ground's grass are
*calculated* at startup, not drawn by hand: `bakeTiles(renderer)` renders
the same WGSL the materials evaluate per pixel (`textures_wgsl.js`,
one source of truth) over exactly one period of each pattern, 3 x 3 samples
per texel, into a texture with mipmaps and the GPU's full anisotropy. Per
pixel a material then reads the filtered tile at its world coordinates
(along the face and up on walls, x/z on floors) instead of evaluating
hard-edged steps, so thin joints fade instead of flickering at distance
and a checker floor seen along a nave no longer turns to moire. A tile
stores what the pattern does, not colours (R brightness factor / 1.5, G
accent share, B dark-figure share), so one tile serves every colour and
averaging down the mip chain averages the coloured result exactly. To
repeat exactly, the scrollwork's frequencies sit on one common base, the
gothic joints are 8 to a 6.5m course and parquet tones repeat every 16 x 4
boards. Crops (cut-outs), fruit dots (3D), wood grain (moving doors),
marble veining (smooth), the snow cover and the orientation shading stay
per pixel. `?textures=0` evaluates everything per pixel again, to compare.
`textures.html` shows the tiles; `build/textures.py` saves them as PNG
files into `texture/` for inspection -- the game never loads those files.

**Parallax** (2026-09-14). Each tile's alpha holds the pattern's relief
(`patternHeight`, the same joints: bevelled stones proud of recessed
mortar, roof courses thick at their lower edge, sunk grooves and tracery,
raised pilasters, lattice and bosses), and `TILES[..].depth` how deep it
is in metres (gothic 6cm, ashlar and roof tiles 3cm, brick 1.8cm, marble,
checker and parquet a few mm; stars and scrollwork flat). `archMaterial`
walks the view ray -- in the object's own frame, along the pattern's axes --
down into it in 8 layers with a linear refine between the last two, reads
the colour where it meets the relief (every read at the unshifted
gradients, so the mip level never jumps) and shades the deep parts a little darker. The relief is LIT: its slope (two
more reads) tilts the normal along the face's axes and the world's own
orientation shading takes it (1.8x, or the flat-lit world would hardly
show it) -- a stone's top edge catches the light, its underside goes
dark, head-on too -- and it SHADOWS itself: from the hit,
`parallaxShadowSteps` (4) reads climb toward the light that shading
implies (high, from +x and +z); relief above that ray darkens the spot,
so stones throw short shadows onto the mortar below them (faces turned
from that light skip it). The heights carry detail the colours do not:
pitted ashlar, unevenly worn arrises, chipped bricks, grainy mortar, rough
roof tiles -- value noise on a lattice that wraps with the tile
(`tileNoise`), so every tile still repeats seamlessly. Wood (doors, shutters,
planks) goes through the same walk with its relief worked out per pixel
(`reliefAt`: raised grain, 4mm, across and along the board on upright and
level faces alike), and so do the trees' trunks and boughs in the instanced
engine: `barkHeight` over the cylinder (along the axis, round it by arc
length, a whole number of ridges round so the unwrap has no seam) --
furrowed bark, ridges running up the trunk parted into plates (most
trees), or ringed, lenticel grooves across it (birch, cherry: `bark:
"barkH"` in flora.js TREES) -- a fifth of the radius deep (2.5cm at most,
twigs smooth), lit and self-shadowed like the walls. It works on a wall's faces and a floor's top only and fades
out toward 15m, where the joints are under a pixel anyway. Settings in
`config.json` (`textures.parallax`, `parallaxSteps`, `parallaxFar`),
`?parallax=0|1` to compare. Cost at a worst-case glancing view (a wall
filling half the screen, measured in the headless software renderer):
about +9% of the frame's GPU time.

Buildings and carts take part in the same outline switch: every part gets
a backface-only hull copy whose per-vertex inflation direction is baked
from a slightly larger re-generated primitive (exact at box corners), and
the vertex shader pushes it out by one pixel's worth of metres at its
depth, so the rim is one pixel wide near or far. With outlines off the
hull meshes are hidden and cost nothing.

Buildings use conventional geometry (they're mostly boxes and extrusions —
polygons are the right tool there) with one shared `ShaderMaterial` family:
deterministic orientation shading (`k = .82 + .2n_y + .1n_x + .06n_z`
substitutes for lighting, on the world normal), procedural patterns (ashlar, brick,
marble, roof tiles, grooves, star fields, scrollwork, gothic wall
articulation, checkerboard floors, ornament lattice, wood grain) in the
OBJECT's own frame -- geometry position and normal, an instance's scale
folded in -- so a barge, a cart or a swinging door carries its texture and
every orientation gets the same pattern (buildings are placed by translation
only, so for them object frame = world frame), a shared `SNOW`
uniform that whitens upward faces, and per-part millimeter inflation so no
two components ever share an exact plane (z-fighting). Stained glass is a
single translucent shader drawing a diamond lattice in the same object frame.

## Tubes and the half-resolution pass (composite engine)

A third primitive beside the rounded cone and the triangle: the **tube** (`shape: "tube"`,
`size: { a, c, b, r1, r2, bulge }`) -- a quadratic Bezier centreline a -> (control c) -> b whose
radius runs r1 -> r2 plus `bulge * 4t(1-t)`. Per pixel: the nearest curve parameter in the
projection plane (iq's cubic, `bezierT` in banner.js), the silhouette distance there, and along the
ray the sphere of the tube's radius at that point for depth, texture and shading (a tangent frame
placed so patterns run along the curve). The end radius and bulge are packed into b's radius slot
(`-2 - (r2 mm + 4096 * bulge mm)`; a triangle's is -1). A swan's S-neck is two tubes, a snake four,
a fish, dolphin or shark body one straight tube with a bulge (a spindle); the crocodile is three.
The banner/instanced engines draw a tube as the capsule a-b, the mesh engine as a THREE tube.
`partExtent(part)` (species.js) is the one reader of a body part's girth and length.

Stage 5 of the pipeline, **half resolution** (`PIPE.half`, Shift+M, `?half=0`): figures whose
nearest part is within `PIPE.halfDist` (12 m) are left out of the main pass and drawn by its twin
into a half-size buffer (colour + 24-bit depth). Its alpha holds the EDGE AS A DISTANCE -- a ramp
through the silhouette (1/2 on it) -- and two buffer pixels past the edge still carry real colour and
depth; one full-screen blit upsamples it bilinearly and thresholds the ramp at 1/2 with one screen
pixel of smoothing: crisp, anti-aliased edges that never go see-through (a coverage fade made thin
parts ghostly and ringed the heads). A quarter of the pixels where figures fill the screen.
The fish, dolphins and sharks moved from the instanced herd to a composite one (their tube bodies
are exact only there; elsewhere a tube falls back to a capsule at its mean girth).

## Depth through any projection

Every SDF shader (banner, instanced, composite and its passes) writes its pixel depth with
`viewDepth(projectionMatrix, pv)` (banner.js): the view-space point through the FULL projection, not
the plain-perspective shortcut -- a mirror's camera (three's Reflector) tilts its near plane onto the
glass, and only the full matrix puts the figures at the same depths as the meshes around them; a point
before the (tilted) near plane returns -1 and is discarded (behind the glass, or too close).

## What a frame walks (and why it used to walk it five times)

A frame here renders the scene five times: the grass mask's three draws (`grass.js`), the occluders' depth
(stage 3b) and the picture itself. Every `renderer.render()` walks the WHOLE graph before it draws anything --
world matrices, visibility, frustum tests, render list, bind groups -- and this world is about 1100 objects,
so that was 5600 object visits a frame whatever the GPU was doing. Three things fixed it, none of which
changes a pixel (the probe compares the picture):

- **One matrix walk a frame.** `scene.updateMatrixWorld()` is called once in the tick and
  `scene.matrixWorldAutoUpdate` is then false for the rest of the frame: nothing moves between the passes, so
  the other four walks were re-deriving matrices that were already right.
- **The occluders are a flat list, shared.** Stage 3b and the grass mask's first pass draw exactly the same
  set -- everything on `OCC_LAYER` -- so `occluderScene(scene)` (composite.js) keeps that set as a scene of
  its own: the same objects, no hierarchy to recurse, gathered with `traverseVisible` and re-gathered when the
  world changes or every fifteen calls.
- **The mask's other two passes have their own lists too.** They draw six objects and one; they were walking
  eleven hundred to find them.

**The buildings' colour rides in their vertices.** `buildBuilding` has always merged a building's parts by
MATERIAL -- but a material was keyed by colour, so a farmhouse of thirty-nine colours stayed thirty-nine
meshes, each of them an object to walk five times a frame and a draw call when in view. The shader is the same
for all of them; only two vec3 uniforms differed. So `paintGeometry` writes the colour and the accent per
vertex and `archMaterial(side, pat)` is keyed by what actually changes the shader. The world went from 1117
objects to 751 (953 drawable to 587), and the picture is the same to within one cell of the probe's ASCII
frame -- that one being two coincident surfaces whose draw order changed when they landed in the same mesh.

This is also the answer to "why not instance the village": with colour out of the material, what is left
between two walls is their shape, and the generators give every wall its own. True instancing would mean
building the village out of a few unit primitives (a box, a right-angle prism) with the transform, the size,
the colour and the pattern as per-instance attributes -- and then the pattern has to be evaluated in the
INSTANCE's space (the shader reads `positionGeometry`, which for an InstancedMesh is the unit primitive, not
the wall). That is a real rewrite of architecture.js, and it would trade per-object CPU for lost per-building
frustum culling, so it is worth doing only if the frame's cpu line says CPU is what runs out.

**The buildings have no outline geometry any more.** The 1px outline is off by default and is the world's one
option, but every building generated a backface hull copy of every part regardless -- 81 meshes and 220k
triangles, built, walked and never drawn. Removed: `outline: false` in a part definition is now inert, and the
switch (Shift+O) reaches only the SDF engines, whose border is a line in the shader and costs no geometry. The
probe checks it: switching the outline on must not add a single mesh to the world.

**One glass material for every window**, its colour in the vertices like the walls'. `glassFor(color)` used to
cache a `MeshBasicMaterial` per pane colour -- about sixty materials, one mesh each. The tableware's drinks
were the same mistake (a material per vessel for a sixteen-triangle disc) and are now one per drink. World
materials: 385 building + ~60 glass, down to 18 + 1.

**Merging (merge.js)** joins parts that share a parent and a material into one mesh, and refuses anything that
is not already at identity -- the building shaders read the LOCAL position and normal, so baking a transform
would move their planks and stone courses. In this world it finds almost nothing (every part is generated with
its own material, and the buildings are placed by group transforms, so nothing repeats), which is itself the
answer to "why not instance the village": there is nothing repeated to instance. It stays for the worlds where
there is, and `?merge=0` switches it off.

**Merging ACROSS buildings (merge.js `mergeAcross`).** A building is a parent, so the merge above stops at every
house -- and after it a village is still a few hundred meshes. But the site buildings differ from one another by
a translation alone, never move and are kept by nobody, so parts that share a material are joined across them,
per 96 m cell of ground (one mesh for the whole world would never be culled). The pattern problem is solved, not
dodged: the merged vertices carry their ORIGINAL local position in an `aLocal` attribute and the building material
has a `placed` twin (architecture.js `placedMaterial`) that reads its pattern frame from it -- bit for bit what it
read before. The village goes from 686 objects in the graph to 565 and the picture is pixel-identical (`?across=0`
to compare).

**Small things far away leave the graph (farhide.js).** A frustum test stops a mug being drawn, not being
visited -- in every one of the frame's scene renders. Each site's tableware and the palace's paintings are now ONE
group per place, switched off past the distance at which they cannot amount to a pixel (45 m / 70 m plus the
place's own size, four checks a second, a tenth of hysteresis). From the green, three of the four groups are off
and the occluder/grass-mask list drops from 470 objects to 303 (`?farhide=0` to compare).

**Measuring this headless is a trap.** Under the software GPU the same configuration's median "draw submit" ran
4.9 ms in one run and 13.0 ms in the next -- the rasteriser shares the CPU with the page. Object and list counts are
the honest headless metric; milliseconds want the real GPU (`__dbg.profile()`, or `?prof=1` with its
`PROFILE-MEDIAN` line, which skips the warm-up frames where pipelines compile and the paintings are taken).

**The ground is tiled and tessellated to its error (terrain.js).** It used to be one `PlaneGeometry` of
400x400 cells over the whole world: 320,000 triangles, the heaviest geometry in the game by an order of
magnitude, drawn three times a frame and never frustum-culled -- a mesh that spans the world is always on
screen. But `groundH` is a long, smooth swell (wavelengths of 145 to 700 metres) with a few sharp things cut
into it: every building's plot levelled flat with a 2.5m transition, the river's 16m groove, the moats, the
lake rim. A uniform grid paid the same price for empty meadow as for the village, and still sampled the
village more coarsely (4.2m cells) than the features deserve.

Now each tile is sampled on a lattice and given the coarsest subdivision whose flat cells stay within 0.15m
of the real ground: **3.3m cells where the ground is carved or levelled, 13 to 26m over open swell**.

| | before | after |
|---|---|---|
| ground triangles | 320,000 | **134,656** |
| triangles in the frame (spawn view) | 6.11M | **4.17M** |
| ground draws | 1, never culled | **64 blocks, frustum-culled** |
| build | 1.26s | 2.4s |

Two things make the LOD invisible, and both are load-bearing:

- **Normals come from `groundH`, not from the triangles.** One lattice per tile with a row of halo serves
  three purposes -- the error verdict, the vertices' heights, and central differences for the normals. Every
  tile samples the same world lattice, so a neighbour's first interior point is this tile's halo point and two
  tiles at different subdivisions compute the *identical* normal along their shared edge.
  `computeVertexNormals` would have drawn a crease along every tile border.
- **The finer side follows the coarser one's line** (2026-09-28). A coarse tile's edge is a straight chord
  between its own vertices, and its finer neighbour's border vertices between them sat on the ground, above or
  below that chord: a sliver of sky along the join. The coarse triangle cannot bend, so the fine side gives way:
  every tile is sampled and its subdivision chosen first, then each is built knowing its neighbours', and a
  border vertex facing a coarser neighbour takes the height of that neighbour's edge at its place (the coarse
  vertices are lattice points of the same world lattice, so both edges are then the same line). Checked on 44
  mixed borders, down to 5 vertices against 33: the worst difference along any border is 0.000 cm.
- **Skirts**, still: a shallow curtain from every border, emitted with whichever winding faces outward (tested,
  not assumed -- a skirt culled by its winding hides nothing). With the borders matched it only covers what the
  rasterizer may leave along a T-junction, a pixel here and there.

Checked against the old grid, same viewpoint, clock pinned: the village and river view differs on **0.74% of
pixels**, the aerial view on **0.13%**. At ground level ~19% of pixels differ, all of it the grass fringe
choosing different individual blades (their root cells shift with the ground's interpolated height) -- the lawn
itself is the same. `?terrain=grid` brings the old grid back for comparison and `?terraintol=` sets the error
budget in metres. Sampling the whole world at the finest cell is the floor on the build cost: to know where
the ground needs 3-metre cells you have to look at it at 3 metres.

**Stage 3c is on by default now.** The figures write their own depth, so the hardware cannot reject them
early; the bound pass marks a stencil where a figure is not definitely behind the world and the real pass
tests that mark. The performance lab's self-check proves it changes no picture in the open and leaves nothing
of a figure behind a wall. `?stencilcull=0` to switch it off, `=show` to paint the mask.

**The frame-cost readout** (top bar) now reads like the lab's: fps, the real ms/frame, and then cpu (the
tick's own JavaScript), gpu (the device's own time for the draws) and rest (waiting -- for the display, the
present, the GPU). They are separate on purpose: adding cpu and gpu counts the same wall clock twice, and they
overlap, so the budget percentage is judged on the longer of the two.

## Open: stalks painted over water (the streaks near the origin)

Standing near the origin and looking across the lake, the grass fringe paints long thin streaks over the
water. What is established, by measurement rather than by eye:

- **The water is real.** Within 140m of the origin the ground runs from -8.8m to +1.9m and 250 of 3249 samples
  are below the water level; the lake sits at (18, 157) with a 70m radius, and there is one moat. The sheet is
  the lake seen almost edge-on, not a stray plane.
- **It is not the terrain rewrite.** The same water area appears with `?terrain=grid` (31,512 pixels against
  33,280), so it predates the tiles.
- **The streaks are the fringe.** With `?fringe=0` the water is clean.
- **The mask believes that water is grass.** `?fringe=alpha` reads 255 (grass) over ~26,000 of the water's
  33,000 pixels, and the mask's distance channel there decodes to roughly 140-180m -- the lake's own distance.

Two fixes were tried and neither held, so neither is in the code:

1. **A fourth mask pass** stamping the water as "nothing may be painted here" (`MASK_BLOCK_LAYER`, layer 6,
   still reserved). With a depth test the stamp is rejected; without one the world-spanning water plane blacks
   out the fringe everywhere; placed before the ground pass, the ground pass re-marks the same pixels as grass.
2. **A reach rule** in the fringe -- a stalk may not be painted over a surface more than four times its root's
   distance away. It never fires at the streak pixels, which means the model of which mask texels feed those
   streaks is still wrong: the streaks are far too long (a third of the screen) to be rooted at the distance
   the mask records there.

The next step is to work from the exact spot rather than a viewpoint picked from outside: the frame-cost line
now carries the camera's position, and `?eye=x,y,z&look=x,y,z&sweep=N&shot=N` puts the headless probe there.

## The ground is built on another thread

`groundH` is asked a few hundred thousand times to build the terrain -- about 2.4 seconds of arithmetic -- and
none of it touches three or the DOM. So it runs in a worker (`terrain_worker.js`) while the main thread lays
the world out, and the ground appears when the arrays arrive. Nothing waits on it: `groundH` itself is on the
main thread, and it is what the walking, the placing and the collisions ask.

Three pieces make that possible, and each is worth keeping straight:

- **`ground.js`** holds the shape of the land -- the lake's C, the river's groove, the moats, and the height
  function that carves them -- as a factory over plain data (two numbers and two lists). A worker cannot see
  index.html's closures, and a second copy of the terrain's shape would be the worst kind of duplicate, so
  there is exactly one and both threads import it. The lists are read by reference, so the world can keep
  filling them in as it lays itself out.
- **`terrain_data.js`** is the arithmetic with nothing of three in it (import maps do not reach workers, so a
  worker cannot resolve a bare `three` specifier at all). `terrain.js` is the thin half that wraps the arrays
  it returns in meshes.
- The arrays come back **transferred**, not copied.

Verified: the probe's picture is byte-identical to the same build without the worker, which is the proof that
the worker's height function and the main thread's are the same function.

## Two counters that were lying

- `renderer.info.render.calls` is a **lifetime** total in three; only `render.drawCalls` is per frame. The
  readout was showing the former, which is why it climbed into the thousands and never came down.
- An app that drives its own animation loop -- this one does -- must call `renderer.info.reset()` itself.
  three only calls it from `Renderer.start()`, the loop we do not use, so even the per-frame counters never
  cleared. Reset is now the first thing `tick()` does.

With both fixed the readout is flat at ~144 draws a frame, and geometries, textures and heap are flat over 75
frames: nothing was leaking, the number was lying.

## A typed array will drop a write and say nothing

The terrain's skirt allocates one dropped vertex per border vertex: `4 * (seg + 1)`, not `4 * seg`. It was
written as the latter, so the last vertex of each of the four borders fell off the end of the arrays --
silently, because an out-of-range write to a typed array is a no-op -- and the triangles that referenced those
indices read **zeros**: black, and anchored at (0, 0, 0). On screen that was long black wedges fanning out of
the origin across the meadow, which is a strange enough picture to be worth remembering as a symptom: geometry
that is black AND converges on the world origin is an index running past the end of a buffer.

## The geometry view (T), and the simple SDF

**T** in the game shows what the picture is made of, in the two kinds this world has:

- **red lines: triangles.** Every mesh's triangle edges, baked once into a single `LineSegments` when the view is
  switched on. Two things make it usable. It is built **nearest first** — the world is over a million triangles and
  the budget is `WIRE.max` (900 000 edges, about 300 000 triangles), so what gets in is what you are looking at; and
  every vertex is pulled `WIRE.bias` (0.4 %) of the way to the eye, or the lines sit exactly in the surfaces they
  outline and z-fighting eats them. Without the nearest-first sort the budget went on the terrain and the buildings
  had no edges at all.
- **blue rectangles: SDF banners.** Each banner shader draws a hairline round its own quad when `outline.js QUADS`
  is on — `banner.js` (single props, clouds), `instanced.js` (herds, plants) and the composite engine (near
  figures). The card's EDGE only, never a fill: a filled card hides what it covers, and one quad with a bad extent
  filled the screen. The line is drawn at the quad's own plane depth — returning 0 there puts it on the near plane,
  which is the same bug in a different dress.

A banner's corners are worked out in the shader from the camera and the part's ends, so nothing on the CPU knows
where they are: that is why the cards must draw themselves and cannot join the line set.

**What you see per figure.** A near figure is ONE card, but that card is cut into up to `PIPE.cells` × `PIPE.cells`
(8 × 8) screen cells, each carrying the short list of parts that touch it — which is what keeps the per-pixel loop
short, and what makes a person look like a grid of small rectangles in this view. `?cells=1` gives one card per
figure. A distant animal, a tree or a plant is the instanced engine instead: one card per PART, each capsule its
own banner (perf_lab's K key is the same question asked as a measurement: 1, 2, 4 or 8 shapes per banner).

**The simple SDF.** `PIPE.blend` is now **off** by default: parts no longer melt into one another with a smooth
union — a leg meets the belly along a crease. It costs less two ways (the `smin` itself, and the padding every
screen cell has to put round every part so that a part can reach beyond its own outline), and `?blend=1` brings the
fillets back.

## A merge that moved things to the origin

`mergeStatic` refuses any mesh that is not at identity — it concatenates geometry verbatim, so a mesh with a
transform of its own would be baked in the wrong place. The test read `o.matrix`, and **three only recomputes that
when it walks the graph to render**: the merge runs before the first frame, so every mesh that had just been given
a position still carried the identity there, passed the test, and was baked at the world's origin.

In this world that was the fountain: its pool, its two basins and its jets are meshes positioned straight onto the
scene (they are live-water shaders, not building parts), and they ended up 97 m away from the fountain, at 0, 0, 0
— a dome of ripples sitting on the grass by the path. Both merge passes now call `updateMatrixWorld(true)` first.

The cost of the fix is nothing: `mergeStatic` merged exactly two groups in this scene before, and those two groups
were the mis-placed water. The merge that earns its keep is `mergeAcross` (206 meshes → 103), which was always
honest because it updates each group's matrix itself.


## What the grass fringe costs (and why it is off by default now)

Measured on a quiet machine, the whole town with 40 animals, one browser per run, best of two:

| | CPU a frame | draw submit | grass mask | GPU |
| --- | --- | --- | --- | --- |
| fringe off (the default now) | **8.59 ms** | 4.41 | 0.01 | **7.79 ms** |
| fringe on | 11.15 ms | 5.18 | 2.57 | 11.61 ms |

So the stalks cost **2.6 ms of CPU and 3.8 ms of GPU** — a quarter of the frame on each side. The CPU half is the
mask's three draws (the occluders' depth, the ground, the blockers); the GPU half is mostly the full-screen blade
quad, which is why skipping the mask on alternate frames would recover only about a fifth of the total: the quad
is drawn every frame regardless.

`config.json renderer.grassFringe: true`, or `?fringe=1`, brings it back. Nothing else breaks without it: the
composite engine's occlusion cull borrows the mask's depth buffer when the fringe is on (`occluderDepth()`), and
falls back to rendering its own when it is off — and occlusion is off by default anyway.

The measurement lesson that came with it: the first numbers taken for this (4.5 ms of mask, 16.6 ms of draw
submit, "100 µs a draw call") were taken on a machine with leftover browsers on it and were wrong by 3x. One
browser per run, killed by PID afterwards, and each configuration measured twice with the baseline repeated last.

## Render bundles: measured, and they do not pay here

A WebGPU render bundle is a recorded list of draws replayed as one call: the commands still go in every frame --
a GPU remembers nothing of the last one -- but what three does per object on the way there (world matrix, frustum
test, render-list entry, bind group, pipeline lookup) happens once instead of once a frame. three exposes it as
`BundleGroup` with `static = true`. The static world is the obvious candidate: buildings and ground never move.

Built it (`?bundle=1`, index.html): everything at the top of the scene that is not flagged `moves` / `noMerge` /
`sdf` / `screen`, and is not one of the things the file animates by hand (doors, carts, windmill sails, water
wheels, fires), grouped by 96 m cell -- 28 cells holding 89 top-level objects. Whole town, 40 animals, grass off,
on a quiet machine:

| | CPU a frame | draw submit |
| --- | --- | --- |
| no bundles | 8.56 ms | 4.34 ms |
| bundles, each cell shown/hidden per frame by its own box | **10.72 ms** | 5.89 ms |
| bundles, no visibility toggling | 8.48 ms | 3.99 ms |
| one bundle for the lot (`?bundlecell=100000`) | 8.81 ms | 4.18 ms |

Two things to take away. **Toggling a BundleGroup's `visible` costs more than the bundle saves** -- 2.2 ms a frame
for 28 groups, because three re-records a bundle it has to bring back. And with the toggling gone the gain is
0.08 ms, which is noise: the per-object work bundles skip is work `ONE_MATRIX` had already taken out of the frame
(the world's matrices are walked once, and three is told not to walk them again).

Note also that `renderer.info.render.drawCalls` drops from 91 to 50 when bundles are on. That is the counter not
seeing replayed draws, not fewer draws -- do not read it as a win.

Left in behind `?bundle=1` with the measurement written down, because the idea is sound and someone will think of
it again; the reason it does not pay is particular to this frame, not to bundles.

## What a draw costs, measured (three 185, this machine)

`ref/drawbench.html` in the session scratchpad draws 100 boxes 240 times and varies one thing at a time:

| what each material carries | µs a draw |
| --- | --- |
| one `MeshBasicMaterial`, shared | 7.2 |
| its own node material, nothing live | 10.0 |
| + 10 STATIC uniforms | 7.7 |
| + 20 static uniforms | 7.9 |
| + a node graph 200 nodes deep | 5.0 |
| + 1 `onRenderUpdate` uniform | 10.6 |
| + 5 | 19.8 |
| + 10 | 29.6 |
| + 20 | 47.2 |
| 20 live uniforms, but the same NODES shared by every material | 14.0 |
| the same, in a shared `uniformGroup` | 9.3 |
| 900 extra objects that are walked and culled, never drawn | +0.34 µs each |

So: the floor for a draw is **8–10 µs**. Static uniforms are free. A deep node graph is free. Culling is nearly
free. **A live uniform costs about 2 µs per draw**, every draw that uses that material, every frame -- and the
cost goes away if the uniform NODE is shared between materials rather than made per material.

That is why `banner_wgsl.js U` exists (the instanced engine has one `uniform(` call in the file), and the same is
now done in banner.js and composite.js: their `outline`, `quads`, `full`, `nearDist`, `halfDist`, `occOn`,
`occBig` and `px3` are made once for the file instead of once per part or once per herd. Measured in the world,
that came out inside the noise (draw submit 4.61 -> 4.52 ms), because those materials were already sharing within
a herd; it is kept because it is the pattern that avoids the cost, and because a new live uniform added per
material -- which is what `quads` was when the geometry view was written -- would otherwise be a tax on every draw.

**What was unexplained** was that the world paid about 70 µs a draw where the bench's floor is 10, and neither
the object count (412 walked, 326 culled, ~0.1 ms) nor the live uniforms (4–16 µs of it) accounted for the gap.
A DevTools profile of a real frame pointed at `GPUQueue.writeBuffer` under `updateAttribute`, and the answer was
not the draws at all:

## The draws were not expensive -- the frame was re-uploading buffers that had not changed

`ref/writes.html` and `ref/dirty.html` (scratchpad) wrap `device.queue.writeBuffer` and the `needsUpdate` setter
on `BufferAttribute.prototype`, and count both per frame. Before:

    writeBuffer 112 calls a frame, 4151 KB a frame (182 MB/s)
    attributes actually MARKED needsUpdate: 1133 KB a frame

Three megabytes a frame were being uploaded that nobody had marked dirty. The reason is one line in three's
`Attributes.update` (WebGPU backend, r185):

```js
if ( data.version < bufferAttribute.version || bufferAttribute.usage === DynamicDrawUsage ) {
    this.backend.updateAttribute( attribute );
```

**`DynamicDrawUsage` means "upload this whole buffer on every draw", version or no version.** The flag reads like
a hint about memory placement (it is, in WebGL); here it is an unconditional re-upload. The banner herds set it
on `aA`/`aB`/`aC`, and the biggest herd by far is the FOREST -- 82,788 parts, three 970 KB buffers -- which is
written once, at world build, and then stands still for the rest of the run. 2.9 MB a frame went up the wire for
trees that do not move.

The other half was the opposite mistake. `needsUpdate` with no update range uploads the WHOLE array, and both
engines allocate generously and fill a little: a composite herd has room for 4096 figures (`MAXA`) and carries a
handful, so each of the ~14 herds sent a 64 KB `aBound` a frame to move a few hundred bytes of bounding spheres.

The fix is `touch(attr, count)` (composite.js, used by both engines): clear the ranges, mark the used prefix,
bump the version. The backend clears the range once it has uploaded, so a later pass in the same frame finds the
version current and sends nothing at all. `DynamicDrawUsage` is gone from instanced.js -- with it there, ranges
make things WORSE: the first draw uploads the range and clears it, and every later draw in the frame re-uploads
the lot.

| defaults, 1100x700, best of two | CPU a frame | draw submit | ms/frame | writeBuffer |
| --- | --- | --- | --- | --- |
| whole-buffer uploads | 13.99 ms | 6.88 ms | 19.46 | 4151 KB a frame |
| used range only | **10.51 ms** | **4.68 ms** | **17.29** | **188 KB a frame** |

A quarter of the frame's CPU, and a third of "draw submit", was buffer traffic; 22x less of it goes up now. The
per-draw figure fell from ~72 to 44.7 µs with the draws themselves untouched -- which is the lesson: "draw
submit" in this renderer is where attribute and binding uploads are paid, so an expensive draw is usually an
upload wearing a draw's clothes.

## The same waste in the textures: only the rows that changed

The composite engine keeps each herd's parts in a float texture (`dyn`, 3 texels a part, 1024 texels a row) and
`sync()` marked it `needsUpdate` -- and three has no update range for a texture in r185, so that sends the whole
thing. `__dbg.herds.map(h => h.stats())` (`ref/herds.html`) says what is in them, standing in the village:

| animals | shown | parts | rows a sync writes | uploaded |
| --- | --- | --- | --- | --- |
| 237 | 70 | 6598 / 9480 | 14 / 28 in 3 runs | 448 KB |
| 305 | 41 | 4332 / 7936 | 10 / 24 in 3 runs | 384 KB |
| 144 | 0 | 4120 / 6912 | 0 / 21 | 336 KB |
| 42 | 2 | 1640 / 1640 | 1 / 5 | 80 KB |
| ...9 more | | | | 16-32 KB each |

1424 KB a frame for 448 KB of change: the pose variants a villager is not wearing, figures the camera cannot
see, and whole herds with nobody shown at all (the third row sent 336 KB a frame for an empty picture).

`sync()` now marks the rows it writes (`markDyn`) and `uploadDyn()` sends those runs through the backend's own
`device.queue.writeTexture`, leaving the texture's version alone so three sends nothing of its own. The first
frame and the frame after a reallocation still go through three -- the GPU texture has to exist first.

| | writeTexture | CPU a frame |
| --- | --- | --- |
| whole texture a herd | 14.0 calls, 1532 KB, 1.06 ms | 10.51 ms |
| the rows that changed | 11.6 calls, 604 KB, 0.82 ms | **9.74 ms** |

Worth knowing what these calls cost before trying to be clever about them (`ref/texbench.html`, plain WebGPU, no
three): a `writeTexture` of one 16 KB row costs 33 µs, of 512 KB 718 µs; eight calls of 4 rows cost the same
740 µs as one call of 32. So the cost is VOLUME, roughly 1.4 µs per KB, on a per-call floor of about 16-25 µs
(`writeBuffer` is about half that per byte). Splitting an upload into runs is therefore nearly free, and there is
nothing to be gained by merging runs into one span that also carries clean rows.

Since the session started, these two changes together: CPU 13.99 -> 9.74 ms a frame, draw submit 6.88 -> 4.59 ms,
uploads 4151 -> 196 KB of buffer and 1532 -> 604 KB of texture.

## The shell engine: the figures as polygons (?shell=1)

An alternative to evaluating the figures per pixel: draw the same parts as GEOMETRY -- cuts along an axis, a
ring of N points per cut, triangles between neighbouring rings, which is what a lathe would turn and what
arch.js does for a vault. Once the shape is triangles the hardware does the work it is built for, early-z
lives, no shader writes its own depth, and the surface normal is exact and free.

It is not a second world. Every part, pose and colour comes from the composite herd that owns it: the skeleton
walk, the world mirror, the dyn/stat textures, the culling and the per-frame upload are already there, and
shell.js reads the same texels the fragment shader reads. The quad stays (it is what syncs the data) drawing no
instances; the half-resolution twin, the 3D pre-pass and the stencil bound have nothing left to do.

**One lathe per CHAIN, not per part.** A body is not one cone: a crocodile is tail, body, neck, head and snout
laid end to end. Two shells that each cover the joint land on the SAME surface and fight for the depth test --
that is what made the deer look see-through, a texture of polygon-shaped patches where the two surfaces
crossed. So the parts that run end to end along one axis are found once per species and swept as ONE continuous
mesh: `u` walks the whole chain, the profile follows each part in turn, and the colour crosses each joint as a
short gradient. Limbs, horns, ears and garments are chains of their own -- one main axis, the limbs separate.

**The surface.** Each ring is a cut square to the local axis, centre and radius interpolated along the part;
then TWO NEWTON STEPS put it on the true smooth union of the chain's own parts and the few parts of other
chains it touches, `P -= n * smin(own, neighbour, k)`. The SDF is unit-gradient, so a step lands on the surface
and the second cleans up the taper and the fillet, and the step is clamped to 60% of the local radius so it
stays a correction. The normal is mixed by the same weights, which matters more than the silhouette: without it
two lobes still read as two, because the shading breaks at the seam. What the SDF pays per pixel, this pays per
vertex. Where two separate chains do both cover one fillet, the higher slot sinks 1.5 mm so the depth test has
a deterministic winner.

**Two things that had to be learned the hard way.**
  * A chain must be worked out from the POSED endpoints (`herd.ends`). A compiled part's own `pA`/`pB` are in
    its OWN frame, relative to its pivot -- "this part's B end sits on that part's A end" is not a question
    local coordinates can answer. Asked there, it chained a head to a tail and swept a sail between them.
  * The ring frame must be the CHAIN's, not the ring's. A frame built from each part's own axis turns by a
    different amount at every joint, the rings stop lining up, and the strip between them spans the chain in
    long spikes. One reference direction across the chain, squared to the local axis per ring, fixes it.

**The parts that are not round.** A triangle (an ear, a fin, a wing membrane) is a flat EXTRUSION -- two flat
faces a hair apart with a rim band between them, the rim following the triangle's own edges: an ear is a plate,
not a pillow. A flat part (a garment slab) is squashed to C.x of its width along the figure's forward, as the
SDF squashes it. A cut (a garment's slab along its own axis, C.x..C.y metres from its A end: a skirt at waist
and hem, a hair cap at the hairline, a brim) clamps the rings onto the cutting planes, which leaves the flat
cap the "solid" cut asks for. A tube is the capsule between its ends at mean girth. A bone (k < -.5) and a face
mark (an eye, a nostril -- painted onto the head by the fragment shader, and its A.w is the mark's reach, not a
radius) are left out.

**The chain's own profile: each part's shape, smoothed only at the hand-over.** Away from a joint a part keeps
exactly the centre line and the girth it was given. At a joint the sweep reaches the JOINT's own point and
girth -- the average of the two ends that meet there -- and leaves again from it, so both spans agree and no
crease is left. Two earlier versions of this were worse and are worth remembering: a Catmull-Rom spline through
the joints carries a chest's girth all the way down a neck (and a mane lying along that neck disappears inside
it), and extrapolating each neighbour's cone into this span squeezes a short part from both sides (a horse's
head shrank until its muzzle floated free).

**The torso is a SPINE, in the data** (mammals.js). It used to be two lobes -- a rump capsule along x and a
chest ellipsoid crossing it, overlapping in the middle. As an SDF those melt into one body; as geometry they
are two shapes at right angles, and no sweep can make one lathe of them, so every quadruped read as two balls
stuck together. No linking rule can fix that: the data has to say what the shape is. The same measurements now
describe a chain -- the rump keeps its capsule (it is the root, and every other part hangs off its frame) and
from its front end the torso continues as cuts laid end to end to the front of the chest, each cut's girth what
the two ellipsoids actually have at that station, softened (a hard max of the two leaves a wasp waist between
the shoulders and the hips). Both engines gain it: the SDF draws the chain as a smooth union exactly as it drew
the two lobes.
  Three rules keep those chains honest. A LIMB IS NEVER A CONTINUATION of the torso (the torso's cuts carry
`spine`, and a spine part only chains with another) -- without it a bear's torso reached down and swallowed a
hind leg. A link must go FORWARD: "their end caps touch" alone will happily link an elephant's chest back to
its rump and swallow everything between. And the chain's parts must run the same WAY: a pillPart's posed axis
runs from its second point to its first, so the spine is built back to front, or it will not join the rump it
continues.

**A ball is not a segment.** A chain caps only its two ends, so a part with no length of its own -- a head
modelled as a sphere, a joint blob -- loses its roundness inside one and becomes a bulge on its neighbour.
Those keep their own shell. (And a zero-length part divided by its own length collapsed the ring frame
entirely, which is what made the head vanish in the first place.)

**A limb bends hard and is still one limb.** The chain test asks that the next part carry on in roughly the
same direction; at 53 degrees a horse's hind legs stayed two shells apiece while the front ones swept as one,
and the back legs read differently from the front. Only a right angle or worse now breaks a chain.

**A TUBE** (a tail, a fish, an elephant's trunk, a hydra's neck, an antler) follows its own quadratic curve at
its own girth profile, rather than the mean-girth capsule the banner engines draw -- which is what made tails
far too thick. It is never swept INTO a chain, because the chain sweep draws straight spans and a tube is a
curve; but it IS a neighbour like any other, met at the girth of the capsule it is closest to. Leaving tubes
out of the fillet as well as out of the chains is what made an elephant's trunk, a reindeer's antlers and a
hydra's necks read as separate pieces stuck to the animal rather than growing out of it.

**The fillet, and only the fillet.** Where another chain comes within a part's blend radius the surface bulges
out by at most k/4 from each side, which is the smooth union's fillet and nothing more. It must NOT be pushed
out to the union itself: a horse's neck then swells out to the surface of the mane lying along its crest and
swallows it. Where a vertex is INSIDE a neighbour it is covered by that neighbour's own shell and is left where
it is. The blend radius is the part's OWN k, not the wider of the two -- a mane asks for .3 m, and taking the
wider one bulges the whole neck by a quarter of that. Both sides build the fillet (suppressing one leaves a
muzzle floating off its head); the one that gives way -- decided on the CPU and carried in the SIGN of the
neighbour slot, because chains interleave and part slots alone cannot settle it -- sinks 2 mm so that two
coincident fillets cannot fight for the depth test.

**A colour boundary is not a continuation.** A lathe has one colour per cut, so chaining a crocodile's pale
belly plate into its flank would paint the pale right round the body. Parts that do not share a colour stay
separate shells.

**A cut leaves the shape's own cross-section.** A garment's slab cut (a skirt at waist and hem, a hair cap at
the hairline, a hat brim) slides the rings beyond it flat onto the cutting plane. Leaving their radius alone
gives a disc as wide as the whole part -- on a hair cap that is a ring of hair right round the face, meeting in
front of it. The disc is clamped to the girth the shape actually has at the plane instead.

**How many cuts follows how much it BENDS**, not how long it is. A horn, a skirt or a leg bone is straight and
a handful of cuts draws it exactly; a cat's tail, a swan's neck, an elephant's trunk and a snake turn through a
large angle and need them spread along the turn. `LENGTHS` are the ring multipliers for straight, bending and
curling chains, and the bend is measured once per species: the angles at the joints, plus what the girth does,
since a strong taper turns the surface even where the axis is straight.

**A bucket is uploaded only when its list changed.** What a frame writes into the instance lists hardly ever
changes: a figure that walks across the world keeps the same parts in the same slots, and only appearing,
disappearing or crossing into another detail bucket moves anything. Each value is therefore compared before it
is stored, and a bucket that came out identical is not uploaded -- it was four attribute uploads a bucket, nine
buckets a herd, every frame. CPU in the village: 10.5 -> 7.6-8.5 ms, with the face marks now in the lists.

**A bucket that is full waits.** `push()` runs inside the render -- the herd syncs in `onBeforeRender` -- and
swapping a geometry's attributes there hands three a buffer it has already bound for this frame, which is a GPU
validation error and a lost device a moment later. A bucket that runs out of room asks for more instead, and
`grow()`, called from the herd's `update()` between frames, gives it. One frame without a chain in an over-full
bucket is invisible; the crash was not.

**A membrane is a plate, and its edges are exact.** A triangle part (an ear, a fin, a wing) is a thin flat
extrusion whose rim is walked by PERIMETER, not by angle from the centroid: an angle sweep traces the right
outline but lands on the corners only by luck, so every corner is cut off by a chord and two triangles that
share an edge leave a gap along it. The cuts are shared out between the three edges as whole steps, so a corner
always falls on a cut and a shared edge is the same straight line from either side. Thickness follows the
membrane's own size, so an ear is not a slab.

**LOD, on three axes.** By distance (`SHELL.lod` = [out to N metres, rings, points round a cut], by default 14 m:
16x20, 34 m: 10x12, beyond: 6x7) by LENGTH (`LENGTHS`): a swan's neck, an elephant's trunk, a cat's tail
and a snake are long curved sweeps and want their rings spread along that length, where a stubby part is happy
with a handful -- and a tube is one part but a curve, so it counts as long. The distance is measured in CHAIN
LENGTHS, not metres, so a muzzle or an ear falls to the coarse grid while a body a hundred times its size keeps
the fine one at the same distance. Nine grids, grown on demand, most
of them nearly empty.

**Hair at a distance** (2026-09-28): a head of hair vanished a few metres off. Two chord errors together, both
about a centimetre -- and hair is a cut shell 1.2 cm thick over the scalp. ALONG the cap: a hair cap's chain is
straight, so the far grid gave it four rings, two of them for its outer wall, and the wall from the hairline over
the crown came out as one cone from the hairline to a point deep inside the skull. A cut shell (a part with
`clip`: hair, hoods, skirts, brims) now counts as curling, whatever its axis. ROUND it: seven points on the
circle leave the faces between them a tenth of the radius inside it, under the head's own points; the outer wall
of a cut shell (and its rim) is now circumscribed, its faces touching the circle from outside (`1/cos` of half
the step). Checked at 6, 16 and 40 m: the hair, a bun and a ponytail under a hat all hold.

`?shellchain=0` goes back to one lathe per part, `?shellblend=0` drops the fillets,
`?shellthin=` sets a membrane's thickness, `?shell=0` brings the SDF engine back.

| the village, 1100x700, same viewpoint | CPU a frame | GPU | draws | triangles |
| --- | --- | --- | --- | --- |
| composite (SDF) | 9.74 ms | 8.12 ms | 96 | 910k |
| shells, one per part | 10.1-10.8 ms | 4.42 ms | 83 | 900k |
| shells, one per chain | 11.3 ms | 4.99 ms | 83 | 960k |
| shells, chains + spline + length LOD | 11.0 ms | 5.16 ms | 90 | 967k |
| shells, after the shape pass (the default) | **7.9-8.2 ms** | **4.43 ms** | 89 | 934k |

The GPU cost drops by nearly 40%: on this iGPU the per-pixel union was the expensive half of the frame, and a
few hundred thousand small triangles are not. The CPU pays about 1.5 ms more than the SDF -- the instance lists
are four vec4s per chain and are written and uploaded every frame, which is the obvious thing to fix next
(they only change when a figure's visibility or detail level does).

**It is the default** (`config.json`, composite.shell). With it on, the passes that exist to make the SDF
cheaper or sharper -- the half-resolution twin, the 3D pre-pass, the stencil bound -- are not even built, and
the quad stays only because its `onBeforeRender` is what syncs the data.

**The see-through, for the third time: a WINDING bug.** A crocodile showed its pale belly through its flank,
and a leg through a trunk, with the part in front clearly nearer -- and it survived `?shellblend=0`, which
looked like proof that the shapes themselves were wrong. They were not. A Catmull-Rom derivative points
BACKWARDS wherever the knots double back (two parts of a chain that overlap along it), the rings then wind the
other way, that stretch of the shell faces inward, and backface culling simply deletes it -- so you look
straight through the body at whatever is behind. The sweep's direction is now held to the chain's own
direction, and the material draws both faces, so no winding can open a hole again. Worth remembering as a
class: with an SDF a sign error shades wrong, with polygons it makes the surface disappear.

**The caps by ANGLE.** Even steps in the height up the axis put nearly all the rings round the equator and none
near the pole, and a big round body (an elephant, a whale) ends in a point. The cap rings are spaced by angle
instead, and along a span the cuts gather at the joints (where the sweep bends and the girth turns) and thin
out along the straight middle.

**A FACE MARK IS AN ELLIPSE, AND A FLAT PLATE DRAWS IT.** This one cost three wrong guesses, so here is what
a mark actually is (composite.js markRows): centre in A, half WIDTH in B - A, half HEIGHT in C - A, all three
already laid on the head's surface; A.w is the reach its relief paints over, and **B.w is a STYLE CODE** -- the
expression's own number, not a size at all. Reading B.w as a radius is why the faces stayed blank (the code is
often a fraction of a millimetre) and why a figure sprouted shapes when it was TALKED to or struck by an arrow:
the expression changes, the code changes, and the "radius" jumped to metres. A mark is drawn as a thin plate
over its ellipse, lifted clear of the head by its neighbour's own bulge, shaded from its rim inwards -- rim,
iris, pupil -- which is the flat surface to paint on that the shape was always asking for. Marks are flagged by
a blend radius of -2 (a bone is -1): that, not a field, is what the CPU has to test.

**A mark climbs out of its PARENT, not out of whatever it is near.** An eye is painted on the head, so the head
is what it has to stand proud of. Handing it the nearest parts instead let it climb out of the HAT ball it
happened to sit inside, which put the eyes and the mouth a hand's width off the face.

**A CUT PART IS A SHELL, not a solid with a lid.** Hair, a hood, a hat's crown, a skirt, a sleeve: the rig cuts
a ball or a cone with a slab along its own axis, and the composite engine fills the cut with a flat cap -- which
as geometry is a disc standing in the middle of the head. Since a hair ball is wider than the skull it sits on,
that disc came out all round the face and the two sides met in front of it. What the shape IS -- and what
people.js calls it -- is a shell round the body: the surface between the two cuts, SHELL.skin thick, closed by a
rim at each end. A bent plate with thickness, which hugs what it covers instead of swallowing it.
  Which cuts still get a LID: the far one always (a hat's flat crown, a boot's sole, a skirt's hem -- the end
of the thing, where the SDF capped it too), and the near one when nothing solid fills it, when the shape is
kept as a thin slab (a brim, a belt: there the flat faces ARE the shape) or when its circle is small against
the shape's girth. A hairline is none of those, so it stays open and the face shows through it.

**What a solid cannot do is hide what it does not cover.** The SDF drew, per pixel, the nearest surface among
the parts covering it -- so a hat crown that stopped at .8 of the head's radius, well below the skull, still
hid the head and the hair above it. As geometry it hides nothing: the head came out through the top of the hat.
Two data fixes in people.js follow from that and are the kind to expect elsewhere: the brim and straw crowns now
start ABOVE the skull, and hair lies flat (1.015 of the head, rather than 1.1) when a hat is worn.

**A figure that has not been posed yet has no geometry.** One added in the middle of a frame -- the rider an
arrow parts from his horse -- still has zeroed rows, and drawing it stretches its shells from the world's
origin. Worse, it is usually the FIRST of its species to be drawn, so the chains worked out from those zeros
would be cached and wrong for every figure of that species afterwards. It waits a frame.

**What is not there yet.** Animals come out right. People are close -- bodies, sleeves, skirts, hair and boots
all read -- but a garment's cut still leaves dark flat caps where the SDF hides them, faces are blank (the
marks are the fragment shader's), and patterns, bands, relief and the outline have no vertex equivalent at all.

## A membrane is fatter than its triangle

The SDF draws a `tri` part as the Minkowski sum of its triangle with a sphere of radius r1 -- r past every
edge, a spherical corner at every vertex, 2r thick. The shell drew the bare triangle 2.4 cm thick, so two
panels that share an edge stopped on the same line with nothing to cover the join: a ceratopsian's frill had
slits you could see the sky through, and every membrane was r smaller than the SDF's.

Three things put it right, and the order they were found in is the useful part:

- **Offset the outline outward by r.** Neighbours then overlap by 2r along a shared edge and no seam can show.
- **But pinch the offset back at the CORNERS.** Carried all the way round -- mitred along the bisector, or on
  the SDF's own corner arc -- two plates that meet at a POINT (all three frill panels reach the apex) each
  carry their corner out in their own PLANE, and those are different directions: the apex came out as a step
  with a notch beside it. Held back over the last r of each edge (to .4 of the offset, not to nothing, or the
  outline dips into a notch between two bulged edges) both plates end on the corner they share.
- **And make it as thick as the SDF: th = r.** Two plates meeting at an angle leave a wedge between their
  planes near a shared corner; a pair of wafers left it open, and 7 cm of plate fills it from inside.

What remains is a nick a centimetre or two across right at the apex, where three panels in three planes meet
at one point. The SDF has none because its union is SMOOTHED (the frill's parts carry k = 5 cm) -- and the
shell's fillet is a chain's business, so a triangle plate takes no part in it. That is where to start if it
ever matters: let membranes into `shellNeighbours` and give the triangle branch the same smin step the chains
get, with `sdTri` for a membrane neighbour.

Worth knowing when hunting the next one: the seam was NOT in the data. The three panels share their corners
exactly, in local space and posed, which is what made it look like a shader bug -- the shapes were simply both
correct and both too small.

## A screw is a shape, not a shade

`twist` (pattern 19) paints ridges spiralling round a part's axis -- a blackbuck's horns, a ram's curls. As
paint it does what paint can: from the side the horn's outline was a straight taper whatever the light did.

The sweep now turns the ring between cuts. Its radius rises and falls with the SHADER'S OWN PHASE -- one turn
per `TWIST_PITCH` radii, exported from banner_wgsl.js and read by both, so the ridge the light draws and the
ridge the silhouette shows can never drift apart -- at an amplitude of .35 of the local girth. The normal
comes from the surface's own cross product (how the point moves round the ring against how it moves along the
sweep), which for a plain cone is exactly the `rad - ax * slope` it replaces, so nothing else changed shape.

**Cuts are what a screw is made of**, and the LOD had none to give: a chain asks for detail by its GIRTH (so a
muzzle and a body at the same distance are not the same problem), and by girth a horn is tiny at any distance
and always lands on the coarsest grid -- the spiral came out as a handful of chunky kinks. A twisted chain
asks by its own LENGTH instead (a third of it), which near the camera is 32 rings and at twelve metres is
twelve. It also counts as a curve when its ring budget is worked out, like a bend or a tube's arc.

Cost in the village: GPU 6.2 -> 6.4 ms, for the two species that have twisted horns plus the membranes'
inflation.

## Fewer draw calls (2026-09-24)

A draw call is not free even when it draws nothing: three walks the object, tests it, makes a render-list
entry and a bind group, and the frame does that five times over (the grass mask's passes, the occluders'
depth, the pictures). The village was spending a hundred and thirty of them on a town view. Where they went,
and what they cost:

| what | was | now | how |
|---|---|---|---|
| the palace's paintings | 17 | 1 | one atlas target, a cell per view, and the canvases one merged mesh |
| the mirrors' still glass | 16 | 1 | every pane in the world baked into one geometry (none of them ever moves or hides) |
| the figures | up to 21 | 2-4 | one POOL of textures and one set of swept meshes for every herd (below) |
| the doors | one apiece | 1 | an instanced mesh, as the window panes already were |
| the windmill's sail cross | 9 | 2 | the four arms and the axle baked into one wood mesh and one cloth mesh |
| the landmarks | 5-8 each | ~2 each | `mergeAcross` at 400m cells instead of 96 -- they stand further apart than that |

**The figures' pool is the structural one.** A herd used to own its part textures and its own set of detail
buckets, and the world holds a dozen herds -- the wanderers, the villagers, the village's own life, the
guards, the riders, the cart teams, the fishermen, the swimmers, the arena's cast, and the spares combat
parts figures into. Every one of them drew its own buckets. They share ONE pool now: a part's slot is a
global index (which is what the shaders always read), so a herd owns a RANGE of slots and the animals in it,
nothing more. One texture pair, one shell, one set of meshes, three or four draws for every figure in the
world.
  The frame is driven from a single quad that draws nothing: it begins the shell, lets every herd write its
poses (skipped for a herd whose figures have not moved and whose camera has not), then lets every herd hand
over its chains -- that half always runs, because the buckets were cleared at the start of the pass and a
herd that skipped would simply not be drawn -- and ends it.

Measured, same three views: the town centre 131 -> 77, the temple row 131 -> 97, the village 119 -> 102, the
herd's own view 89 -> 69. GPU unchanged at 6.7 ms.

**What is left**, in order: the terrain's visible tiles (9), the landmarks' materials (each pattern is its own
material, so a building is one draw per pattern it uses -- an atlas or a texture array would make them one),
and the props.

## The model audit: what a solid engine finds that an SDF hid

`ref/audit.html` (session scratchpad) poses every species once -- no pictures -- and measures the three faults
that only show when the figures are geometry:

* **FLOATS**: a part whose nearest neighbour's surface is more than a couple of millimetres away. The SDF's
  smooth union closed such gaps and its per-pixel compositing hid the rest; as solids they are a tail or a horn
  hanging in the air. Found and fixed: a smilodon's tail (3.9 cm clear of the rump), a unicorn's horn (3.6 cm
  clear of the skull), a peacock's legs (.7 cm), a hedgehog's nose (.4 cm), a dog's tail (.3 cm).
* **STEPS**: an end-to-end joint where the two girths differ by more than 1.8x. Most are anatomy -- a head IS
  wider than a neck, a mane than the neck under it -- so this is a list to read, not a list to fix; what it
  did prompt was the fillet rule below.
* **STRAIGHT runs**: parts long against their girth with almost no taper, which are paying for cuts they do
  not need.

A plate counts as a neighbour (its three edges are measured), or every spike on a ceratopsian's frill reads as
floating. 56 of the 60-odd species now come back clean, and the rest are the anatomical steps.

**Cuts round a chain follow its GIRTH, not its length.** A horn, an antler or a leg bone is long and thin: the
ring needs few points and the sweep needs few rings, but the LOD bucket was picked by the chain's overall size,
so a 2 cm horn was drawn with the same twenty points round as a body. The distance is now measured in the
chain's own GIRTHS (`SHELL.lod` thresholds 25 / 70), which drops thin parts to the coarse grid at any distance
they are actually seen from.

**A thin part running into a fat one takes half the fat one's blend.** The fillet is a part's OWN blend radius
(a mane's .3 m must not bulge the neck it lies on), but where a neck runs into a head or a tail into a rump,
its own blend is far too small for the step and the joint reads as a shoulder. Where the neighbour is more than
half again as wide, the fillet takes half of the wider blend -- which rounds the step without touching what a
thin part lies on.

**A wing is a membrane, not a flattened ball.** `segmentFor` can only approximate an ellipsoid (a sphere with a
non-uniform `scale`) as a capsule along its longest axis, so an owl's wing -- 4 cm thick in the data -- was
drawn as a 12 cm sausage, and the bird did not read at all. The owl's and the eagle's wings and tails are now
`tri` membranes, which the shell engine draws as thin plates with exact edges. About a dozen other strongly
flattened parts in species.js are candidates for the same treatment.

## Patterns, cloth and fur on the swept surface

The shell engine started with flat fills, and a figure drawn that way loses what the composite engine paints:
a tiger's stripes, a zebra's bands, a leopard's rosettes, the dinosaurs' scales, a coat's fur, and every
garment's cloth -- stripes, checks, weave, braid, pleats, trim and hems.

None of it had to be rewritten. What a pattern wants to know is where a point lies ON the part it belongs to --
how far ALONG the axis, at what ANGLE round it, and how far OUT from it -- which is exactly the vector
`partLocal(point, A, B)` returns, and exactly what a lathe knows about every vertex it makes. So the shell's
fragment shader calls the composite engine's own library on the same numbers: `patternAt` for coats and horns
and bark, `clothAt` for garments and hair, `furAt` over either.

**The fragment fetches the part's texels itself**, by a slot handed down as a flat varying: colours, flags
(pat * 8 + bodyFrame * 4 + edge * 2 + seam, fur at 256, a painted panel at 512), the cloth code and the cut.
That is fewer varyings than carrying them across, and it reads exactly what the SDF reads. Four numbers ride
along with it -- the surface point in world space, its normal, the colour the sweep chose (a chain's gradient,
a mark's iris) and the part's girth there -- plus which face of a shell the point is on (outer wall, lining, or
a cut's flat cap), since cloth shades those differently.

**A cloth pattern laid in the FIGURE's frame** -- a coat over rump, chest, neck and head; a skirt's stripes
round the body -- reads the figure's root, slot `base`, for that frame, as the composite does.

**RELIEF comes back with it**: `clothAt` returns the surface gradient of a pleat, a fold or a hem, and the
normal is tilted by it before the light is applied, so the same numbers that darken the colour also turn the
light. A face MARK is handed a slot of -1 and keeps its own colour: the flags in its texel are iris, pupil,
round and relief, which are not a pattern.

**A pattern is fixed to the SURFACE, and that is a question of frames.** The engine keeps a part's ends in
CAMERA space while the camera is where it is (`PIPE.viewSpace` saves a matrix per part per pixel), so reading
them straight and pairing them with a world-space point mixes two frames -- and the pattern then slides over
the coat as the camera turns, which is exactly what a texture must never do. The ends are brought back to the
world before the local frame is built. The check is two renders of one frozen animal from two angles: the
stripes fall on the same places.

Measured in the village: CPU 8.5 ms, GPU 4.55 ms -- unchanged. The patterns are a few dozen instructions on
fragments the frame was already shading.

**A ring is not a good pattern at a cat's scale.** Leopard rosettes are drawn as rings, and at any honest
distance the ring itself is a pixel or two wide, so the coat reads as speckle rather than as spots. The
giraffe's patches -- filled Voronoi cells -- hold their shape all the way out, and a leopard is the same coat
at a fifth of the scale. Worth remembering when adding any pattern: what survives is the FILLED shape, not the
outline.

**...but a leopard is a yellow cat with dark spots, not a dark cat with yellow veins.** Painting the whole
cell, as the giraffe does, inverts the animal: the tawny survives only as thin lines between the patches. The
spot is the small dark thing ON the coat, so pattern 21 paints only each cell's CORE (cellBorder3 gives the
distance to the border; the paint starts well inside it) at .065 m cells -- and the yellow between them is the
cat's own colour, untouched.

**A torso's ends need their own cuts.** The rings were spread evenly over (cnt + 1) units, half a unit to each
cap -- which on a four-part body left under one ring per cap and the ends came to a cone. A fifth of the cuts
now goes to each cap whatever the chain's length, and a chain of many parts asks for a finer grid even when it
is straight (the demand is the bend plus a share per part). An elephant's rump is a dome again, for 23k more
triangles in the village.

**And a torso's middle needs filling.** The spine's girth is a soft maximum of the two lobes the species
declares; at a power of 6 an elephant still had a wasp waist, because its lobes are far apart and both are
tapering hard by the time they meet. At 3 the overlap fills the way the SDF's own blend filled it, and a single
lobe is untouched either way -- (a^p + 0)^(1/p) is a.

**What hangs on the chest hangs on the ROOT.** The torso's cuts are `pillPart`s, and a pillPart carries the
rotation that aims it, which its children inherit. The chest used to be an ellipsoid with no rotation of its
own, so extras written in the species' own coordinates landed where they were written; through a spine segment
they came out turned -- a tyrannosaur's arms ended up at its throat. Extras naming `front` as their parent now
hang on the rump capsule, whose frame IS the species' frame because it is never aimed.

**A pattern is fixed to the MESH, not to the pose.** The local frame was built from the part's posed ends, so
a swinging leg dragged its stripes through the coat. It now comes from the sweep's own parametrization --
how far along the chain the ring is, and where round it the vertex lies -- which is the same pair of numbers
whatever the animal is doing. Coats laid in the figure's frame are the exception, and are meant to move with
it. The check is two renders of one animal at two times: the stripes sit on the same places on each bone.

**One pixel is one pixel.** Patterns fade out when their cells get smaller than a pixel, and the fade is fed
the pixel's footprint at the surface, in metres. The shell measured it as `length(fwidth(pl))` -- but `fwidth`
is |ddx| + |ddy|, so taking it per component and then the length of the three counts one pixel three or four
times over. Every scale, scute and cloth weave was past its own fade at any distance: a dinosaur came out in
flat paint. It is the step the point itself takes across one pixel, `max(length(dpdx(pw)), length(dpdy(pw)))`,
as the SDF measures it. Nothing else changed and the hides, scutes and weaves all came back at once.

**A tube's third texel is its BEND POINT, not a cut.** The fragment decides between `clothAt` and `patternAt`
by `C.z < -0.5` -- the flag a garment's cut slab carries. A tube's C is a coordinate, and in view space
almost always a large negative one, so every tube went down the garment path and lost its own pattern: no
dinosaur had scales on its tail, no cat had spots on hers. The SDF's own fragment escapes this by accident
(it zeroes C for anything whose second radius is negative, which covers triangles AND tubes); the shell now
does it on purpose.

**And an extra's arc has a pattern too.** `arcChain` takes one and writes it into every link, but the extras
loop -- the path a hydra's necks, a trunk and a dinosaur's arc tails take -- did not pass it on, so those
parts were bare whatever the species declared.

## A run of tubes is one tail

A tube is a spindle with a curve of its own (a quadratic through its bend point) and a girth that tapers
along it, and the chains left them out: a chain span was a straight round cone, and a tube's profile is not
something a straight span can hand over to. An arc chain is a string of them -- a stegosaur's tail is seven
links, a hydra's neck five -- so the tail came out as a string of beads, each one capped, with a step at
every link.

The sweep now walks each span on ITS OWN curve: where the span is a tube it takes that tube's Bezier and its
own tapering radius, and where it is not it takes the straight profile and the joint hand-over as before.
Tubes chain only with each other (`isTube(p) !== isTube(q)` ends a chain), since the two profiles have
nothing to hand over. The chain's caps are its first part's A end and its last part's B end, as for any
chain.

Two details the link tests needed: a tube's END radius is packed into its `r2` with its bulge, and read raw
(a large negative) every gap and step test is answered by nonsense -- hence `endR()`. And a chain of tubes is
not one big curve but several small ones, so it asks for a share of the ring budget per link (.45 radians
each) rather than the 1.4 a lone tube claims.

Measured in the village: GPU 6.2 ms with the tube chains and 6.2 ms without them -- a tail that was seven
shells with fourteen caps is one shell with two, and the rings it saves pay for the rings the curve wants.


## A fall of hair is cut open at the front (2026-09-25)

`clip.back` (people.js, packed by skeleton.js into the cut texel) means: *also* cut away everything more than
that many metres in FRONT of the shell's start, along the FIGURE's own forward. It is what makes long hair a
fall round the back of the head and the shoulders with the face left free. The SDF did that cut; when the
figures became polygons the shell engine kept the slab (`lo`, `hi`, mode) and quietly dropped the front cut,
so every long-haired person has been wearing a veil since -- hair closed over the face down to the chin, an
eye slot to see out of.

The shell sweeps a surface of revolution, so the cut is not a clip: it is the ARC the sweep covers. For a
vertex at `sPos` along the axis at radius `r`, the plane test
`dot(ax, fwd) * sPos + r * m * cos(ang - phi) <= back` (with `m`, `phi` the forward's length and angle in the
shell's own radial frame) is satisfied on an arc centred away from the forward, of half-width `pi - acos(t)`,
`t = (back - along) / (r * m)`. The sweep starts at `phi + acos(t)` and spans the rest, per vertex -- so the
opening narrows and widens correctly down a cone that widens toward the shoulders. `t` clamps to 1 for points
on the axis (full turn) and to -1 for a shell entirely in front of the plane (a closed sliver).

Parts with a slab but no `back` (a hat's crown, a skirt, a sleeve, a boot) take the full turn as before: the
packed code is 0 for them.

## Heads, hands and the figures' proportions (2026-09-25)

Measured against real animals (`ref/prop.html`: withers, torso, head from the posed model) every mammal's head
was a third to three quarters too long -- a dog's was .38 m on a .57 m dog, a wolf's half a metre. It is one
property now, `headScale` on `mammal()`, which shrinks the whole cluster (skull, muzzle, nose, ears, eyes)
ABOUT THE NECK JOINT, so the head stays seated and only its size changes. What hangs on the head keeps its own
size: a horn, a tusk or a fang is moved so its ROOT lands back on the smaller skull (they floated by up to
13 cm otherwise -- an elephant's tusks), and a soft piece that IS the head, like a sheep's fleece cap, says
`headPiece: true` and shrinks with it. The big cats' frame was also a third too short in the body and half
again too deep in the chest (a tiger stands on 50% leg), and the bear stood at 1.45 m with a metre-deep chest.

For people, the cranium was cut to the head's HEIGHT: a 24 cm-wide skull, half a head too broad seen from the
front. A head is 23 cm chin to crown but 15 across and 20 deep, and a cross-section here is a circle, so the
sphere is cut between the width and the depth (`hr = .056 h`) and the jaw below it carries the height. And the
hand was a ball on the wrist, which left every arm a tenth of a body short: it is a flattened pill down the
forearm now, .11 of the stature long -- the wrist at .49 h, the fingertips at .38, as they are.

## The pattern slid because the frame was the world's (2026-09-25)

A sweep needs a reference square to the axis to measure the angle round it from, and it took
`cross(worldUp, axis)` -- with a switch to `cross(worldZ, axis)` whenever the axis came within 26 degrees of
vertical, or the cross product would vanish. A hanging arm sits inside that cone and a swinging one leaves it:
so a sleeve's checks JUMPED a quarter turn round the arm mid-stride, and rolled steadily the rest of the time
as the reference turned with the tilting axis. (With the ends kept in camera space, that "world up" is the
camera's, so the frame also turned as you walked round a figure.)

The reference is the FIGURE's own side now -- `cross(up, forward)` from the root part, squared to the axis --
which stays perpendicular to a limb swinging fore and aft, so the pattern does not move on it at all. It only
degenerates where a part runs ALONG the body's side (a horn, a spread wing, an outstretched arm), and there
the figure's forward stands in. Both the chain sweep and the cut shells (a skirt's stripes) use it.

## Shoulders, and what "long necks" really was (2026-09-25)

Measured, the neck showed 4cm of skin between collar and chin, which is what a body shows -- and every person
still read as long-necked. `ref/neck.html` prints the DRAWN silhouette (the widest surface at each height,
every part being a union of spheres) and the reason was plain: from .84 to .91 of the stature the figure was a
column 11 to 15cm wide. The torso's pill ends in a dome, so the body fell from 42cm to 14cm in the last four
centimetres under the chin, and the jaw -- a cone tapering to three quarters of the cranium -- was no wider
than the neck. Everything from the collarbone to the cheek was one stalk.

What was missing is the mass a real pair of shoulders carries BESIDE the neck: `yoke`, a capsule across the top
of the torso in whatever the chest wears (trapezius and collarbones). The body now holds 25-35cm of width right
up to the collar, the narrow part is the handspan of neck it should be, and the shoulder joint the arms hang
from sits at .79 of the stature. The head keeps a jawline of its own by starting the neck UNDER the jaw rather
than inside the skull: head and neck sweep as one lathe (same colour, same direction, ends touching), and with
the neck's top above the chin that lathe doubled back and came out as a funnel with no jaw in it at all.

## One torso, and what a body wears (2026-09-27)

The yoke is gone: the shoulders are the TORSO's own. The torso is three flattened cuts (`chest` shoulders to
armpits, `belly` to the natural waist, `hips` to the hip ring), all `flat` and `spine`, which the shell engine now
chains like an animal's torso lobes -- a flat part sweeps only with other flat torso cuts -- so it is one lathe
through four rings, with a waist. Its ends are `caps` (skeleton.js; composite.js packs them into the third texel's w,
which no shader read before): each cap as tall as its share of the radius and as square as a superellipse exponent,
so the top is a low, squared cap -- the shoulders -- instead of a hemisphere as tall as it is wide (which is why a
second shape across the top was ever needed). The arms hang beside it (their shafts clear of the chest and the hips,
their joint ball tucked under the shoulders' flare, as a deltoid covers the joint). Canon: assets/people/body.json.

WHAT A PART WEARS (clothes.js, docs/clothes.md) is `dress`: layers of sheet, outermost first, six static texels
each in pseudo-slots after the figure's parts (composite.js `packDress`: where the layer lies along the part and
round it, its four colours, its fabric and repeat, its thickness, pleats, wear and dags, a band's width, a neckline
or a window). The vertex stage lifts a dressed part's surface by every layer over the point, and hands the ring's OWN
part to the fragment through a FLAT varying -- a triangle takes its first vertex's, so a joint's strip belongs to one
part -- and the fragment finds the point on that part geometrically (along its axis, round it from the figure's
front), picks the outermost layer covering it and mixes its colours by the fabric's slot weights (fabric.js: one
texture ARRAY, a layer per fabric, sampled with the seamless gradient of the angle). A STANDING part (a skirt, a cloak)
is cloth only where a layer covers it: elsewhere the fragment discards -- its openings are holes.

A cut shell (a garment standing off the body) may be squashed front to back (`clip.squash`, the third texel's w)
and gets its true normals now (the cone's lean, a sphere's over a rounded end). Its rings are laid BY NUMBER --
ring 0 the low cut's rim, then the outer surface, one ring for the high rim, the inner surface back -- because the
grid's ring count is now in the geometry (position.z). Laid out by fractions of u, the high rim's inner end fell
between two rings at every grid the figures use: every skirt was an open tube at its hem and a seated lap ended in
a hole. `clip.lid` (mode 3) closes a garment's near cut too (a skirt's waistband over the gap between a round skirt
and a flat torso). The FAR cut is an edge, not a lid -- a skirt's hem, a cloak's, a sleeve's mouth, a fall of hair end
in their own thickness and stay open -- unless the cut is solid (mode 2: a hat's crown) or a thin slab (a brim).

## A figure the pool was still drawing (2026-09-25)

Two ways to leave a copy of yourself standing in the field, both from the same change: since the figures share
ONE pool with one driver, a herd is drawn because it is on the pool's list -- not because its mesh is in the
scene, and not because anyone is still updating it.

- **Crouch.** `updateSelf` hides the player's own body and returns without updating its herd. `hidden` was only
  read inside `update()` (where it sets `_off`), so nothing ever told the pool: it went on posing and drawing
  the body where it last stood. `poseInto` and `pushChains` read `hidden` directly now.
- **Drawing a bow.** The player's body is rebuilt when its pose kind changes (walk -> draw -> walk), and the
  old one was disposed of with `scene.remove(herd.mesh)` -- which stopped nothing. Every shot left a frozen
  archer behind and leaked its slots. `herd.dispose()` takes its figures off the pool's list, hands the slots
  back (`P.take`/`P.give`, a free list with merging) and removes its Group -- carrying the pool's own group to
  a surviving herd if it happened to hang there. Peers who leave and duplicates that fall off the end of the
  list (Shift+N keeps ten) dispose the same way.

`ref/clone.html` drives it: crouch, stand, then eight arrows. Herds 13 and pool slots 15854 throughout, one
figure fewer drawn while crouched.
