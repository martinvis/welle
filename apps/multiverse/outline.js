// The one outline switch for the whole world. Every engine that can draw a
// dark line along a silhouette -- banner, instanced and composite quads,
// the polygon rig's hull copies, the buildings' and carts' hull copies --
// reads this: off (the default) means flat fills and nothing else drawn,
// which is the cheapest frame there is; on means a ONE-PIXEL line, so a
// far cottage and a near horse get the same weight. Shift+O toggles it.
//
//   OUTLINE     shared uniform object: 0 off, 1 on (banner shaders compare it)
//   OUTLINE_PX  world metres per screen pixel at unit view depth -- the
//               polygon hulls inflate by this times their depth to be 1px
//               thick; the render loop keeps it current (fov, canvas height)
//   onOutline   register a hook run on every change (and once now): the
//               hull meshes show or hide themselves through it
export const OUTLINE = { value: 0 };
export const OUTLINE_PX = { value: 0 };
export const OUTLINE_COLOR = 0x201812;
const hooks = [];
export function onOutline(fn) { hooks.push(fn); fn(OUTLINE.value > .5); }
export function setOutline(on) {
  OUTLINE.value = on ? 1 : 0;
  for (const h of hooks) h(!!on);
}
export const outlineOn = () => OUTLINE.value > .5;
