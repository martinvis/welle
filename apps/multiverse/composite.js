// Composite engine: ONE quad per animal, every part of it in the fragment
// shader. Where the instanced engine stamps a separate banner per part (and
// so draws a border band at every seam), this evaluates all of an animal's
// projected part silhouettes per pixel and joins them with a SMOOTH union:
// the two body lobes, neck, head and muzzle melt into one metaball torso,
// legs and tail blend into it with a small fillet, and the optional 1px
// outline (Shift+O) runs once round the OUTER silhouette. Classic parts (a
// rider fused onto the horse, any species without the mammal rig) keep
// their own band inside it, so a person in the saddle still reads.
//
// 3D LOD (NEAR): animals nearer than NEAR.dist metres are true 3D
// metaballs. Every pixel whose ray exactly hits a primitive is already
// exact in the main pass (hitCone), so only the SMOOTH-UNION FILLETS --
// where the surface is the blend of two parts and no primitive is hit --
// still differ from a real 3D render. A pre-pass (renderNearPass) marches
// exactly those pixels: it re-evaluates the 2D silhouette, discards
// pixels with an exact hit, and sphere-traces the smooth union of the
// rounded-cone SDFs for the rest, writing colour with pattern, coverage
// and view depth into a shared buffer. The main pass then takes colour
// and depth from that buffer for its fillet pixels and lets the marched
// coverage decide the silhouette there, so a near animal's fillets have
// the real 3D surface, depth and outline while every other pixel keeps
// the exact per-primitive result. A few percent of pixels march, so the
// buffer runs at full resolution by default (NEAR.scale). Per pixel the
// marcher first culls to the few parts the ray passes near. Far animals
// never enter the pre-pass.
//
// Data path: the same CPU skeleton walk as instanced.js (skeleton.js) writes
// world-space endpoints into a mirror array; just before the draw they go
// into a float texture (in camera space with PIPE.viewSpace) -- three
// texels per part: (A, r1), (B, r2), (C, k) -- next to three static texels
// (colour, pattern and flags; second colour, cloth code; a painted panel's
// colour and place -- an apron on a skirt, a sector of the part in another
// colour with no shape of its own). One instance per
// animal carries where its parts start and how many there are; the vertex
// shader loops over them to fit the quad (or its cells) to their projected
// bounding box, the fragment shader loops again to shade. Still one buffer
// upload and one draw call per herd.
//
// Per-pixel choice of WHICH part a pixel shows is by depth, exactly what
// the z-buffer did between separate banners: among the parts covering the
// pixel the nearest surface (plane depth + the round solid's bulge) wins
// and writes gl_FragDepth, so eyes sit on heads and a hind leg stays
// behind the belly. Fillet pixels that no part covers take the nearest
// part's colour and its plane depth.
//
// PIPELINE. Every stage is general -- animals, people, fused riders alike --
// and is switched by ONE condition, so any of them can be turned off to
// compare or to debug:
//   1 pose       the CPU skeleton walk writes world-space endpoints (always)
//   2 viewSpace  PIPE.viewSpace: the CPU takes them into camera space once
//                per frame, just before drawing, so no shader multiplies a
//                matrix per part per pixel (otherwise the shaders do it)
//   3 cells      PIPE.cells = N: the animal's quad is split into N x N
//                cells; each cell's vertices test every part's padded screen
//                box once and pass the overlapping ones on as a 128-bit mask,
//                so a pixel loops over the handful of parts near it instead of
//                all of them (1 = off). Empty cells are dropped; animals
//                smaller on screen than PIPE.cellMin stay one cell; figures at least
//                PIPE.cellBig of the screen's height tall take the whole grid, the
//                rest half as many cells each way (decided from their bounding
//                sphere, aBound, before any work); SOLID CELLS (PIPE.solidCells): a
//                cell lying wholly inside one solid part's outline -- past every
//                blend and a few pixels, all four corners -- whose far bound is
//                nearer than every other part's near bound there, lists that part
//                alone (plus any face marks): one part per pixel inside big shapes
//   3b occlude   OCC.on: the world's occluders (the buildings, the ground -- by layer) draw their DEPTH ALONE
//                into a small buffer before the figures, and a figure whose whole bounding sphere lies behind
//                every sample over its own screen box culls all its cells in the vertex shader. The shaders
//                write gl_FragDepth, so the GPU cannot reject a hidden figure early: without this a villager
//                behind a house is shaded in full and only then thrown away by the depth test
//   4 near       NEAR.dist: the raymarched fillet pre-pass (0 = off, see above)
//   5 half       PIPE.half: figures within PIPE.halfDist metres -- the ones
//                that fill the screen -- are drawn by a twin of the main pass
//                into a half-size buffer (a quarter of the pixels: colour and
//                depth), which one full-screen blit puts into the frame, depth
//                and all; the main pass leaves them out (renderNearPass)
//   6 main pass  silhouettes, exact hits, cuts, cloth, seams, outline
//   7 early      PIPE.early: sync writes each figure's parts NEAREST-FIRST for the
//                camera (the root stays in slot 0 -- the body frame is read
//                from it; then face marks, the rest, bones last), and a pixel stops its loop
//                once the part it just did lies wholly behind the surface already
//                won while it is deep inside that winner's outline (past every
//                blend, two pixels in, clear of a cut): nothing left can change it
//   PIPE.debug   tints every pixel by the share of parts it evaluated
//                (green few .. red all) -- to see what cells save
// setPipe({...}) changes any of them live (shaders recompile, grids rebuild);
// pipeFromQuery reads ?viewspace=0|1 ?cells=N ?cellmin= ?pipedebug=1 ?half=0|1 ?early=0|1; occFromQuery ?occlude= ?occscale=.
//
// RELIEF (gRelief, CLOTH_GLSL): what a surface shows in the LIGHT without showing it in the silhouette -- a
// skirt's pleats, the ridge of a brow, the socket an eyeball sits in. Each producer adds the surface gradient
// of its own height field in metres, and the shading tilts the normal by it just before shadeOf. It costs no
// geometry and no part; the same field that tilts the normal also shades the colour, so the two cannot drift.
import * as THREE from "three";
import { SDF_GLSL, BORDER, OUTLINE } from "./banner.js";
import { compileDef, writeAnimal, easeGait } from "./skeleton.js";

const W = 1024;      // texels per texture row
const MAXP = 160;    // parts per animal the shader loops over at most
const ST = 3;        // static texels per part: (colour, flags), (colour2, cloth code), (panel colour, panel place)

export const PIPE = {
  viewSpace: true,   // stage 2
  cells: 8,          // stage 3: at most N x N cells per animal quad (1 = off)...
  cellBig: .9,       // ...for figures at least this tall on screen (NDC: 2 = the whole height); smaller ones take N/2 x N/2
  solidCells: true,  // stage 3: a cell wholly inside one solid part, in front of all else there, lists that part alone
  cellMin: .25,      // ...unless the quad spans less than this on screen (NDC units, 2 = the whole screen)
  debug: false,      // heat map of parts evaluated per pixel
  half: false,       // stage 5: near figures at half resolution (off by default; the game takes it from config.json)
  halfDist: 12,      // ...within this many metres (the nearest part's depth)
  // A MEASUREMENT switch, not a feature (?flatdepth=1). The figures write gl_FragDepth so that each pixel
  // carries its true surface depth -- which is what turns off early-z, so a villager behind a wall is shaded in
  // full and only then thrown away. With this on, a figure takes its QUAD's plane depth instead: the picture is
  // wrong (bodies intersect walls and each other as flat cards) but early-z comes back, so the frame time says
  // exactly what per-pixel depth is costing. ?depth=flat does the same for the instanced engine's banners.
  flatDepth: false,
  // ?blend=0: no SMOOTH union. Parts stop melting into one another -- a rump and a chest read as two pills, a
  // leg meets the belly along a crease -- and two costs go with it: the smin itself, and (the larger one) the
  // padding every screen cell puts round every part, which exists only because a part can reach beyond its own
  // outline to blend. With it off a cell lists only the parts that truly touch it.
  blend: true,
  early: false,      // stage 7 (off by default: no measurable gain in the software renderer; try it on a GPU): parts nearest-first, a pixel stops deep inside the surface it has won
};
const herds = [];    // every composite herd, so setPipe reaches them all
export function setPipe(opts) {
  Object.assign(PIPE, opts);
  for (const h of herds) h.applyPipe();
}
export function pipeFromQuery(qp) {
  if (qp.has("viewspace")) PIPE.viewSpace = qp.get("viewspace") !== "0";
  if (qp.has("cells")) PIPE.cells = Math.max(1, Math.round(+qp.get("cells")) || 1);
  if (qp.has("cellmin")) PIPE.cellMin = +qp.get("cellmin");
  if (qp.has("cellbig")) PIPE.cellBig = +qp.get("cellbig");
  if (qp.has("solid")) PIPE.solidCells = qp.get("solid") !== "0";
  if (qp.has("pipedebug")) PIPE.debug = qp.get("pipedebug") !== "0";
  if (qp.has("half")) PIPE.half = qp.get("half") !== "0";
  if (qp.has("early")) PIPE.early = qp.get("early") !== "0";
  if (qp.has("flatdepth")) PIPE.flatDepth = qp.get("flatdepth") !== "0";
  if (qp.has("blend")) PIPE.blend = qp.get("blend") !== "0";
}
const pipeDefines = (extra = {}) => ({
  ...extra, SCALE_TEX: "", CELLS: Math.max(1, PIPE.cells | 0), CELL_MIN: PIPE.cellMin.toFixed(4), CELL_BIG: PIPE.cellBig.toFixed(4),
  ...(PIPE.viewSpace ? { VIEW_SPACE: "" } : {}), ...(PIPE.debug ? { PIPE_DEBUG: "" } : {}), ...(PIPE.early ? { EARLY_OUT: "" } : {}), ...(PIPE.solidCells ? { SOLID_CELLS: "" } : {}), ...(PIPE.flatDepth ? { FLAT_DEPTH: "" } : {}), ...(PIPE.blend ? {} : { NO_BLEND: "" }),
});
// the texture holds camera-space points (stage 2 on) or world-space ones (off);
// shaders read them through viewPt, and take a point back to the world with worldPt
const VIEW_GLSL = /* glsl */ `
  #ifdef VIEW_SPACE
    vec3 viewPt(vec3 p) { return p; }
  #else
    vec3 viewPt(vec3 p) { return (viewMatrix * vec4(p, 1.0)).xyz; }
  #endif
`;
// A.w packs three things (sync and add() write it): |A.w| = (k in 2mm steps * 2 + needC) * 4 + r1 -- r1 the part's
// first radius (< 4m; its precision rises as k falls: a small part is exact to ~1e-5m), k its blend radius (< 1.02m),
// needC: its third texel carries anything (a cut, a flat part's squash/band, a bone or face mark) -- so a plain
// capsule costs two texel reads, not three. Negative: a flat part. Returns (r1 with that sign, k, needC).
const PACK_GLSL = /* glsl */ `
  vec3 unpackAw(float w) { float a = abs(w), q = floor(a / 4.0), r = a - 4.0 * q, f = mod(q, 2.0), k = floor(q / 2.0) * 0.002; return vec3(w < 0.0 ? -r : r, k, f); }
`;
const WORLD_GLSL = /* glsl */ `
  #ifdef VIEW_SPACE
    vec3 worldPt(vec3 p) { return (uInvView * vec4(p, 1.0)).xyz; }
  #else
    vec3 worldPt(vec3 p) { return p; }
  #endif
`;

// a segment with one end behind the near plane (z > -0.05, the camera on a
// mount sits right over the body) is cut there, its radius interpolated
const CLIP_GLSL = /* glsl */ `
  void clipNear(inout vec3 a, inout vec3 b, inout float ra, inout float rb) {
    if (a.z > -0.05) { float t = (-0.05 - a.z) / (b.z - a.z); a = mix(a, b, t); ra = mix(ra, rb, t); }
    if (b.z > -0.05) { float t = (-0.05 - b.z) / (a.z - b.z); b = mix(b, a, t); rb = mix(rb, ra, t); }
  }
`;

// People's clothing (people.js). A part may be CUT by a slab along its own
// axis: C.xyz of a non-triangle part holds (lo, hi, mode) -- metres from A
// along A->B, mode 1 an open shell (the primitive's own surface inside the
// slab; where the near side is cut away the far wall's inside shows: a
// hood's lining), mode 2 a solid (the primitive intersected with the slab:
// flat caps -- a belt, a brim, a skirt's waistband). Only an exact ray hit
// that survives the cut covers a pixel. The ray's exit from a rounded cone
// is the same closed-form hit run backwards from beyond the solid.
// Then the cloth: the lab's patterns in the garment's wrapped frame (arc
// round the axis, height), uneven dye, wear toward the hem, pleat folds,
// a trim above the hem or cuff and a bodice's lacing.
const CLOTH_GLSL = /* glsl */ `
  float exitCone(vec3 rd, vec3 a, vec3 b, float ra, float rb) {
    float T = max(dot(a, rd), dot(b, rd)) + max(ra, rb) + 0.1;
    vec3 o = rd * T;
    float t = hitCone(-rd, a - o, b - o, ra, rb);
    return t > 0.0 ? T - t : -1.0;
  }
  // hit: ray distance or -1; kind: 0 outer surface, 1 inside of a shell, 2 a flat cap; mg: metres to the cut
  //   cl = (lo, hi, packed mode): mode 1 shell / 2 solid, + 4 * (front cut in mm + 501) -- see skeleton.js
  //   fwd: the animal's forward direction in view space (the front cut's normal)
  void clipHit(vec3 rd, vec3 a, vec3 b, float ra, float rb, vec3 cl, vec3 fwd, out float hit, out float kind, out float mg) {
    hit = -1.0; kind = 0.0; mg = 1e9;
    float q = floor(cl.z / 4.0 + 0.01), mode = cl.z - 4.0 * q;
    float front = q > 0.5 ? (q - 1.0) / 1000.0 - 0.5 : 1e4;   // keep nothing further than this in front of A
    float t0 = hitCone(rd, a, b, ra, rb);
    if (t0 <= 0.0) return;
    float t1 = max(exitCone(rd, a, b, ra, rb), t0);
    vec3 u = normalize(b - a); float du = dot(rd, u), au = dot(a, u);
    float s0 = t0 * du - au, s1 = t1 * du - au;
    if (mode < 1.5) {
      float f0 = front - dot(rd * t0 - a, fwd), f1 = front - dot(rd * t1 - a, fwd);   // >= 0: behind the front cut
      if (s0 >= cl.x && s0 <= cl.y && f0 >= 0.0) { hit = t0; mg = min(min(s0 - cl.x, cl.y - s0), f0); }
      else if (s1 >= cl.x && s1 <= cl.y && f1 >= 0.0) { hit = t1; kind = 1.0; mg = min(min(s1 - cl.x, cl.y - s1), f1); }
    } else {
      float tl = -1e9, th = 1e9;
      if (abs(du) > 1e-6) { float ta = (cl.x + au) / du, tb = (cl.y + au) / du; tl = min(ta, tb); th = max(ta, tb); }
      else if (s0 < cl.x || s0 > cl.y) return;
      float tin = max(t0, tl), tout = min(t1, th);
      if (tin > tout) return;
      hit = tin;
      if (tin > t0) kind = 2.0;
      else { float s = tin * du - au; mg = min(s - cl.x, cl.y - s); }
    }
  }
  float hash2(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
  // RELIEF: what a surface shows in the LIGHT without showing it in the silhouette -- a skirt's pleats, a brow
  // ridge, the hollow of an eye socket. Every producer adds the SURFACE (tangential) gradient of its own height
  // field, world metres per metre; just before shadeOf the shading tilts the normal by it (n - grad). One field
  // per feature: the same numbers darken the colour and tilt the normal, so the two can never drift apart.
  vec3 gRelief;
  const float FOLD = .018;   // how deep a pleat's valley lies under the cloth's mean surface (metres)
  const float BALL = .002;   // how far an eyeball stands proud of the skin around it (metres)
  // The world's light is deliberately FLAT (shadeOf: .82 + .2ny + .1nx + .06nz -- a gradient of .23, and only ~.08
  // along the horizontal tangents a skirt's folds run across), so an honest slope moves the shade by about 1%.
  // Every producer states its real depth in metres and this one gain, shared by all of them, carries it into
  // a light this flat. It is the only place the exaggeration lives.
  const float RELIEF = 5.0;
  const float BROWH = .004;  // how far a brow ridge stands out of the forehead (metres)
  const float SOCK  = .002;  // how deep the eye socket sinks round the eyeball (metres)
  // code = scale + 256 * (pleats + 32 * (trim + 4 * (lace + 2 * wear))) -- see add()
  //   pl: the pattern frame point (the person's frame for torso pieces); cl: the part's cut (hi = its hem)
  //   fq: a flat part's squash along the forward (pl.x), 1 for a round one
  vec3 clothAt(vec3 c1, vec3 c2, float pat, float code, vec3 pl, bool bodyFrame, vec3 pw, vec3 aw, vec3 bw, float r, vec3 cl, float kind, float fq, vec4 P) {
    float sc = mod(code, 256.0); code = floor(code / 256.0);
    float pleats = mod(code, 32.0); code = floor(code / 32.0);
    float trim = mod(code, 4.0); code = floor(code / 4.0);
    float lace = mod(code, 2.0), wear = floor(code / 2.0);
    vec3 q = partLocal(pw, aw, bw);   // x along the axis from A, (y, z) round it
    float len = length(bw - aw), hemS = cl.z > 0.5 && cl.y < 1e3 ? cl.y : len;
    // ROUND THE PART: the pattern's coordinate is the ANGLE times one radius for the whole part, chosen so a
    // WHOLE NUMBER of the pattern's periods fits the turn. Arc length at each pixel's own radius (what this
    // was) broke twice at the back: the angle wraps there, so the pattern met itself mid-period -- and the
    // radius changes over a garment, so the stripes splayed, funnelling into a V down a bodice's spine and
    // shearing a skirt's checks. One radius per part keeps them radial; a whole number of periods closes the
    // wrap. (A flat torso is unwrapped by fq as the round one it was squashed from, else the arc barely moves
    // across its back and the rings smear. Mail's 1.2 and a plait's .5 still meet a hairline at the wrap.)
    float turns = max(1.0, floor(6.2832 * max(r, .02) * max(sc, 1.0) + .5)), K = turns / (6.2832 * max(sc, 1.0));
    vec2 fz = vec2(pl.x / fq, pl.z);
    vec2 uv = bodyFrame ? vec2(atan(fz.y, fz.x) * K, pl.y) : vec2(atan(q.z, q.y) * K, -q.x);
    float u = uv.x, v = uv.y, m = 0.0;
    if (pat > 15.5) m = .6 * smoothstep(.3, .95, vnoise(vec2(u * sc, v * sc * .07))) + .25 * smoothstep(.6, 1.0, vnoise(vec2(u * sc * 2.3, v * sc * .05 + 3.0)));   // 16 hair: strands, long along the fall
    else if (pat > 14.5) m = step(.5, fract(v * sc + abs(fract(u * sc * .5) - .5) * 1.6));              // 15 braid: chevrons down the plait
    else if (pat > 13.5) { vec2 g = uv * sc * 1.2; g.x += .5 * floor(g.y); m = 1.0 - smoothstep(.05, .1, abs(length(fract(g) - .5) - .36)); }   // 14 mail rings
    else if (pat > 12.5) { vec2 g = uv * sc; m = .88 * vnoise(g) * vnoise(g * 2.3 + 7.0); }       // 13 leather mottle
    else if (pat > 11.5) m = .35 * (step(.5, fract((u + v) * sc)) * .5 + step(.5, fract((u - v) * sc)) * .5);   // 12 weave (twill)
    else if (pat > 10.5) m = abs(step(.5, fract(u * sc)) - step(.5, fract(v * sc)));             // 11 checks
    else if (pat > 9.5) m = step(.5, fract(u * sc));                                              // 10 vertical stripes
    else if (pat > 8.5) m = step(.5, fract(v * sc));                                              // 9 horizontal stripes
    vec3 col = mix(c1, c2, m);
    float f = clamp(q.x / max(hemS, 1e-3), 0.0, 1.0);                     // 0 at A .. 1 at the hem
    // a PANEL painted on the cloth (an APRON on a skirt): a sector about the figure's forward, from f0 down to
    // f1 -- no shape of its own, so it rides the skirt's swing exactly and no knee can ever poke through it,
    // and it takes every shading term below (dye, wear, the pleats' valleys and their relief), so it lies ON
    // the folds instead of floating over them. Its own edge is darkened: that is what a silhouette did for it.
    if (P.w > 0.5 && bodyFrame && kind < 0.5) {
      float pc = P.w, hlf = mod(pc, 256.0) * .01745; pc = floor(pc / 256.0);
      float f0 = mod(pc, 64.0) / 63.0, f1 = floor(pc / 64.0) / 63.0;
      float inA = hlf - abs(atan(pl.z, pl.x)), inB = min(f - f0, f1 - f);
      if (inA > 0.0 && inB > 0.0) col = P.rgb * (inA < .05 || inB < .025 ? .8 : 1.0);
    }
    if (wear > 0.5) col *= 1.0 - .065 * (vnoise(uv * 3.0) - .5) * 2.0;   // uneven dye
    if (wear > 1.5) col *= 1.0 - .14 * smoothstep(.45, 1.0, f);           // worn and dusty toward the hem
    if (pleats > 0.5) {   // pleats: ONE field -- its valleys darken the cloth AND tilt the normal (relief), so a fold catches the light
      float ph = pleats * atan(q.z, q.y), ramp = clamp(f * 1.6, 0.0, 1.0), rr = max(length(q.yz), .01);
      col *= 1.0 - .14 * (.5 - .5 * cos(ph)) * ramp;                                     // the valley's own shade: in a flat light this still carries the fold
      float fine = 1.0 - smoothstep(.12, .3, gPatPx * pleats / (6.2832 * rr));            // gone once a fold spans a few pixels (as fur and scales fade)
      vec3 e = normalize(bw - aw), rad = pw - aw - e * dot(pw - aw, e);                   // the valley's depth h = -FOLD * (.5 - .5 cos ph) * ramp,
      gRelief += cross(normalize(rad), e) * (-FOLD * .5 * pleats * sin(ph) * ramp * fine / rr);   // its slope along the arc: dh/dphi / r, round the axis the way partLocal measures it
    }
    if (trim > 0.5 && kind < 1.5) {   // (not on a flat cap: a skirt's underside is no border)
      float e = hemS - q.x;   // metres above the hem or cuff
      if (e < .035) {
        vec3 tc = mix(c2, vec3(.92, .82, .55), .5);
        if (trim < 1.5) col = tc;
        else if (trim < 2.5) col = mix(tc, c1 * .6, step(.5, fract(u * 25.0)) * step(.012, e) * step(e, .028));
        else if (e < .012 + .02 * (.5 + .5 * sin(u * 50.0))) col = tc;
      }
    }
    if (lace > 0.5 && bodyFrame) {   // front lacing down the bodice: the torso pill's axis runs down from the shoulders (q.x), the person's frame gives front (pl.x > 0) and across (pl.z)
      float lat = pl.z, dn = q.x;
      if (pl.x > 0.0 && abs(lat) < .05 && dn > -.02 && dn < .32) {
        float zig = abs(fract(dn * 9.0) - .5) * 2.0 - .5;
        float cord = abs(lat - zig * .045), eye = length(vec2(abs(lat) - .0225, (fract(dn * 9.0 + .25) - .5) * .11));
        if (cord < .006 || eye < .008) col = vec3(.3, .22, .14);
      }
    }
    // a PAINTED BAND round a flat part (a person's belt): cl.z = -(its centre along the axis from A, mm + 4096 x its
    // width, mm), cl.y = its colour (linear, 8 bits each packed); a brass buckle at the front
    if (cl.z < -0.5) {
      float bv = -cl.z, wmm = floor(bv / 4096.0), cmm = bv - 4096.0 * wmm;
      if (abs(q.x - cmm * .001) < wmm * .0005) {
        col = vec3(floor(cl.y / 65536.0), mod(floor(cl.y / 256.0), 256.0), mod(cl.y, 256.0)) / 255.0;
        if (bodyFrame && pl.x > 0.0 && abs(pl.z) < .022) col = vec3(.58, .36, .1);
      }
    }
    return col;
  }
`;

// ---- stage 3b: OCCLUSION. A figure behind a wall still costs every pixel it covers: the shaders write
// gl_FragDepth, so the GPU cannot reject it early and the depth test only throws the work away afterwards.
// So the world's occluders draw their DEPTH ALONE into a small buffer first (renderOcclusion, same frame and
// same camera as the figures, so there is nothing to reproject and no margin to guess), and a figure whose
// whole bounding sphere lies behind every sample over its own screen box culls all of its cells in the vertex
// shader. Conservative by construction: the sphere's NEAREST point must be behind the occluder (so the ground
// running up to a figure's feet never hides it), a sample that saw nothing reads the far plane and refuses the
// cull, and a figure crossing the screen's edge is left alone. Occluders opt in by layer (OCC_LAYER), so the
// buffer holds the few big meshes that hide anything -- the buildings and the ground, not the figures.
export const OCC = { on: false, scale: .25, big: .5 };   // big: figures taller than this share of the screen are not tested (they are never wholly hidden, and they are the expensive ones to test)
export const OCC_LAYER = 3;
const OCC_U = { uOcc: { value: null }, uOccOn: { value: 0 }, uOccBig: { value: .5 } };
let occRT = null;
const occDepthMat = new THREE.MeshBasicMaterial({ colorWrite: false });   // depth only: the cheapest thing a mesh can draw
let occSaved = -1;
export function renderOcclusion(renderer, scene, camera) {
  OCC_U.uOccOn.value = 0;
  if (!OCC.on) return;
  renderer.getDrawingBufferSize(_size);
  const w = Math.max(8, Math.round(_size.x * OCC.scale)), h = Math.max(8, Math.round(_size.y * OCC.scale));
  if (!occRT || occRT.width !== w || occRT.height !== h) {
    if (occRT) occRT.dispose();
    occRT = new THREE.WebGLRenderTarget(w, h, { depthTexture: new THREE.DepthTexture(w, h), depthBuffer: true });
    occRT.depthTexture.minFilter = occRT.depthTexture.magFilter = THREE.NearestFilter;   // depth must not blend across an edge
    OCC_U.uOcc.value = occRT.depthTexture;
  }
  const mask = camera.layers.mask, over = scene.overrideMaterial, tgt = renderer.getRenderTarget();
  camera.layers.set(OCC_LAYER); scene.overrideMaterial = occDepthMat;
  renderer.setRenderTarget(occRT);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  renderer.setRenderTarget(tgt); scene.overrideMaterial = over; camera.layers.mask = mask;
  OCC_U.uOccOn.value = 1; OCC_U.uOccBig.value = OCC.big;
}
// a mirror's or a painting's view is a different camera: its figures must not be culled against the main view's buffer
export function occFromQuery(qp) {
  if (qp.has("occlude")) OCC.on = qp.get("occlude") !== "0";
  if (qp.has("occscale")) OCC.scale = +qp.get("occscale");
}

// ---- the 3D LOD: configuration and the shared half-resolution buffer ----
// dist: animals whose nearest part is within this many metres are raymarched (0 = off)
// scale: the pre-pass buffer's size as a fraction of the canvas (0.5 = a quarter of the pixels)
export const NEAR = { dist: 0, scale: 1 };   // off unless ?near= asks for it: the marched fillets cost more than they show
const nearScene = new THREE.Scene();
const NEAR_U = {   // uniform objects shared by every composite material and the near materials
  uNear: { value: null }, uNearZ: { value: null }, uFull: { value: new THREE.Vector2(1, 1) },
  uNearDist: { value: 0 }, uPx3: { value: 0 },
};
let nearRT = null;
const _size = new THREE.Vector2();
// ---- stage 5: the half-resolution buffer for near figures, and the blit that puts it into the frame
const halfScene = new THREE.Scene();
const HALF_U = { uHalfDist: { value: 0 }, uHalfC: { value: null }, uHalfZ: { value: null } };   // uHalfDist 0: no split (pages without the pre-pass)
let halfRT = null, halfBroken = false;   // halfBroken: this GPU would not draw into the buffer -- the pass stays off
const halfBlit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: { uHalfC: HALF_U.uHalfC, uHalfZ: HALF_U.uHalfZ },
  transparent: true, depthWrite: true,   // (after the opaque world: the feathered edges blend over it)
  vertexShader: /* glsl */ `out vec2 vUv; void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    layout(location = 0) out highp vec4 fragColor;
    #define gl_FragColor fragColor
    uniform sampler2D uHalfC, uHalfZ;
    in vec2 vUv;
    void main() {
      vec4 c = texture(uHalfC, vUv);
      float cov = clamp((c.a - .5) / max(fwidth(c.a), 1e-4) + .5, 0.0, 1.0);   // the ramp's 1/2 is the edge: one screen pixel of anti-aliasing
      if (cov < .01) discard;
      gl_FragColor = vec4(c.rgb, cov);
      gl_FragDepth = texture(uHalfZ, vUv).r;   // depth as the half pass wrote it: the world still hides them and they hide it
      #include <colorspace_fragment>
    }`,
}));
halfBlit.frustumCulled = false; halfBlit.visible = false; halfBlit.renderOrder = 1;
// A secondary view (a mirror's reflection) draws inside the main render: its figures in full -- no
// half-resolution split, no blit (that buffer belongs to the main camera) -- then back.
let savedHalf = 0;
// anything else that only holds for the MAIN camera's frame (the grass fringe's mask) registers here
const secHooks = [];
export function onSecondaryView(fn) { secHooks.push(fn); }
export function beginSecondaryView() { savedHalf = HALF_U.uHalfDist.value; HALF_U.uHalfDist.value = 0; halfBlit.visible = false; occSaved = OCC_U.uOccOn.value; OCC_U.uOccOn.value = 0; for (const f of secHooks) f(true); }
export function endSecondaryView() { HALF_U.uHalfDist.value = savedHalf; halfBlit.visible = PIPE.half; if (occSaved >= 0) OCC_U.uOccOn.value = occSaved; for (const f of secHooks) f(false); }
// The pre-passes, once per frame before the main render: near figures at half
// resolution (stage 5), then the raymarched fillets (stage 4, off by default).
export function renderNearPass(renderer, camera) {
  renderer.getDrawingBufferSize(_size);
  if (halfBroken) PIPE.half = false;
  HALF_U.uHalfDist.value = PIPE.half ? PIPE.halfDist : 0;
  halfBlit.visible = PIPE.half;
  if (PIPE.half) {   // (re-checked below: the buffer may turn out unusable)
    const w = Math.max(8, Math.round(_size.x / 2)), h = Math.max(8, Math.round(_size.y / 2));
    if (!halfRT || halfRT.width !== w || halfRT.height !== h) {
      if (halfRT) halfRT.dispose();
      // plain 8-bit sRGB colour (renderable on every WebGL2 GPU, half the traffic of half-float; the edge ramp
      // in alpha needs no more) and a 24-bit depth texture (the widely supported kind)
      halfRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
                                                   depthBuffer: true, depthTexture: new THREE.DepthTexture(w, h) });
      halfRT.depthTexture.minFilter = halfRT.depthTexture.magFilter = THREE.NearestFilter;   // depth must not blend across an edge
      HALF_U.uHalfC.value = halfRT.texture; HALF_U.uHalfZ.value = halfRT.depthTexture;
      // can this GPU draw into it? If not, the pass switches off for good (near figures drawn in full)
      const prev = renderer.getRenderTarget(), gl = renderer.getContext();
      renderer.setRenderTarget(halfRT);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      renderer.setRenderTarget(prev);
      if (!ok) {
        console.warn("composite: this GPU cannot draw into the half-resolution buffer -- near figures stay at full resolution");
        halfBroken = true; PIPE.half = false; HALF_U.uHalfDist.value = 0; halfBlit.visible = false;
        halfRT.dispose(); halfRT = null;
      }
    }
    if (halfRT) {
    const prevTarget = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(halfRT);
    renderer.setClearAlpha(0);
    renderer.clear(true, true, false);
    renderer.render(halfScene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevAlpha);
    }
  }
  NEAR_U.uNearDist.value = NEAR.dist;
  if (NEAR.dist <= 0) return;
  renderer.getDrawingBufferSize(_size);
  const w = Math.max(8, Math.round(_size.x * NEAR.scale)), h = Math.max(8, Math.round(_size.y * NEAR.scale));
  if (!nearRT || nearRT.width !== w || nearRT.height !== h) {
    if (nearRT) nearRT.dispose();
    nearRT = new THREE.WebGLRenderTarget(w, h, { count: 2, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
    nearRT.textures[1].minFilter = nearRT.textures[1].magFilter = THREE.NearestFilter;   // depth must not blend across an edge
    NEAR_U.uNear.value = nearRT.textures[0]; NEAR_U.uNearZ.value = nearRT.textures[1];
  }
  NEAR_U.uFull.value.set(_size.x, _size.y);
  NEAR_U.uPx3.value = 2 / (camera.projectionMatrix.elements[5] * h);   // metres per buffer pixel at unit depth
  const prevTarget = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(nearRT);
  renderer.setClearAlpha(0);
  renderer.clear(true, true, false);
  renderer.render(nearScene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearAlpha(prevAlpha);
}

const VERT = /* glsl */ `
  uniform sampler2D tDyn;
  uniform float uViewH;       // the target's height in pixels (solid cells keep a few pixels' margin)
  uniform float uPad;
  uniform float uNearDist, uHalfDist;
  attribute float aBase, aCount;
  attribute vec2 aCell;      // this vertex's cell (0..CELLS-1 each way); position.xy = its corner inside the cell, 0..1
  attribute vec4 aBound;     // the figure's bounding sphere (world centre, radius): how finely its quad is cut into cells
  varying vec2 vP;
  varying float vZc;
  uniform sampler2D uOcc; uniform float uOccOn, uOccBig;   // stage 3b: the occluders' depth this frame, and the size above which a figure is not tested
  flat varying int vBase, vCount;
  flat varying float vNear;
  flat varying uvec4 vMask;  // stage 3: bit i = part i overlaps this cell (parts past 127 are always evaluated)
  flat varying float vKmax;  // stage 7: the figure's largest blend radius (metres), for "deep inside"
  vec4 texel(int i) { return texelFetch(tDyn, ivec2(i % ${W}, i / ${W}), 0); }
  ${SDF_GLSL}
  ${VIEW_GLSL}
  ${PACK_GLSL}
  ${CLIP_GLSL}
  // part t/3's projection into the plane at depth zc (perspective-correct:
  // xy and radius scaled by plane depth over own depth) -- its box, its
  // segment and radii (rad.y < 0: a triangle, box only); false if behind the camera
  vec2 gPa, gPb, gRad;
  // what partBox reports besides the box (stage 3's solid cells): a solid part (a plain capsule or a flat one -- not a
  // cut garment, a membrane, a tube), a face mark, the part's far and near depth bounds (view z), its true outline radii
  bool gSolid, gIsMark; float gZfar, gZnear; vec2 gRadIn; vec3 gFwdV;
  bool partBox(int t, float zc, out vec2 lo, out vec2 hi, out float zm) {
    vec4 A = texel(t), B = texel(t + 1);
    vec3 ua = unpackAw(A.w); A.w = ua.x;
    vec4 Cq = ua.z > 0.5 ? texel(t + 2) : vec4(0.0); float cw = Cq.w;
    gSolid = false; gIsMark = false;
    if (cw < -0.5) {   // a bone: never drawn -- or a face mark (-2): painted onto the surface under it, so its cells must list it
      if (cw > -1.5) return false;
      gIsMark = true;
      vec3 c = viewPt(A.xyz);
      if (c.z > -0.05) return false;
      float kc = zc / c.z, rc = A.w * kc; vec2 pc = c.xy * kc;
      lo = pc - rc; hi = pc + rc; gRad = vec2(rc); gPa = pc; gPb = pc; zm = c.z;
      return true;
    }
    vec3 a = viewPt(A.xyz), b = viewPt(B.xyz);
    if (min(a.z, b.z) > -0.05) return false;
    zm = (a.z + b.z) * 0.5;
    float ra0 = abs(A.w), rb0 = B.w;   // (a flat part's radius is negative: see part)
    gZfar = min(a.z, b.z); gZnear = max(a.z, b.z) + max(ra0, max(rb0, 0.0));   // (its front surface lies between: never behind its axis)
    vec3 a0p = a, b0p = b;
    clipNear(a, b, ra0, rb0);
    float ka = zc / a.z, kb = zc / b.z;
    vec2 pa = a.xy * ka, pb = b.xy * kb;
    if (B.w < -0.5) {   // triangle membrane: its third corner, rounded by r1
      vec3 c = viewPt(texel(t + 2).xyz);
      if (c.z > -0.05) return false;
      vec2 pc = c.xy * (zc / c.z);
      vec2 tb = tubeUnpack(B.w);   // (a tube: its fattest radius at its nearest point's scale -- the curve stays inside the hull of its three points)
      float r = B.w < -1.5 ? (max(A.w, tb.x) + tb.y) * max(max(ka, kb), zc / c.z) : A.w * ka;
      gZnear = max(gZnear, c.z + (B.w < -1.5 ? max(A.w, tb.x) + tb.y : A.w));
      lo = min(min(pa, pb), pc) - r; hi = max(max(pa, pb), pc) + r;
      gRad = vec2(r, -1.0);
    } else {
      float ra = ra0 * ka, rb = rb0 * kb;
      lo = min(pa - ra, pb - rb); hi = max(pa + ra, pb + rb);
      gRad = vec2(ra, rb);
      gSolid = ua.z < 0.5 || ua.x < 0.0;   // a plain capsule, or a flat part (a cut garment is no solid)
      gRadIn = gRad;
      if (ua.x < 0.0) {   // a flat part: its outline narrows with the view, as part() works it out
        vec3 e = normalize(b0p - a0p), w = gFwdV - e * dot(gFwdV, e); w = dot(w, w) > 1e-8 ? normalize(w) : vec3(0.0, 0.0, 1.0);
        vec3 s = cross(e, normalize(a0p + b0p)); float ls = length(s); s = ls > 1e-5 ? s / ls : cross(e, w);
        float su = dot(s, cross(e, w)), sw = dot(s, w) * Cq.x; gRadIn *= sqrt(su * su + sw * sw);
      }
    }
    gPa = pa; gPb = pb;
    return true;
  }
  void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vP = vec2(0.0); vZc = -1.0; vBase = 0; vCount = 0; vNear = 0.0; vMask = uvec4(0u); vKmax = 0.0; }
  void main() {
    int base = int(aBase + 0.5), count = int(aCount + 0.5);
    // stage 3, adaptive: a figure at least CELL_BIG of the screen's height tall takes the whole CELLS x CELLS grid,
    // any other half as many each way -- decided from its bounding sphere before any work, the unused cells culled
    int nEff = CELLS;
    vec3 bc = (viewMatrix * vec4(aBound.xyz, 1.0)).xyz; float sz = 2.0 * aBound.w * projectionMatrix[1][1] / max(-bc.z, 0.1);
    #if CELLS > 1
    { if (sz < CELL_BIG) nEff = max(1, CELLS / 2);
      if (int(aCell.x) >= nEff || int(aCell.y) >= nEff) { cull(); return; } }
    #endif
    // stage 3b: is the whole figure behind the world? Its bounding sphere's screen box, 4 x 4 samples of the
    // occluders' depth; every one of them must be NEARER than the sphere's nearest point for the figure to go.
    if (uOccOn > 0.5 && sz < uOccBig && bc.z < -0.1) {
      vec4 cp = projectionMatrix * vec4(bc, 1.0);
      vec2 c = cp.xy / cp.w * 0.5 + 0.5, r = vec2(aBound.w * projectionMatrix[0][0], aBound.w * projectionMatrix[1][1]) * 0.5 / -bc.z;
      if (all(greaterThan(c - r, vec2(0.0))) && all(lessThan(c + r, vec2(1.0)))) {   // (a figure crossing the screen's edge: left alone)
        float zNear = bc.z + aBound.w, p22 = projectionMatrix[2][2], p32 = projectionMatrix[3][2];
        bool hidden = true;
        for (int j = 0; j < 4 && hidden; j++) for (int i = 0; i < 4 && hidden; i++) {
          float d = textureLod(uOcc, c + r * (vec2(float(i), float(j)) / 1.5 - 1.0), 0.0).r;   // (a vertex shader has no derivatives: explicit LOD)      // window depth of whatever the world put there
          float zw = -p32 / (p22 + (d * 2.0 - 1.0));                                      // ...back to view metres (the far plane reads ~0, no cull)
          if (!(zw > zNear + 0.15)) hidden = false;                                       // nearer than the sphere's front, by a margin
        }
        if (hidden) { cull(); return; }
      }
    }
    { vec3 r0 = viewPt(texel(base * 3).xyz), r1 = viewPt(texel(base * 3 + 1).xyz), dd = r1 - r0;   // the figure's forward (its root: slot 0)
      gFwdV = dot(dd, dd) > 1e-10 ? normalize(dd) : vec3(0.0, 0.0, -1.0); }
    // the quad lives in the camera-parallel plane through the NEAREST part's
    // midpoint depth; parts at or behind the camera are left out
    float zc = -1e9, kmax = 0.0;
    for (int i = 0; i < ${MAXP}; i++) {
      if (i >= count) break;
      vec4 A = texel((base + i) * 3), B = texel((base + i) * 3 + 1);
      #ifndef NO_BLEND
        kmax = max(kmax, unpackAw(A.w).y);   // (off: nothing reaches past its own outline, so the cells pad by nothing)
      #endif
      vec3 a = viewPt(A.xyz), b = viewPt(B.xyz);
      if (min(a.z, b.z) > -0.05) continue;
      zc = max(zc, (a.z + b.z) * 0.5);
    }
    if (zc < -1e8) { cull(); return; }
    // never in front of the camera's near plane: a part closer than that
    // (the withers under a rider's eye) would take the WHOLE animal's quad
    // with it when the GPU clips; the plane stays just beyond it and the
    // fragment shader clips only the surfaces that are nearer
    zc = min(zc, -1.02 * projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0));
    vNear = -zc <= uNearDist ? 1.0 : 0.0;   // the 3D LOD: this animal is raymarched in the pre-pass
    #ifdef NEAR_PASS
      if (vNear < 0.5) { cull(); return; }
    #endif
    // stage 5: near figures go to the half-resolution pass, the main pass leaves them out
    #if defined(HALF_PASS)
      if (-zc > uHalfDist) { cull(); return; }
    #elif defined(HALF_SPLIT)
      if (-zc <= uHalfDist) { cull(); return; }
    #endif
    // bounding box of every projected part, padded for the fillets
    vec2 lo = vec2(1e9), hi = vec2(-1e9), l, h; float zm;
    for (int i = 0; i < ${MAXP}; i++) {
      if (i >= count) break;
      if (partBox((base + i) * 3, zc, l, h, zm)) { lo = min(lo, l); hi = max(hi, h); }
    }
    lo -= uPad; hi += uPad;
    vec2 c0 = lo, c1 = hi;
    uvec4 mask = uvec4(0xffffffffu);
    #if CELLS > 1
      // stage 3: this cell's rectangle and the parts that can reach into it --
      // a part's box padded by the animal's largest blend radius (at the
      // part's depth) and a hair for the outline: beyond that its distance
      // cannot change the smooth union, the colour, the depth or a seam
      // the grid covers only what is ON SCREEN of the quad (the frustum's
      // cross-section at depth zc, with a sliver of margin): a ridden mount's
      // quad reaches far past the screen, and cells out there would be wasted
      mat4 P = projectionMatrix;
      vec2 fLo = -zc * (vec2(-1.02) + vec2(P[2][0], P[2][1])) / vec2(P[0][0], P[1][1]);
      vec2 fHi = -zc * (vec2(1.02) + vec2(P[2][0], P[2][1])) / vec2(P[0][0], P[1][1]);
      vec2 sLo = max(lo, fLo), sHi = min(hi, fHi);
      if (any(greaterThanEqual(sLo, sHi))) { cull(); return; }   // wholly off screen
      vec2 ndc = (sHi - sLo) * vec2(P[0][0], P[1][1]) / -zc;
      if (max(ndc.x, ndc.y) < CELL_MIN) {   // small on screen: cell (0,0) takes the whole quad, the rest vanish
        if (aCell.x + aCell.y > 0.5) { cull(); return; }
      } else {
        c0 = mix(sLo, sHi, aCell / float(nEff)); c1 = mix(sLo, sHi, (aCell + 1.0) / float(nEff));
        vec2 cc = 0.5 * (c0 + c1); float cr = length(0.5 * (c1 - c0));   // the cell's centre and half diagonal
        mask = uvec4(0u);
        uvec4 marks = uvec4(0u); int cand = -1; float candFar = -1e9, zn1 = -1e9, zn2 = -1e9; int zn1i = -1;
        float mpx = 2.0 * -zc / (projectionMatrix[1][1] * uViewH);   // one pixel, in the quad's plane
        for (int i = 0; i < 128; i++) {
          if (i >= count) break;
          if (!partBox((base + i) * 3, zc, l, h, zm)) continue;
          float pad = kmax * (zc / zm) + 0.01 * -zc;
          if (h.x + pad < c0.x || l.x - pad > c1.x || h.y + pad < c0.y || l.y - pad > c1.y) continue;   // box test
          if (gRad.y >= 0.0 && sdUnevenCapsule(cc, gPa, gPb, gRad.x, gRad.y) > cr + pad) continue;   // the capsule itself stays clear of the cell
          uint bit = 1u << uint(i & 31); int w = i >> 5;
          uvec4 one = w == 0 ? uvec4(bit, 0u, 0u, 0u) : w == 1 ? uvec4(0u, bit, 0u, 0u) : w == 2 ? uvec4(0u, 0u, bit, 0u) : uvec4(0u, 0u, 0u, bit);
          mask |= one;
          #ifdef SOLID_CELLS
            if (gIsMark) { marks |= one; continue; }   // (painted on whatever wins: kept, never in the way)
            // only a part whose own outline reaches the cell can hide the candidate there (one listed for its blend's
            // reach alone merely shapes the union, which does not matter deep inside the candidate)
            bool reaches = h.x >= c0.x && l.x <= c1.x && h.y >= c0.y && l.y <= c1.y && (gRad.y < 0.0 || sdUnevenCapsule(cc, gPa, gPb, gRad.x, gRad.y) <= cr);
            if (reaches) { if (gZnear > zn1) { zn2 = zn1; zn1 = gZnear; zn1i = i; } else if (gZnear > zn2) zn2 = gZnear; }
            if (gSolid && gZfar > candFar) {   // a solid part holding all four corners a few pixels deep
              // (no blend margin: inside a part its colour and depth are its own -- a blend only shapes the union's
              // outline and the fillets between parts; the pixels keep seams and the edge's smoothing exact)
              float m = 4.0 * mpx;
              if (sdUnevenCapsule(c0, gPa, gPb, gRadIn.x, gRadIn.y) < -m && sdUnevenCapsule(c1, gPa, gPb, gRadIn.x, gRadIn.y) < -m &&
                  sdUnevenCapsule(vec2(c0.x, c1.y), gPa, gPb, gRadIn.x, gRadIn.y) < -m && sdUnevenCapsule(vec2(c1.x, c0.y), gPa, gPb, gRadIn.x, gRadIn.y) < -m) {
                cand = i; candFar = gZfar;
              }
            }
          #endif
        }
        #ifdef SOLID_CELLS
          if (cand >= 0 && (zn1i == cand ? zn2 : zn1) < candFar) {   // every other part's nearest point lies behind its farthest: it alone
            uint cb = 1u << uint(cand & 31); int cw5 = cand >> 5;
            mask = marks | (cw5 == 0 ? uvec4(cb, 0u, 0u, 0u) : cw5 == 1 ? uvec4(0u, cb, 0u, 0u) : cw5 == 2 ? uvec4(0u, 0u, cb, 0u) : uvec4(0u, 0u, 0u, cb));
          }
        #endif
        if (mask == uvec4(0u) && count <= 128) { cull(); return; }   // nothing here: the cell is not drawn
      }
    #endif
    vec2 p = mix(c0, c1, position.xy);
    vP = p; vZc = zc; vBase = base; vCount = count; vMask = mask; vKmax = kmax;
    gl_Position = projectionMatrix * vec4(p, zc, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  layout(location = 0) out highp vec4 fragColor;   // GLSL3: three.js leaves the output to us
  #define gl_FragColor fragColor
  uniform sampler2D tDyn, tStat, uNear, uNearZ, tOrd;
  uniform float uOutline;
  uniform vec2 uFull;
  uniform vec3 uBorder;
  uniform mat4 projectionMatrix, uInvView;
  varying vec2 vP;
  varying float vZc;
  flat varying int vBase, vCount;
  flat varying float vNear;
  flat varying uvec4 vMask;
  flat varying float vKmax;

  ${SDF_GLSL}
  ${CLOTH_GLSL}

  float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
  vec4 texel(int i) { return texelFetch(tDyn, ivec2(i % ${W}, i / ${W}), 0); }
  vec4 stat(int i) { return texelFetch(tStat, ivec2(i % ${W}, i / ${W}), 0); }   // ${ST} per part: (rgb, flags), (rgb2, cloth code), (panel rgb, panel place)
  // stage 7: the part in this slot -- its place in the figure's own list (the order it was built in; four per texel)
  float ordOf(int slot) { int t = slot >> 2, c = slot & 3; vec4 v = texelFetch(tOrd, ivec2(t % ${W}, t / ${W}), 0); return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w; }
  ${VIEW_GLSL}
  ${PACK_GLSL}
  ${WORLD_GLSL}
  ${CLIP_GLSL}
  vec3 gFwd;   // the animal's forward direction in view space (its root segment), for front cuts
  bool gMark;  // part() met a face mark: no shape, main paints it onto the winning surface
  float gZf;   // stage 7: the part's nearest possible depth (view z, its ends' plus its greatest radius) -- sync's sort key
  // stage 3: does part i reach into this pixel's cell? (always, with cells off)
  bool inCell(int i) {
    #if CELLS > 1
      if (i >= 128) return true;
      uint m = i < 32 ? vMask.x : i < 64 ? vMask.y : i < 96 ? vMask.z : vMask.w;
      return (m & (1u << uint(i & 31))) != 0u;
    #else
      return true;
    #endif
  }

  // one part's projected silhouette (distance, frame, radii in the plane),
  // its true surface along this pixel's ray (hit distance, -1 if none or a
  // membrane), its plane depth for the fallback, and its camera-space endpoints
  bool part(int i, vec3 rd, out float d, out vec2 pa, out vec2 pb, out vec2 rad, out float zm, out float k, out vec3 av, out vec3 bv, out float hit, out float rw, out float mg, out float hk) {
    int t = (vBase + i) * 3;
    mg = 1e9; hk = 0.0;
    vec4 A = texel(t), B = texel(t + 1);
    vec3 ua = unpackAw(A.w); A.w = ua.x;   // (the third texel only where it carries something: two reads for a plain capsule)
    vec4 C = ua.z > 0.5 || B.w < -0.5 ? texel(t + 2) : vec4(0.0, 0.0, 0.0, ua.y);
    gMark = C.w < -1.5;
    if (C.w < -0.5) return false;   // a bone, or a face mark (painted once the pixel's winner is known, see main)
    vec3 a = viewPt(A.xyz), b = viewPt(B.xyz);
    if (min(a.z, b.z) > -0.05) return false;
    av = a; bv = b;
    // the silhouette uses the segment clipped at the near plane (a part half
    // behind the camera still shows its front half); the ray hit uses the whole solid
    vec3 a0 = a, b0 = b; float ra = abs(A.w), rb = B.w;   // (A.w < 0: a flat part, squashed by C.x)
    gZf = max(a0.z, b0.z) + max(ra, max(rb, 0.0));
    clipNear(a, b, ra, rb);
    float ka = vZc / a.z, kb = vZc / b.z;
    pa = a.xy * ka; pb = b.xy * kb;
    zm = (a.z + b.z) * 0.5;
    // the blend radius is world metres; distances here are measured in the
    // plane at depth vZc, where a metre at this part's depth is vZc/zm --
    // without this a part far behind the plane (the head seen from the
    // saddle) would melt with a radius many times its own
    k = C.w * (vZc / zm);
    if (B.w < -1.5) {   // a tube: the curve's nearest point in the plane; along the ray, the sphere of its radius there
      vec3 c = viewPt(C.xyz);
      if (c.z > -0.05) return false;
      vec2 pc = c.xy * (vZc / c.z), rb2 = tubeUnpack(B.w);
      float tt = bezierT(vP, pa, pc, pb);
      vec3 P = bezier3(a0, c, b0, tt);
      float rr = tubeR(tt, A.w, rb2), kt = vZc / min(P.z, -0.05);
      d = length(vP - bezier2(pa, pc, pb, tt)) - rr * kt;
      rad = vec2(rr * kt); rw = max(max(A.w, rb2.x), rb2.x + rb2.y); zm = P.z; k = C.w * (vZc / zm);
      gZf = max(max(a0.z, b0.z), c.z) + rw;
      // its frame for texture and shading: the tangent there, placed so the axial coordinate runs with t
      vec3 T = 2.0 * mix(c - a0, b0 - c, tt); float L = length(c - a0) + length(b0 - c);
      T = dot(T, T) > 1e-12 ? normalize(T) : normalize(b0 - a0 + 1e-6);
      av = P - T * (tt * L); bv = av + T * L;
      float pr = dot(P, rd), disc = rr * rr - (dot(P, P) - pr * pr);
      hit = disc >= 0.0 ? pr - sqrt(disc) : max(pr, 0.05);
      return true;
    }
    if (B.w < -0.5) {
      vec3 c = viewPt(C.xyz);
      if (c.z > -0.05) return false;
      vec2 pc = c.xy * (vZc / c.z);
      gZf = max(gZf, c.z + A.w);
      d = sdTri(vP, pa, pb, pc) - A.w * ka;
      rad = vec2(A.w * ka, -1.0); zm = (a.z + b.z + c.z) / 3.0; rw = A.w;
      vec3 nt = cross(b - a, c - a); float dn = dot(rd, nt);
      hit = abs(dn) > 1e-9 ? dot(a, nt) / dn : -1.0;   // the membrane's own plane along this ray: a slanted apron or wing at its true depth
      if (hit <= 0.0 || hit > -4.0 * zm) hit = -1.0;
    } else {
      // FLAT parts (A.w < 0): a round cone squashed along the figure's forward (gFwd, square to its axis) to C.x of
      // its width -- the outline narrows with the view's angle to that axis (the ellipse's width across the screen);
      // the exact hit is the round cone's in the unsquashed space (ray and ends scaled by 1/C.x along that axis)
      bool sqz = A.w < 0.0; float g = 1.0, sq = 0.0; vec3 w = vec3(0.0);
      if (sqz) {
        vec3 e = normalize(b0 - a0); w = gFwd - e * dot(gFwd, e); w = dot(w, w) > 1e-8 ? normalize(w) : vec3(0.0, 0.0, 1.0);
        vec3 s = cross(e, normalize(a0 + b0)); float ls = length(s); s = ls > 1e-5 ? s / ls : cross(e, w);
        float su = dot(s, cross(e, w)), sw = dot(s, w) * C.x;
        g = sqrt(su * su + sw * sw); sq = 1.0 / C.x - 1.0;
      }
      rad = vec2(ra * ka, rb * kb) * g;
      d = sdUnevenCapsule(vP, pa, pb, rad.x, rad.y);
      rw = max(abs(A.w), B.w);
      if (sqz) {
        hit = approachT(rd, a0, b0);
        if (d < 0.0) {
          vec3 rq = rd + sq * w * dot(w, rd); float lq = length(rq);
          float tq = hitCone(rq / lq, a0 + sq * w * dot(w, a0), b0 + sq * w * dot(w, b0), -A.w, B.w);
          if (tq > 0.0) hit = tq / lq;
        }
      } else if (C.z > 0.5) {   // clothing cut by a slab: only a hit that survives the cut covers the pixel
        hit = -1.0;
        if (d < 0.0) clipHit(rd, a0, b0, A.w, B.w, C.xyz, gFwd, hit, hk, mg);
        if (hit < 0.0) { d = max(d, 1e-4); hit = approachT(rd, a0, b0); }
      } else hit = d < 0.0 ? surfaceT(rd, a0, b0, A.w, B.w) : approachT(rd, a0, b0);   // the exact hit where covered, the limb's depth otherwise (slivers, fillets)
    }
    return true;
  }

  // FUR (mammals' coats, the part flag): short strands lying along the body (the animal frame's x, nose to tail) and
  // down the limbs (a part's own axis) -- two stretched value noises, a faint shading between strands, over whatever
  // colour or pattern is there; gone once a strand falls under a couple of pixels (then not even worked out)
  vec3 furAt(vec3 col, vec3 p) {
    const float ACROSS = 55.0, ALONG = 8.0;   // strands ~2cm apart, ~12cm long
    float detail = 1.0 - smoothstep(.5, 1.2, gPatPx * ACROSS);
    if (detail < .01) return col;
    float n = .5 * vnoise(vec2(p.y * ACROSS, p.x * ALONG)) + .5 * vnoise(vec2(p.z * ACROSS + 7.0, p.x * ALONG + 3.0));
    return col * mix(1.0, .86 + .24 * n, detail);
  }
  void main() {
    float dU = 1e9;                      // the animal's whole silhouette (smooth union)
    // the union: the EIGHT nearest parts are kept, then blended one after another in the figure's OWN list order, each
    // with its own blend radius -- exactly the running smooth union the list order always gave (a part farther than
    // the eight nearest changes nothing there -- checked: identical to the old running union), whatever order stage 7 puts the parts in for this camera
    // (stage 7 only: without it the parts come in the figure's own order and the union runs as it always did)
    #ifdef EARLY_OUT
    const int NU = 8;
    float ud[NU], uk[NU], uo[NU];
    for (int j = 0; j < NU; j++) { ud[j] = 1e9; uk[j] = 0.0; uo[j] = 1e9; }
    #endif
    float dMin = 1e9; int nearI = -1;    // the part nearest to this pixel (for fillet pixels no part covers)
    float zBest = -1e9; int best = -1;   // among covering parts: the nearest surface
    float zSec = -1e9; int sec = -1;     // ...and the next one behind it (a seam shows where it has another colour)
    float dB = 1e9; vec2 bA, bB, bRad; vec3 bAv, bBv; float tBest = -1.0, rwB = 0.0, mgB = 1e9, hkB = 0.0;
    float d, zm, k, hit, rw, mg, hk; vec2 pa, pb, rad; vec3 av, bv;
    int nEval = 0;                       // (PIPE.debug) parts this pixel evaluated
    int mks[6]; int nm = 0;              // the face marks this pixel's cell lists (eyes, brows, a mouth)
    bool early = false;                  // stage 7: the loop stopped deep inside the surface it had won
    vec3 rd = normalize(vec3(vP, vZc));   // this pixel's view ray (the camera is the view-space origin)
    gRelief = vec3(0.0);                  // the pixel's relief, added to by the cloth and the face marks below
    float px = fwidth(vP.x);              // one pixel in the plane, in metres
    vec3 rootD = viewPt(texel(vBase * 3 + 1).xyz) - viewPt(texel(vBase * 3).xyz);
    gFwd = dot(rootD, rootD) > 1e-10 ? normalize(rootD) : vec3(0.0, 0.0, -1.0);
    for (int i = 0; i < ${MAXP}; i++) {
      if (i >= vCount) break;
      if (!inCell(i)) continue;   // stage 3: too far from this cell to matter
      nEval++;
      if (!part(i, rd, d, pa, pb, rad, zm, k, av, bv, hit, rw, mg, hk)) { if (gMark && nm < 6) { mks[nm] = i; nm++; } continue; }
      #ifdef EARLY_OUT
      if (d < ud[NU - 1]) { float o = ordOf(vBase + i); int j = NU - 1; while (j > 0 && ud[j - 1] > d) { ud[j] = ud[j - 1]; uk[j] = uk[j - 1]; uo[j] = uo[j - 1]; j--; } ud[j] = d; uk[j] = k; uo[j] = o; }
      #else
      #ifdef NO_BLEND
        dU = min(dU, d);
      #else
        dU = k > 0.0 ? smin(dU, d, k) : min(dU, d);
      #endif
      #endif
      if (d < dMin) { dMin = d; nearI = i; }
      if (d < 0.0) {
        // the nearest true surface wins the pixel (a membrane sits at its plane)
        float z = hit > 0.0 ? rd.z * hit : zm;
        if (viewDepth(projectionMatrix, rd * (z / rd.z)) < 0.0) continue;   // before the near plane (or behind a mirror's glass): clipped, as a mesh's would be
        if (z > zBest) { zSec = zBest; sec = best; zBest = z; best = i; dB = d; bA = pa; bB = pb; bRad = rad; bAv = av; bBv = bv; tBest = hit; rwB = rw; mgB = mg; hkB = hk; }
        else if (z > zSec) { zSec = z; sec = i; }
      }
      #ifdef EARLY_OUT
        // stage 7: the parts come nearest-first -- once this one's nearest point lies behind the surface already won,
        // none left can win; deep inside the winner's outline (past every blend and the edge's pixels, clear of a
        // cut) nothing left can change the pixel either: no fillet, no seam, no outline
        if (i > 0 && best >= 0 && gZf + 1e-3 < zBest &&   // (slot 0 is the root, outside the order)
            dB < -(vKmax * (vZc / zBest) + 2.0 * px) && mgB > 2.0 * px * zBest / vZc) { early = true; break; }
      #endif
    }
    #ifdef EARLY_OUT
    {
      for (int a = 1; a < NU; a++) { float d0 = ud[a], k0 = uk[a], o0 = uo[a]; int j = a;   // the figure's own order
        while (j > 0 && uo[j - 1] > o0) { ud[j] = ud[j - 1]; uk[j] = uk[j - 1]; uo[j] = uo[j - 1]; j--; }
        ud[j] = d0; uk[j] = k0; uo[j] = o0; }
      dU = ud[0];
      #ifdef NO_BLEND
        for (int j = 1; j < NU; j++) { if (ud[j] > 1e8) continue; dU = min(dU, ud[j]); }
      #else
        for (int j = 1; j < NU; j++) { if (ud[j] > 1e8) continue; dU = uk[j] > 0.0 ? smin(dU, ud[j], uk[j]) : min(dU, ud[j]); }
      #endif
    }
    #endif
    // the 3D LOD: a near animal's marched surface (colour, coverage, depth) at this pixel
    #ifdef HALF_PASS
      bool n3 = false;   // (the half buffer has no use for the full-size near buffer)
    #else
      bool n3 = vNear > 0.5;
    #endif
    vec4 nc = n3 ? texture(uNear, gl_FragCoord.xy / uFull) : vec4(0.0);
    float z3 = n3 ? texture(uNearZ, gl_FragCoord.xy / uFull).r : -1e9;
    bool cov3 = n3 && nc.a > 0.5;
    #ifdef HALF_PASS
      // the half buffer keeps the EDGE AS A DISTANCE, not a coverage: alpha is a ramp through the
      // silhouette (1/2 on it, 0 one buffer pixel out), which bilinear upsampling carries exactly; the
      // blit thresholds it at 1/2 with one screen pixel of smoothing -- a crisp edge, never see-through
      // (a fade would turn thin parts ghostly). Two buffer pixels beyond the edge still get the nearest
      // part's colour and depth, so the filtering never mixes in the cleared background.
      float fw = clamp(fwidth(dU), 1e-6, 2.0 * px);   // (capped: where a solid cell meets a full one, dU may step -- never a see-through seam)
      if (dU > 2.0 * fw || nearI < 0) discard;
      float cover = clamp(0.5 - 0.5 * dU / fw, 0.0, 1.0);
      if (early) cover = 1.0;   // (stopped deep inside: dU is a partial union there, its derivative meaningless)
    #else
      if ((dU > 0.0 && !cov3) || nearI < 0) discard;
    #endif
    if (best < 0) {   // a fillet pixel between parts: the nearest part's colour, at its limb's depth
      best = nearI; part(best, rd, dB, bA, bB, bRad, zBest, k, bAv, bBv, hit, rwB, mgB, hkB); tBest = hit; sec = -1;
      if (hit > 0.0) zBest = rd.z * hit;
      if (viewDepth(projectionMatrix, rd * (zBest / rd.z)) < 0.0) discard;
    }
    // a near animal's fillet pixels (no primitive hit exactly here) come from
    // the marched 3D surface: its colour and depth where it covers the pixel,
    // nothing where it says the true union is outside
    bool use3 = n3 && tBest <= 0.0 && cov3;
    if (n3 && !cov3 && tBest <= 0.0) discard;
    vec3 bAw = (uInvView * vec4(bAv, 1.0)).xyz, bBw = (uInvView * vec4(bBv, 1.0)).xyz;   // the winner's endpoints in the world (patterns, shading)
    vec4 S = stat((vBase + best) * ${ST});
    float flags = mod(S.w, 256.0), pat = floor(flags / 8.0 + 0.01), hi = floor(S.w / 256.0);
    bool furry = mod(hi, 2.0) > .5, panelled = hi > 1.5;   // (256: fur, 512: a panel painted on it)
    bool bodyFrame = mod(flags, 8.0) >= 4.0, edge = mod(flags, 4.0) >= 2.0, seamed = mod(flags, 2.0) >= 1.0, tri = bRad.y < -0.5;
    // optional 1px outline: round the whole silhouette, plus a part's own band if it is flagged edge
    float cap = tri ? 1e9 : 0.5 * min(bRad.x, bRad.y);   // thin parts keep their fill colour
    bool border = uOutline > 0.5 && (dU > -min(fwidth(dU), cap) || (edge && dB > -min(fwidth(dB), cap)));
    if (use3) {   // the pre-pass shaded this pixel: its colour (pattern included), normal and depth; the outline follows the 2D union's edge
      border = uOutline > 0.5 && dU > -min(fwidth(dU), 0.5 * min(bRad.x, abs(bRad.y)));
      vec3 n3 = texture(uNearZ, gl_FragCoord.xy / uFull).gba;
      gl_FragColor = vec4(border ? uBorder : nc.rgb * shadeOf(n3), 1.0);
      #include <colorspace_fragment>
      float zv3 = min(z3, -0.01);
      { float fd = viewDepth(projectionMatrix, vec3(vP, vZc) * (zv3 / vZc)); if (fd < 0.0) discard; gl_FragDepth = fd; }
      return;
    }
    vec3 col = border ? uBorder : S.rgb;
    if (!border) {
      // the pixel's surface point back in world space -- for the solid
      // texture (in the animal's frame for torso pieces: one continuous coat
      // across rump, chest and neck, rebuilt from the root part's segment;
      // in the part's own frame for limbs and tails: rings that swing with
      // the leg) and for the orientation shading
      vec3 pv = tBest > 0.0 ? rd * tBest : vec3(vP, vZc) * (zBest / vZc);
      vec3 pw = (uInvView * vec4(pv, 1.0)).xyz;
      vec4 S2 = stat((vBase + best) * ${ST} + 1);
      float code = floor(S2.w + 0.5);
      if (pat > 0.5 || code > 0.5 || furry || panelled) {
        vec3 pl, pp;
        if (bodyFrame) {
          vec3 A0 = worldPt(texel(vBase * 3).xyz), B0 = worldPt(texel(vBase * 3 + 1).xyz), dd = B0 - A0;
          vec3 fw = length(dd) > 1e-4 ? normalize(dd) : vec3(1.0, 0.0, 0.0), lf = cross(vec3(0.0, 1.0, 0.0), fw);
          vec3 q = pw - 0.5 * (A0 + B0);
          pl = vec3(dot(q, fw), q.y, dot(q, lf));
          // rosettes are unwrapped round the frame's axis: a piece well off the trunk's axis (neck, head, snout) takes
          // one through itself -- its own if long (the neck), else the animal's orientation through its centre
          vec3 cP = 0.5 * (bAw + bBw), o = cP - 0.5 * (A0 + B0);
          if (abs(pat - 18.0) < 0.5 && length(o - fw * dot(o, fw)) > 0.5 * rwB) {
            if (length(bBw - bAw) > rwB) pp = partLocal(pw, bAw, bBw);
            else { vec3 c = pw - cP; pp = vec3(dot(c, fw), c.y, dot(c, lf)); }
          } else pp = pl;
        } else pp = pl = partLocal(pw, bAw, bBw);
        gPatPx = px * zBest / vZc;   // (the pixel's size at the surface: scales, rosettes and fur fade by it)
        vec3 nL = cross(dFdx(pp), dFdy(pp)); gPatAx = abs(nL.x) / max(length(nL), 1e-9);   // (the surface's tilt to the frame's axis: rosettes fade where it faces along it)
        vec3 clw = tri ? vec3(0.0) : texel((vBase + best) * 3 + 2).xyz;   // a garment's cut -- or a flat part's squash and painted band
        if ((pat > 8.5 && pat < 16.5) || code > 0.5 || clw.z < -0.5 || panelled)
          col = clothAt(col, S2.rgb, pat, code, pl, bodyFrame, pw, bAw, bBw, rwB, clw, hkB, texel((vBase + best) * 3).w < 0.0 ? max(clw.x, .05) : 1.0,
                        panelled ? stat((vBase + best) * ${ST} + 2) : vec4(0.0));
        else if (pat > 0.5) col = patternAt(col, pat, pp, rwB);
        if (furry) col = furAt(col, pl);
      }
      // FACE MARKS: painted where this pixel's winning surface point lies on one -- within a hair of the plane
      // touching its parent there, inside its outline (a lens with pointed corners, or round); hair, a brim or
      // a nose in front win the pixel and are left alone. An eye: white (or a dark rim), iris, pupil, a glint
      if (nm > 0 && tBest > 0.0) {
        vec3 P = rd * tBest;
        for (int m = 0; m < 6; m++) {
          if (m >= nm) break;
          int t3 = (vBase + mks[m]) * 3;
          vec3 mc0 = viewPt(texel(t3).xyz), mu = viewPt(texel(t3 + 1).xyz) - mc0, mv = viewPt(texel(t3 + 2).xyz) - mc0, dp = P - mc0;
          float lv = length(mv);
          vec4 M1 = stat((vBase + mks[m]) * ${ST}), M2 = stat((vBase + mks[m]) * ${ST} + 1);
          float fl = M1.w; bool rnd = mod(floor(fl / 8.0), 2.0) > .5; float pupil = floor(mod(fl, 8.0) / 2.0 + .01);
          float rel = floor(mod(fl, 64.0) / 16.0 + .01);   // 0 none, 1 a ridge (a brow) -- an eyeball's own relief comes with its iris
          // off its surface: a person's (lens) mark keeps tight to the skin (hair stands 5-8mm out); an animal's round
          // eye also takes a face disc or a patch standing a little proud of the head sphere (an owl's, a parrot's)
          vec2 q = vec2(dot(dp, mu) / dot(mu, mu), dot(dp, mv) / (lv * lv));   // (q.y: up the face)
          // an EXPRESSION's style (faces.js, via markRows in B.w): 2 a closed eye, 3 a smile, 4 a frown, 5 an open mouth,
          // 6 teeth, 7.x a crying eye (x: its tear's phase), 9 an eye squeezed shut laughing
          float fx = texel(t3 + 1).w, off = abs(dot(dp, normalize(cross(mu, mv))));
          if (fx > 6.5 && fx < 8.0) {   // a crying eye's tear: a drop running down the cheek from under it, fading, then the next
            float ph = fx - 7.0, a = smoothstep(0.0, .12, ph) * (1.0 - smoothstep(.62, 1.0, ph));
            vec2 d = vec2(q.x * length(mu) / lv, q.y) - vec2(.1, -1.25 - ph * 4.3);   // (in half-heights)
            if (d.y > 0.0) d.y *= .55;   // its tail drawn out upward
            if (a > .01 && off < .012 && length(d) < .48) {   // (off its plane: the cheek falls away below the eye)
              col = mix(col, length(d - vec2(-.13, -.1)) < .15 ? vec3(.97) : vec3(.62, .78, .92), .8 * a);
              continue;
            }
          }
          if (off > (rnd ? .6 : .2) * lv + .0015) continue;
          // RELIEF round the mark -- the face's shape where it costs no geometry: the ridge of a brow over the
          // forehead, the socket the eye sits in. Each reaches as far as the mark's own reach lists it in the cells
          // (people.js dot.reach), and the light does the rest; the eyeball's own cap is inside its outline below.
          if (rel > 0.5 || mod(fl, 2.0) > .5) {
            vec2 g = vec2(0.0), ev = vec2(q.x * length(mu) / lv, q.y);   // in half-heights, up the face
            if (rel > 0.5) {                                             // a ridge along the mark, dying out beyond its ends
              float n = ev.y / 3.0, tap = max(0.0, 1.0 - q.x * q.x), bell = max(0.0, 1.0 - n * n);
              g += vec2(BROWH * bell * bell * -2.0 * q.x * lv / max(length(mu), 1e-4), BROWH * bell * (-4.0 * n / 3.0) * tap);
            } else {                                                     // the socket: a shallow trough round the eyeball
              float K = rnd ? .8 : .95, r = length(ev), m = clamp((r - K) / (1.9 - K), 0.0, 1.0);
              if (m > 0.0 && m < 1.0) g += (ev / max(r, 1e-4)) * (-SOCK * 4.0 * (1.0 - 2.0 * m) / (1.9 - K));
            }
            gRelief += mat3(uInvView) * (normalize(mu) * g.x + normalize(mv) * g.y) / lv;
          }
          if (fx > 9.5 && fx < 10.5) {   // a struck-down figure's eye (combat.js): dark red all over, no pupil, no glint
            if (rnd ? dot(q, q) > 1.0 : abs(q.y) > 1.0 - q.x * q.x) continue;
            col = vec3(.55, .04, .04) * (rnd ? 1.0 - .35 * dot(q, q) : 1.0);
            continue;
          }
          if (fx > 8.5 && fx < 9.5) {   // an eye squeezed shut laughing: the lid's line bowed upward
            if (abs(q.y - .25 + .5 * q.x * q.x) < .17 && abs(q.x) < .92) col = vec3(.13, .09, .08);
            continue;
          }
          if (fx > 4.5 && fx < 5.5) {   // an open mouth: an oval, dark within the lips
            float r2 = dot(q, q);
            if (r2 > 1.0) continue;
            col = r2 > .45 ? M1.rgb : vec3(.2, .06, .06);
            continue;
          }
          if (fx > 1.5 && fx < 2.5) {   // a closed eye: the skin stays; only the lashes' line along the lid, sagging in the middle
            if (abs(q.y + .3 - .3 * q.x * q.x) < .16 && abs(q.x) < .92) col = vec3(.13, .09, .08);
            continue;
          }
          float bend = (fx > 2.5 && fx < 3.5) || (fx > 5.5 && fx < 6.5) ? 1.1 : fx > 3.5 && fx < 4.5 ? -1.1 : 0.0;   // a smile's corners up, a frown's down (half-heights)
          float y = q.y - bend * q.x * q.x;
          if (rnd ? dot(q, q) > 1.0 : abs(y) > 1.0 - q.x * q.x) continue;
          vec3 mcol = M1.rgb;
          if (fx > 5.5 && fx < 6.5 && abs(y) < .55 * (1.0 - q.x * q.x) && abs(q.x) < .8) mcol = abs(y) < .07 ? vec3(.3, .2, .18) : vec3(.93, .9, .84);   // the teeth, a dark line between the rows
          if (mod(fl, 2.0) > .5) {
            float K = rnd ? .8 : .95;
            vec2 e = vec2(q.x * length(mu) / lv, q.y);   // in half-heights
            if (length(e) < K) {
              mcol = M2.rgb;
              // the eyeball is a BALL, not a sticker: a parabolic cap in the mark's own frame lifts the normal
              // (relief, no geometry), and the upper lid lays its shadow over the top of it
              gRelief += mat3(uInvView) * (normalize(mu) * e.x + normalize(mv) * e.y) * (-2.0 * BALL / (K * K * lv));
              bool pu = pupil < .5 ? length(e) < .42 * K : pupil < 1.5 ? abs(e.y) < .16 * K && abs(e.x) < .62 * K : abs(e.x) < .13 * K && abs(e.y) < .85 * K;
              if (pu) mcol = vec3(.015);
              if (length(e - vec2(-.3, .38) * K) < .14 * K) mcol = vec3(.85);   // the glint
              mcol *= 1.0 - .35 * smoothstep(.55, 1.0, dot(e, e) / (K * K)) * step(0.0, e.y);   // ...and the lid's shadow over all of it
            }
          }
          col = mcol;
        }
      }
      vec3 rdw = mat3(uInvView) * rd, nw;
      if (tri) nw = triNormal(bAw, bBw, worldPt(texel((vBase + best) * 3 + 2).xyz), rdw);
      else if (hkB > 1.5) { nw = normalize(bBw - bAw); if (dot(nw, rdw) > 0.0) nw = -nw; }   // a flat cap, facing the viewer
      else if (texel((vBase + best) * 3).w < 0.0 && tBest > 0.0) {   // a flat part: the round part's normal, carried back through the squash
        float sq = 1.0 / texel((vBase + best) * 3 + 2).x - 1.0;
        vec3 P = rd * tBest, e = normalize(bBv - bAv), w = gFwd - e * dot(gFwd, e);
        w = dot(w, w) > 1e-8 ? normalize(w) : vec3(0.0, 0.0, 1.0);
        vec3 nr = capsuleNormal(P + sq * w * dot(w, P), bAv + sq * w * dot(w, bAv), bBv + sq * w * dot(w, bBv));
        nw = normalize(mat3(uInvView) * normalize(nr + sq * w * dot(w, nr)));
      }
      else { nw = capsuleNormal(pw, bAw, bBw); if (hkB > 0.5) nw = -nw; }
      // relief (cloth folds, the face's ridges and hollows): tilt the normal by the height field's surface gradient
      if (dot(gRelief, gRelief) > 0.0) nw = normalize(nw - RELIEF * (gRelief - nw * dot(gRelief, nw)));
      col *= shadeOf(nw);
      if (hkB > 0.5 && hkB < 1.5) col *= .6;   // the inside of a shell: a hood's lining, a skirt from below
      // seams: a 1px dark line along this part's edge -- its silhouette or its
      // cut -- wherever the surface behind it there has another colour
      if (seamed && sec >= 0 && dot(abs(stat((vBase + sec) * ${ST}).rgb - S.rgb), vec3(1.0)) > .03
          && (dB > -px || mgB < px * zBest / vZc)) col *= .55;
    }
    #ifdef PIPE_DEBUG
      float share = float(nEval) / float(max(vCount, 1));
      col = mix(col * .3, mix(vec3(.1, .9, .2), vec3(1.0, .1, .1), share), .75);
    #endif
    #ifdef HALF_PASS
      gl_FragColor = vec4(col, cover);   // straight colour (the fringe carries real colour) + the edge ramp
    #else
      gl_FragColor = vec4(col, 1.0);
    #endif
    #include <colorspace_fragment>
    float zv = min(zBest, -0.01);
    #ifdef FLAT_DEPTH
      if (viewDepth(projectionMatrix, vec3(vP, vZc) * (zv / vZc)) < 0.0) discard;   // (the quad's own depth stands: early-z lives)
    #else
      { float fd = viewDepth(projectionMatrix, vec3(vP, vZc) * (zv / vZc)); if (fd < 0.0) discard; gl_FragDepth = fd; }
    #endif
  }
`;

// The 3D pre-pass fragment shader: sphere-trace the smooth union of the
// animal's rounded cones along this pixel's ray. Writes two targets:
//   0: rgb = colour with pattern at the hit, a = coverage (1 hit; a miss keeps
//      0.5 - its closest approach in buffer pixels, so the full-resolution
//      pass can magnify the edge cleanly)
//   1: r = view depth of the hit
const FRAG_NEAR = /* glsl */ `
  precision highp float;
  layout(location = 0) out highp vec4 o0;
  layout(location = 1) out highp vec4 o1;
  uniform sampler2D tDyn, tStat;
  uniform mat4 projectionMatrix, uInvView;
  uniform float uPx3;
  varying vec2 vP;
  varying float vZc;
  flat varying int vBase, vCount;
  flat varying float vNear;

  ${SDF_GLSL}

  float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
  vec4 texel(int i) { return texelFetch(tDyn, ivec2(i % ${W}, i / ${W}), 0); }
  ${VIEW_GLSL}
  ${PACK_GLSL}
  ${WORLD_GLSL}
  // exact signed distance to a rounded cone from a (r1) to b (r2) (iq)
  float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
    vec3 ba = b - a; float l2 = dot(ba, ba);
    if (l2 < 1e-8) return length(p - a) - max(r1, r2);
    float rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1.0 / l2;
    vec3 pa = p - a; float y = dot(pa, ba), z = y - l2;
    vec3 w = pa * l2 - ba * y; float x2 = dot(w, w), y2 = y * y * l2, z2 = z * z * l2, k = sign(rr) * rr * rr * x2;
    if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
    if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
    return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
  }
  ${CLIP_GLSL}
  const int NC = 12;   // parts one ray can pass near
  void main() {
    vec3 rd = normalize(vec3(vP, vZc));
    // only fillet pixels march: if this ray exactly hits any primitive the
    // main pass already has the exact surface, and far outside the 2D
    // union there is nothing a fillet could bulge into
    float dU = 1e9, kmax = 0.0, kPlane = 0.0;
    for (int i = 0; i < ${MAXP}; i++) {
      if (i >= vCount) break;
      int t3 = (vBase + i) * 3;
      vec4 A = texel(t3), B = texel(t3 + 1); vec3 ua = unpackAw(A.w); A.w = ua.x; vec4 C = ua.z > 0.5 || B.w < -0.5 ? texel(t3 + 2) : vec4(0.0, 0.0, 0.0, ua.y);
      kmax = max(kmax, C.w);
      if (B.w < -0.5 || C.z > 0.5 || C.w < -0.5) continue;   // membranes, cut clothing and bones stay out of the marched union
      vec3 a = viewPt(A.xyz), b = viewPt(B.xyz);
      if (min(a.z, b.z) > -0.05) continue;
      vec3 a0 = a, b0 = b; float ra = abs(A.w), rb = B.w;
      clipNear(a, b, ra, rb);
      float ka = vZc / a.z, kb = vZc / b.z, zm = (a.z + b.z) * 0.5, k = C.w * (vZc / zm);
      float d = sdUnevenCapsule(vP, a.xy * ka, b.xy * kb, ra * ka, rb * kb);
      if (d < 0.0 && hitCone(rd, a0, b0, abs(A.w), B.w) > 0.0) discard;   // an exact hit: not a fillet pixel
      #ifdef NO_BLEND
        dU = min(dU, d);
      #else
        dU = k > 0.0 ? smin(dU, d, k) : min(dU, d);
      #endif
      kPlane = max(kPlane, k);
    }
    if (dU > kPlane) discard;
    // the parts this ray passes within blending reach of: a closest-approach test each
    vec4 ca[NC], cb[NC]; float ck[NC]; int ci[NC]; int n = 0;
    float tStart = 1e9, tEnd = 0.0;
    for (int i = 0; i < ${MAXP}; i++) {
      if (i >= vCount) break;
      int t3 = (vBase + i) * 3;
      vec4 A = texel(t3), B = texel(t3 + 1); vec3 ua = unpackAw(A.w); A.w = ua.x; vec4 C = ua.z > 0.5 || B.w < -0.5 ? texel(t3 + 2) : vec4(0.0, 0.0, 0.0, ua.y);
      if (B.w < -0.5 || C.z > 0.5 || C.w < -0.5) continue;   // membranes and cut clothing stay 2D (bones: not drawn)
      vec3 a = viewPt(A.xyz), b = viewPt(B.xyz);
      vec3 ba = b - a;
      float m0 = dot(ba, ba), m2 = dot(ba, rd), m1 = dot(ba, a), m3 = dot(rd, a), den = m2 * m2 - m0;
      float s = abs(den) > 1e-8 ? clamp((m1 - m2 * m3) / den, 0.0, 1.0) : 0.5;
      float t = max(m3 + m2 * s, 0.0);
      float reach = max(abs(A.w), B.w) + C.w + kmax;
      if (length(rd * t - (a + ba * s)) > reach + 0.01 || n >= NC) continue;
      ca[n] = vec4(a, abs(A.w)); cb[n] = vec4(b, B.w); ck[n] = C.w; ci[n] = i; n++;
      tStart = min(tStart, t - reach); tEnd = max(tEnd, t + reach);
    }
    if (n == 0) discard;
    // sphere tracing of the smooth union of just those parts
    float t = max(tStart, 0.05), minPx = 1e9; bool hit = false; int nearest = 0; vec3 p = vec3(0.0);
    for (int s = 0; s < 64; s++) {
      p = rd * t;
      float d = 1e9, dn = 1e9;
      for (int j = 0; j < NC; j++) {
        if (j >= n) break;
        float dj = sdRoundCone(p, ca[j].xyz, cb[j].xyz, ca[j].w, cb[j].w);
        d = ck[j] > 0.0 ? smin(d, dj, ck[j]) : min(d, dj);
        if (dj < dn) { dn = dj; nearest = j; }
      }
      float px = t * uPx3;   // one buffer pixel at this depth
      minPx = min(minPx, d / px);
      if (d < px * 0.5) { hit = true; break; }
      t += d * 0.9;
      if (t > tEnd) break;
    }
    if (!hit) {   // a miss: leave the edge's distance for magnification, behind everything
      o0 = vec4(0.0, 0.0, 0.0, clamp(0.5 - minPx, 0.0, 0.5));
      o1 = vec4(-1e9, 0.0, 0.0, 1.0);
      gl_FragDepth = 0.9999;
      return;
    }
    // colour: the nearest primitive's, patterned at the true surface point
    int idx = ci[nearest];
    vec4 S = texelFetch(tStat, ivec2(((vBase + idx) * ${ST}) % ${W}, ((vBase + idx) * ${ST}) / ${W}), 0);
    float flags = mod(S.w, 256.0), pat = floor(flags / 8.0 + 0.01); bool furry = mod(floor(S.w / 256.0), 2.0) > .5;   // (256: fur)
    bool bodyFrame = mod(flags, 8.0) >= 4.0;
    vec3 col = S.rgb;
    if (pat > 0.5) {
      vec3 pw = (uInvView * vec4(p, 1.0)).xyz, pl;
      if (bodyFrame) {
        vec3 A0 = worldPt(texel(vBase * 3).xyz), B0 = worldPt(texel(vBase * 3 + 1).xyz), dd = B0 - A0;
        vec3 fw = length(dd) > 1e-4 ? normalize(dd) : vec3(1.0, 0.0, 0.0), lf = cross(vec3(0.0, 1.0, 0.0), fw);
        vec3 q = pw - 0.5 * (A0 + B0);
        pl = vec3(dot(q, fw), q.y, dot(q, lf));
      } else pl = partLocal(pw, worldPt(texel((vBase + idx) * 3).xyz), worldPt(texel((vBase + idx) * 3 + 1).xyz));
      col = patternAt(col, pat, pl, max(ca[nearest].w, cb[nearest].w));
    }
    // the field's gradient (tetrahedral differences) is the fillet's normal, taken to world space for the shading
    vec3 nrm = vec3(0.0);
    for (int q = 0; q < 4; q++) {
      vec3 e = q == 0 ? vec3(1, -1, -1) : q == 1 ? vec3(-1, -1, 1) : q == 2 ? vec3(-1, 1, -1) : vec3(1, 1, 1);
      vec3 pe = p + e * 0.002; float de = 1e9;
      for (int j = 0; j < NC; j++) { if (j >= n) break; float dj = sdRoundCone(pe, ca[j].xyz, cb[j].xyz, ca[j].w, cb[j].w); de = ck[j] > 0.0 ? smin(de, dj, ck[j]) : min(de, dj); }
      nrm += e * de;
    }
    nrm = normalize(mat3(uInvView) * nrm);
    o0 = vec4(col, 1.0);
    o1 = vec4(p.z, nrm);
    { float fd = viewDepth(projectionMatrix, p); if (fd < 0.0) discard; gl_FragDepth = fd; }
  }
`;

function floatTex(data, rows) {
  const t = new THREE.DataTexture(data, W, rows, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// The quad as N x N cells (stage 3): each cell a separate quad whose vertices
// carry the cell (aCell) and their corner inside it (position, 0..1), so a
// cell can be dropped or given its own part mask. N = 1 is the plain quad.
function cellGrid(geo, n) {
  const pos = [], cell = [], idx = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = pos.length / 3;
    for (const [u, w] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { pos.push(u, w, 0); cell.push(x, y); }
    idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
  }
  geo.setIndex(idx);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aCell", new THREE.Float32BufferAttribute(cell, 2));
}

// capacity = expected total part count (a hint: the textures grow if more animals are added)
// level of detail for posing: the demo points eye at the camera; figures past near are posed every
// 2nd frame, past far every 4th (metres, on the ground)
// camera + noCull: figures whose bounding sphere lies outside that camera's view are neither posed, synced nor drawn
// (the simulation still moves them) -- noCull while something else looks around (a mirror, the paintings)
export const LOD = { eye: null, camera: null, noCull: false, near: 60, far: 120 };

// the dinosaurs' SCALES baked once as a volume (patternAt, pattern 17, SCALE_TEX): a 64^3 block tiling in
// all three directions, 8 x 8 x 8 jittered cells -- per texel the distance to the nearest seam (r, /.6), the
// nearest cell's own tone (g) and the distance to its middle (b, /.9) -- all smooth where they vary, so the
// filtered read keeps the seams crisp; one mipmapped lookup instead of a 27-cell search per pixel
function scaleVolume(N = 64, C = 8) {
  const data = new Uint8Array(N * N * N * 4), cs = N / C;
  const hash = (x, y, z, k) => { let h = (x * 374761393 + y * 668265263 + z * 1440662683 + k * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const jit = [];
  for (let z = 0; z < C; z++) for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) jit.push([.1 + .8 * hash(x, y, z, 1), .1 + .8 * hash(x, y, z, 2), .1 + .8 * hash(x, y, z, 3), hash(x, y, z, 4)]);
  const w = (v) => ((v % C) + C) % C, J = (x, y, z) => jit[(w(z) * C + w(y)) * C + w(x)];
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const px = (i + .5) / cs, py = (j + .5) / cs, pz = (k + .5) / cs, gx = Math.floor(px), gy = Math.floor(py), gz = Math.floor(pz);
    let s1 = 9, s2 = 9, tone = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const h = J(gx + dx, gy + dy, gz + dz), d = Math.hypot(gx + dx + h[0] - px, gy + dy + h[1] - py, gz + dz + h[2] - pz);
      if (d < s1) { s2 = s1; s1 = d; tone = h[3]; } else if (d < s2) s2 = d;
    }
    const o = ((k * N + j) * N + i) * 4;
    data[o] = Math.min(255, (s2 - s1) / .6 * 255); data[o + 1] = tone * 255; data[o + 2] = Math.min(255, s1 / .9 * 255); data[o + 3] = 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.unpackAlignment = 1;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
const SCALE_U = { value: null };   // (baked with the first herd)

// stage 7: a part's greatest radius (its sort key's pad): a tube's r1, r2 or r2 + bulge (packed in r2), a membrane's
// rounding, a capsule's larger end -- the same numbers the fragment shader's part() pads its ends by (gZf)
function reachOf(p) {
  if (p.r2 < -1.5) { const v = -p.r2 - 2, bu = Math.floor(v / 4096 + 1e-4), r2 = (v - bu * 4096) / 1000; return Math.max(p.r1, r2, r2 + bu / 1000); }
  return p.r2 < 0 ? p.r1 : Math.max(p.r1, p.r2);
}

const _vh = new THREE.Vector2();
const viewH = (renderer) => { const rt = renderer.getRenderTarget(); return rt ? rt.height : renderer.getDrawingBufferSize(_vh).y; };   // (the canvas, a mirror's, the half buffer)
// off-view culling (update): the camera's frustum, a figure's bounding sphere
const _frus = new THREE.Frustum(), _fm = new THREE.Matrix4(), _sph = new THREE.Sphere();

export function createComposite(capacity = 256) {
  if (!SCALE_U.value) SCALE_U.value = scaleVolume();
  const geo = new THREE.InstancedBufferGeometry();
  let cellsBuilt = Math.max(1, PIPE.cells | 0);
  cellGrid(geo, cellsBuilt);
  const MAXA = 4096;   // animals
  const fBase = new Float32Array(MAXA), fCount = new Float32Array(MAXA);
  const attrBase = new THREE.InstancedBufferAttribute(fBase, 1), attrCount = new THREE.InstancedBufferAttribute(fCount, 1);
  geo.setAttribute("aBase", attrBase);
  geo.setAttribute("aCount", attrCount);
  const fBound = new Float32Array(MAXA * 4), attrBound = new THREE.InstancedBufferAttribute(fBound, 4);   // stage 3: bounding spheres
  geo.setAttribute("aBound", attrBound);
  geo.instanceCount = 0;

  // textures: dyn = 3 texels per part (A r1, B r2, C k -- C.xyz is a
  // triangle's third corner, or a clothing part's cut), stat = 2 (rgb, flags), (rgb2, cloth code).
  // wld mirrors dyn's layout and keeps the WORLD endpoints from the skeleton
  // walk; stage 2 decides, per camera, what goes into dyn's xyz (see sync)
  // sdyn / sstat: each part's fixed data (radii, blend, cut or band; colours, flags) by its own index -- stage 7
  // writes dyn and stat in the camera's nearest-first order from these
  let cap = 0, dyn = null, wld = null, stat = null, tDyn = null, tStat = null, sdyn = null, sstat = null;
  let ordData = null, tOrd = null;   // stage 7: each slot's part's place in its figure's own list (four per texel)
  const alloc = (n) => {
    const rows = Math.ceil(n * 3 / W), stRows = Math.ceil(n * ST / W);
    const nd = new Float32Array(W * rows * 4), nw = new Float32Array(W * rows * 4), ns = new Float32Array(W * stRows * 4);
    const nsd = new Float32Array(W * rows * 4), nss = new Float32Array(W * stRows * 4);
    if (dyn) { nd.set(dyn); nw.set(wld); ns.set(stat); nsd.set(sdyn); nss.set(sstat); tDyn.dispose(); tStat.dispose(); }
    dyn = nd; wld = nw; stat = ns; sdyn = nsd; sstat = nss; cap = n;
    tDyn = floatTex(dyn, rows); tStat = floatTex(stat, stRows);
    const oRows = Math.max(1, Math.ceil(n / (4 * W))), no = new Float32Array(W * oRows * 4);
    if (ordData) { no.set(ordData); tOrd.dispose(); }
    ordData = no; tOrd = floatTex(ordData, oRows);
  };
  alloc(Math.max(capacity, 64));

  const mainUniforms = () => ({
    tDyn: { value: tDyn }, tStat: { value: tStat },
    uPad: { value: .3 },
    uOutline: OUTLINE,
    uBorder: { value: new THREE.Color(BORDER.color) },
    uInvView: { value: new THREE.Matrix4() },
    uNear: NEAR_U.uNear, uNearZ: NEAR_U.uNearZ, uFull: NEAR_U.uFull, uNearDist: NEAR_U.uNearDist, uHalfDist: HALF_U.uHalfDist, uScaleTex: SCALE_U, tOrd: { value: tOrd }, uViewH: { value: 800 },
    uOcc: OCC_U.uOcc, uOccOn: OCC_U.uOccOn, uOccBig: OCC_U.uOccBig,
  });
  const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, defines: pipeDefines({ HALF_SPLIT: "" }), uniforms: mainUniforms(), vertexShader: VERT, fragmentShader: FRAG });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.userData.sdf = true;   // never an occluder: its shader writes its own gl_FragDepth, so an override material would hand back the quad's (grass.js markGroundProp)
  mesh.onBeforeRender = (renderer, scene, camera) => { material.uniforms.uInvView.value.copy(camera.matrixWorld); material.uniforms.uViewH.value = viewH(renderer); sync(camera); };
  if (!halfBlit.parent) mesh.add(halfBlit);   // the one blit rides along with the first herd (drawn with the scene)
  // stage 5's twin: the same main pass, only for the near figures, into the half-size buffer
  const halfMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, defines: pipeDefines({ HALF_PASS: "" }), uniforms: mainUniforms(), vertexShader: VERT, fragmentShader: FRAG });
  const halfMesh = new THREE.Mesh(geo, halfMat);
  halfMesh.frustumCulled = false;
  halfMesh.onBeforeRender = (renderer, scene, camera) => { halfMat.uniforms.uInvView.value.copy(camera.matrixWorld); halfMat.uniforms.uViewH.value = viewH(renderer); sync(camera); };
  halfScene.add(halfMesh);
  // the 3D pre-pass twin: same quads and data, raymarched into the shared near buffer
  const nearMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines: pipeDefines({ NEAR_PASS: "" }),
    uniforms: { tDyn: { value: tDyn }, tStat: { value: tStat }, uInvView: { value: new THREE.Matrix4() }, uNearDist: NEAR_U.uNearDist, uPx3: NEAR_U.uPx3, uScaleTex: SCALE_U, uViewH: { value: 800 },
                uOcc: OCC_U.uOcc, uOccOn: OCC_U.uOccOn, uOccBig: OCC_U.uOccBig },
    vertexShader: VERT,
    fragmentShader: FRAG_NEAR,
  });
  const nearMesh = new THREE.Mesh(geo, nearMat);
  nearMesh.frustumCulled = false;
  nearMesh.onBeforeRender = (renderer, scene, camera) => { nearMat.uniforms.uInvView.value.copy(camera.matrixWorld); nearMat.uniforms.uViewH.value = viewH(renderer); sync(camera); };
  nearScene.add(nearMesh);

  // stage 2 -- fill dyn's xyz from wld for this camera: transformed into
  // camera space (PIPE.viewSpace) or copied as they are. Runs just before
  // the draw (onBeforeRender), once per new pose or camera.
  let dirty = true, syncedView = false;
  // stage 7: a part's nearest possible depth for this camera (view z grows toward the eye) -- face marks first (they
  // must be listed before any stop), bones last (never drawn)
  function frontZ(an, i, e) {
    const p = an.parts[i];
    if (p.dot) return Infinity;
    if (p.k < -.5) return -Infinity;
    const o = (an.base + i) * 12, vz = (j) => e[2] * wld[j] + e[6] * wld[j + 1] + e[10] * wld[j + 2] + e[14];
    let z = Math.max(vz(o), vz(o + 4));
    if (p.r2 < 0) z = Math.max(z, vz(o + 8));
    return z + p.reach;
  }
  const lastView = new THREE.Matrix4();
  function sync(camera) {
    const vs = PIPE.viewSpace;
    if (!dirty && vs === syncedView && (!vs || lastView.equals(camera.matrixWorldInverse))) return;
    const e = camera.matrixWorldInverse.elements;
    let statDirty = false;
    for (const an of animals) {
      if (an._off || an._out) continue;   // hidden, or out of view: not drawn
      const n = an.parts.length;
      // stage 7: the order the parts go into the texture -- nearest-first for this camera (PIPE.early), else as built;
      // colours and flags follow it (copied only when it changes)
      const ord = an._ord ?? (an._ord = Int32Array.from({ length: n }, (_, i) => i));
      // (the ROOT stays in slot 0: the shaders take the figure's body frame -- coat patterns, forward, a flat part's
      // squash, a hair's front cut -- from slot 0's segment; only the rest is sorted)
      if (PIPE.early) {
        const key = an._key ?? (an._key = new Float64Array(n));
        for (let i = 1; i < n; i++) key[i] = frontZ(an, i, e);
        ord[0] = 0;
        ord.subarray(1).sort((a, b) => key[b] - key[a]);
      } else for (let i = 0; i < n; i++) ord[i] = i;
      const prev = an._prev ?? (an._prev = Int32Array.from({ length: n }, (_, i) => i));
      let changed = false;
      for (let k = 0; k < n; k++) if (ord[k] !== prev[k]) { changed = true; break; }
      if (changed) {
        for (let k = 0; k < n; k++) { const src = (an.base + ord[k]) * ST * 4, dst = (an.base + k) * ST * 4; for (let q = 0; q < ST * 4; q++) stat[dst + q] = sstat[src + q]; }
        for (let k = 0; k < n; k++) ordData[an.base + k] = ord[k];
        prev.set(ord); statDirty = true;
      }
      {   // stage 3: its bounding sphere (world: the box round every part's ends, padded by the largest radius)
        let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9, rm = 0;
        for (let i = 0; i < n; i++) {
          const o = (an.base + i) * 12, p = an.parts[i];
          for (let c = 0; c < (p.r2 < 0 ? 3 : 2); c++) { const x = wld[o + c * 4], y = wld[o + c * 4 + 1], z = wld[o + c * 4 + 2];
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
          if (p.reach > rm) rm = p.reach;
        }
        const j = an.idx * 4;
        fBound[j] = (x0 + x1) / 2; fBound[j + 1] = (y0 + y1) / 2; fBound[j + 2] = (z0 + z1) / 2; fBound[j + 3] = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + rm;
        const bo = an._bo ?? (an._bo = [0, 0, 0]); bo[0] = fBound[j] - an.position.x; bo[1] = fBound[j + 1] - an.position.y; bo[2] = fBound[j + 2] - an.position.z; an._br = fBound[j + 3];   // (off-view culling)
      }
      for (let k = 0; k < n; k++) {
        const i = ord[k], p = an.parts[i], so = (an.base + i) * 12, dso = (an.base + k) * 12, tri = p.r2 < 0 || !!p.dot;   // (a face mark: three points too)
        for (let c = 0; c < 3; c++) {
          const o = so + c * 4, w = dso + c * 4;
          if (c < 2 || tri) {
            const x = wld[o], y = wld[o + 1], z = wld[o + 2];
            if (vs) {
              dyn[w] = e[0] * x + e[4] * y + e[8] * z + e[12];
              dyn[w + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
              dyn[w + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
            } else { dyn[w] = x; dyn[w + 1] = y; dyn[w + 2] = z; }
          } else { dyn[w] = sdyn[o]; dyn[w + 1] = sdyn[o + 1]; dyn[w + 2] = sdyn[o + 2]; }   // a cut, or a flat part's squash and band
          dyn[w + 3] = sdyn[o + 3];
        }
      }
    }
    lastView.copy(camera.matrixWorldInverse); syncedView = vs; dirty = false;
    tDyn.needsUpdate = true;
    if (statDirty) tStat.needsUpdate = tOrd.needsUpdate = true;
    attrBound.needsUpdate = true;
  }

  const animals = [];
  let used = 0, lastT = null, frameN = 0;
  const herd = {
    mesh,
    animals,
    add(def) {
      const parts = compileDef(def);
      if (used + parts.length > cap) { alloc(Math.max(cap * 2, used + parts.length)); material.uniforms.tDyn.value = tDyn; material.uniforms.tStat.value = tStat; nearMat.uniforms.tDyn.value = tDyn; nearMat.uniforms.tStat.value = tStat; halfMat.uniforms.tDyn.value = tDyn; halfMat.uniforms.tStat.value = tStat; material.uniforms.tOrd.value = tOrd; halfMat.uniforms.tOrd.value = tOrd; }
      if (parts.length > MAXP) console.warn(`composite: ${def.name} has ${parts.length} parts, only ${MAXP} are drawn`);
      const animal = { parts, base: used, idx: animals.length, position: new THREE.Vector3(), rotY: 0, dots: parts.flatMap((p, i) => p.dot ? [i] : []), expr: def.expr ?? null };   // expr: the face it shows (faces.js; its def's resting face)
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i], t = (used + i) * 3;
        dyn[t * 4 + 3] = p.flat ? -p.r1 : p.r1; dyn[(t + 1) * 4 + 3] = p.r2; dyn[(t + 2) * 4 + 3] = p.k;   // (a flat part: its radius negative, the squash in C.x)
        // C: a garment's cut -- or a flat part's squash, a painted band's colour and place
        if (p.r2 >= 0) { const c = p.flat ? [p.flat, p.band ? p.band.rgb : 0, p.band ? -(p.band.cmm + 4096 * p.band.wmm) : 0] : p.clip ?? [0, 0, 0]; dyn[(t + 2) * 4] = c[0]; dyn[(t + 2) * 4 + 1] = c[1]; dyn[(t + 2) * 4 + 2] = c[2]; }
        const s = (used + i) * ST * 4, cl = p.cloth;
        stat[s] = p.color.r; stat[s + 1] = p.color.g; stat[s + 2] = p.color.b; stat[s + 3] = p.pat * 8 + p.body * 4 + p.edge * 2 + p.seam + (p.fur ? 256 : 0) + (p.panel ? 512 : 0);
        stat[s + 4] = p.color2.r; stat[s + 5] = p.color2.g; stat[s + 6] = p.color2.b;
        stat[s + 7] = cl ? Math.min(255, Math.round(cl.scale ?? 0)) + 256 * ((cl.pleats ?? 0) + 32 * ((cl.trim ?? 0) + 4 * ((cl.lace ? 1 : 0) + 2 * (cl.wear ?? 1)))) : 0;
        // the third texel: a PANEL painted on the part (an apron), its colour and where it lies -- half-angle in
        // degrees about the figure's forward, then its span down the axis in 1/63ths of the part's cut
        const pn = p.panel;
        stat[s + 8] = pn ? pn.color.r : 0; stat[s + 9] = pn ? pn.color.g : 0; stat[s + 10] = pn ? pn.color.b : 0;
        stat[s + 11] = pn ? Math.round(pn.half * 180 / Math.PI) + 256 * (Math.round(pn.from * 63) + 64 * Math.round(pn.to * 63)) : 0;
        if (p.dot) {   // a face mark: flags (iris, pupil, round), the iris as colour 2, its reach (for the cells) as r1
          const c2 = p.dot.iris ?? p.color;
          stat[s + 3] = (p.dot.iris ? 1 : 0) + 2 * p.dot.pupil + 8 * (p.dot.round ? 1 : 0) + 16 * p.dot.relief; stat[s + 4] = c2.r; stat[s + 5] = c2.g; stat[s + 6] = c2.b; stat[s + 7] = stat[s + 11] = 0;
          dyn[t * 4 + 3] = 1.2 * Math.max(p.pA.distanceTo(p.pB) / 2, p.r1);
        }
        {   // A.w: r1, the blend radius and whether the third texel is needed, packed (PACK_GLSL)
          const r = Math.abs(dyn[t * 4 + 3]), kq = Math.min(511, Math.round(Math.max(p.k, 0) * 500)), needC = !!(p.flat || p.clip || p.dot || p.k < 0);
          if (r >= 4 || p.k > 1.022) console.warn(`composite: ${def.name}: part ${i} radius ${r.toFixed(3)} / blend ${p.k.toFixed(3)} beyond what A.w packs (4m / 1.02m)`);
          dyn[t * 4 + 3] = (p.flat ? -1 : 1) * ((kq * 2 + (needC ? 1 : 0)) * 4 + Math.min(r, 3.999));
        }
        for (let q = 0; q < 12; q++) sdyn[t * 4 + q] = dyn[t * 4 + q];   // (stage 7's fixed copy)
        for (let q = 0; q < ST * 4; q++) sstat[s + q] = stat[s + q];
        ordData[used + i] = i;   // (as built: slot i holds part i)
        if (p.reach === undefined) p.reach = reachOf(p) * (p.dot?.reach ?? 1);   // a mark's relief reaches past the mark: the cells must list it that far
      }
      if (parts.length > 128 && PIPE.cells > 1) console.info(`composite: ${def.name} has ${parts.length} parts; past 128 they are evaluated in every cell`);
      fBase[animals.length] = used; fCount[animals.length] = parts.length;
      attrBase.needsUpdate = attrCount.needsUpdate = true;
      used += parts.length;
      geo.instanceCount = animals.length + 1;
      tStat.needsUpdate = true; tOrd.needsUpdate = true;
      animals.push(animal);
      dirty = true;
      return animal;
    },
    update(t) {
      const dt = lastT === null ? 0 : Math.min(Math.max(t - lastT, 0), .1); lastT = t;
      frameN++;
      const eye = LOD.eye, cam = LOD.camera;
      const fr = cam && !LOD.noCull ? _frus.setFromProjectionMatrix(_fm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)) : null;
      for (const an of animals) {
        // hidden: out of the draw entirely -- its part count 0, so the vertex shader culls its quad, and
        // nothing is posed or synced for it; shown again: its count back, posed at once
        if (an.hidden) { if (!an._off) { fCount[an.idx] = 0; attrBase.needsUpdate = attrCount.needsUpdate = true; an._off = true; } continue; }
        // out of the camera's view (its last bounding sphere, carried along with it, padded): not posed, synced or drawn
        if (fr && an._posed && an._br !== undefined) {
          _sph.center.set(an.position.x + an._bo[0], an.position.y + an._bo[1], an.position.z + an._bo[2]); _sph.radius = an._br * 1.15 + .3;
          if (!fr.intersectsSphere(_sph)) { if (!an._out) { fCount[an.idx] = 0; attrCount.needsUpdate = true; an._out = true; } continue; }
        }
        if (an._out) { an._out = false; if (!an._off) { fCount[an.idx] = an.parts.length; attrCount.needsUpdate = true; } an._posed = false; }
        if (an._off) { fCount[an.idx] = an.parts.length; attrCount.needsUpdate = true; an._off = false; an._posed = false; }
        easeGait(an, dt);
        // distant figures are posed every 2nd (past LOD.near) or 4th (past LOD.far) frame, staggered --
        // display only, so the world's deterministic simulation is untouched
        if (eye && an._posed) {
          const d = Math.hypot(an.position.x - eye.x, an.position.z - eye.z), k = d > LOD.far ? 4 : d > LOD.near ? 2 : 1;
          if (k > 1 && (frameN + an.idx) % k) continue;
        }
        writeRows(an, t); if (an.dots.length) markRows(an, t); an._posed = true;
      }
      dirty = true;   // sync() uploads it, for the camera about to draw
    },
    // a part's two world endpoints as the last update() posed it -- for what rides on a body
    // without being part of it (a tool in the hand, tools.js)
    ends(an, i) { const o = (an.base + i) * 12; return [[wld[o], wld[o + 1], wld[o + 2]], [wld[o + 4], wld[o + 5], wld[o + 6]]]; },
    // follow PIPE after setPipe: new defines (the shaders recompile), a new cell grid, a fresh sync
    applyPipe() {
      material.defines = pipeDefines({ HALF_SPLIT: "" }); nearMat.defines = pipeDefines({ NEAR_PASS: "" }); halfMat.defines = pipeDefines({ HALF_PASS: "" });
      material.needsUpdate = nearMat.needsUpdate = halfMat.needsUpdate = true;
      const n = Math.max(1, PIPE.cells | 0);
      if (n !== cellsBuilt) { cellGrid(geo, n); cellsBuilt = n; }
      dirty = true;
    },
  };
  herds.push(herd);
  return herd;
  // the skeleton walk writes plain A/B/C rows (3 floats per part, as for
  // the instanced engine); they are copied into the world mirror here
  function writeRows(an, t) {
    if (an.hidden && an._parked) return;   // parked out of sight: its rows already lie parked (the skeleton skips it too -- the scratch rows are someone else's)
    const n = an.parts.length;
    if (scratchA.length < n * 3) { scratchA = new Float32Array(n * 3); scratchB = new Float32Array(n * 3); scratchC = new Float32Array(n * 3); }
    const base = an.base; an.base = 0;
    writeAnimal(an, t, scratchA, scratchB, scratchC);
    an.base = base;
    for (let i = 0; i < n; i++) {
      const t3 = (base + i) * 3, j = i * 3;
      wld[t3 * 4] = scratchA[j]; wld[t3 * 4 + 1] = scratchA[j + 1]; wld[t3 * 4 + 2] = scratchA[j + 2];
      wld[(t3 + 1) * 4] = scratchB[j]; wld[(t3 + 1) * 4 + 1] = scratchB[j + 1]; wld[(t3 + 1) * 4 + 2] = scratchB[j + 2];
      if (an.parts[i].r2 < 0) { wld[(t3 + 2) * 4] = scratchC[j]; wld[(t3 + 2) * 4 + 1] = scratchC[j + 1]; wld[(t3 + 2) * 4 + 2] = scratchC[j + 2]; }
    }
  }
  // FACE MARKS (parts flagged `dot`: eyes, a mouth): their rows become the mark's frame on the parent's surface --
  // A = the centre (on the surface, along the parent's centre -> the posed corners' midpoint), B = A + half the
  // width (along the corners, flat in the touching plane), C = A + half the height (r1); the fragment shader paints it
  function markRows(an, t) {
    for (const i of an.dots) {
      const p = an.parts[i], pi = p.parentIdx;
      if (pi < 0) continue;
      const o = (an.base + i) * 12, q = (an.base + pi) * 12;
      const ax = wld[o], ay = wld[o + 1], az = wld[o + 2], bx = wld[o + 4], by = wld[o + 5], bz = wld[o + 6];
      const px = wld[q], py = wld[q + 1], pz = wld[q + 2];
      let nx = (ax + bx) / 2 - px, ny = (ay + by) / 2 - py, nz = (az + bz) / 2 - pz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const R = Math.max(nl, an.parts[pi].r1);
      let cx = px + nx * R, cy = py + ny * R, cz = pz + nz * R;
      let ux = (bx - ax) / 2, uy = (by - ay) / 2, uz = (bz - az) / 2;
      const un = ux * nx + uy * ny + uz * nz; ux -= nx * un; uy -= ny * un; uz -= nz * un;
      // up the face: world up laid on the face (a face turned skyward -- a sleeper's -- keeps the mark as it is)
      let wx = -nx * ny, wy = 1 - ny * ny, wz = -nz * ny;
      const wl = Math.hypot(wx, wy, wz), up = wl > .3;
      if (up) { wx /= wl; wy /= wl; wz /= wl; }
      // an EXPRESSION (an.expr, faces.js) reshapes the mark by its role: tilted in the face's plane (+: its outer end
      // up -- the mark's u runs inner to outer on the +z side, outer to inner on the other, hence the side), lifted
      // up the face (in half-widths), scaled; and its style code goes to the shader in B.w
      const ex0 = p.dot.role ? an.expr?.[p.dot.role] : null, ex = ex0?.side && ex0.side !== p.dot.side ? null : ex0;   // (a sided recipe -- a wink -- only on its side)
      if (ex) {
        const ul = Math.hypot(ux, uy, uz);
        if (ex.tilt && up) {
          const a = ex.tilt * (p.dot.side || 1), ca = Math.cos(a), sa = Math.sin(a) * ul;
          ux = ux * ca + wx * sa; uy = uy * ca + wy * sa; uz = uz * ca + wz * sa;
        }
        if (ex.lift && up) { cx += wx * ex.lift * ul; cy += wy * ex.lift * ul; cz += wz * ex.lift * ul; }
        if (ex.w) { ux *= ex.w; uy *= ex.w; uz *= ex.w; }
      }
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      let vs = p.r1 * (ex?.h ?? 1) / (Math.hypot(vx, vy, vz) || 1);
      if (up && vx * wx + vy * wy + vz * wz < 0) vs = -vs;   // v (its half-height) up the face: a smile's corners rise, an eye's glint sits high
      // (a crying eye: code 7 + its tear's phase, each eye its own; its reach grown so the cells list it down the cheek)
      sdyn[o + 7] = ex?.tear ? 7 + ((t * .5 + (p.dot.side > 0 ? 0 : .45)) % 1) * .98 : ex?.code ?? 0;
      if (p._r0 === undefined) p._r0 = sdyn[o + 3] - 4;   // (a mark's A.w: 4 + its reach -- PACK_GLSL, no blend, the third texel read)
      sdyn[o + 3] = 4 + Math.min(3.99, p._r0 * (ex?.reach ?? 1) * p.dot.reach);   // (the same reach the cells were padded by, times what the expression asks for)
      wld[o] = cx; wld[o + 1] = cy; wld[o + 2] = cz;
      wld[o + 4] = cx + ux; wld[o + 5] = cy + uy; wld[o + 6] = cz + uz;
      wld[o + 8] = cx + vx * vs; wld[o + 9] = cy + vy * vs; wld[o + 10] = cz + vz * vs;
    }
  }
}
let scratchA = new Float32Array(MAXP * 3), scratchB = new Float32Array(MAXP * 3), scratchC = new Float32Array(MAXP * 3);
