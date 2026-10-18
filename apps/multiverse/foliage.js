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
import { wgslFn, uniform, texture, attribute, varying, float, vec4, positionGeometry,
         cameraViewMatrix, cameraProjectionMatrix, cameraPosition } from "three/tsl";
import { MASK_MODE, NOGRASS_LAYER } from "./grass.js";
import { lightWGSL } from "./light.js";
import { leafAtlasTexture, LEAF_STYLES } from "./textures.js";

export const FOLIAGE_T = { value: 0 };
// 1 (the default): every card is a banner turned to the camera -- each by
// its own angle within the screen plane, so the clumps never repeat -- and
// keeps its stored orientation only for the shading (so brightness still
// varies through a crown); 0: cards stand fixed in space, as grown.
export const FOLIAGE_BB = { value: 1 };

// ---- the shaders, in WGSL (docs/webgpu.md) ----------------------------------------------------------------
// A leaf cluster is one card: its centre and two half-extent vectors, its style cell in the atlas, its phase,
// how far it sways and its crown's shade. The card sways with the one wind clock; optionally it billboards,
// turning with the view but keeping its own roll.
const leafPoint = wgslFn(`
  fn leafPoint(corner: vec3<f32>, C: vec3<f32>, R: vec3<f32>, U: vec3<f32>, info: vec4<f32>,
               view: mat4x4<f32>, t: f32, billboard: f32) -> vec3<f32> {
    var Rv = R;
    var Uv = U;
    if (billboard > 0.5) {   // a banner facing the camera: the view's right and up, turned by the card's own angle
      let cr = vec3<f32>(view[0][0], view[1][0], view[2][0]);
      let cu = vec3<f32>(view[0][1], view[1][1], view[2][1]);
      let s = length(R);
      let c = cos(info.y);
      let sn = sin(info.y);
      Rv = (cr * c + cu * sn) * s;
      Uv = (cu * c - cr * sn) * s;
    }
    var p = C + Rv * corner.x + Uv * corner.y;
    p.x = p.x + info.z * sin(t * 1.6 + info.y);
    p.z = p.z + info.z * 0.7 * sin(t * 1.1 + info.y * 1.7);
    return p;
  }
`);

const leafUv = wgslFn(`
  fn leafUv(corner: vec3<f32>, info: vec4<f32>, styles: f32) -> vec2<f32> {
    return vec2<f32>((info.x + corner.x * 0.5 + 0.5) / styles, corner.y * 0.5 + 0.5);
  }
`);

// the leaf's colour and its cut-out edge: the atlas's alpha sharpened to a one-pixel edge (for
// alpha-to-coverage), the crown's own shade, and the mask pass's black where a leaf is not grass
const leafFrag = wgslFn(`
  fn leafFrag(atlas: texture_2d<f32>, samp: sampler, uv: vec2<f32>, atlasSize: vec2<f32>, col: vec3<f32>,
              nrm: vec3<f32>, wp: vec3<f32>, shade: f32, eye: vec3<f32>, maskMode: f32) -> vec4<f32> {
    let tex = textureSample(atlas, samp, uv);
    let dx = dpdx(uv * atlasSize);
    let dy = dpdy(uv * atlasSize);
    let mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
    var a = tex.a * (1.0 + mip * 0.25);                          // keep far crowns full
    a = (a - 0.5) / max(abs(dpdx(a)) + abs(dpdy(a)), 1e-4) + 0.5;  // a one-pixel edge for alpha-to-coverage
    if (a <= 0.0) { discard; }
    var n = normalize(nrm);
    if (dot(n, eye - wp) < 0.0) { n = -n; }                      // the side we see
    let k = ${lightWGSL("n")};
    // the grass mask (grass.js): a leaf is not grass and nothing may be painted over it. Its shape is this
    // alpha, so the mask cuts with it here rather than through an override material that never sees it.
    if (maskMode > 0.5) {
      if (a < 0.5) { discard; }
      return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    return vec4<f32>(col * tex.rgb * k * shade, clamp(a, 0.0, 1.0));
  }
`);

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
  const A = { C: attribute("aC", "vec3"), R: attribute("aR", "vec3"), U: attribute("aU", "vec3"),
              col: attribute("aCol", "vec3"), info: attribute("aInfo", "vec4") };
  const uT = uniform(0).onRenderUpdate(() => FOLIAGE_T.value);           // the one wind clock
  const uBillboard = uniform(0).onRenderUpdate(() => FOLIAGE_BB.value);
  const uMask = uniform(0).onRenderUpdate(() => MASK_MODE.value);
  const texNode = texture(atlas);
  const p = leafPoint({ corner: positionGeometry, C: A.C, R: A.R, U: A.U, info: A.info,
                        view: cameraViewMatrix, t: uT, billboard: uBillboard });
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, alphaToCoverage: true, transparent: true });
  mat.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1.0)));
  const out = leafFrag({
    atlas: texNode, samp: texNode,
    uv: varying(leafUv({ corner: positionGeometry, info: A.info, styles: float(LEAF_STYLES.length) }), "vLeafUv"),
    atlasSize: uniform(new THREE.Vector2(atlas.image.width, atlas.image.height)),
    col: A.col, nrm: varying(A.R.cross(A.U).normalize(), "vLeafN"), wp: varying(p, "vLeafW"),
    shade: A.info.w, eye: cameraPosition, maskMode: uMask,
  });
  mat.colorNode = out.xyz;
  mat.opacityNode = out.w;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.cut = true;          // a leaf's shape lives in the shader's cut-out: never an occluder through an override material
  mesh.layers.enable(NOGRASS_LAYER);   // ...it writes the grass mask itself instead (MASK_MODE, above)
  mesh.userData.cards = n;
  return mesh;
}
