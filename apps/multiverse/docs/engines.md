# The banner engines

## Why banners

A capsule tessellated the classic way costs ~600 triangles, twice (fill +
outline hull). A banner costs 2 triangles and draws a *mathematically
perfect* silhouette at any zoom: the fragment shader evaluates a 2D signed
distance function and discards outside pixels. Flat fill + dark border
replaces lighting, matching the 2D game's look. That's a ~300x geometry
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

## Per-pixel depth

By default (`?depth=flat` disables it) the fragment shader bulges the flat
quad to the round solid's true depth: for SDF distance `d` and radius `r`,
surface height is `sqrt(-d(2r+d))`, written to `gl_FragDepth`. Costs early-z,
buys correct intersection curves where parts interpenetrate — eyes sit *on*
heads, legs meet bodies with round seams. Triangle membranes stay at plane
depth (they are flat skins). Depth is otherwise the midpoint depth, so parts
z-sort against each other and the polygon world through the ordinary buffer.

## Borders and patterns

The border band is a fixed world width (~2.2cm), capped at half the smallest
radius so thin tails don't drown in outline. Patterns are computed in the
same 2D plane, measured along the segment axis so they stay glued to the
part: `1` leaf mottle, `2` bark streaks, `3` wavy tiger stripes, `4` straight
zebra bands, `5` giraffe patch voronoi (cell-border distance), `6` butterfly
wing spots. Both banner and instanced engines share the GLSL (`SDF_GLSL`).

## The instanced engine

`instanced.js` erases the scene graph: `compileDef` flattens a species'
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

## Building materials

Buildings use conventional geometry (they're mostly boxes and extrusions —
polygons are the right tool there) with one shared `ShaderMaterial` family:
deterministic orientation shading (`k = .82 + .2n_y + .1n_x + .06n_z`
substitutes for lighting), world-space procedural patterns (ashlar, brick,
marble, roof tiles, grooves, star fields, scrollwork, gothic wall
articulation, checkerboard floors, ornament lattice), a shared `SNOW`
uniform that whitens upward faces, and per-part millimeter inflation so no
two components ever share an exact plane (z-fighting). Stained glass is a
single translucent shader drawing a world-space diamond lattice.
