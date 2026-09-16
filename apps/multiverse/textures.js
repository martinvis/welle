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
export const PATTERN_GLSL = /* glsl */ `
  float tileHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
  // value noise that repeats with the tile: its lattice (cells of ~c metres, a whole number of them to a period)
  // wraps every per metres, so a baked tile still tiles seamlessly
  float tileNoise(vec2 q, vec2 per, float c) {
    vec2 N = max(floor(per / c + .5), 1.0), g = q / per * N, i = floor(g), f = g - i;
    f = f * f * (3.0 - 2.0 * f);
    vec2 i0 = mod(i, N), i1 = mod(i + 1.0, N);
    return mix(mix(tileHash(i0), tileHash(vec2(i1.x, i0.y)), f.x), mix(tileHash(vec2(i0.x, i1.y)), tileHash(i1), f.x), f.y);
  }
  float gTilePhase = 0.0;   // which way the wind has the blades leaning while this grass tile is baked (-1 .. 1)
  vec3 patternTile(float pat, vec2 q) {
    float k = 1.0, a = 0.0, b = 0.0;
    if (pat < 2.5) {                     // 1 ashlar: large courses, staggered joints   2 brick: tight running bond
      bool br = pat > 1.5;
      float ch = br ? .27 : .8, bw = br ? .56 : 1.6;
      float row = floor(q.y / ch);
      float m = step(fract(q.y / ch), br ? .1 : .045);
      m = max(m, step(fract(q.x / bw + mod(row, 2.0) * .5), br ? .06 : .028));
      k = 1.0 - m * (br ? .16 : .09);
    } else if (pat < 3.5) {              // 3 grooves: vertical channels in the accent colour
      a = step(.62, fract(q.x * 6.0));
    } else if (pat < 4.5) {              // 4 stars: a dot grid in the accent colour
      a = smoothstep(.19, .13, length(fract(q / .55) - .5));
    } else if (pat < 5.5) {              // 5 marble: hairline joints of Greek precision masonry
      float row = floor(q.y / 1.1);
      float m = step(fract(q.y / 1.1), .015);
      m = max(m, step(fract(q.x / 2.3 + mod(row, 2.0) * .5), .0075));
      k = 1.0 - m * .05;
    } else if (pat < 6.5) {              // 6 tiles: scalloped roof courses
      float row = floor(q.y / .36);
      float tu = fract(q.x / .32 + mod(row, 2.0) * .5) - .5;
      float m = step(fract(q.y / .36), .14 + .2 * (1.0 - 2.0 * abs(tu)));
      m = max(m * .8, step(abs(tu), .03) * .5);
      k = 1.0 - m * .2;
    } else if (pat < 7.5) {              // 7 scroll: interfering waves curl into gilded tendrils, black counter-figures
      vec2 s = q * .76;                  // every frequency a whole multiple of .76: the tile repeats exactly
      float w1 = sin(s.x * 4.0 + sin(s.y * 6.0 + s.x * 2.0) * 1.6);
      float w2 = sin(s.y * 5.0 + sin(s.x * 3.0 - s.y * 2.0) * 1.8 + 1.2);
      float m = smoothstep(.55, .8, w1 * w2), e = smoothstep(.38, .55, w1 * w2) - m;
      a = clamp(m + e * .45, 0.0, 1.0);
      b = smoothstep(.55, .82, -(w1 * w2)) * .9;
    } else if (pat < 8.5) {              // 8 gothic: pilaster strips every 3m, string courses, blind tracery, faint joints
      float du = min(fract(q.x / 3.0), 1.0 - fract(q.x / 3.0)) * 3.0;
      k *= 1.0 - .22 * smoothstep(.14, .05, du);
      k *= 1.0 + .1 * (smoothstep(.3, .17, du) - smoothstep(.14, .05, du));
      float by = fract(q.y / 6.5);
      k *= 1.0 - .16 * step(by, .05);
      k *= 1.0 + .08 * step(.05, by) * step(by, .1);
      k *= 1.0 - .08 * step(.92, fract(q.x / .75)) * step(.45, by);
      k *= 1.0 - .05 * step(fract(q.y / .8125), .06);   // 8 joints to a course
    } else if (pat < 9.5) {              // 9 checker: 1.1m marble squares with thin joints
      a = mod(floor(q.x / 1.1) + floor(q.y / 1.1), 2.0) * .8;
      vec2 j = min(fract(q / 1.1), 1.0 - fract(q / 1.1));
      k = 1.0 - .12 * step(min(j.x, j.y), .012);
    } else if (pat < 10.5) {             // 10 ornament: a diamond lattice with centre bosses
      vec2 o = q / .85, f = abs(fract(o) - .5);
      float a1 = smoothstep(.06, .02, abs(f.x + f.y - .5)) * .55, a2 = smoothstep(.11, .05, length(fract(o) - .5)) * .6;
      a = 1.0 - (1.0 - a1) * (1.0 - a2);
    } else if (pat < 11.5) {             // 11 parquet: .14m boards in 1.2m lengths, staggered, each its own warm tone
      float row = floor(q.y / .14), sh = mod(row, 2.0) * .5;
      float j = max(step(fract(q.y / .14), .06), step(fract(q.x / 1.2 + sh), .02));
      float tone = fract(sin(mod(row, 16.0) * 12.99 + mod(floor(q.x / 1.2 + sh), 4.0) * 78.23) * 437.58);
      k = (1.0 - j * .22) * (.9 + .16 * tone);
    } else {                             // 99 grass: BLADES -- three to a ~3cm cell, each a tapered streak from its
      // root in the direction it leans, the tip pushed along +x by the tile's wind phase. The nearest blade wins the
      // texel; R is its coverage, G and B its along-the-blade place and its own tone, both PREMULTIPLIED by the
      // coverage so the mip chain averages them the way it averages the coverage (the ground divides them back out).
      // A real blade is 4mm wide, which from standing eye height is ONE PIXEL at the nearest ground you can see
      // (~4m at the bottom of the screen) -- true, and invisible. These are painted blades: 8mm at the root and
      // leaning far enough to read as a stroke, 3 to a 6cm cell, which is ~25% cover. Cells stay big enough that
      // a blade reaches no further than its neighbours, so a texel still tests 3x3 cells and no more.
      const float CELLS = 16.0, CELL = 1.0 / CELLS, W0 = .004, W1 = .0012, BEND = .018;
      vec2 gi = floor(q / CELL);
      float cov = 0.0, tip = 0.0, tone = 0.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 cc = gi + vec2(float(i), float(j)), cw = mod(cc, CELLS);   // wrapped: the tile repeats seamlessly at its period
        for (int n = 0; n < 3; n++) {
          float o = float(n) * 13.0;
          float h1 = tileHash(cw + o), h2 = tileHash(cw + o + 17.0), h3 = tileHash(cw + o + 41.0), h4 = tileHash(cw + o + 73.0);
          vec2 root = (cc + vec2(h1, h2)) * CELL;
          float ang = h3 * 6.2832, len = CELL * (.6 + .8 * h4);
          vec2 t = root + vec2(cos(ang), sin(ang)) * len + vec2(gTilePhase * BEND * (.6 + .8 * h2), 0.0);
          vec2 d = t - root, pq = q - root;
          float u = clamp(dot(pq, d) / max(dot(d, d), 1e-9), 0.0, 1.0);
          float dist = length(pq - d * u), w = mix(W0, W1, u);
          float c = smoothstep(w, w * .45, dist);
          if (c > cov) { cov = c; tip = u; tone = h3; }
        }
      }
      return vec3(cov, cov * tip, cov * tone);
    }
    return vec3(k, a, b);
  }
  // the pattern's RELIEF (baked into the tile's alpha, for parallax): 1 the face, 0 its deepest -- mortar, a
  // channel, the gap under a roof tile. The same joints as patternTile; stones' edges bevelled and unevenly worn, their
  // faces pitted, bricks chipped, mortar grainy (per: the tile's period -- the noise repeats with it)
  float patternHeight(float pat, vec2 q, vec2 per) {
    if (pat < 2.5) {                     // ashlar, brick: stones proud of the mortar, rounded at the arrises
      bool br = pat > 1.5;
      float ch = br ? .27 : .8, bw = br ? .56 : 1.6, wy = br ? .1 : .045, wx = br ? .06 : .028, bev = br ? .01 : .035;
      float row = floor(q.y / ch), fy = fract(q.y / ch), sx = q.x / bw + mod(row, 2.0) * .5, fx = fract(sx);
      float d = min(min(fy - wy, 1.0 - fy) * ch, min(fx - wx, 1.0 - fx) * bw);   // metres inside the stone (< 0: the mortar)
      float rough = br ? .1 * tileNoise(q, per, .025) + .05 * tileNoise(q + 7.0, per, .01)
                       : .12 * tileNoise(q, per, .08) + .07 * tileNoise(q + 3.0, per, .025) + .04 * tileNoise(q + 9.0, per, .01);
      float wear = (br ? .4 : .5) * tileNoise(q + 5.0, per, br ? .04 : .1);   // the arris worn unevenly: the bevel wider here, sharper there
      return d < 0.0 ? .1 + .06 * tileNoise(q + 11.0, per, .02)
                     : .5 + .5 * smoothstep(0.0, bev * (.6 + wear * 2.0), d) - .1 * tileHash(vec2(row, floor(sx))) - rough;
    } else if (pat < 3.5) {              // grooves: channels cut in
      float f = fract(q.x * 6.0);
      return 1.0 - .9 * smoothstep(.6, .66, f) * (1.0 - smoothstep(.96, 1.0, f));
    } else if (pat < 5.5 && pat > 4.5) { // marble: hairline joints
      float row = floor(q.y / 1.1), j = min(min(fract(q.y / 1.1), 1.0 - fract(q.y / 1.1)) * 1.1, min(fract(q.x / 2.3 + mod(row, 2.0) * .5), 1.0 - fract(q.x / 2.3 + mod(row, 2.0) * .5)) * 2.3);
      return .2 + .8 * smoothstep(.004, .012, j);
    } else if (pat < 6.5 && pat > 5.5) { // tiles: each course thick at its lower edge (lying on the one below), sunk where the scallops part
      float row = floor(q.y / .36), fy = fract(q.y / .36), tu = fract(q.x / .32 + mod(row, 2.0) * .5) - .5;
      float m = step(fy, .14 + .2 * (1.0 - 2.0 * abs(tu)));
      return mix(.3 + .7 * (1.0 - fy), .1, m) - .08 * tileNoise(q, per, .04);
    } else if (pat < 8.5 && pat > 7.5) { // gothic: pilaster strips and string courses stand out, tracery and joints cut in
      float du = min(fract(q.x / 3.0), 1.0 - fract(q.x / 3.0)) * 3.0, by = fract(q.y / 6.5);
      float h = .55 + .45 * smoothstep(.14, .1, du);
      h = max(h, step(by, .05));
      h -= .25 * step(.92, fract(q.x / .75)) * step(.45, by) + .15 * step(fract(q.y / .8125), .06);
      return clamp(h - .06 * tileNoise(q, per, .1) - .03 * tileNoise(q + 3.0, per, .03), 0.0, 1.0);
    } else if (pat < 9.5 && pat > 8.5) { // checker: thin joints
      vec2 j = min(fract(q / 1.1), 1.0 - fract(q / 1.1)) * 1.1;
      return .1 + .9 * smoothstep(.008, .016, min(j.x, j.y));
    } else if (pat < 10.5 && pat > 9.5) {   // ornament: lattice and bosses raised
      vec2 o = q / .85, f = abs(fract(o) - .5);
      float a1 = smoothstep(.07, .02, abs(f.x + f.y - .5)), a2 = smoothstep(.12, .04, length(fract(o) - .5));
      return .4 + .6 * max(a1, a2) - .04 * tileNoise(q, per, .03);
    } else if (pat < 11.5 && pat > 10.5) {  // parquet: the joints between boards
      float row = floor(q.y / .14), sh = mod(row, 2.0) * .5;
      return 1.0 - .8 * max(step(fract(q.y / .14), .06), step(fract(q.x / 1.2 + sh), .02));
    }
    return 1.0;                          // flat: stars, scroll, grass
  }
`;

const targets = new Map();
// the tile's texture (baked by bakeTiles; materials may take it before that)
export function tileTexture(name) {
  let rt = targets.get(name);
  if (!rt) {
    const t = TILES[name];
    rt = new THREE.WebGLRenderTarget(t.size, t.size, {
      depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: t.nearest ? THREE.NearestFilter : THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    });
    targets.set(name, rt);
  }
  return rt.texture;
}

// Render every tile once (3 x 3 samples per texel), mipmaps and anisotropy
// on. Call once after the renderer exists, before the first frame.
let baked = false;
export function bakeTiles(renderer) {
  if (baked) return;
  baked = true;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPat: { value: 0 }, uPeriod: { value: new THREE.Vector2() }, uTexel: { value: 0 }, uPhase: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uPat, uTexel, uPhase;
      uniform vec2 uPeriod;
      varying vec2 vUv;
      ${PATTERN_GLSL}
      void main() {
        gTilePhase = uPhase;   // the grass tiles are one pattern baked three times, leaning three ways
        vec3 s = vec3(0.0); float h = 0.0;
        for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) {
          vec2 q = (vUv + (vec2(float(i), float(j)) - 1.0) * uTexel / 3.0) * uPeriod;
          s += patternTile(uPat, q); h += patternHeight(uPat, q, uPeriod);
        }
        s /= 9.0; h /= 9.0;
        gl_FragColor = vec4(uPat > 98.5 ? s : vec3(s.x / 1.5, s.y, s.z), uPat > 98.5 ? 1.0 : h);   // alpha: the relief (parallax)
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(), cam = new THREE.Camera();
  scene.add(quad);
  const prev = renderer.getRenderTarget(), aniso = renderer.capabilities.getMaxAnisotropy();
  for (const [name, t] of Object.entries(TILES)) {
    const tex = tileTexture(name);
    tex.anisotropy = aniso;
    mat.uniforms.uPat.value = t.id;
    mat.uniforms.uPeriod.value.set(t.period[0], t.period[1]);
    mat.uniforms.uTexel.value = 1 / t.size;
    mat.uniforms.uPhase.value = t.phase ?? 0;
    renderer.setRenderTarget(targets.get(name));
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();
}

// a baked tile's texels (RGBA, bottom row first) -- for textures.html and the PNG export
export function readTile(renderer, name) {
  const rt = targets.get(name), n = TILES[name].size, buf = new Uint8Array(n * n * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, n, n, buf);
  for (let i = 3; i < buf.length; i += 4) buf[i] = 255;   // (the alpha holds the relief, for parallax: the picture shows opaque)
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
