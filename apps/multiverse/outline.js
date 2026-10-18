// The one outline switch for the whole world. It costs NO GEOMETRY: what
// reads it is the banner, instanced and composite shaders, which draw their
// dark line along a silhouette they are already computing per pixel. Off
// (the default) means flat fills and nothing else; on means a ONE-PIXEL
// line, so a far cottage and a near horse get the same weight. Shift+O
// toggles it.
//
// The buildings used to answer it with geometry -- a backface hull copy of
// every part, inflated in the vertex shader -- and that copy was built
// whether the outline was ever switched on or not: a second village of
// eighty-one meshes and a fifth of a million triangles. It is gone
// (architecture.js); buildings simply have no outline now.
//
//   OUTLINE     shared uniform object: 0 off, 1 on (banner shaders compare it)
//   OUTLINE_PX  world metres per screen pixel at unit view depth, kept
//               current by the render loop (fov, canvas height)
//   onOutline   register a hook run on every change (and once now)
export const OUTLINE = { value: 0 };
// THE GEOMETRY VIEW (T in the game): what each thing on the screen is really made of. The banner engines show their
// QUADS -- the flat cards an SDF is drawn on, tinted over their whole rectangle so that the card is visible where
// the shape is not -- and the world's triangle meshes are drawn as edges by whoever owns the scene. One switch, as
// the outline is one switch, so that every banner material can read it without being told about it.
export const QUADS = { value: 0 };
export const OUTLINE_PX = { value: 0 };
export const OUTLINE_COLOR = 0x201812;
const hooks = [];
export function onOutline(fn) { hooks.push(fn); fn(OUTLINE.value > .5); }
export function setOutline(on) {
  OUTLINE.value = on ? 1 : 0;
  for (const h of hooks) h(!!on);
}
export const outlineOn = () => OUTLINE.value > .5;
export const quadsOn = () => QUADS.value > .5;
export function setQuads(on) { QUADS.value = on ? 1 : 0; for (const fn of quadHooks) fn(on); }
const quadHooks = [];
export function onQuads(fn) { quadHooks.push(fn); fn(QUADS.value > .5); }
