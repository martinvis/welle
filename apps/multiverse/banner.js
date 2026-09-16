// Banner engine: same species part-list -> hierarchy of camera-facing quads.
// Each part is ONE 2-triangle quad ("banner"); the fragment shader draws a
// mathematically perfect silhouette -- circle for spheres, pill for capsules,
// uneven pill for cones -- as a 2D signed-distance function, filled flat,
// with an optional 1px outline. No lighting, no tessellation, no outline mesh.
// A polygon mesh would take ~600 triangles x2 meshes per part vs 2 triangles x1 here.
//
// How a part becomes a banner: its primitive is reduced to a canonical
// SEGMENT (two local endpoints A,B plus end radii r1,r2). The vertex shader
// transforms A,B to view space, flattens them onto the camera plane through
// their midpoint, and stretches the quad to cover the projected shape -- so
// a capsule seen side-on is a long pill, and the same capsule seen end-on
// collapses to a circle, exactly like the real solid's silhouette. Depth is
// the (constant) midpoint depth, so parts of one animal still sort against
// each other and against other animals with the ordinary z-buffer.
import * as THREE from "three";
export { animateSpecies } from "./anim.js";

import { OUTLINE, OUTLINE_COLOR } from "./outline.js";
export { OUTLINE };
export const BORDER = { color: OUTLINE_COLOR };
// The outline switch (outline.js) is shared by every banner material as one
// uniform object: 0 = flat fills only, 1 = a one-pixel dark band along each
// silhouette, measured with screen-space derivatives so it stays one pixel
// wide at any distance. Off by default; Shift+O toggles it.

const QUAD = new THREE.PlaneGeometry(2, 2);   // position.xy in [-1,1] -> extent multipliers

// 2D uneven capsule (iq): distance to the hull of two circles (pa,ra),(pb,rb).
// Shared with instanced.js so the silhouette math cannot diverge.
export const SDF_GLSL = /* glsl */ `
  float sdUnevenCapsule(vec2 p, vec2 pa, vec2 pb, float ra, float rb) {
    vec2 d = pb - pa;
    float h = length(d);
    if (h < 1e-5) return length(p - pa) - max(ra, rb);
    vec2 u = d / h;
    vec2 q = vec2(abs(dot(p - pa, vec2(-u.y, u.x))), dot(p - pa, u));
    float b = clamp((ra - rb) / h, -0.999, 0.999);
    float a = sqrt(1.0 - b * b);
    float k = dot(q, vec2(-b, a));
    if (k < 0.0) return length(q) - ra;
    if (k > a * h) return length(q - vec2(0.0, h)) - rb;
    return dot(q, vec2(a, b)) - ra;
  }

  // signed distance to a 2D triangle (iq) -- the "tri" banner shape: flat
  // membrane skins (bat wings) that no capsule silhouette can fake
  float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
    vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
    vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                     vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                 vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
  }

  // DEPTH: the depth-buffer value of a view-space point through the camera's projection P -- in full,
  // not the plain-perspective shortcut, so a mirror's camera (three's Reflector tilts its near plane onto
  // the glass: an oblique projection) puts the SDF figures at the same depths as the meshes around them.
  // -1 where the point lies before the near plane: behind the glass, or too close -- the caller discards it.
  float viewDepth(mat4 P, vec3 pv) { vec4 c = P * vec4(pv, 1.0); float z = c.z / c.w; return z < -1.0 ? -1.0 : z * 0.5 + 0.5; }

  // TUBES: a quadratic Bezier centreline a -> (control c) -> b whose radius runs
  // from r1 (at a) to r2 (at b) with a bulge in the middle, r(t) = mix(r1, r2, t)
  // + bulge * 4t(1-t) -- a swan's S-neck from two, a snake from a few, a fish's
  // spindle from one straight one with a bulge. The radius slot of b packs
  // -2 - (r2 in mm + 4096 * bulge in mm) (a triangle's is -1).
  vec2 tubeUnpack(float bw) { float v = -bw - 2.0, bu = floor(v / 4096.0 + 1e-4); return vec2(v - bu * 4096.0, bu) * 0.001; }   // (r2, bulge)
  float tubeR(float t, float r1, vec2 rb) { return mix(r1, rb.x, t) + rb.y * 4.0 * t * (1.0 - t); }
  vec3 bezier3(vec3 a, vec3 c, vec3 b, float t) { float s = 1.0 - t; return s * s * a + 2.0 * s * t * c + t * t * b; }
  vec2 bezier2(vec2 a, vec2 c, vec2 b, float t) { float s = 1.0 - t; return s * s * a + 2.0 * s * t * c + t * t * b; }
  // the parameter of the point of a 2D quadratic Bezier (A, control B, C) nearest to p (iq's
  // sdBezier cubic); a straight one (control at the middle) by plain projection
  float bezierT(vec2 p, vec2 A, vec2 B, vec2 C) {
    vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - p, ac = C - A;
    float L2 = max(dot(ac, ac), 1e-12);
    if (dot(b, b) < 1e-5 * L2) return clamp(dot(p - A, ac) / L2, 0.0, 1.0);
    float kk = 1.0 / dot(b, b), kx = kk * dot(a, b), ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0, kz = kk * dot(d, a);
    float pp = ky - kx * kx, q = kx * (2.0 * kx * kx - 3.0 * ky) + kz, h = q * q + 4.0 * pp * pp * pp;
    if (h >= 0.0) {
      h = sqrt(h);
      vec2 x = (vec2(h, -h) - q) / 2.0, uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
      return clamp(uv.x + uv.y - kx, 0.0, 1.0);
    }
    float z = sqrt(-pp), v = acos(q / (pp * z * 2.0)) / 3.0, m = cos(v), n = sin(v) * 1.732050808;
    vec2 tt = clamp(vec2(m + m, -n - m) * z - kx, 0.0, 1.0);
    vec2 q0 = d + (c + b * tt.x) * tt.x, q1 = d + (c + b * tt.y) * tt.y;
    return dot(q0, q0) < dot(q1, q1) ? tt.x : tt.y;
  }

  // distance to the nearest border of a jittered 3D voronoi grid: large in a
  // cell's interior, ~0 on the seams -- thresholded, that is the giraffe's
  // coat (pattern 5): wide polygonal patches split by thin cream lines
  float cellBorder3(vec3 p) {
    vec3 g = floor(p), f = fract(p);
    float s1 = 8.0, s2 = 8.0;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
      vec3 o = vec3(float(i), float(j), float(k));
      vec3 h = fract(sin(vec3(dot(g + o, vec3(127.1, 311.7, 74.7)), dot(g + o, vec3(269.5, 183.3, 246.1)), dot(g + o, vec3(113.5, 271.9, 124.6)))) * 43758.55);
      float dd = length(o + 0.1 + h * 0.8 - f);
      if (dd < s1) { s2 = s1; s1 = dd; } else { s2 = min(s2, dd); }
    }
    return s2 - s1;
  }
  // a pattern's pixel size in metres at the surface -- set by a fragment caller before patternAt (the scales
  // fade with it); 0 (the default, and in vertex shaders, which have no derivatives): no fade
  float gPatPx = 0.0;
  float gPatAx = 0.0;   // (composite fragment) how squarely the surface faces along the pattern frame's x axis, |n.x|
  // the scales' cells: in the composite (SCALE_TEX) one filtered, mipmapped read of its baked volume
  // (composite.js scaleVolume: 8 cells per repeat), elsewhere the 27-cell search below
  #ifdef SCALE_TEX
  uniform highp sampler3D uScaleTex;
  vec3 scaleCells3(vec3 p);
  // (the filtered read rounds the seam's sharp dip off by ~half a texel -- taken back, so the seams stay as dark and thin)
  vec3 scaleAt(vec3 q) { vec4 t = texture(uScaleTex, q / 8.0); return vec3(max(t.r * .6 - .06, 0.0), t.g, t.b * .9); }
  #else
  vec3 scaleCells3(vec3 p);
  vec3 scaleAt(vec3 q) { return scaleCells3(q); }
  #endif
  // the same grid for reptile scales: x = distance to the nearest seam, y = the nearest cell's own random
  // tone (0..1), z = distance to that cell's middle
  vec3 scaleCells3(vec3 p) {
    vec3 g = floor(p), f = fract(p);
    float s1 = 8.0, s2 = 8.0, id = 0.0;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
      vec3 o = vec3(float(i), float(j), float(k));
      vec3 h = fract(sin(vec3(dot(g + o, vec3(127.1, 311.7, 74.7)), dot(g + o, vec3(269.5, 183.3, 246.1)), dot(g + o, vec3(113.5, 271.9, 124.6)))) * 43758.55);
      float dd = length(o + 0.1 + h * 0.8 - f);
      if (dd < s1) { s2 = s1; s1 = dd; id = h.x; } else { s2 = min(s2, dd); }
    }
    return vec3(s2 - s1, id, s1);
  }

  // EXACT SURFACE: the 2D silhouette says which pixels a part covers; for
  // depth and texturing the pixel's view ray is intersected with the real
  // 3D primitive -- a round cone from a (radius ra) to b (radius rb), a
  // capsule when the radii match, a sphere when a = b (iq's roundedcone
  // intersection; the ray starts at the camera, the view-space origin).
  // One closed-form hit per covering part, no marching. Returns the ray
  // distance, or -1 where the flattened silhouette overhangs the solid by a
  // sliver (the callers fall back to the plane-plus-bulge estimate there).
  float hitCone(vec3 rd, vec3 a, vec3 b, float ra, float rb) {
    vec3 ba = b - a, oa = -a, ob = -b;
    float m0 = dot(ba, ba);
    if (m0 < 1e-8) {
      float bq = dot(oa, rd), c = dot(oa, oa) - ra * ra, h = bq * bq - c;
      return h < 0.0 ? -1.0 : -bq - sqrt(h);
    }
    float rr = ra - rb, m1 = dot(ba, oa), m2 = dot(ba, rd), m3 = dot(rd, oa), m5 = dot(oa, oa), m6 = dot(ob, rd), m7 = dot(ob, ob);
    float d2 = m0 - rr * rr, k2 = d2 - m2 * m2, k1 = d2 * m3 - m1 * m2 + m2 * rr * ra, k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2.0 - m0 * ra * ra;
    float h = k1 * k1 - k0 * k2;
    if (h < 0.0) return -1.0;
    if (abs(k2) > 1e-9) {
      float t = (-sqrt(h) - k1) / k2, y = m1 - ra * rr + t * m2;
      if (y > 0.0 && y < d2) return t;
    }
    float h1 = m3 * m3 - m5 + ra * ra, h2 = m6 * m6 - m7 + rb * rb, r = 1e20;
    if (h1 > 0.0) r = -m3 - sqrt(h1);
    if (h2 > 0.0) r = min(r, -m6 - sqrt(h2));
    return r < 1e19 ? r : -1.0;
  }

  // Where the flattened silhouette overhangs the solid by a sliver the ray
  // misses; the surface there is the limb of the primitive, at the depth of
  // the ray's closest approach to its axis (the tangent point lies in the
  // plane through that point square to the ray). Using it keeps a part's
  // rim at the same depth as the pixels beside it, so a nearer part never
  // loses its own edge to a farther one.
  float approachT(vec3 rd, vec3 a, vec3 b) {
    vec3 ba = b - a;
    float m0 = dot(ba, ba), m2 = dot(ba, rd), m1 = dot(ba, a), m3 = dot(rd, a), den = m2 * m2 - m0;
    float s = abs(den) > 1e-8 ? clamp((m1 - m2 * m3) / den, 0.0, 1.0) : 0.5;
    return max(m3 + m2 * s, 0.05);
  }
  // the surface along the ray: the exact hit, else the limb
  float surfaceT(vec3 rd, vec3 a, vec3 b, float ra, float rb) {
    float t = hitCone(rd, a, b, ra, rb);
    return t > 0.0 ? t : approachT(rd, a, b);
  }

  // SHADING without lights: the buildings' deterministic orientation term
  // (architecture.js) -- brightness from the world-space normal alone, so a
  // back reads lighter than a belly and a flank than a chest, and animals
  // sit in the same light as the town. The normal of a capsule at its
  // surface point is the direction away from the nearest axis point (exact
  // for capsules, near enough for tapered ones); a membrane's is its plane.
  float shadeOf(vec3 n) { return .82 + .2 * n.y + .1 * n.x + .06 * n.z; }
  vec3 capsuleNormal(vec3 p, vec3 a, vec3 b) {
    vec3 ba = b - a; float l2 = max(dot(ba, ba), 1e-8);
    float s = clamp(dot(p - a, ba) / l2, 0.0, 1.0);
    vec3 n = p - (a + ba * s); float l = length(n);
    return l > 1e-5 ? n / l : vec3(0.0, 1.0, 0.0);
  }
  vec3 triNormal(vec3 A, vec3 B, vec3 C, vec3 toward) {   // facing the viewer
    vec3 n = normalize(cross(B - A, C - A));
    return dot(n, toward) > 0.0 ? -n : n;
  }

  // SOLID TEXTURES: every pattern is a function of a 3D point in metres in
  // the part's (or the animal's) own frame, never of the screen plane -- so
  // stripes keep their spacing from any angle and stay glued to the body.
  // The point comes from the pixel's reconstructed surface (plane point
  // scaled to the bulged depth, taken back to world space).
  // A part's frame: x along the segment from A, y up-ish, z sideways.
  vec3 partLocal(vec3 pw, vec3 A, vec3 B) {
    vec3 d = B - A; float l = length(d);
    vec3 u = l > 1e-4 ? d / l : vec3(1.0, 0.0, 0.0);
    vec3 ref = abs(u.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 w = normalize(cross(ref, u)), v = cross(u, w);
    vec3 q = pw - A;
    return vec3(dot(q, u), dot(q, v), dot(q, w));
  }
  // the pattern at local point p; r = the part's radius (mottles scale with it)
  //   1 leaf mottle, 2 bark streaks, 3 wavy tiger stripes, 4 straight zebra bands,
  //   5 giraffe patches, 6 butterfly wing spots, 7 turtle scutes, 8 beaver-tail diamonds, 17 reptile scales,
  //   18 leopard rosettes, 19 twist (a horn's spiral ridges)
  // BARK RELIEF (parallax on trunks and boughs: instanced.js) at s = (metres along the axis, metres round it) on a part
  // of radius r; 1 the bark's face, 0 its deepest. 2 furrowed: ridges running up the trunk, wavering, parted into
  // plates (oak, pine, most trees); 20 ringed: lenticels, short grooves across it (birch, cherry). Both repeat a whole
  // number of times round the trunk, so there is no seam where the unwrap closes
  float barkHeight(float pat, vec2 s, float r) {
    float C = 6.2832 * max(r, .01);
    if (pat > 19.5) {
      float row = floor(s.x / .035), fv = fract(s.x / .035) - .5, n = max(3.0, floor(C / .06 + .5));
      float dash = step(.45, fract(s.y / C * n + row * .37 + .1 * sin(row * 3.1)));
      return 1.0 - .8 * smoothstep(.2, .07, abs(fv)) * dash;
    }
    float n = max(3.0, floor(C / clamp(r * .5, .025, .09) + .5)), w = C / n;
    float c = s.y / w + .35 * sin(s.x / w * .45), fu = fract(c), cid = mod(floor(c), n);
    float ridge = smoothstep(0.0, .3, fu) * smoothstep(1.0, .7, fu);
    float plate = smoothstep(0.0, .08, fract(s.x / (w * 3.0) + fract(sin(cid * 12.9898) * 437.585)));
    return .15 + .85 * ridge * (.7 + .3 * plate);
  }
  vec3 patternAt(vec3 col, float pat, vec3 p, float r) {
    if (pat > 19.5) {   // 20 RINGED BARK (birch, cherry): its lenticels dark -- short dashes across the axis (barkHeight)
      return col * (.55 + .45 * barkHeight(20.0, vec2(p.x, atan(p.z, p.y) * r), r));
    }
    if (pat > 18.5) {   // 19 TWIST: ridges spiralling round the part's own axis (a screw) -- a horn's; p: x along it
      float ph = p.x / max(5.0 * r, .01) + atan(p.z, p.y) / 6.2832, rid = abs(fract(ph) - .5) * 2.0;
      return col * (.62 + .68 * smoothstep(.15, .7, rid));   // two-sided: a ridge CATCHES the light as well as its groove loses it, so it reads on a near-black horn (a blackbuck's) and not only on a pale one (a ram's)
    }
    if (pat > 17.5) {   // 18 ROSETTES: a leopard's -- laid out on the coat's own surface, not in space (a 3D grid sliced by the
      // body shows rings cut short and shrunk to dots): unwrapped round the body's or limb's axis (along it, round it by
      // true arc length -- one frame for the trunk's pieces, so no jump between them), one rosette per cell of a regular
      // grid with alternate rows staggered, nudged +-15% (the ring stays inside its cell), broken into small blobs by a
      // finer grid, round a centre a shade deeper; the unwrap's seam runs under the belly, and on a part's rounded end
      // (a muzzle, a sphere's pole: facing along the axis, where the unwrap smears) the rings fade out
      vec2 s = vec2(p.x, atan(p.z, p.y) * length(p.yz)) / .06; s.x += .5 * mod(floor(s.y), 2.0);
      vec2 g = floor(s), h = fract(sin(vec2(dot(g, vec2(127.1, 311.7)), dot(g, vec2(269.5, 183.3)))) * 43758.55);
      float d = length(s - (g + .5 + (h - .5) * .3));
      float ring = smoothstep(.15, .19, d) * (1.0 - smoothstep(.29, .33, d));
      float blob = step(.38, scaleAt(vec3(s * 2.4, 11.0)).y);
      float detail = (1.0 - smoothstep(.35, .8, gPatPx / .06)) * (1.0 - smoothstep(.6, .8, gPatAx));
      vec3 inner = mix(col, col * vec3(.9, .82, .72), 1.0 - smoothstep(.13, .16, d));
      return mix(col, mix(inner, vec3(.08, .06, .05), ring * blob * .92), detail);
    }
    if (pat > 16.5) {
      // SCALES (the dinosaurs): pebbly scales -- each a small dome, lighter in its middle, a dark seam round
      // it, its own tone -- sized by the limb's girth (a flank's bigger than a toe's), patches of bigger
      // feature scales where a slow blotchy mottle runs high; far away (scales under ~2 pixels) it fades
      // to the mottle alone, so it never shimmers
      float sz = clamp(r * .07, .012, .05);
      vec3 q = p / sz;
      float blot = sin(p.x * 2.1 + sin(p.z * 3.3)) * sin(p.y * 2.7 + p.z * 1.9);
      vec3 c = blot > .45 ? scaleAt(q * .6 + 17.0) : scaleAt(q);
      float dome = 1.12 - .42 * smoothstep(.05, .55, c.z), seam = mix(.55, 1.0, smoothstep(.01, .07, c.x)), tone = .86 + .26 * c.y;
      vec3 base = col * (1.0 + .14 * blot);
      float detail = 1.0 - smoothstep(.35, .8, gPatPx / sz);
      return mix(base * .86, base * tone * dome * seam, detail);
    }
    if (pat > 8.5) return col;   // cloth patterns: the composite engine's clothAt
    if (pat > 7.5) {
      float m = max(step(.4, abs(fract((p.x + p.y) / .025) - .5)), step(.4, abs(fract((p.x - p.y) / .025) - .5)));
      return mix(col, vec3(.03, .02, .02), m * .85);
    } else if (pat > 6.5) {
      return col * mix(.5, 1.0, smoothstep(.05, .16, cellBorder3(p / .055)));
    } else if (pat > 5.5) {
      vec2 sp = fract(p.xy / .05) - .5;
      return mix(col, vec3(.07, .05, .05), smoothstep(.34, .2, length(sp)) * .85);
    } else if (pat > 4.5) {
      return mix(col, vec3(.36, .19, .07), smoothstep(.07, .15, cellBorder3(p / .5)) * .93);
    } else if (pat > 2.5) {
      // stripes across the axis (vertical on a body, rings on a leg), ~18cm apart;
      // the tiger's wander with height and depth, the zebra's run straight
      float wig = pat > 3.5 ? 0.0 : sin(p.y * 9.) * .6 + sin(p.z * 7.) * .3;
      return mix(col, vec3(.045, .04, .04), smoothstep(.45, .7, sin(p.x * 35. + wig)) * .96);
    } else {
      vec3 q = p / max(r, .05);
      float m = pat > 1.5 ? smoothstep(.55, .8, fract(q.x * 1.4 + .3 * sin(atan(q.z, q.y) * 2.0)))   // streaks along the axis, wavering round it
                          : smoothstep(.2, .65, sin(q.x * 12.7 + 1.3) * sin(q.y * 13.9 + q.z * 7.1));
      return col * (1.0 - m * .12);
    }
  }
`;

const VERT = /* glsl */ `
  uniform vec3 uA, uB;
  uniform float uR1, uR2;
  varying vec2 vP, vA, vB;
  varying vec2 vRad;
  varying float vZc;
  varying vec3 vAw, vBw, vAv, vBv;
  varying vec2 vRw;
  void main() {
    vec3 a = (modelViewMatrix * vec4(uA, 1.0)).xyz;
    vec3 b = (modelViewMatrix * vec4(uB, 1.0)).xyz;
    vAw = (modelMatrix * vec4(uA, 1.0)).xyz; vBw = (modelMatrix * vec4(uB, 1.0)).xyz;
    vAv = a; vBv = b;
    // view matrix is rigid, so column lengths of modelView = accumulated world
    // scale; mean of the three is our (approximate) radius multiplier
    float s = (length(modelViewMatrix[0].xyz) + length(modelViewMatrix[1].xyz) + length(modelViewMatrix[2].xyz)) / 3.0;
    // the quad lives in the camera-parallel plane at the segment's midpoint
    // depth; flattening each endpoint onto it must be perspective-correct --
    // scale its xy AND radius by (plane depth / own depth) -- so the drawn
    // silhouette lands exactly where the true 3D projection would. Without
    // this, depth-slanted parts shift by different amounts and gaps open at
    // joints that genuinely overlap in 3D. A slanted capsule correctly
    // becomes an uneven pill: near cap fatter, far cap thinner.
    float zc = (a.z + b.z) * 0.5;
    float ka = zc / min(a.z, -1e-2);
    float kb = zc / min(b.z, -1e-2);
    vec2 pa = a.xy * ka, pb = b.xy * kb;
    vec2 rad = vec2(uR1 * ka, uR2 * kb) * s;
    vRw = vec2(uR1, uR2) * s;
    vec2 ab = pb - pa;
    float l = length(ab);
    vec2 u = l > 1e-5 ? ab / l : vec2(1.0, 0.0);
    vec2 v = vec2(-u.y, u.x);
    float R = max(rad.x, rad.y) + 0.01;
    vec2 p = (pa + pb) * 0.5 + u * (position.x * (l * 0.5 + R)) + v * (position.y * R);
    vP = p; vA = pa; vB = pb; vRad = rad; vZc = zc;
    gl_Position = projectionMatrix * vec4(p, zc, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uOutline, uPat;
  uniform vec3 uFill, uBorder;
  uniform mat4 projectionMatrix, uInvView;
  varying vec2 vP, vA, vB;
  varying vec2 vRad;
  varying float vZc;
  varying vec3 vAw, vBw, vAv, vBv;
  varying vec2 vRw;

  ${SDF_GLSL}

  void main() {
    float d = sdUnevenCapsule(vP, vA, vB, vRad.x, vRad.y);
    if (d > 0.0) discard;
    // optional 1px outline: the band is one pixel of distance (fwidth),
    // capped at half the smallest radius so a thin tail keeps its fill
    bool border = uOutline > 0.5 && d > -min(fwidth(d), 0.5 * min(vRad.x, vRad.y));
    vec3 col = border ? uBorder : uFill;
    // the true surface: the pixel's view ray hits the actual 3D capsule.
    // Costs early-z (depth is unknown until after shading), buys exact
    // intersection curves where parts interpenetrate -- and gives the
    // patterns their 3D surface point (slivers the flattened silhouette
    // overhangs by take the limb's depth, see surfaceT).
    vec3 rd = normalize(vec3(vP, vZc));
    vec3 pv = rd * surfaceT(rd, vAv, vBv, vRw.x, vRw.y);
    float zv = min(pv.z, -0.01);
    if (!border) {
      vec3 pw = (uInvView * vec4(pv, 1.0)).xyz;
      if (uPat > .5) col = patternAt(col, uPat, partLocal(pw, vAw, vBw), max(vRw.x, vRw.y));
      col *= shadeOf(capsuleNormal(pw, vAw, vBw));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  #ifdef PIXEL_DEPTH
    { float fd = viewDepth(projectionMatrix, vec3(vP, vZc) * (zv / vZc)); if (fd < 0.0) discard; gl_FragDepth = fd; }
  #endif
  }
`;

// Triangle-banner shaders: three points flattened onto their mean-depth
// plane (perspective-correct like the capsule path), quad stretched over
// the projected triangle's bounding box, flat depth (skins have no bulge).
const VERT_TRI = /* glsl */ `
  uniform vec3 uA, uB, uC;
  uniform float uR1;
  varying vec2 vP, vA, vB, vC;
  varying float vZc;
  varying vec3 vAw, vBw, vCw;
  void main() {
    vAw = (modelMatrix * vec4(uA, 1.0)).xyz; vBw = (modelMatrix * vec4(uB, 1.0)).xyz; vCw = (modelMatrix * vec4(uC, 1.0)).xyz;
    vec3 a = (modelViewMatrix * vec4(uA, 1.0)).xyz;
    vec3 b = (modelViewMatrix * vec4(uB, 1.0)).xyz;
    vec3 c = (modelViewMatrix * vec4(uC, 1.0)).xyz;
    float zc = (a.z + b.z + c.z) / 3.0;
    vec2 pa = a.xy * (zc / min(a.z, -1e-2));
    vec2 pb = b.xy * (zc / min(b.z, -1e-2));
    vec2 pc = c.xy * (zc / min(c.z, -1e-2));
    float pad = uR1 + 0.03;
    vec2 lo = min(pa, min(pb, pc)) - pad, hi = max(pa, max(pb, pc)) + pad;
    vec2 p = mix(lo, hi, position.xy * 0.5 + 0.5);
    vP = p; vA = pa; vB = pb; vC = pc; vZc = zc;
    gl_Position = projectionMatrix * vec4(p, zc, 1.0);
  }
`;

const FRAG_TRI = /* glsl */ `
  precision highp float;
  uniform float uOutline, uR1, uPat;
  uniform vec3 uFill, uBorder;
  uniform mat4 projectionMatrix, uInvView;
  varying vec2 vP, vA, vB, vC;
  varying float vZc;
  varying vec3 vAw, vBw, vCw;

  ${SDF_GLSL}

  void main() {
    float d = sdTri(vP, vA, vB, vC) - uR1;
    if (d > 0.0) discard;
    bool border = uOutline > 0.5 && d > -fwidth(d);
    vec3 col = border ? uBorder : uFill;
    if (!border) {   // membranes are flat: the plane point is the surface point
      vec3 pw = (uInvView * vec4(vP, vZc, 1.0)).xyz;
      if (uPat > .5) col = patternAt(col, uPat, partLocal(pw, vAw, vBw), uR1);
      col *= shadeOf(triNormal(vAw, vBw, vCw, mat3(uInvView) * normalize(vec3(vP, vZc))));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  #ifdef PIXEL_DEPTH
    float zv = vZc;
    { float fd = viewDepth(projectionMatrix, vec3(vP, vZc) * (zv / vZc)); if (fd < 0.0) discard; gl_FragDepth = fd; }
  #endif
  }
`;

// Reduce a part's primitive to the canonical segment in the quad's rigid
// local space (the part's own non-uniform `scale` is baked in here and
// cancelled on the scene-graph side, see holder below).
export function segmentFor(part) {
  const s = part.scale ?? [1, 1, 1];
  const { shape, size } = part;
  // flat triangular membrane: three local corner points + corner rounding;
  // r2 = -1 flags the shape for the shaders
  if (shape === "tri") return { a: size.a, b: size.b, c: size.c, r1: size.r ?? .03, r2: -1 };
  // tube: a curved, profiled limb -- centreline a -> (control c) -> b, radius r1 -> r2 plus a middle bulge
  // (the composite engine draws it exactly; the other banner engines fall back to the capsule a-b)
  if (shape === "tube") return { a: size.a, b: size.b, c: size.c, r1: size.r1, r2: size.r2 ?? size.r1, bulge: size.bulge ?? 0, tube: true };
  if (shape === "sphere") {
    // sphere x non-uniform scale = ellipsoid; approximate it as a capsule
    // along its longest semi-axis (good enough for squashed ears/patches)
    const semi = s.map((k) => size.r * k);
    const dom = semi.indexOf(Math.max(...semi));
    const [p, q] = [0, 1, 2].filter((i) => i !== dom);
    const r = (semi[p] + semi[q]) / 2;
    const h = Math.max(semi[dom] - r, 0);
    const a = [0, 0, 0], b = [0, 0, 0];
    a[dom] = h; b[dom] = -h;
    return { a, b, r1: r, r2: r };
  }
  // capsule/cone axis is local +Y, optionally re-aimed by geomRot (degrees)
  const dir = new THREE.Vector3(0, 1, 0);
  if (part.geomRot) {
    const [x, y, z] = part.geomRot.map(THREE.MathUtils.degToRad);
    dir.applyEuler(new THREE.Euler(x, y, z));
  }
  const rMul = (s[0] + s[1] + s[2]) / 3;
  const half = shape === "cone" ? size.h / 2 : size.len / 2;
  const a = [dir.x * half * s[0], dir.y * half * s[1], dir.z * half * s[2]];
  const b = a.map((v) => -v);
  // a capsule may taper: size.r is its +y end, size.r2 (optional) its -y end
  return shape === "cone"
    ? { a: b, b: a, r1: size.r * rMul, r2: Math.max(size.r * .12, .008) * rMul }  // round base -> near-point apex
    : { a, b, r1: size.r * rMul, r2: (size.r2 ?? size.r) * rMul };
}

// the patterns rebuild each pixel's world point from the camera: every banner material keeps the camera's world matrix current
const invView = function (renderer, scene, camera) { this.material.uniforms.uInvView.value.copy(camera.matrixWorld); };

function bannerMesh(part, pixelDepth) {
  const seg = segmentFor(part);
  if (part.shape === "tri") {
    const mesh = new THREE.Mesh(QUAD, new THREE.ShaderMaterial({
      defines: pixelDepth ? { PIXEL_DEPTH: "" } : {},
      uniforms: {
        uA: { value: new THREE.Vector3(...seg.a) },
        uB: { value: new THREE.Vector3(...seg.b) },
        uC: { value: new THREE.Vector3(...seg.c) },
        uR1: { value: seg.r1 },
        uPat: { value: part.pat === "wingspots" ? 6 : 0 },
        uOutline: OUTLINE, uInvView: { value: new THREE.Matrix4() },
        uFill: { value: new THREE.Color(part.color) },
        uBorder: { value: new THREE.Color(BORDER.color) },
      },
      vertexShader: VERT_TRI,
      fragmentShader: FRAG_TRI,
    }));
    mesh.frustumCulled = false;
    mesh.onBeforeRender = invView;
    return mesh;
  }
  const mesh = new THREE.Mesh(QUAD, new THREE.ShaderMaterial({
    defines: pixelDepth ? { PIXEL_DEPTH: "" } : {},
    uniforms: {
      uA: { value: new THREE.Vector3(...seg.a) },
      uB: { value: new THREE.Vector3(...seg.b) },
      uR1: { value: seg.r1 },
      uR2: { value: seg.r2 },
      uOutline: OUTLINE, uInvView: { value: new THREE.Matrix4() },
      uPat: { value: part.pat === "spots" ? 5 : part.pat === "bands" ? 4 : part.pat === "stripes" ? 3 : part.pat === "bark" ? 2 : part.pat === "barkH" ? 20 : part.pat === "leaf" ? 1 : 0 },
      uFill: { value: new THREE.Color(part.color) },
      uBorder: { value: new THREE.Color(BORDER.color) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  }));
  mesh.frustumCulled = false;   // the shader repositions vertices; the plane's bounds are meaningless
  mesh.onBeforeRender = invView;
  return mesh;
}

export function buildSpecies(def, { pixelDepth = true } = {}) {
  const root = new THREE.Group();
  root.name = def.name;
  const nodes = { };
  for (const part of def.parts) {
    const group = new THREE.Group();
    group.name = part.id;
    group.position.set(...(part.pos ?? [0, 0, 0]));
    const [rx, ry, rz] = (part.rot ?? [0, 0, 0]).map(THREE.MathUtils.degToRad);
    group.rotation.set(rx, ry, rz);
    if (part.scale) group.scale.set(...part.scale);   // children inherit it

    // holder: sits at the pivot and cancels the group's own non-uniform scale,
    // so the quad's local frame stays rigid (its scale is baked into A/B/r)
    const holder = new THREE.Group();
    holder.position.set(...(part.pivot ?? [0, 0, 0]));
    if (part.scale) holder.scale.set(1 / part.scale[0], 1 / part.scale[1], 1 / part.scale[2]);
    holder.add(bannerMesh(part, pixelDepth));
    group.add(holder);

    group.userData.baseRot = { x: rx, y: ry, z: rz };
    group.userData.anim = part.anim ?? null;
    group.userData.ik = part.ik ?? null;
    group.userData.bob = !!part.bob;
    group.userData.baseY = group.position.y;

    nodes[part.id] = group;
    (part.parent ? nodes[part.parent] : root).add(group);
  }
  root.userData.gaits = def.gaits ?? null;
  return root;
}
