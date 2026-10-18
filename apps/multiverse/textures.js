// Pattern tiles: the building materials' surface patterns (ashlar, brick,
// marble joints, roof tiles, checker floors, parquet, gothic bands,
// grooves, stars, ornament, scrollwork) and the ground's grass, CALCULATED
// at startup -- the same maths the shaders used to evaluate per pixel,
// rendered once over exactly one period of each pattern into a texture
// with mipmaps and anisotropic filtering. Per pixel the materials then read
// a filtered tile instead of evaluating hard-edged steps: thin joints fade
// instead of flickering at distance, a checker floor seen at a grazing angle
// no longer turns to moire, and the grass stops shimmering.
//
// A tile stores what the pattern DOES, not colours: R = the brightness
// factor k / 1.5, G = how much of the accent colour, B = how much of the dark
// counter-figure colour -- so one tile serves every colour of brick. Mixing
// and multiplying are linear in these, so averaging them down the mip chain
// is exactly averaging the coloured result. (The grass tile holds three
// masks instead: two fleck kinds and a patch value.)
//
// TEXTURES.on (?textures=0) switches it off: the materials then evaluate the
// same GLSL per pixel -- one source of truth, below. textures.html shows the
// tiles; build/textures.py saves them as PNG files into texture/ for looking
// at. Nothing loads those files: the tiles are always calculated.
import * as THREE from "three";
import { wgslFn, uniform, uv } from "three/tsl";
import { patternTile, patternHeight } from "./textures_wgsl.js";

export const TEXTURES = { on: true };
// PARALLAX on the baked architecture tiles (archMaterial): the relief baked in each tile's alpha, walked in `steps`
// layers up to the tile's `depth`, fading out by `far` metres (index.html sets it from config.json)
export const PARALLAX = { on: true, steps: 8, far: 15, shadowSteps: 4 };   // shadowSteps: the relief's own shadows (0: none)

// period: the metres one tile covers in (u, v) -- one exact repeat of the
// pattern (along the face, up) on walls, (x, z) on floors; size: texels a side;
// depth: metres of relief for parallax (0: flat)
export const TILES = {
  ashlar:   { id: 1, period: [1.6, 1.6], size: 512, depth: .03 },          // two courses of large stones
  brick:    { id: 2, period: [.56, .54], size: 512, depth: .018 },          // two courses of running bond
  grooves:  { id: 3, period: [1 / 6, 1 / 6], size: 128, depth: .03 },     // triglyph channels
  stars:    { id: 4, period: [.55, .55], size: 256 },          // a dot grid
  marble:   { id: 5, period: [2.3, 2.2], size: 1024, depth: .004 },         // hairline joints (the veining stays per pixel: smooth)
  tiles:    { id: 6, period: [.32, .72], size: 512, depth: .03 },          // scalloped roof tiles, two courses
  scroll:   { id: 7, period: [2 * Math.PI / .76, 2 * Math.PI / .76], size: 1024 },   // scrollwork, frequencies on one base so it repeats
  gothic:   { id: 8, period: [3, 6.5], size: 1024, depth: .06 },           // a bay by a string course
  checker:  { id: 9, period: [2.2, 2.2], size: 1024, depth: .004 },         // two marble squares each way
  ornament: { id: 10, period: [.85, .85], size: 512, depth: .02 },         // diamond lattice with bosses
  parquet:  { id: 11, period: [4.8, 2.24], size: 1024, depth: .003 },       // 4 lengths x 16 boards, each its own tone
  // GRASS: real blades, one tile per wind phase (bent left, upright, bent right) -- the ground blends the two
  // that bracket the wind where it stands, so the lawn BENDS instead of sliding. A blade is ~4mm wide, so the
  // tile has to be fine: 1m to 512 texels is .2cm each. It repeats every metre, which the broad tone patches
  // and the per-blade tone hide. Mipmapped like every other tile, which is what keeps blades from shimmering.
  grassL:   { id: 99, period: [1, 1], size: 512, phase: -1 },
  grass:    { id: 99, period: [1, 1], size: 512, phase: 0 },
  grassR:   { id: 99, period: [1, 1], size: 512, phase: 1 },
};

// The patterns. q: metres in the pattern's plane. Returns (k, accent, dark);
// the grass returns its masks.
// The patterns live in textures_wgsl.js now; the GLSL they were ported from is kept outside the repo as the
// parity reference (examples/webgpu_parity.html).

const targets = new Map();
// the tile's texture (baked by bakeTiles; materials may take it before that)
export function tileTexture(name) {
  let rt = targets.get(name);
  if (!rt) {
    const t = TILES[name];
    rt = new THREE.RenderTarget(t.size, t.size, {
      depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: t.nearest ? THREE.NearestFilter : THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    });
    targets.set(name, rt);
  }
  return rt.texture;
}

// The tile bake, in WGSL: one full-screen pass per tile, 3 x 3 samples a texel, mipmaps and anisotropy on.
// Colour carries the pattern, ALPHA its relief (patternHeight) for the parallax to walk down into.
// Call once after the renderer exists, before the first frame.
const bakeFn = wgslFn(`
  fn bakeTile(uv: vec2<f32>, pat: f32, period: vec2<f32>, texel: f32, phase: f32) -> vec4<f32> {
    var s = vec3<f32>(0.0);
    var h = 0.0;
    for (var i: i32 = 0; i < 3; i = i + 1) {
      for (var j: i32 = 0; j < 3; j = j + 1) {
        let q = (uv + (vec2<f32>(f32(i), f32(j)) - 1.0) * texel / 3.0) * period;
        s = s + patternTile(pat, q, phase);       // (the grass tiles are one pattern baked three times, leaning three ways)
        h = h + patternHeight(pat, q, period);
      }
    }
    s = s / 9.0;
    h = h / 9.0;
    if (pat > 98.5) { return vec4<f32>(s, 1.0); }          // grass: the blades' own three channels, no relief
    return vec4<f32>(s.x / 1.5, s.y, s.z, h);
  }
`, [patternTile, patternHeight]);

let baked = false;
export function bakeTiles(renderer) {
  if (baked) return;
  baked = true;
  const uPat = uniform(0), uPeriod = uniform(new THREE.Vector2()), uTexel = uniform(0), uPhase = uniform(0);
  const mat = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, transparent: true });
  mat.blending = THREE.NoBlending;                         // the alpha IS data (the relief), never a blend factor
  const baked4 = bakeFn({ uv: uv(), pat: uPat, period: uPeriod, texel: uTexel, phase: uPhase });
  mat.colorNode = baked4.xyz;
  mat.opacityNode = baked4.w;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  scene.add(quad);
  const prev = renderer.getRenderTarget(), aniso = renderer.getMaxAnisotropy();
  for (const [name, t] of Object.entries(TILES)) {
    const tex = tileTexture(name);
    tex.anisotropy = aniso;
    uPat.value = t.id;
    uPeriod.value.set(t.period[0], t.period[1]);
    uTexel.value = 1 / t.size;
    uPhase.value = t.phase ?? 0;
    renderer.setRenderTarget(targets.get(name));
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();
}

// a baked tile's texels (RGBA, BOTTOM row first) -- for textures.html and the PNG export
//   THE ROW ORDER IS THIS FUNCTION'S BUSINESS, not its callers'. WebGL's readPixels handed back the bottom
// row first; WebGPU's readback starts at the TOP (its render targets have their origin there), so on the
// switch every exported tile came out upside down. The rows are turned back here, once, so everything that
// reads a tile -- textures.html, the PNG export, the two engines' comparison page -- keeps the one order.
export async function readTile(renderer, name) {
  const rt = targets.get(name), n = TILES[name].size;
  const buf = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, n, n);   // WebGPU reads back asynchronously
  for (let i = 3; i < buf.length; i += 4) buf[i] = 255;   // (the alpha holds the relief, for parallax: the picture shows opaque)
  const row = n * 4, tmp = buf.slice(0, row);
  for (let y = 0; y < n >> 1; y++) {
    const a = y * row, b = (n - 1 - y) * row;
    tmp.set(buf.subarray(a, a + row));
    buf.copyWithin(a, b, b + row);
    buf.set(tmp, b);
  }
  return buf;
}

// ---- the leaf atlas ----------------------------------------------------------
// Clusters of leaves painted on a canvas, one cell per style, for the trees'
// leaf cards (foliage.js): white-to-grey leaves (each its own grey, a darker
// midrib on the broad ones) on transparent, so a card's colour tints them
// and the alpha cuts them out. Calculated like the tiles (seeded, nothing
// loaded); mipmapped; textures.html shows it and build/textures.py saves it.
export const LEAF_STYLES = ["oval", "round", "lobed", "needles", "willow", "berries", "apples", "cherries"];   // the last three: fruit cards (bushes, orchard trees)
export const LEAF_CELL = 256;
export function leafAtlasCanvas() {
  const S = LEAF_CELL, cv = document.createElement("canvas");
  cv.width = S * LEAF_STYLES.length; cv.height = S;
  const g = cv.getContext("2d");
  let seed = 11;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  LEAF_STYLES.forEach((style, i) => {
    seed = 11 + i * 101;
    const ox = i * S;
    g.save();
    g.beginPath(); g.rect(ox, 0, S, S); g.clip();   // nothing spills into the next cell
    const grey = () => { const v = 200 + Math.floor(rnd() * 55); return `rgb(${v},${v},${v})`; };
    if (style === "apples") {   // apples: a few round fruits on short stalks, each with a paler highlight
      for (let t = 0; t < 7; t++) {
        const x = ox + S * (.2 + .6 * rnd()), y = S * (.22 + .6 * rnd()), ar = S * (.07 + .025 * rnd()), v = 180 + Math.floor(rnd() * 45);
        g.strokeStyle = "rgb(70,55,35)"; g.lineWidth = S * .012; g.beginPath(); g.moveTo(x, y - ar * .8); g.lineTo(x + ar * .2, y - ar * 1.4); g.stroke();
        g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(x, y, ar, 0, 6.2832); g.fill();
        g.fillStyle = "rgb(255,255,255)"; g.beginPath(); g.arc(x - ar * .35, y - ar * .3, ar * .28, 0, 6.2832); g.fill();
      }
    } else if (style === "cherries") {   // cherries: pairs of small fruits on long stalks joined at the top
      for (let t = 0; t < 10; t++) {
        const x = ox + S * (.2 + .6 * rnd()), y = S * (.15 + .55 * rnd()), cr = S * (.032 + .008 * rnd()), sp = cr * (1.3 + rnd());
        g.strokeStyle = "rgb(70,55,35)"; g.lineWidth = S * .008;
        for (const s of [-1, 1]) {
          const fx = x + s * sp, fy = y + S * .12, v = 180 + Math.floor(rnd() * 45);
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s * sp * .3, y + S * .05, fx, fy - cr); g.stroke();
          g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(fx, fy, cr, 0, 6.2832); g.fill();
          g.fillStyle = "rgb(255,255,255)"; g.beginPath(); g.arc(fx - cr * .35, fy - cr * .35, cr * .28, 0, 6.2832); g.fill();
        }
      }
    } else if (style === "berries") {   // clusters of round berries, each with a paler highlight (the card's colour tints them)
      for (let t = 0; t < 12; t++) {
        const cx = ox + S * (.16 + .68 * rnd()), cy = S * (.16 + .68 * rnd()), br = S * (.028 + .012 * rnd());
        for (let k = 0, n = 5 + Math.floor(rnd() * 5); k < n; k++) {
          const a = rnd() * 6.2832, d = br * 1.6 * Math.sqrt(rnd()), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, v = 175 + Math.floor(rnd() * 45);
          g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(x, y, br, 0, 6.2832); g.fill();
          g.fillStyle = "rgb(255,255,255)"; g.beginPath(); g.arc(x - br * .35, y - br * .35, br * .3, 0, 6.2832); g.fill();
        }
      }
    } else if (style === "needles") {   // tufts of needles radiating from twig points
      g.lineCap = "round"; g.lineWidth = S * .013;
      for (let t = 0; t < 24; t++) {   // packed: a card reads as a full clump
        const cx = ox + S * (.14 + .72 * rnd()), cy = S * (.14 + .72 * rnd()), base = rnd() * 6.2832;
        for (let k = 0; k < 16; k++) {
          const a = base + k / 16 * 6.2832 + (rnd() - .5) * .3, l = S * .1 * (.7 + .6 * rnd());
          g.strokeStyle = grey(); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); g.stroke();
        }
      }
    } else {
      // packed clusters: a card reads as a full clump of leaves, not a few strays
      const n = style === "willow" ? 34 : style === "round" ? 30 : style === "lobed" ? 18 : 26, base = S * (style === "round" ? .085 : style === "willow" ? .085 : style === "lobed" ? .12 : .1);
      for (let k = 0; k < n; k++) {
        const x = ox + S * (.12 + .76 * rnd()), y = S * (.12 + .76 * rnd()), s = base * (.7 + .6 * rnd()), a = rnd() * 6.2832;
        g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = grey(); g.beginPath();
        if (style === "oval") g.ellipse(0, 0, s * .45, s, 0, 0, 6.2832);
        else if (style === "round") g.arc(0, 0, s * .6, 0, 6.2832);
        else if (style === "willow") g.ellipse(0, 0, s * .16, s * 1.3, 0, 0, 6.2832);
        else for (let j = 0; j < 5; j++) { const t = (j - 2) * .55; g.ellipse(Math.sin(t) * s * .35, -Math.cos(t) * s * .35 + s * .2, s * .22, s * .7, t, 0, 6.2832); }
        g.fill();
        if (style !== "round") {   // a midrib, a little darker
          const L = style === "willow" ? 1.2 : .85;
          g.strokeStyle = "rgba(0,0,0,.2)"; g.lineWidth = Math.max(1, s * .06);
          g.beginPath(); g.moveTo(0, s * L); g.lineTo(0, -s * L); g.stroke();
        }
        g.restore();
      }
    }
    g.restore();
  });
  return cv;
}
let atlas = null;
export function leafAtlasTexture() {
  if (!atlas) {
    atlas = new THREE.CanvasTexture(leafAtlasCanvas());
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 8;
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  }
  return atlas;
}
