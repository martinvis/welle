// Generative people for the banner engines -- the animals' trick applied to
// humans: capsules for limbs and torso, sphere banners for head and hair,
// perfect round silhouettes for free. A seed varies height, build, skin
// tone, hair style and color, and clothing colors; parts follow the same
// vocabulary as species.js so rig, banner, and instanced all draw them,
// and a crowd fits in one instanced call. Heights run 1.55-1.95m.
import { rng } from "./flora.js";

const SKIN = [0xf0c8a0, 0xdfb289, 0xc79668, 0xa9764d, 0x7c5236];
const HAIR = [0x241b14, 0x4a2f18, 0x7a4a22, 0xa87433, 0xd9b96a, 0x99928a, 0xb0502c];
const CLOTH = [0x8e2f35, 0x2f5d8e, 0x3f6b46, 0xb07d2e, 0x6b4a86, 0x9a5232, 0x4a6b73, 0x8a8378];

// pose: undefined = standing/walking; "sit" = thighs swung forward for a
// bench (place origin at seatY - hipY); "ride" = legs splayed down a mount's
// flanks; "carry" = both arms held out level in front (a load in the arms),
// legs still walking. still: strip every anim so the figure holds perfectly still.
// kind: "man" | "woman" | "child10" | "child5" -- drawn from the seed unless
// given (adult: true keeps to men and women). It sets height, build, hair
// and the children's proportions (bigger heads, shorter legs), and it is
// what the voice follows: a woman's voice on a woman, a child's on a child.
export const KINDS = ["man", "woman", "child10", "child5"];
export function makePerson({ seed = 1, height, pose, still, kind, adult } = {}) {
  const r = rng(seed * 771 + 13);
  const kr = r();
  if (!kind) kind = adult ? (kr < .5 ? "man" : "woman") : kr < .4 ? "man" : kr < .8 ? "woman" : kr < .9 ? "child10" : "child5";
  const isChild = kind.startsWith("child");
  const h = height ?? (kind === "man" ? 1.68 + r() * .24 : kind === "woman" ? 1.55 + r() * .18 : kind === "child10" ? 1.32 + r() * .14 : 1.02 + r() * .12);
  const skin = SKIN[Math.floor(r() * SKIN.length)];
  const hair = HAIR[Math.floor(r() * HAIR.length)];
  const shirt = CLOTH[Math.floor(r() * CLOTH.length)];
  let pants = CLOTH[Math.floor(r() * CLOTH.length)];
  if (pants === shirt) pants = CLOTH[(CLOTH.indexOf(pants) + 3) % CLOTH.length];
  const build = (kind === "woman" ? .82 : isChild ? .8 : .95) + r() * .25;
  const headR = h * (kind === "child5" ? .105 : kind === "child10" ? .088 : .073);   // children: bigger heads
  const legL = h * (isChild ? .4 : .45);                                            // and shorter legs
  const legR = h * .045 * build;
  const armL = h * .32;
  const parts = [
    // legs pivot at the hip and stride; arms counter-swing from the shoulder.
    // len = legL - 2r and pivot -legL/2 puts the capsule's top exactly at the
    // hip and the foot's bottom exactly on the ground
    { id: "legL", parent: null, shape: "capsule", size: { r: legR, len: legL - 2 * legR }, pos: [0, legL, h * .055],
      pivot: [0, -legL / 2, 0], color: pants, anim: { axis: "z", deg: 24, speed: .8, phase: 0 } },
    { id: "legR", parent: null, shape: "capsule", size: { r: legR, len: legL - 2 * legR }, pos: [0, legL, -h * .055],
      pivot: [0, -legL / 2, 0], color: pants, anim: { axis: "z", deg: 24, speed: .8, phase: 3.14 } },
    { id: "torso", parent: null, shape: "capsule", size: { r: h * .1 * build, len: h * .24 }, pos: [0, h * .56, 0], color: shirt },
    { id: "armL", parent: "torso", shape: "capsule", size: { r: h * .03, len: armL }, pos: [0, h * .12, h * .115 * build],
      rot: [-9, 0, 0], pivot: [0, -armL / 2, 0], color: shirt, anim: { axis: "z", deg: 17, speed: .8, phase: 3.14 } },   // hangs outward
    { id: "armR", parent: "torso", shape: "capsule", size: { r: h * .03, len: armL }, pos: [0, h * .12, -h * .115 * build],
      rot: [9, 0, 0], pivot: [0, -armL / 2, 0], color: shirt, anim: { axis: "z", deg: 17, speed: .8, phase: 0 } },
    { id: "head", parent: null, shape: "sphere", size: { r: headR }, pos: [0, h * .85, 0], color: skin,
      anim: { axis: "y", deg: 18, speed: .22, phase: r() * 3 } },
    { id: "eyeL", parent: "head", shape: "sphere", size: { r: Math.max(.024, h * .015) }, pos: [headR * .85, headR * .16, headR * .38], color: 0x201812 },
    { id: "eyeR", parent: "head", shape: "sphere", size: { r: Math.max(.024, h * .015) }, pos: [headR * .85, headR * .16, -headR * .38], color: 0x201812 },
  ];
  let style = Math.floor(r() * 4);   // 0 bald, 1 short, 2 long, 3 bun
  if (kind === "woman") style = 2 + Math.floor(r() * 2);   // women: long or bun
  else if (isChild) style = 1 + Math.floor(r() * 2);      // children: short or long
  if (style >= 1) parts.push({ id: "hairC", parent: "head", shape: "sphere", size: { r: headR * 1.07 },
    scale: style === 2 ? [1, 1.25, 1] : [1, .72, 1], pos: [-headR * .14, style === 2 ? -headR * .11 : headR * .3, 0], color: hair });
  if (style === 3) parts.push({ id: "hairB", parent: "head", shape: "sphere", size: { r: headR * .44 },
    pos: [-headR * 1.03, headR * .41, 0], color: hair });
  if (pose === "carry")
    for (const p of parts) if (p.id.startsWith("arm")) { const side = p.id.endsWith("L") ? 1 : -1; p.rot = [side * 6, 0, 82]; delete p.anim; }   // forearms forward, a little inward
  if (pose === "sit" || pose === "ride")
    for (const p of parts) {
      const side = p.id.endsWith("L") ? 1 : -1;         // +z is the left side
      // NOTE the x-rotation sign: NEGATIVE side swings a hanging capsule
      // toward its own +z side, so the left leg goes left, right goes right
      if (p.id.startsWith("leg")) {
        if (pose === "sit") p.rot = [-side * 10, 0, 78];   // thighs FORWARD onto the bench
        else {                                             // around the mount's barrel, each on its own side,
          p.rot = [-side * 48, 0, 20];                     // hips still against the body so nothing floats
          p.pos = [p.pos[0], p.pos[1], side * .17];
        }
      }
      if (pose === "ride" && p.id.startsWith("arm"))
        p.rot = [side * 10, 0, 60];                        // hands forward-in, toward the mount's neck
    }
  if (pose === "lie")   // flat on the back: every root part turned a quarter about z, so the figure lies along +x
    for (const p of parts) if (!p.parent) {   // (head toward +x) with its back at y = 0; children follow their parents' frames
      const rt = p.rot ?? [0, 0, 0];
      p.pos = [p.pos[1], h * .1 * build, p.pos[2]];
      p.rot = [rt[0], rt[1], rt[2] - 90];
      delete p.anim;
    }
  if (still) for (const p of parts) delete p.anim;
  return { name: "person", parts, hipY: legL, kind };
}
