# The banner engines

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
deterministic orientation term the buildings use, `k = .82 + .2n_y + .1n_x
+ .06n_z` on the world-space normal, so a back reads lighter than a belly
and animals, people and trees sit in the same light as the town. The
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
wear one continuous coat with no seams. `patternAt` (in `SDF_GLSL`, shared
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
  light is deliberately flat (`shadeOf`'s gradient is .23, and only ~.08 along
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
  texel carries anything are packed into A.w (`PACK_GLSL`), so a plain
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
wind -- `GRASS_WIND_GLSL`, one definition both halves read -- so a stalk agrees
with the lawn it rises out of. `?fringe=0` turns it off, `FRINGE` holds the
knobs (height in metres, roots per metre, the share that grow one).

### Pattern tiles (textures.js)

The flat repeating patterns of the building materials -- ashlar, brick,
marble joints, roof tiles, checker floors, parquet, gothic bands, grooves,
stars, ornament, scrollwork -- and the ground's grass are
*calculated* at startup, not drawn by hand: `bakeTiles(renderer)` renders
the same GLSL the materials used to evaluate per pixel (`PATTERN_GLSL`,
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
