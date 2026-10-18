// The FIGURES' engine: one herd of animals or people, their skeletons walked on the CPU and their parts held
// in float textures that shell.js draws as polygons.
//
// This file used to be a renderer as well -- one quad per figure with every part evaluated per pixel, a
// distance field joined by a smooth union, with screen cells, a stencil bound, a half-resolution pass for near
// figures and a raymarched pre-pass for the fillets. The figures are POLYGONS now (shell.js: one lathe per
// chain of parts, LOD by distance and length), which is cheaper here and exact everywhere, so all of that is
// gone -- what it was and what it cost is written up in docs/engines.md, which is where to look before
// building anything like it again. The SDF itself lives on in instanced.js, which still draws the trees,
// plants, clouds and butterflies as banners.
//
// What is left is the data path, and it is unchanged: the CPU skeleton walk (skeleton.js) writes world-space
// endpoints into a mirror array; just before the draw they go into a float texture (in camera space with
// PIPE.viewSpace, so no shader multiplies a matrix per part per pixel) -- three texels per part: (A, r1),
// (B, r2), (C, k) -- next to three static texels (colour, pattern and flags; second colour, the strands' scale;
// a dressed part's dress header, whose layers of cloth follow the figure's parts -- packDress below). Only the
// rows a frame actually wrote are uploaded.
//
// A part's numbers are packed the way the shaders read them: |A.w| = (k in 2mm steps * 2 + needC) * 4 + r1,
// negative for a flat part; r2 < -1.5 is a TUBE (its end radius and bulge packed in), r2 = -1 a TRIANGLE, and
// a blend radius of -1 marks a BONE (posed, never drawn) or -2 a FACE MARK (an eye, a mouth: its rows become
// a little frame on its parent's surface -- markRows below).
//
// RELIEF (gRelief, CLOTH_GLSL): what a surface shows in the LIGHT without showing it in the silhouette -- a
// skirt's pleats, the ridge of a brow, the socket an eyeball sits in. Each producer adds the surface gradient
// of its own height field in metres, and the shading tilts the normal by it just before shadeOf. It costs no
// geometry and no part; the same field that tilts the normal also shades the colour, so the two cannot drift.
import * as THREE from "three";
import { texture } from "three/tsl";
import { compileDef, writeAnimal, easeGait } from "./skeleton.js";
import { createShell, shellFromQuery } from "./shell.js";

const W = 1024;      // texels per texture row
const MAXP = 160;    // parts per animal the shader loops over at most
const ST = 3;        // static texels per part: (colour, flags), (colour2, strands' scale), (a dressed part's dress header)

export const PIPE = {
  // The one switch left of what was a pipeline. The CPU takes every part's endpoints into CAMERA space once
  // per frame, just before drawing, instead of leaving them in the world for the shaders to transform; the
  // patterns then have to bring them back (one matrix per pixel, not per part per pixel).
  viewSpace: true,
};
export const herds = [];    // every composite herd, so setPipe reaches them all (and so a harness can ask what they hold)
let driver = null;          // the one mesh in the scene whose onBeforeRender syncs them all (see createComposite)
export function setPipe(opts) {
  Object.assign(PIPE, opts);
  for (const h of herds) h.applyPipe();
}
export function pipeFromQuery(qp) {
  if (qp.has("viewspace")) PIPE.viewSpace = qp.get("viewspace") !== "0";
  shellFromQuery(qp);   // ?shelllod= ?shellblend= ?shelldebug=1 ...: how the figures are drawn
}
// ---- THE OCCLUDERS, AS ONE FLAT LIST. Anything solid that stands on the ground opts in by layer
// (OCC_LAYER, grass.js markGroundProp), and the grass mask draws exactly that set. A renderer.render() walks
// the WHOLE graph to find them -- eleven hundred objects, to draw the eight hundred that are on the layer --
// and it would do that walk again for every pass, so the set is gathered once into a scene of its own (the
// same objects, no hierarchy) and re-gathered when the world gains or loses something, or every fifteen
// calls: a mask that is a quarter of a second stale still decides the same thing.
//   (The figures used to test their bounding spheres against a depth buffer of these, since an SDF shader
// writes its own depth and the GPU cannot reject it early. Polygons are rejected by early-z like anything
// else, so that pass and its buffer are gone -- see docs/engines.md.)
export const OCC_LAYER = 3;
const occFlat = new THREE.Scene();
occFlat.matrixWorldAutoUpdate = false;     // their matrices are the world's, already updated for this frame
let occTick = 0, occKids = -1;
export function occluderScene(scene) {
  if (occKids !== scene.children.length || occTick++ % 15 === 0) {
    occKids = scene.children.length;
    const list = [];
    scene.traverseVisible((o) => {   // traverseVisible: a hidden group is not an occluder
      if ((o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine) && o.layers.isEnabled(OCC_LAYER)) list.push(o);
    });
    occFlat.children = list;
  }
  return occFlat;
}

// A SECONDARY VIEW (a mirror, a painting) draws the world again with another camera. Anything that is tied
// to the main view says so here and puts itself back afterwards.
const secHooks = [];
export function onSecondaryView(fn) { secHooks.push(fn); }
export function beginSecondaryView() { for (const f of secHooks) f(true); }
export function endSecondaryView() { for (const f of secHooks) f(false); }

function floatTex(data, rows) {
  const t = new THREE.DataTexture(data, W, rows, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// A FLAT PART'S END CAPS (skeleton.js `caps`), packed into its third texel's w -- which no shader reads for
// anything else: each cap's height in hundredths of the radius (7 bits apiece, 100 = a hemisphere), the
// superellipse exponent in tenths above them. Exact in a float (under 2^24). No caps: 0, read as round.
export const capCode = (c) => c ? Math.min(127, Math.round((c.a ?? 1) * 100)) + 128 * Math.min(127, Math.round((c.b ?? 1) * 100)) + 16384 * Math.min(99, Math.round((c.p ?? 2) * 10)) : 0;

// WHAT A PART WEARS (clothes.js, docs/clothes.md): its layers of sheet, outermost first, each SIX static texels --
// two slots of the figure's own block, after its parts (a figure takes parts + 2 x layers slots from the pool). The
// part's third static texel is then its dress header, [first layer's slot, how many, standing, 0], and bit 1024 of
// its flags says it is dressed; a STANDING part (a skirt, a cloak, a hood: a shell of its own) is cloth only where a
// layer covers it -- elsewhere it is a hole. Per layer:
//   L0 [s0, s1, arc centre, arc half-width]   where it lies: metres along the part from its A end, radians round it
//                                             from the figure's front toward its left (half-width >= pi: all round)
//   L1 [c0, c1, c2, c3]                       its four colours, linear, 8 bits a channel packed in each
//   L2 [fabric, period u, period v, v offset] its cloth (fabric.js layer), the repeat in metres, where the repeat starts
//   L3 [repeats round, thickness, flags, band] a whole number of repeats round it (0: by the girth), how much it lifts
//                                             the surface, pleats + 64 x wear + 256 x dags, a band's width (0: filled)
//   L4 [opening, a, b, c], L5 [d, e, 0, 0]    a cut-out: 1-5 a neckline (round scoop v square boat: a ball round the
//                                             collar point, a = where that point lies along the part, e its radius at the
//                                             back plus c, at the front plus b, d the half-width of a v or a square), 6-7 a
//                                             window (ellipse, slot: a = its angle, b its place along, d/e half-sizes)
const DRESSED = 1024;
export const packRGB = (c) => { const q = new THREE.Color(c); return Math.round(q.r * 255) * 65536 + Math.round(q.g * 255) * 256 + Math.round(q.b * 255); };
const layerCount = (parts) => parts.reduce((n, p) => n + (p.dress?.layers.length ?? 0), 0);
function packDress(stat, s, slot, L) {
  const o = slot * ST * 4, op = L.opening ?? null, w = L.wrap ?? null;
  const put = (k, a, b, c, d) => { stat[o + k * 4] = a; stat[o + k * 4 + 1] = b; stat[o + k * 4 + 2] = c; stat[o + k * 4 + 3] = d; };
  put(0, L.s0 ?? -1e3, L.s1 ?? 1e3, w ? w[0] : 0, w ? w[1] : 4);
  const cs = L.colors ?? [];
  put(1, packRGB(cs[0] ?? 0x808080), packRGB(cs[1] ?? cs[0] ?? 0x808080), packRGB(cs[2] ?? cs[0] ?? 0x808080), packRGB(cs[3] ?? cs[0] ?? 0x808080));
  put(2, L.fabric ?? 0, L.period?.[0] ?? .1, L.period?.[1] ?? .1, L.vOffset ?? 0);
  put(3, L.repeats ?? 0, L.thick ?? 0, (L.pleats ?? 0) + 64 * (L.wear ?? 0) + 256 * (L.dags ?? 0), L.band ?? 0);
  if (!op) { put(4, 0, 0, 0, 0); put(5, 0, 0, 0, 0); }
  else if (op.neckline) put(4, 1 + ["round", "scoop", "v", "square", "boat"].indexOf(op.neckline), op.top, op.front, op.back), put(5, op.half ?? 1, op.base ?? .06, 0, 0);
  else put(4, op.slot ? 7 : 6, op.angle ?? 0, op.at ?? 0, 0), put(5, op.half ?? .3, op.halfLength ?? .1, 0, 0);
}

// capacity = expected total part count (a hint: the textures grow if more animals are added)
// level of detail for posing: the demo points eye at the camera; figures past near are posed every
// 2nd frame, past far every 4th (metres, on the ground)
// camera + noCull: figures whose bounding sphere lies outside that camera's view are neither posed, synced nor drawn
// (the simulation still moves them) -- noCull while something else looks around (a mirror, the paintings)
export const LOD = { eye: null, camera: null, noCull: false, near: 60, far: 120 };
// WHAT WAS POSED THIS FRAME, counted by both engines: figures walked, parts written (a part is one capsule or
// triangle whose two or three world points the skeleton recomputes). Reset by whoever drives the frame.
export const POSE = { figures: 0, parts: 0 };

// PARTIAL UPLOADS: send the part of an instance buffer that is in use, not the whole capacity.
//
// three uploads an attribute in full whenever its version moves (`needsUpdate`) and no update range is
// set -- and, worse, EVERY DRAW when its usage is DynamicDrawUsage, version or not (Attributes.update in
// the WebGPU backend skips the version test for a dynamic buffer). Both engines allocate generously and
// fill a little: a composite herd has room for 4096 figures and carries four (its bounding spheres are a
// 64 KB buffer of which 100 bytes matter), the banner herds have room for every tree in the world. The
// measured bill was 4.2 MB a frame of writeBuffer for a world that moves a few hundred kilobytes.
//   `touch` marks the used prefix instead. The backend clears the range after it uploads, so a later pass
// in the same frame finds the version already current and sends nothing at all.
export function touch(attr, count) {
  if (count <= 0) return;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count * attr.itemSize);
  attr.needsUpdate = true;
}

// a part's greatest radius: a tube's r1, r2 or r2 + bulge (packed in r2), a membrane's rounding, a capsule's
// larger end -- what a figure's bounding sphere is padded by, so off-view culling never clips a figure early
function reachOf(p) {
  if (p.r2 < -1.5) { const v = -p.r2 - 2, bu = Math.floor(v / 4096 + 1e-4), r2 = (v - bu * 4096) / 1000; return Math.max(p.r1, r2, r2 + bu / 1000); }
  return p.r2 < 0 ? p.r1 : Math.max(p.r1, p.r2);
}

// off-view culling (update): the camera's frustum, a figure's bounding sphere
const _frus = new THREE.Frustum(), _fm = new THREE.Matrix4(), _sph = new THREE.Sphere();

// ---- THE POOL: one set of textures, one shell, for every figure in the world ------------------------------
// A herd used to own its textures and its own set of swept meshes, and the world holds a dozen herds -- the
// wanderers, the villagers, the village's own life, the guards, the riders, the cart teams, the fishermen,
// the swimmers, the arena's cast, and the spares combat parts figures into. Every one of them drew its own
// detail buckets: twenty-odd draw calls for the figures alone in a busy view, for perhaps four hundred
// triangles apiece.
//   They share ONE pool now. A part's slot is a global index, which is what the shaders always read, so the
// only thing a herd really owns is a RANGE of slots and the animals in it. One texture pair, one shell, one
// set of meshes: three or four draws for every figure in the world.
//   The driver (a quad that draws nothing) is what carries the frame's work: begin the shell, let every herd
// write its poses and hand over its chains, end it. It must be RENDERED -- not hidden -- or nothing would
// ever be filled again.
let POOL = null;
function pool() {
  if (POOL) return POOL;
  const P = { cap: 0, used: 0, dyn: null, wld: null, stat: null, sdyn: null, tDyn: null, tStat: null,
              rowDirty: null, nDyn: null, nStat: null, shell: null, group: null, driver: null };
  P.alloc = (n) => {
    const rows = Math.ceil(n * 3 / W), stRows = Math.ceil(n * ST / W);
    const nd = new Float32Array(W * rows * 4), nw = new Float32Array(W * rows * 4), ns = new Float32Array(W * stRows * 4);
    const nsd = new Float32Array(W * rows * 4);
    if (P.dyn) { nd.set(P.dyn); nw.set(P.wld); ns.set(P.stat); nsd.set(P.sdyn); P.tDyn.dispose(); P.tStat.dispose(); }
    P.dyn = nd; P.wld = nw; P.stat = ns; P.sdyn = nsd; P.cap = n;
    P.rowDirty = new Uint8Array(rows);
    P.tDyn = floatTex(P.dyn, rows); P.tStat = floatTex(P.stat, stRows);
    if (P.nDyn) { P.nDyn.value = P.tDyn; P.nStat.value = P.tStat; }
  };
  P.room = (parts) => {                     // enough slots for one more figure, growing the pool if not
    if (P.used + parts <= P.cap) return;
    P.alloc(Math.max(P.cap * 2, P.used + parts));
    P.shell.resize(P.cap);
  };
  // SLOTS COME BACK. A figure that is thrown away -- the player's own body, rebuilt whenever its pose changes
  // from walking to drawing a bow; a duplicate that has fallen off the end of the list -- used to leave its
  // slots in the pool for good: the pool only ever grew, and (worse) the figure in them was still posed and
  // still drawn, standing where it was left. `take` hands out a freed block when one fits, `give` takes it
  // back and merges it with its neighbours.
  P.freed = [];                             // [base, count] blocks, in base order
  P.take = (n) => {
    for (let i = 0; i < P.freed.length; i++) {
      const b = P.freed[i];
      if (b[1] < n) continue;
      const base = b[0];
      if (b[1] === n) P.freed.splice(i, 1); else { b[0] += n; b[1] -= n; }
      return base;
    }
    P.room(n);
    const base = P.used; P.used += n;
    return base;
  };
  P.give = (base, n) => {
    let i = 0;
    while (i < P.freed.length && P.freed[i][0] < base) i++;
    P.freed.splice(i, 0, [base, n]);
    for (let k = P.freed.length - 1; k > 0; k--)      // merge with the block before it where they touch
      if (P.freed[k - 1][0] + P.freed[k - 1][1] === P.freed[k][0]) { P.freed[k - 1][1] += P.freed[k][1]; P.freed.splice(k, 1); }
    const last = P.freed[P.freed.length - 1];         // ...and hand the tail straight back to the pool
    if (last && last[0] + last[1] === P.used) { P.used = last[0]; P.freed.pop(); }
  };
  P.markDyn = (base, n) => { const r1 = Math.ceil((base + n) * 3 / W); for (let r = (base * 3 / W) | 0; r < r1; r++) P.rowDirty[r] = 1; };
  P.alloc(4096);
  P.nDyn = texture(P.tDyn); P.nStat = texture(P.tStat);
  P.group = new THREE.Group();
  P.group.name = "figures";
  P.shell = createShell({ nDyn: P.nDyn, nStat: P.nStat, W, ST, viewSpace: PIPE.viewSpace, cap: P.cap, touch,
    ends: (an, i) => { const o = (an.base + i) * 12; const w = P.wld;
                       return [[w[o], w[o + 1], w[o + 2]], [w[o + 4], w[o + 5], w[o + 6]]]; } });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
  geo.instanceCount = 0;
  P.driver = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  P.driver.frustumCulled = false;
  P.driver.userData.sdf = true;     // never an occluder and never wired by the geometry view: it draws nothing
  P.driver.renderOrder = 2;
  P.driver.onBeforeRender = (renderer, scene, camera) => P.sync(camera, renderer);
  P.group.add(P.driver);
  for (const m of P.shell.meshes) P.group.add(m);
  // ONE PASS FOR THE WHOLE WORLD: the poses (only where something moved), then every herd's chains into the
  // buckets, then the upload. The chains are handed over EVERY pass, even for a herd whose rows did not
  // change, because the buckets are cleared at the start of one -- a herd that skipped would vanish.
  P.sync = (camera, renderer) => {
    P.shell.begin();
    for (const h of herds) h.poseInto(camera);
    for (const h of herds) h.pushChains(camera);
    P.shell.end();
    P.upload(renderer);
  };
  P.upload = (renderer) => {
    const gpu = renderer?.backend?.get?.(P.tDyn)?.texture;
    if (!gpu) { P.tDyn.needsUpdate = true; P.rowDirty.fill(0); return; }
    const q = renderer.backend.device.queue, rows = P.rowDirty.length;
    for (let r = 0; r < rows; r++) {
      if (!P.rowDirty[r]) continue;
      let e = r + 1; while (e < rows && P.rowDirty[e]) e++;
      q.writeTexture({ texture: gpu, mipLevel: 0, origin: { x: 0, y: r, z: 0 } },
        P.dyn, { offset: r * W * 16, bytesPerRow: W * 16, rowsPerImage: e - r }, { width: W, height: e - r });
      P.rowDirty.fill(0, r, e);
      r = e;
    }
  };
  POOL = P;
  return P;
}

// HOW FINE THE FIGURES ARE SWEPT (shell.js setDetail): 1 is the world's own setting, 2 twice the rings and
// points round a cut. The asset viewer turns it with + and -.
export function figureDetail(k) { pool().shell.setDetail(k); }
export const figureGrids = () => pool().shell.detailOf();

export function createComposite(capacity = 256) {
  const P = pool();
  const shell = P.shell;
  // the herd's own handle in the scene: the first one carries the world's figures, the rest are empty groups
  // (the meshes are the pool's, and there is one set of them)
  const mesh = new THREE.Group();
  mesh.name = "herd";
  if (P.group.parent === null && !P.mounted) { P.mounted = true; mesh.add(P.group); }

  // THE HERD'S SHARE OF THE FRAME, in two halves, because the pool drives them for every herd at once:
  //   writeRows  the poses into the texture -- skipped entirely when nothing this herd owns has moved and the
  //              camera is where it was (which is most herds, most frames)
  //   pushChains its figures handed to the detail buckets -- ALWAYS, because the buckets were cleared at the
  //              start of this pass and a herd that skipped would simply not be drawn
  let dirty = true, syncedView = false;
  const lastView = new THREE.Matrix4();
  const fBound = new Float32Array(4096 * 4);   // each figure's bounding sphere -- off-view culling, below

  function poseInto(camera) {
    const vs = PIPE.viewSpace;
    if (!dirty && vs === syncedView && (!vs || lastView.equals(camera.matrixWorldInverse))) return;
    const e = camera.matrixWorldInverse.elements, dynA = P.dyn, wldA = P.wld, sdynA = P.sdyn;
    for (const an of animals) {
      // hidden, or out of view: not drawn. `hidden` is read HERE, and not only through the flag update()
      // sets, because a figure can be hidden by an owner that then stops updating it (the player's own body,
      // hidden the moment you crouch) -- and the pool would go on drawing it where it stood.
      if (an.hidden || an._off || an._out) continue;
      const n = an.parts.length;
      P.markDyn(an.base, n);
      {   // its bounding sphere (world: the box round every part's ends, padded by the largest radius)
        let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9, rm = 0;
        for (let i = 0; i < n; i++) {
          const o = (an.base + i) * 12, p = an.parts[i];
          for (let c = 0; c < (p.r2 < 0 ? 3 : 2); c++) { const x = wldA[o + c * 4], y = wldA[o + c * 4 + 1], z = wldA[o + c * 4 + 2];
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
          if (p.reach > rm) rm = p.reach;
        }
        const j = an.idx * 4;
        fBound[j] = (x0 + x1) / 2; fBound[j + 1] = (y0 + y1) / 2; fBound[j + 2] = (z0 + z1) / 2; fBound[j + 3] = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + rm;
        const bo = an._bo ?? (an._bo = [0, 0, 0]); bo[0] = fBound[j] - an.position.x; bo[1] = fBound[j + 1] - an.position.y; bo[2] = fBound[j + 2] - an.position.z; an._br = fBound[j + 3];   // (off-view culling)
      }
      for (let i = 0; i < n; i++) {
        const p = an.parts[i], so = (an.base + i) * 12, tri = p.r2 < 0 || !!p.dot;   // (a face mark: three points too)
        for (let c = 0; c < 3; c++) {
          const o = so + c * 4, w = o;
          if (c < 2 || tri) {
            const x = wldA[o], y = wldA[o + 1], z = wldA[o + 2];
            if (vs) {
              dynA[w] = e[0] * x + e[4] * y + e[8] * z + e[12];
              dynA[w + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
              dynA[w + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
            } else { dynA[w] = x; dynA[w + 1] = y; dynA[w + 2] = z; }
          } else { dynA[w] = sdynA[o]; dynA[w + 1] = sdynA[o + 1]; dynA[w + 2] = sdynA[o + 2]; }   // a cut, or a flat part's squash and band
          dynA[w + 3] = sdynA[o + 3];
        }
      }
    }
    lastView.copy(camera.matrixWorldInverse); syncedView = vs; dirty = false;
  }

  function pushChains(camera) {
    for (const an of animals) {
      if (an.hidden || an._off || an._out) continue;
      shell.push(an, camera.position.distanceTo(an.position));   // its detail level, by distance
    }
  }

  const animals = [];
  let lastT = null, frameN = 0;
  const herd = {
    mesh,
    animals,
    add(def) {
      const parts = compileDef(def);
      const slots = parts.length + 2 * layerCount(parts);   // (its parts, then two slots for every layer a part wears)
      const used = P.take(slots);   // the slots come from the world's one pool, not from this herd
      const dyn = P.dyn, stat = P.stat, sdyn = P.sdyn;
      if (parts.length > MAXP) console.warn(`composite: ${def.name} has ${parts.length} parts, only ${MAXP} are drawn`);
      const upPart = def.parts.findIndex((q) => q.id === "chest" || q.id === "r_chest"), upRow = upPart >= 0 ? used + upPart + 1 : 0;   // (the def keeps the ids; a rider's is r_chest)
      const animal = { parts, base: used, slots, idx: animals.length, position: new THREE.Vector3(), rotY: 0, dots: parts.flatMap((p, i) => p.dot ? [i] : []), expr: def.expr ?? null,   // expr: the face it shows (faces.js; its def's resting face)
                       face: def.face ?? null, mane: def.mane ?? null, jewelry: def.jewelry ?? null };   // face: a mesh head to stand on its head part (heads.js), or none; mane: a mane of thorns on its mane (manes.js)
      let nextLayer = parts.length;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i], t = (used + i) * 3;
        dyn[t * 4 + 3] = p.flat ? -p.r1 : p.r1; dyn[(t + 1) * 4 + 3] = p.r2; dyn[(t + 2) * 4 + 3] = p.flat ? capCode(p.caps) : p.clip ? p.clip[3] ?? 0 : p.k;   // (a flat part: its radius negative, the squash in C.x, its caps in C.w; a cut shell's own squash in C.w)
        // C: a garment's cut -- or a flat part's squash, a painted band's colour and place
        if (p.r2 >= 0) { const c = p.flat ? [p.flat, 0, 0] : p.clip ?? [0, 0, 0]; dyn[(t + 2) * 4] = c[0]; dyn[(t + 2) * 4 + 1] = c[1]; dyn[(t + 2) * 4 + 2] = c[2]; }
        const s = (used + i) * ST * 4, cl = p.cloth;
        stat[s] = p.color.r; stat[s + 1] = p.color.g; stat[s + 2] = p.color.b; stat[s + 3] = p.pat * 8 + p.body * 4 + p.edge * 2 + p.seam + (p.fur ? 256 : 0) + (p.stone ?? 0) * 2048;   // (stone: a statue's material, statues.js)
        stat[s + 4] = p.color2.r; stat[s + 5] = p.color2.g; stat[s + 6] = p.color2.b;
        stat[s + 7] = cl ? Math.min(255, Math.round(cl.scale ?? 0)) : 0;   // (the strands' scale: hair, a braid)
        stat[s + 8] = stat[s + 9] = stat[s + 10] = stat[s + 11] = 0;
        if (p.dress?.layers.length) {   // ...or, dressed, its dress header: its layers follow the figure's parts
          stat[s + 3] += DRESSED;
          stat[s + 8] = used + nextLayer; stat[s + 9] = p.dress.layers.length; stat[s + 10] = p.dress.standing ? 1 : 0;
          stat[s + 11] = upRow;   // (the row of the part whose axis is the figure's UP -- its chest -- so the cloth's frame turns with a figure lying on its side; 0: the world's up)
          for (const L of p.dress.layers) { packDress(stat, s, used + nextLayer, L); nextLayer += 2; }
        }
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
        for (let q = 0; q < 12; q++) sdyn[t * 4 + q] = dyn[t * 4 + q];   // (the fixed half of the row: radii, blend, cut)
        if (p.reach === undefined) p.reach = reachOf(p) * (p.dot?.reach ?? 1);   // a mark's relief reaches past the mark
      }
      P.markDyn(used, parts.length);   // add() writes the fixed half of the rows itself
      P.tStat.needsUpdate = true;
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
        if (an.hidden) { an._off = true; continue; }
        // out of the camera's view (its last bounding sphere, carried along with it, padded): not posed, synced or drawn
        if (fr && an._posed && an._br !== undefined) {
          _sph.center.set(an.position.x + an._bo[0], an.position.y + an._bo[1], an.position.z + an._bo[2]); _sph.radius = an._br * 1.15 + .3;
          if (!fr.intersectsSphere(_sph)) { an._out = true; continue; }
        }
        if (an._out) { an._out = false; an._posed = false; }
        if (an._off) { an._off = false; an._posed = false; }
        easeGait(an, dt);
        // distant figures are posed every 2nd (past LOD.near) or 4th (past LOD.far) frame, staggered --
        // display only, so the world's deterministic simulation is untouched
        if (eye && an._posed && !an.moving) {   // (one on something moving -- a cart's driver, its team -- every frame: posed
                                                //  every 2nd or 4th it stayed behind where it was and slid off its seat)
          const d = Math.hypot(an.position.x - eye.x, an.position.z - eye.z), k = d > LOD.far ? 4 : d > LOD.near ? 2 : 1;
          if (k > 1 && (frameN + an.idx) % k) continue;
        }
        writeRows(an, t); if (an.dots.length) markRows(an, t); an._posed = true; POSE.figures++; POSE.parts += an.parts.length;
      }
      shell.grow();  // (a shell bucket that ran out of room gets it HERE, between frames, never mid-render)
      dirty = true;   // sync() uploads it, for the camera about to draw
    },
    poseInto, pushChains,   // the pool's two halves of a frame (it drives every herd at once)
    // THROWING A HERD AWAY. Taking its mesh out of the scene does nothing any more -- the pool draws every
    // herd on its list, through one driver -- so a herd that is finished with has to say so: its figures come
    // off the list and its slots go back. Its Group goes out of the scene with it, and if the pool's own
    // group was hanging on that Group (the first herd ever made carries it) it moves to a herd that is staying.
    dispose() {
      for (const an of animals) { an.hidden = true; P.give(an.base, an.slots); }
      animals.length = 0;
      const k = herds.indexOf(herd);
      if (k >= 0) herds.splice(k, 1);
      // the pool's own group hangs on the first herd ever made: it moves to one that is staying, or comes
      // off this mesh altogether -- left on a mesh that is being thrown out, NOTHING draws, and the next herd
      // does not take it back because it still has a parent (which is what emptied the asset viewer's stand
      // the moment you picked a second asset)
      if (P.group.parent === mesh) {
        const host = herds[0];
        if (host) host.mesh.add(P.group);
        else { mesh.remove(P.group); P.mounted = false; }
      }
      if (mesh.parent) mesh.parent.remove(mesh);
    },
    raw: () => P.wld,       // the world mirror itself (harnesses: a triangle part's third corner, docs/engines.md)
    // a part's two world endpoints as the last update() posed it -- for what rides on a body
    // without being part of it (a tool in the hand, tools.js)
    ends(an, i) { const o = (an.base + i) * 12, w = P.wld; return [[w[o], w[o + 1], w[o + 2]], [w[o + 4], w[o + 5], w[o + 6]]]; },
    // what this herd holds and how much of its dyn texture a frame really changes (harnesses, docs/engines.md)
    stats() {
      const rows = P.tDyn.image.height, hit = new Uint8Array(rows);
      let shown = 0;
      for (const an of animals) {
        if (an._off || an._out) continue;
        shown++;
        const r0 = Math.floor(an.base * 3 / W), r1 = Math.ceil((an.base + an.parts.length) * 3 / W);
        for (let r = r0; r < r1; r++) hit[r] = 1;
      }
      let dirtyRows = 0, runs = 0;
      for (let r = 0; r < rows; r++) { if (hit[r]) { dirtyRows++; if (!r || !hit[r - 1]) runs++; } }
      return { animals: animals.length, shown, used: P.used, cap: P.cap, rows, dirtyRows, runs, kb: rows * W * 16 / 1024,
               shell: shell.stats() };
    },
    // follow PIPE after setPipe: whatever it says, the next sync writes the rows again
    applyPipe() { dirty = true; },
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
      P.wld[t3 * 4] = scratchA[j]; P.wld[t3 * 4 + 1] = scratchA[j + 1]; P.wld[t3 * 4 + 2] = scratchA[j + 2];
      P.wld[(t3 + 1) * 4] = scratchB[j]; P.wld[(t3 + 1) * 4 + 1] = scratchB[j + 1]; P.wld[(t3 + 1) * 4 + 2] = scratchB[j + 2];
      if (an.parts[i].r2 < 0) { P.wld[(t3 + 2) * 4] = scratchC[j]; P.wld[(t3 + 2) * 4 + 1] = scratchC[j + 1]; P.wld[(t3 + 2) * 4 + 2] = scratchC[j + 2]; }
    }
    if (!an._restAxes) restAxes(an, n);
  }
  // THE CLOTH'S OWN FRAME (2026-10-05): a dressed part's REST AXIS -- its axis on the first frame it is posed, in the
  // figure's own frame (forward: the root's axis; up: the chest's; left) -- kept in its second colour's texel (a dressed
  // part has no pattern of its own to colour). The fragment shader turns the figure's forward from that axis to the
  // part's axis now by the least rotation, and measures the angle round the part from it: a sleeve's weave then turns
  // with the arm as it swings, instead of staying with the figure and sliding round the sleeve
  function restAxes(an, n) {
    an._restAxes = true;
    const ax = (k) => { const j = k * 3, d = [scratchB[j] - scratchA[j], scratchB[j + 1] - scratchA[j + 1], scratchB[j + 2] - scratchA[j + 2]], l = Math.hypot(...d); return l > 1e-6 ? d.map((v) => v / l) : null; };
    const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let fw = ax(0) ?? [1, 0, 0], up = [0, 1, 0];
    let chest = -1;
    for (let i = 0; i < n && chest < 0; i++) { const r = P.stat[(an.base + i) * ST * 4 + 11]; if (an.parts[i].dress?.layers.length && r > 0) chest = r - 1 - an.base; }
    if (chest >= 0 && chest < n) { const u = ax(chest); if (u) up = u; }
    const fwp = fw.map((v, k) => v - up[k] * dot3(fw, up)), lp = Math.hypot(...fwp);
    if (lp > 1e-4) fw = fwp.map((v) => v / lp);
    const lf = [fw[1] * up[2] - fw[2] * up[1], fw[2] * up[0] - fw[0] * up[2], fw[0] * up[1] - fw[1] * up[0]];
    for (let i = 0; i < n; i++) {
      const p = an.parts[i];
      if (!p.dress?.layers.length || p.pat) continue;
      const a = ax(i); if (!a) continue;
      const s = (an.base + i) * ST * 4;
      P.stat[s + 4] = dot3(a, fw); P.stat[s + 5] = dot3(a, up); P.stat[s + 6] = dot3(a, lf);
      P.stat[s + 7] = -1;   // (the strands' scale's slot: -1 marks a rest axis kept -- the shader reads no strands below 0)
    }
    P.tStat.needsUpdate = true;
  }
  // FACE MARKS (parts flagged `dot`: eyes, a mouth): their rows become the mark's frame on the parent's surface --
  // A = the centre (on the surface, along the parent's centre -> the posed corners' midpoint), B = A + half the
  // width (along the corners, flat in the touching plane), C = A + half the height (r1); the fragment shader paints it
  function markRows(an, t) {
    for (const i of an.dots) {
      const p = an.parts[i], pi = p.parentIdx;
      if (pi < 0) continue;
      const o = (an.base + i) * 12, q = (an.base + pi) * 12;
      const ax = P.wld[o], ay = P.wld[o + 1], az = P.wld[o + 2], bx = P.wld[o + 4], by = P.wld[o + 5], bz = P.wld[o + 6];
      const px = P.wld[q], py = P.wld[q + 1], pz = P.wld[q + 2];
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
      P.sdyn[o + 7] = ex?.tear ? 7 + ((t * .5 + (p.dot.side > 0 ? 0 : .45)) % 1) * .98 : ex?.code ?? 0;
      if (p._r0 === undefined) p._r0 = P.sdyn[o + 3] - 4;   // (a mark's A.w: 4 + its reach -- PACK_GLSL, no blend, the third texel read)
      P.sdyn[o + 3] = 4 + Math.min(3.99, p._r0 * (ex?.reach ?? 1) * p.dot.reach);   // (the same reach the cells were padded by, times what the expression asks for)
      P.wld[o] = cx; P.wld[o + 1] = cy; P.wld[o + 2] = cz;
      P.wld[o + 4] = cx + ux; P.wld[o + 5] = cy + uy; P.wld[o + 6] = cz + uz;
      P.wld[o + 8] = cx + vx * vs; P.wld[o + 9] = cy + vy * vs; P.wld[o + 10] = cz + vz * vs;
    }
  }
}
let scratchA = new Float32Array(MAXP * 3), scratchB = new Float32Array(MAXP * 3), scratchC = new Float32Array(MAXP * 3);
