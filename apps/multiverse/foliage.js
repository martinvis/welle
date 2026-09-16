// Leaf cards for a whole forest in ONE draw call (the trees are grown in
// flora.js makeTree). Every card is a quad at its place in a crown, painted
// with a cluster of leaves from the leaf atlas (textures.js) and cut out by
// the atlas's alpha -- see-through between the leaves, no sorting needed.
//
// Edges: alpha-to-coverage on the multisampled canvas. The alpha is
// sharpened to about one pixel round the leaf outline, so the MSAA samples
// give the leaves smooth edges; and it is lifted with the mip level, or a
// distant crown -- whose averaged alpha falls below the cut -- would thin
// out to nothing.
// Shading, light-free like everything else: the buildings' orientation term
// from the card's facing (the side toward the camera), a crown-depth factor
// (inner cards darker), each leaf's own grey from the atlas, the card's
// colour (species, per-tree and per-card tint, autumn). Wind: every card
// sways by its height in the crown, on FOLIAGE_T (the frame loop ticks it).
import * as THREE from "three";
import { MASK_MODE, NOGRASS_LAYER } from "./grass.js";
import { leafAtlasTexture, LEAF_STYLES } from "./textures.js";

export const FOLIAGE_T = { value: 0 };
// 1 (the default): every card is a banner turned to the camera -- each by
// its own angle within the screen plane, so the clumps never repeat -- and
// keeps its stored orientation only for the shading (so brightness still
// varies through a crown); 0: cards stand fixed in space, as grown.
export const FOLIAGE_BB = { value: 1 };

const VERT = /* glsl */ `
  attribute vec3 aC, aR, aU, aCol;
  attribute vec4 aInfo;            // style, phase, sway (metres), crown shade
  uniform float uT, uStyles, uBillboard;
  varying vec2 vUv;
  varying vec3 vCol, vN, vW;
  varying float vShade;
  void main() {
    vec3 R = aR, U = aU;
    if (uBillboard > .5) {   // a banner facing the camera: the view's right and up, turned by the card's own angle
      vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      float s = length(aR), c = cos(aInfo.y), sn = sin(aInfo.y);
      R = (cr * c + cu * sn) * s; U = (cu * c - cr * sn) * s;
    }
    vec3 p = aC + R * position.x + U * position.y;
    p.x += aInfo.z * sin(uT * 1.6 + aInfo.y);
    p.z += aInfo.z * .7 * sin(uT * 1.1 + aInfo.y * 1.7);
    vUv = vec2((aInfo.x + position.x * .5 + .5) / uStyles, position.y * .5 + .5);
    vN = normalize(cross(aR, aU)); vW = p; vCol = aCol; vShade = aInfo.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uMaskMode;
  uniform vec2 uAtlasSize;
  varying vec2 vUv;
  varying vec3 vCol, vN, vW;
  varying float vShade;
  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    vec2 dx = dFdx(vUv * uAtlasSize), dy = dFdy(vUv * uAtlasSize);
    float mip = max(0.0, .5 * log2(max(dot(dx, dx), dot(dy, dy))));
    float a = t.a * (1.0 + mip * .25);                        // keep far crowns full
    a = (a - .5) / max(fwidth(a), 1e-4) + .5;                  // a one-pixel edge for alpha-to-coverage
    if (a <= 0.0) discard;
    vec3 n = normalize(vN);
    if (dot(n, cameraPosition - vW) < 0.0) n = -n;             // the side we see
    float k = .82 + .2 * n.y + .1 * n.x + .06 * n.z;
    gl_FragColor = vec4(vCol * t.rgb * k * vShade, clamp(a, 0.0, 1.0));
    // the grass mask (grass.js): a leaf is not grass and nothing may be painted over it. Its shape is this
    // alpha, so the mask cuts with it here rather than through an override material that never sees it.
    if (uMaskMode > .5) { if (a < .5) discard; gl_FragColor = vec4(0.0); }
    #include <colorspace_fragment>
  }
`;

// cards: [{ c: [x,y,z] world centre, r, u: half-extent vectors, color (hex), style (index), phase, sway, shade }]
export function buildFoliage(cards) {
  const n = cards.length;
  const quad = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  const fC = new Float32Array(n * 3), fR = new Float32Array(n * 3), fU = new Float32Array(n * 3), fCol = new Float32Array(n * 3), fInfo = new Float32Array(n * 4);
  const col = new THREE.Color();
  cards.forEach((L, i) => {
    fC.set(L.c, i * 3); fR.set(L.r, i * 3); fU.set(L.u, i * 3);
    col.set(L.color); fCol[i * 3] = col.r; fCol[i * 3 + 1] = col.g; fCol[i * 3 + 2] = col.b;
    fInfo[i * 4] = L.style; fInfo[i * 4 + 1] = L.phase; fInfo[i * 4 + 2] = L.sway; fInfo[i * 4 + 3] = L.shade;
  });
  geo.setAttribute("aC", new THREE.InstancedBufferAttribute(fC, 3));
  geo.setAttribute("aR", new THREE.InstancedBufferAttribute(fR, 3));
  geo.setAttribute("aU", new THREE.InstancedBufferAttribute(fU, 3));
  geo.setAttribute("aCol", new THREE.InstancedBufferAttribute(fCol, 3));
  geo.setAttribute("aInfo", new THREE.InstancedBufferAttribute(fInfo, 4));
  geo.instanceCount = n;
  const atlas = leafAtlasTexture();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMaskMode: MASK_MODE, uAtlas: { value: atlas }, uAtlasSize: { value: new THREE.Vector2(atlas.image.width, atlas.image.height) },
                uT: FOLIAGE_T, uStyles: { value: LEAF_STYLES.length }, uBillboard: FOLIAGE_BB },
    vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.DoubleSide, alphaToCoverage: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.cut = true;          // a leaf's shape lives in the shader's cut-out: never an occluder through an override material
  mesh.layers.enable(NOGRASS_LAYER);   // ...it writes the grass mask itself instead (MASK_MODE, above)
  mesh.userData.cards = n;
  return mesh;
}
