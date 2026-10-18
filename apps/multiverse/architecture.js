// Architecture engine: buildings composed from real architectural layers.
// Where the animals are round (and get the banner/SDF treatment), buildings
// are overwhelmingly cubic -- so honest low-poly geometry IS the cheap path:
// a box is 12 triangles, an 10-gon column 40. Parts are pure data
// ({shape, size, pos, color}) in METERS, generated layer by layer the way
// the real buildings are composed, so one generator covers a whole family
// (every Greek peripteral temple is the same five layers with different
// numbers plugged in: crepidoma -> peristyle -> entablature -> roof -> cella).
//
// NO OUTLINE HULLS. Buildings used to carry a backface-only hull copy of every part, inflated in the vertex
// shader to draw a 1px rim (outline.js, Shift+O). It was off by default and it cost a second copy of the whole
// village -- eighty-one meshes and a fifth of a million triangles, built, walked and never drawn -- so it is
// gone. The SDF engines still draw their 1px border, because theirs is a line in the shader and costs no
// geometry at all. Part definitions may still carry `outline: false`; nothing reads it now.
import * as THREE from "three";
import { ASSETS } from "./catalogue.js";   // the items rooms are furnished with (assets/items), for the assembler
import { wgslFn, uniform, attribute, varying, texture, float, positionGeometry, positionWorld,
         normalWorld, modelWorldMatrix, cameraPosition, vec3 } from "three/tsl";
import { TEXTURES, TILES, tileTexture, PARALLAX } from "./textures.js";
import { patternTile } from "./textures_wgsl.js";
import { FOLIAGE_T } from "./foliage.js";   // the one wind clock: leaves and grain sway together
import { registerPatterns, renderPattern, patternOf, sizeOf as patternSize } from "./patterns.js";
import { PREGEN, pregenOn, pregenMiss, tileKey, groupsKey, wallsKey, recordFor, packGroups, packWalls } from "./pregen.js";   // what build/pregen.py made once (tiles, finished geometry, wall fields)
import { finishPieces, ruleParams, partNames } from "./arch/finish.js";
import PAT_PALETTES from "./assets/patterns/palettes.json" with { type: "json" };
import PAT_SHAPES from "./assets/patterns/shapes.json" with { type: "json" };
import PAT_STONE from "./assets/patterns/stone.json" with { type: "json" };
import PAT_FLOORS from "./assets/patterns/floors.json" with { type: "json" };
import PAT_CARPETS from "./assets/patterns/carpets.json" with { type: "json" };
import PAT_TILES from "./assets/patterns/tiles.json" with { type: "json" };
import PAT_PAINTED from "./assets/patterns/painted.json" with { type: "json" };
import PAT_ROOFS from "./assets/patterns/roofs.json" with { type: "json" };
import PAT_PANELS from "./assets/patterns/panels.json" with { type: "json" };
import PAT_TIMBER from "./assets/patterns/timber.json" with { type: "json" };
import PAT_MATERIALS from "./assets/patterns/materials.json" with { type: "json" };
import PAT_HERALDRY from "./assets/patterns/heraldry.json" with { type: "json" };
import PAT_HIEROGLYPHS from "./assets/patterns/hieroglyphs.json" with { type: "json" };
import PAT_MURALS from "./assets/patterns/murals.json" with { type: "json" };
import { registerMurals } from "./murals.js";   // (tomb paintings on walls: a pattern layer murals.js draws)
import { registerGlyphs } from "./glyphs.js";   // (a wall of hieroglyphs is a pattern layer glyphs.js draws: its library from the catalogue)
import FIN_ARENA from "./assets/finishes/arena.json" with { type: "json" };
import FIN_BERLINER_DOM from "./assets/finishes/berliner-dom.json" with { type: "json" };
import FIN_BLUE_MOSQUE from "./assets/finishes/blue-mosque.json" with { type: "json" };
import FIN_CHICHEN_ITZA from "./assets/finishes/chichen-itza.json" with { type: "json" };
import FIN_COLOGNE from "./assets/finishes/cologne.json" with { type: "json" };
import FIN_DENDERA from "./assets/finishes/dendera.json" with { type: "json" };
import FIN_GIZA from "./assets/finishes/giza.json" with { type: "json" };
import FIN_DIDYMA from "./assets/finishes/didyma.json" with { type: "json" };
import FIN_WINDMILL from "./assets/finishes/windmill.json" with { type: "json" };
import FIN_EL_PILAR from "./assets/finishes/el-pilar.json" with { type: "json" };
import FIN_FISHERMANS_BASTION from "./assets/finishes/fishermans-bastion.json" with { type: "json" };
import FIN_FLORENCE from "./assets/finishes/florence.json" with { type: "json" };
import FIN_FRAUENKIRCHE from "./assets/finishes/frauenkirche.json" with { type: "json" };
import FIN_HAGIA_SOPHIA from "./assets/finishes/hagia-sophia.json" with { type: "json" };
import FIN_HEPHAESTUS from "./assets/finishes/hephaestus.json" with { type: "json" };
import FIN_KARLSKIRCHE from "./assets/finishes/karlskirche.json" with { type: "json" };
import FIN_MAINZ from "./assets/finishes/mainz.json" with { type: "json" };
import FIN_MELK from "./assets/finishes/melk.json" with { type: "json" };
import FIN_MILAN from "./assets/finishes/milan.json" with { type: "json" };
import FIN_MORITZBURG from "./assets/finishes/moritzburg.json" with { type: "json" };
import FIN_NOTRE_DAME from "./assets/finishes/notre-dame.json" with { type: "json" };
import FIN_PANTHEON from "./assets/finishes/pantheon.json" with { type: "json" };
import FIN_PARLIAMENT from "./assets/finishes/parliament.json" with { type: "json" };
import FIN_PARTHENON from "./assets/finishes/parthenon.json" with { type: "json" };
import FIN_SACRE_COEUR from "./assets/finishes/sacre-coeur.json" with { type: "json" };
import FIN_SCHWERIN from "./assets/finishes/schwerin.json" with { type: "json" };
import FIN_ST_BASIL from "./assets/finishes/st-basil.json" with { type: "json" };
import FIN_ST_ISAACS from "./assets/finishes/st-isaacs.json" with { type: "json" };
import FIN_ST_PAULS from "./assets/finishes/st-pauls.json" with { type: "json" };
import FIN_STEPHANSDOM from "./assets/finishes/stephansdom.json" with { type: "json" };
import FIN_SULTAN_QABOOS from "./assets/finishes/sultan-qaboos.json" with { type: "json" };
import FIN_TAJ_MAHAL from "./assets/finishes/taj-mahal.json" with { type: "json" };
import FIN_TEMPLE_OF_HEAVEN from "./assets/finishes/temple-of-heaven.json" with { type: "json" };
import FIN_ULM from "./assets/finishes/ulm.json" with { type: "json" };
import FIN_ZWINGER from "./assets/finishes/zwinger.json" with { type: "json" };
import { assemble, registerDocs, docOf, itemOf } from "./arch/assemble.js";
import { lightWGSL } from "./light.js";   // the COMPONENT engine (arch/): buildings composed from real parts
// the buildings' definitions, with every other asset in the world (assets/, docs/assets.md)
import ARENA_DOC from "./assets/architecture/arena.json" with { type: "json" };
import BASILICA_DOC from "./assets/architecture/basilica.json" with { type: "json" };
import FLORENCE_DOC from "./assets/architecture/florence.json" with { type: "json" };
import IWAN_DOC from "./assets/architecture/components/iwan.json" with { type: "json" };
import PANTHEON_DOC from "./assets/architecture/pantheon.json" with { type: "json" };
import PARTHENON_DOC from "./assets/architecture/parthenon.json" with { type: "json" };
import HEPHAESTUS_DOC from "./assets/architecture/hephaestus.json" with { type: "json" };
import TAJ_DOC from "./assets/architecture/taj-mahal.json" with { type: "json" };
import STBASIL_DOC from "./assets/architecture/st-basil.json" with { type: "json" };
import FRAUENKIRCHE_DOC from "./assets/architecture/frauenkirche.json" with { type: "json" };
import ZWINGER_DOC from "./assets/architecture/zwinger.json" with { type: "json" };
import HAGIA_DOC from "./assets/architecture/hagia-sophia.json" with { type: "json" };
import NOTREDAME_DOC from "./assets/architecture/notre-dame.json" with { type: "json" };
import MILAN_DOC from "./assets/architecture/milan.json" with { type: "json" };
import COLOGNE_DOC from "./assets/architecture/cologne.json" with { type: "json" };
import DENDERA_DOC from "./assets/architecture/dendera.json" with { type: "json" };
import GIZA_DOC from "./assets/architecture/giza.json" with { type: "json" };
import DIDYMA_DOC from "./assets/architecture/didyma.json" with { type: "json" };
import WINDMILL_DOC from "./assets/architecture/windmill.json" with { type: "json" };
import V_BRIDGE from "./assets/architecture/village/bridge.json" with { type: "json" };
import C_CHHATRI from "./assets/architecture/components/chhatri.json" with { type: "json" };
import C_MINARET from "./assets/architecture/components/minaret.json" with { type: "json" };
import C_DOMED_TOWER from "./assets/architecture/components/domed-tower.json" with { type: "json" };
import C_GALLERY from "./assets/architecture/components/gallery.json" with { type: "json" };
import C_CURVED_GALLERY from "./assets/architecture/components/curved-gallery.json" with { type: "json" };
import C_PAVILION from "./assets/architecture/components/pavilion.json" with { type: "json" };
import C_PINNACLE from "./assets/architecture/components/pinnacle.json" with { type: "json" };
import C_FLYING_BUTTRESS from "./assets/architecture/components/flying-buttress.json" with { type: "json" };
import C_BRIDGE from "./assets/architecture/components/bridge.json" with { type: "json" };
import C_PALACE_WING from "./assets/architecture/components/palace-wing.json" with { type: "json" };
import MELK_DOC from "./assets/architecture/melk.json" with { type: "json" };
import SCHWERIN_DOC from "./assets/architecture/schwerin.json" with { type: "json" };
import KARLSKIRCHE_DOC from "./assets/architecture/karlskirche.json" with { type: "json" };
import CHICHEN_DOC from "./assets/architecture/chichen-itza.json" with { type: "json" };
import C_TOWER_STAIR from "./assets/architecture/components/tower-stair.json" with { type: "json" };
import SACRE_DOC from "./assets/architecture/sacre-coeur.json" with { type: "json" };
import STEPHAN_DOC from "./assets/architecture/stephansdom.json" with { type: "json" };
import C_DRUM_DOME from "./assets/architecture/components/drum-dome.json" with { type: "json" };
import C_PORTICO from "./assets/architecture/components/portico.json" with { type: "json" };
import STPAULS_DOC from "./assets/architecture/st-pauls.json" with { type: "json" };
import PARLIAMENT_DOC from "./assets/architecture/parliament.json" with { type: "json" };
import STISAACS_DOC from "./assets/architecture/st-isaacs.json" with { type: "json" };
import C_APSE from "./assets/architecture/components/apse.json" with { type: "json" };
import BERLINERDOM_DOC from "./assets/architecture/berliner-dom.json" with { type: "json" };
import MORITZBURG_DOC from "./assets/architecture/moritzburg.json" with { type: "json" };
import FISHERMANS_DOC from "./assets/architecture/fishermans-bastion.json" with { type: "json" };
import MAINZ_DOC from "./assets/architecture/mainz.json" with { type: "json" };
import C_ROUND_STAIR_TOWER from "./assets/architecture/components/round-stair-tower.json" with { type: "json" };
import EL_PILAR_DOC from "./assets/architecture/el-pilar.json" with { type: "json" };
import SULTAN_QABOOS_DOC from "./assets/architecture/sultan-qaboos.json" with { type: "json" };
import ULM_DOC from "./assets/architecture/ulm.json" with { type: "json" };
import BLUE_MOSQUE_DOC from "./assets/architecture/blue-mosque.json" with { type: "json" };
import C_BAROQUE_TOWER from "./assets/architecture/components/baroque-tower.json" with { type: "json" };
import C_ARCADE_WALK from "./assets/architecture/components/arcade-walk.json" with { type: "json" };
import C_CRENELLATION from "./assets/architecture/components/crenellation.json" with { type: "json" };
import C_OMANI_MINARET from "./assets/architecture/components/omani-minaret.json" with { type: "json" };
import C_PORTAL from "./assets/architecture/components/portal.json" with { type: "json" };
import C_GOTHIC_TOWER_STAGE from "./assets/architecture/components/gothic-tower-stage.json" with { type: "json" };
import C_GOTHIC_OCTAGON_STAGE from "./assets/architecture/components/gothic-octagon-stage.json" with { type: "json" };
import C_GOTHIC_SPIRE from "./assets/architecture/components/gothic-spire.json" with { type: "json" };
import C_DOME_CASCADE from "./assets/architecture/components/dome-cascade.json" with { type: "json" };
import C_DOMED_ARCADE from "./assets/architecture/components/domed-arcade.json" with { type: "json" };
import C_RIWAQ from "./assets/architecture/components/riwaq.json" with { type: "json" };
import C_OTTOMAN_MINARET from "./assets/architecture/components/ottoman-minaret.json" with { type: "json" };
import TEMPLE_OF_HEAVEN_DOC from "./assets/architecture/temple-of-heaven.json" with { type: "json" };
import C_DOUGONG from "./assets/architecture/components/dougong.json" with { type: "json" };
import C_CHINESE_HALL from "./assets/architecture/components/chinese-hall.json" with { type: "json" };
import C_PALACE_WALL from "./assets/architecture/components/palace-wall.json" with { type: "json" };
// the VILLAGE (tools/archgen/village.py): its buildings and the furniture that carries their life (beds, seats, work places)
import F_ALTAR from "./assets/architecture/furniture/altar.json" with { type: "json" };
import F_BAKERY from "./assets/architecture/furniture/bakery.json" with { type: "json" };
import F_BARRELS from "./assets/architecture/furniture/barrels.json" with { type: "json" };
import F_BED from "./assets/architecture/furniture/bed.json" with { type: "json" };
import F_BUTCHER from "./assets/architecture/furniture/butcher.json" with { type: "json" };
import F_CARPENTER from "./assets/architecture/furniture/carpenter.json" with { type: "json" };
import F_CHEST from "./assets/architecture/furniture/chest.json" with { type: "json" };
import F_COOPER from "./assets/architecture/furniture/cooper.json" with { type: "json" };
import F_HEARTH from "./assets/architecture/furniture/hearth.json" with { type: "json" };
import F_PEW from "./assets/architecture/furniture/pew.json" with { type: "json" };
import F_POTTERY from "./assets/architecture/furniture/pottery.json" with { type: "json" };
import F_SMITHY from "./assets/architecture/furniture/smithy.json" with { type: "json" };
import F_TABLE from "./assets/architecture/furniture/table.json" with { type: "json" };
import F_TAILOR from "./assets/architecture/furniture/tailor.json" with { type: "json" };
import F_TAVERN_ROOM from "./assets/architecture/furniture/tavern-room.json" with { type: "json" };
import F_WEAVER from "./assets/architecture/furniture/weaver.json" with { type: "json" };
import V_CHURCH from "./assets/architecture/village/church.json" with { type: "json" };
import V_EAVES_HOUSE from "./assets/architecture/village/eaves-house.json" with { type: "json" };
import V_GABLE_HOUSE from "./assets/architecture/village/gable-house.json" with { type: "json" };
import V_GATEHOUSE from "./assets/architecture/village/gatehouse.json" with { type: "json" };
import V_JETTIED_HOUSE from "./assets/architecture/village/jettied-house.json" with { type: "json" };
import V_LONGHOUSE from "./assets/architecture/village/longhouse.json" with { type: "json" };
import V_STONE_HOUSE from "./assets/architecture/village/stone-house.json" with { type: "json" };
import V_WALL from "./assets/architecture/village/wall.json" with { type: "json" };
import V_WALL_TOWER from "./assets/architecture/village/wall-tower.json" with { type: "json" };
import V_PIG_YARD from "./assets/architecture/village/pig-yard.json" with { type: "json" };
import V_MARKET from "./assets/architecture/village/market.json" with { type: "json" };
import V_APIARY from "./assets/architecture/village/apiary.json" with { type: "json" };
import V_HEN_YARD from "./assets/architecture/village/hen-yard.json" with { type: "json" };
import V_STABLE_YARD from "./assets/architecture/village/stable-yard.json" with { type: "json" };
import C_FENCE from "./assets/architecture/components/fence.json" with { type: "json" };
import C_GATE from "./assets/architecture/components/gate.json" with { type: "json" };
import C_PIGSTY from "./assets/architecture/components/pigsty.json" with { type: "json" };
import C_HEN_HOUSE from "./assets/architecture/components/hen-house.json" with { type: "json" };
import C_STABLE from "./assets/architecture/components/stable.json" with { type: "json" };
import { archRise, archCurve } from "./arch/profiles.js";   // how far a given arch profile rises over its span; its outline

// GLASS: one material for every window in the world. Its colour used to be baked into a material of its own
// (sixty of them, one mesh each -- exactly the mistake the building materials just stopped making); now it
// rides in the vertices like every other part's, so a building's glass merges into one mesh and the whole
// world shares one shader.
const glassMat = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: .38, depthWrite: false, side: THREE.DoubleSide });
glassMat.colorNode = varying(attribute("aC", "vec3"), "vGlassC");

// deterministic orientation shading: a face's brightness comes purely from
// which way it points (all six directions distinct), so same-colored walls
// meeting at a corner -- or a floor against a wall -- always read as
// separate planes, outdoors and indoors alike, independent of any lights
const PAT_IDS = { ashlar: 1, brick: 2, grooves: 3, stars: 4, marble: 5, tiles: 6, scroll: 7, gothic: 8, checker: 9, ornament: 10, parquet: 11, wood: 12,
                  rye: 13, barley: 14, beans: 15, garlic: 16, berries: 17, fruit: 18, cherries: 19 };   // 13-16 are cut-outs (transparent between the plants), 17-19 dots

// Shared weather uniform: 0..1 snow cover. Every archMaterial references
// this same object, so the demo flips all buildings at once.
export const SNOW = { value: 0 };

// Patterns live in the OBJECT's own frame -- its geometry's position and
// normal (for an instanced copy, scaled by the instance's own scale, so a
// unit box stretched into a shutter keeps metre-sized grain) -- and move
// with it: a barge, a cart or a swinging door carries its texture instead
// of sliding through a world-fixed one. Only the orientation shading and
// the snow read the world (a face's brightness says which way it points
// NOW). Buildings are placed by translation alone, so their merged,
// root-local geometry patterns exactly as in world space.
// The relief the parallax walks down into, at q (metres in the pattern's plane): a tile's baked alpha, or
// wood's grain worked out here -- q = (across the grain, along it), raised latewood with the soft wood between
// worn down. Generated per material because the wood case has no texture to sample.
const reliefFn = (id) => wgslFn(id === 12 ? `
  fn reliefAt(q: vec2<f32>, gx: vec2<f32>, gy: vec2<f32>, period: vec2<f32>) -> f32 {
    let g = sin(q.x * 42.0 + sin(q.y * 1.9 + q.x * 3.0) * 2.4 + sin(q.x * 8.5) * 1.1);
    return 1.0 - 0.75 * smoothstep(0.25, 0.95, g) - 0.15 * smoothstep(0.6, 1.0, sin(q.y * 23.0 + q.x * 15.0));
  }
` : `
  fn reliefAt(tex: texture_2d<f32>, samp: sampler, q: vec2<f32>, gx: vec2<f32>, gy: vec2<f32>, period: vec2<f32>) -> f32 {
    return textureSampleGrad(tex, samp, q / period, gx, gy).a;
  }
`);

// THE BUILDING FRAGMENT. The GLSL twin was one shader with a wall of #if PAT == n; WGSL has no preprocessor,
// so the same selection happens here in JavaScript and each material carries only the branch it needs.
// Returns (rgb, keep) -- keep < 0 is the crops' discard, the material's alphaTest cutting the pixel away.
// HOW A FACE IS LIT, and where snow lies: one source for every building material (archFrag, the finish material) --
// brightness from which way the face points, snow on what faces up well above the ground
const SHADE_K = lightWGSL("n");   // (light.js: the world's one sun, the same term every engine shades by)
const SNOW_ON = (c) => `mix(${c}, vec3<f32>(0.93, 0.94, 0.97), snow * smoothstep(0.06, 0.45, n.y) * smoothstep(3.2, 5.5, pW.y))`;
const archFragSource = ({ id, baked, pom, steps, shadow }) => {
  const texParams = (baked || (pom && id !== 12)) ? "tex: texture_2d<f32>, samp: sampler, " : "";
  const reliefCall = (q) => id === 12 ? `reliefAt(${q}, gx, gy, period)` : `reliefAt(tex, samp, ${q}, gx, gy, period)`;
  const floorPat = id === 9 || id === 11;
  return `
  fn archFrag(nW: vec3<f32>, pW: vec3<f32>, pL: vec3<f32>, nL: vec3<f32>, Tw: vec3<f32>, Bw: vec3<f32>,
              camPos: vec3<f32>, ${texParams}C: vec3<f32>, C2: vec3<f32>, snow: f32, t: f32,
              period: vec2<f32>, depth: f32, pomFar: f32, texelUV: f32) -> vec4<f32> {
    let n = normalize(nW);
    var col = C;
    var k = ${SHADE_K};
    let nl = normalize(nL);                                  // the face's normal in its own frame: picks the pattern plane
    let u = select(pL.x, pL.z, abs(nl.x) > abs(nl.z));       // coordinate along the face
${pom ? `
    // PARALLAX: walk the view ray down into the relief -- steps layers to depth metres, along the pattern's own
    // axes (a wall's face: along it and up; a floor's top: x and z; wood: across the grain and along it) --
    // refine between the last two layers; there the relief's slope tilts the normal (lit by the world's
    // orientation shading, 1.8x) and the shadow reads toward that light give the relief short shadows; the
    // colour is read where the ray met the relief. Near only: it fades out toward pomFar metres.
    // The ray is followed in WORLD space against the world-space pattern axes, which is the same walk the GLSL
    // made in the object's frame (the two frames differ by a rotation, and nothing here is scaled).
    let upP = step(0.5, abs(nl.y));
${id === 12 ? `
    var q0 = vec2<f32>(u, pL.y);
    if (upP > 0.5) { q0 = pL.zx; }
    let onPlane = 1.0;
    let gx = vec2<f32>(0.0);
    let gy = vec2<f32>(0.0);
    let eq = vec2<f32>(0.002);
` : `
    var q0 = vec2<f32>(u, pL.y);
    ${floorPat ? "q0 = pL.xz;" : ""}
    let onPlane = ${floorPat ? "abs(nl.y)" : "1.0 - abs(nl.y)"};
    // every read at the UNSHIFTED gradients, so the mip level never jumps as the ray walks
    let gx = dpdx(q0 / period);
    let gy = dpdy(q0 / period);
    let eq = texelUV * period;
`}
    let Vw = camPos - pW;
    let pdist = length(Vw);
    let fade = 1.0 - smoothstep(0.65 * pomFar, pomFar, pdist);
    var relief = 1.0;
    var qP = q0;
    let vd = Vw / max(pdist, 1e-4);
    let dn = dot(vd, n);
    if (fade > 0.01 && onPlane > 0.7 && dn > 0.06) {
      let dq = -vec2<f32>(dot(vd, Tw), dot(vd, Bw)) / dn * depth * fade / ${steps}.0;   // metres across the pattern per layer
      var layer = 1.0;
      var h = ${reliefCall("qP")};
      var hPrev = h;
      for (var i: i32 = 0; i < ${steps}; i = i + 1) {
        if (h >= layer) { break; }
        hPrev = h;
        layer = layer - 1.0 / ${steps}.0;
        qP = qP + dq;
        h = ${reliefCall("qP")};
      }
      let after = h - layer;
      let before = hPrev - (layer + 1.0 / ${steps}.0);
      qP = qP - dq * clamp(after / max(after - before, 1e-5), 0.0, 1.0);       // between the last two layers
      let h0 = ${reliefCall("qP")};
      relief = mix(1.0, h0, fade);
      let slope = vec2<f32>(${reliefCall("qP + vec2<f32>(eq.x, 0.0)")} - h0,
                            ${reliefCall("qP + vec2<f32>(0.0, eq.y)")} - h0) / eq * depth;   // metres of relief per metre
      let np = normalize(n - (Tw * slope.x + Bw * slope.y) * fade);
      k = k + 1.8 * dot(np - n, vec3<f32>(0.1, 0.2, 0.06));
${shadow > 0 ? `
      let Lw = normalize(vec3<f32>(0.1, 0.2, 0.06));
      let lt = vec3<f32>(dot(Lw, Tw), dot(Lw, Bw), dot(Lw, n));
      if (lt.z > 0.05 && h0 < 0.98) {
        var occ = 0.0;
        for (var i: i32 = 1; i <= ${shadow}; i = i + 1) {
          let up = (1.0 - h0) * f32(i) / ${shadow}.0;
          occ = max(occ, ${reliefCall("qP + lt.xy / lt.z * depth * up")} - (h0 + up));
        }
        k = k * (1.0 - 0.45 * smoothstep(0.0, 0.12, occ) * fade);
      }` : ""}
    }
` : ""}
${id >= 1 && id <= 11 ? `
    // flat repeating patterns: (brightness k, accent share, dark-figure share) at this point of the pattern's
    // plane -- floors (checker, parquet) in x/z
    let q = ${floorPat ? "pL.xz" : "vec2<f32>(u, pL.y)"};
${baked ? `
    let T = ${pom ? "textureSampleGrad(tex, samp, qP / period, gx, gy)" : "textureSample(tex, samp, q / period)"}.rgb;
    var kab = vec3<f32>(T.r * 1.5, T.g, T.b);
${pom ? "    kab.x = kab.x * (1.0 - 0.2 * (1.0 - relief));   // the deep parts (mortar, channels) a shade darker still" : ""}
` : `
    let kab = patternTile(${id}.0, q, 0.0);
`}
    k = k * kab.x;
    col = mix(col, C2, kab.y);
    col = mix(col, vec3<f32>(0.05, 0.045, 0.04), kab.z);
${id === 5 ? "    k = k * (1.0 - 0.035 * (0.5 + 0.5 * sin(pL.x * 0.8 + pL.y * 2.3 + pL.z * 1.1)));   // marble veining: smooth, stays per pixel" : ""}
` : ""}
${id === 12 ? `
    // wood grain, slight: streaks along the board -- lengthwise on horizontal faces, vertical on upright ones,
    // wandering a little
    let upF = step(0.5, abs(nl.y));
    var along = mix(pL.y, pL.x, upF);
    var across = mix(u, pL.z, upF);
${pom ? `    along = qP.y; across = qP.x;      // the grain where the ray met it
    k = k * (1.0 - 0.2 * (1.0 - relief));` : ""}
    let g = sin(across * 42.0 + sin(along * 1.9 + across * 3.0) * 2.4 + sin(across * 8.5) * 1.1);
    k = k * (1.0 - 0.075 * smoothstep(0.25, 0.95, g) - 0.03 * smoothstep(0.6, 1.0, sin(along * 23.0 + across * 15.0)));
` : ""}
${id >= 13 && id <= 16 ? `
    // crops as cut-outs: a thin see-through slab carries a row of plants -- rye/barley stalks with ears, bean
    // poles with leaves, garlic leaf-fans -- and is discarded between them, so a field of thousands of plants
    // costs a few dozen boxes. Heights count from the soil top (the site stands 1cm up: .12 local is .13 world).
    let hgt = pL.y - 0.12;
${id === 13 || id === 14 ? `
    let H = ${id === 13 ? "1.15" : "0.85"};
    let cw = 0.07;
    let earL = ${id === 13 ? "0.16" : "0.12"};
    let earW = ${id === 13 ? "0.026" : "0.034"};
    // wind: the row bends as one -- the coordinate along the slab shifts by a smooth gust field that grows
    // toward the ears, so neighbouring stalks move together and waves run over the field
    let sw = pow(clamp(hgt / H, 0.0, 1.0), 1.5) * (0.06 * sin(t * 1.3 + u * 0.35 + pL.z * 0.2) + 0.022 * sin(t * 2.9 + u * 1.1));
    let uu = u - sw;
    let id2 = floor(uu / cw);
    let fu = fract(uu / cw) - 0.5;
    let hs = fract(sin(id2 * 127.1) * 43758.5);
    let top = H * (0.78 + 0.27 * hs);
    let dx = abs(fu * cw - (hs - 0.5) * 0.1 * hgt / H);      // a slight lean, each its own way
    if (hgt > top || hgt < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
    if (hgt > top - earL) {
      if (dx > earW) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
      col = C2;
      k = k * (0.9 + 0.2 * hs);
    } else {
      if (dx > 0.011) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
      k = k * (0.85 + 0.3 * hs);
    }
` : id === 15 ? `
    let cw = 0.5;
    let id2 = floor(u / cw);
    let fu = fract(u / cw) - 0.5;
    let hs = fract(sin(id2 * 91.7) * 43758.5);
    let top = 1.7 * (0.85 + 0.2 * hs);
    if (hgt > top || hgt < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
    let dx = fu * cw;
    let row = floor(hgt / 0.17);
    let fr = fract(hgt / 0.17) - 0.5;
    let sd = ((row + floor(hs * 2.0)) - 2.0 * floor((row + floor(hs * 2.0)) / 2.0)) * 2.0 - 1.0;   // leaves alternate sides up the pole
    let lj = fract(sin(id2 * 31.3 + row * 17.1) * 43758.5);
    let lc = vec2<f32>(dx - sd * (0.07 + 0.05 * lj), fr * 0.17);
    let leaf = step(length(lc * vec2<f32>(1.0, 1.6)), 0.085);
    let pole = step(abs(dx), 0.014);
    if (leaf < 0.5 && pole < 0.5) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
    col = select(C, C2, leaf > 0.5);
    k = k * (0.85 + 0.3 * lj);
` : `
    let cw = 0.3;
    let id2 = floor(u / cw);
    let fu = fract(u / cw) - 0.5;
    let hs = fract(sin(id2 * 57.3) * 43758.5);
    let top = 0.45 * (0.8 + 0.35 * hs);
    if (hgt > top || hgt < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
    let dx = fu * cw;
    var keep = 0.0;
    for (var i: i32 = -1; i <= 1; i = i + 1) {        // three leaves fanning out from the bulb
      let lx = f32(i) * (0.05 + 0.04 * hs) * hgt / 0.45 + (hs - 0.5) * 0.04;
      keep = max(keep, step(abs(dx - lx), 0.012 * (1.0 - 0.5 * hgt / top)));
    }
    if (keep < 0.5) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
    k = k * (0.85 + 0.3 * hs);
`}` : ""}
${id >= 17 && id <= 19 ? `
    // currants (17, ~1cm), apples (18, ~8cm) and cherries (19, ~2.5cm): sharp dots of the accent colour
    // scattered over a crown
    let c = ${id === 17 ? "0.065" : id === 18 ? "0.25" : "0.08"};
    let rr = ${id === 17 ? "0.005" : id === 18 ? "0.04" : "0.0125"};
    let cell = floor(pL / c);
    let f = fract(pL / c);
    let jit = fract(sin(vec3<f32>(dot(cell, vec3<f32>(127.1, 311.7, 74.7)),
                                  dot(cell, vec3<f32>(269.5, 183.3, 246.1)),
                                  dot(cell, vec3<f32>(113.5, 271.9, 124.6)))) * 43758.5) * 0.5 + 0.25;
    let show = step(fract(sin(dot(cell, vec3<f32>(12.9, 78.2, 37.7))) * 4375.5), ${id === 17 ? "0.9" : id === 18 ? "0.75" : "0.85"});   // a heavy crop
    col = mix(col, C2, step(length((f - jit) * c), rr) * show);
` : ""}
    var shaded = col * k;
    // snow settles on upward-facing surfaces well above the ground (roofs, cornices, the stands) -- walls and
    // columns stay bare; the ramp starts near 0 so even steep spires collect snow
    shaded = ${SNOW_ON("shaded")};
    return vec4<f32>(shaded, 1.0);
  }
`;
};

// the pattern's two axes in the world (along the face, up -- a floor's x, z), for the parallax to step along
const patAxes = wgslFn(`
  fn patAxes(nl0: vec3<f32>, model: mat4x4<f32>, which: f32, flat3: f32, wood: f32) -> vec3<f32> {
    let m3 = mat3x3<f32>(model[0].xyz, model[1].xyz, model[2].xyz);
    let woodTop = wood > 0.5 && abs(nl0.y) > 0.5;          // (wood on a level face: across z, along x)
    var v = vec3<f32>(1.0, 0.0, 0.0);
    if (which < 0.5) {                                     // T: along the face
      if (flat3 > 0.5) { v = vec3<f32>(1.0, 0.0, 0.0); }
      else if (woodTop || abs(nl0.x) > abs(nl0.z)) { v = vec3<f32>(0.0, 0.0, 1.0); }
    } else {                                               // B: up the face
      if (flat3 > 0.5) { v = vec3<f32>(0.0, 0.0, 1.0); }
      else if (woodTop) { v = vec3<f32>(1.0, 0.0, 0.0); }
      else { v = vec3<f32>(0.0, 1.0, 0.0); }
    }
    return normalize(m3 * v);
  }
`);

const cutOf = wgslFn(`fn cutOf(v: f32) -> f32 { if (v < 0.0) { return 0.0; } return 1.0; }`);

// THE COLOUR RIDES IN THE VERTICES, NOT IN THE MATERIAL.
// Every part of a building used to ask for a material of its own colour, and since buildBuilding merges parts
// by MATERIAL, a house with thirty-nine colours ended up as thirty-nine meshes -- thirty-nine objects for
// three to walk, five times a frame, and thirty-nine draws when it is in view. The shader is the same for all
// of them: what differs is two vec3 uniforms. So the colour and the accent are written per vertex instead
// (paintGeometry, below) and a material is keyed by what actually changes the SHADER -- its pattern and which
// side it shows. A farmhouse then merges into a handful of meshes, and the picture is identical: the value
// that reached the shader as a uniform now reaches it as an attribute, unchanged.
const archCache = new Map();
function archMaterial(side, pat, placed = false) {
  // pat: mathematically-defined surface patterns in the object's space --
  //  ashlar: large stone courses, staggered joints   brick: tight running bond
  //  marble: hairline joints + soft veining (Greek precision masonry)
  //  grooves: vertical channels in an accent color (triglyphs)
  //  stars: a dot grid in an accent color (painted tympana, rosette bands)
  //  (1-11 are flat repeating patterns: read from a baked, mipmapped tile --
  //  textures.js -- or, with TEXTURES.on false, evaluated per pixel from the same maths)
  // `placed`: the twin for geometry that has had its building's translation BAKED IN (merge.js mergeAcross joins
  // whole streets into one mesh). The pattern must still be read in the building's own frame, so the vertices
  // carry their original local position in `aLocal` and the pattern reads that -- bit for bit what it read before.
  const key = `${side ?? ""}|${pat ?? ""}${placed ? "|placed" : ""}`;
  if (archCache.has(key)) return archCache.get(key);
  const id = PAT_IDS[pat] ?? 0, tile = TEXTURES.on && id >= 1 && id <= 11 ? TILES[pat] : null;
  const pom = PARALLAX.on && ((tile && tile.depth > 0) || id === 12);   // parallax: a tile's baked relief, or wood's grain
  const baked = !!tile;
  const texNode = tile ? texture(tileTexture(pat)) : null;

  const rawPos = placed ? attribute("aLocal", "vec3") : positionGeometry, rawNormal = attribute("normal", "vec3");
  const flat3 = id === 9 || id === 11 ? 1 : 0, wood = id === 12 ? 1 : 0;
  const args = {
    nW: normalWorld, pW: positionWorld, pL: rawPos, nL: rawNormal,
    Tw: varying(patAxes({ nl0: rawNormal.normalize(), model: modelWorldMatrix, which: float(0), flat3: float(flat3), wood: float(wood) }), "vTw"),
    Bw: varying(patAxes({ nl0: rawNormal.normalize(), model: modelWorldMatrix, which: float(1), flat3: float(flat3), wood: float(wood) }), "vBw"),
    camPos: cameraPosition,
    C: varying(attribute("aC", "vec3"), "vArchC"), C2: varying(attribute("aC2", "vec3"), "vArchC2"),
    snow: uniform(0).onRenderUpdate(() => SNOW.value),
    t: uniform(0).onRenderUpdate(() => FOLIAGE_T.value),      // the one wind clock (foliage.js): the crops sway with the leaves
    period: uniform(new THREE.Vector2(...(tile ? tile.period : [1, 1]))),
    depth: uniform(id === 12 ? .004 : tile?.depth ?? 0),
    pomFar: uniform(PARALLAX.far), texelUV: uniform(tile ? 1 / tile.size : 0),
  };
  if (texNode) { args.tex = texNode; args.samp = texNode; }

  const includes = [];
  if (pom) includes.push(reliefFn(id));
  if (id >= 1 && id <= 11 && !baked) includes.push(patternTile);
  const frag = wgslFn(archFragSource({ id, baked, pom, steps: PARALLAX.steps, shadow: PARALLAX.shadowSteps }), includes)(args);

  const mat = new THREE.MeshBasicNodeMaterial({ side: side === "double" ? THREE.DoubleSide : THREE.FrontSide });
  mat.colorNode = frag.xyz;
  if (id >= 13 && id <= 16) {          // the crops are cut-outs: a node material discards through alphaTest
    mat.opacityNode = cutOf({ v: frag.w });
    mat.alphaTest = .5;
  }
  mat.userData.archArgs = { side, pat };
  mat.userData.arch = { side, pat, placed };
  archCache.set(key, mat);
  return mat;
}
// the `placed` twin of a building material (null for any other material: nothing else reads the local frame)
export const placedMaterial = (mat) => mat?.userData?.arch ? (mat.userData.arch.placed ? mat : archMaterial(mat.userData.arch.side, mat.userData.arch.pat, true)) : null;

// ---- FINISHES: patterned surfaces (arch/finish.js says which surface is what; patterns.js draws the tiles) ------------
// The pattern library: every family, and the palettes. A building's finish (assets/finishes/<building>.json) names
// patterns from it; the asset viewer shows it.
registerPatterns({ palettes: PAT_PALETTES, shapes: PAT_SHAPES, stone: PAT_STONE, floors: PAT_FLOORS, carpets: PAT_CARPETS,
                   tiles: PAT_TILES, painted: PAT_PAINTED, roofs: PAT_ROOFS, panels: PAT_PANELS, timber: PAT_TIMBER,
                   materials: PAT_MATERIALS, heraldry: PAT_HERALDRY, hieroglyphs: PAT_HIEROGLYPHS, murals: PAT_MURALS,
                   fabrics: ASSETS.get("patterns/fabrics") });   // (the cloth a room's cushions, hangings and bedding are of: the tailor's own, clothes.js)
registerGlyphs(Object.fromEntries([...ASSETS].filter(([p]) => p.startsWith("glyphs/"))));
registerMurals(Object.fromEntries([...ASSETS].filter(([p]) => p.startsWith("murals/"))));
// every building's finish, by its document (archBuilding finds its own; Florence and the arena are built by code and ask)
export const FINISHES = { "arena": FIN_ARENA, "berliner-dom": FIN_BERLINER_DOM, "blue-mosque": FIN_BLUE_MOSQUE, "chichen-itza": FIN_CHICHEN_ITZA, "cologne": FIN_COLOGNE, "dendera": FIN_DENDERA, "giza": FIN_GIZA, "didyma": FIN_DIDYMA, "windmill": FIN_WINDMILL, "el-pilar": FIN_EL_PILAR, "fishermans-bastion": FIN_FISHERMANS_BASTION, "florence": FIN_FLORENCE, "frauenkirche": FIN_FRAUENKIRCHE, "hagia-sophia": FIN_HAGIA_SOPHIA, "hephaestus": FIN_HEPHAESTUS, "karlskirche": FIN_KARLSKIRCHE, "mainz": FIN_MAINZ, "melk": FIN_MELK, "milan": FIN_MILAN, "moritzburg": FIN_MORITZBURG, "notre-dame": FIN_NOTRE_DAME, "pantheon": FIN_PANTHEON, "parliament": FIN_PARLIAMENT, "parthenon": FIN_PARTHENON, "sacre-coeur": FIN_SACRE_COEUR, "schwerin": FIN_SCHWERIN, "st-basil": FIN_ST_BASIL, "st-isaacs": FIN_ST_ISAACS, "st-pauls": FIN_ST_PAULS, "stephansdom": FIN_STEPHANSDOM, "sultan-qaboos": FIN_SULTAN_QABOOS, "taj-mahal": FIN_TAJ_MAHAL, "temple-of-heaven": FIN_TEMPLE_OF_HEAVEN, "ulm": FIN_ULM, "zwinger": FIN_ZWINGER };
// a rule's tile: the pattern drawn once (patterns.js renderPattern) into a mipmapped, anisotropic texture -- shared by
// every rule and every building that asks for the same pattern in the same colours
const finishTiles = new Map();
const finishKey = (r) => `${r.pattern}|${JSON.stringify(r.palette ?? null)}|${JSON.stringify(ruleParams(r))}|${r.res ?? ""}`;
function finishTile(r) {
  const key = finishKey(r);
  let t = finishTiles.get(key);
  // (pregenerated, if pregen/ has it: the same tile, drawn once by build/pregen.py -- else drawn here, as always)
  const pk = pregenOn() ? tileKey(r.pattern, r.palette, ruleParams(r), r.res) : null;
  if (pk && t) recordFor("tiles", pk, t.canvas);   // (the generator notes which buildings use a tile made for another)
  if (!t) {
    const cached = pk && PREGEN.tiles.get(pk), def = patternOf(r.pattern);
    const tile = cached ? { canvas: cached, size: patternSize(def, ruleParams(r)), repeat: def.repeat !== false }
                        : renderPattern(r.pattern, { palette: r.palette, params: ruleParams(r), res: r.res });
    if (pk) recordFor("tiles", pk, tile.canvas);
    if (pk && !cached) pregenMiss("tile", r.pattern, pk);
    const tex = new THREE.CanvasTexture(tile.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = tile.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 8; tex.generateMipmaps = true;
    finishTiles.set(key, t = { tex, size: tile.size, canvas: tile.canvas });
  }
  return t;
}
export const finishRuleSize = (r) => patternSize(patternOf(r.pattern), ruleParams(r));
// every tile a finish draws with, drawn now (build/pregen.py: a town's style bakes its whole range this way)
export function finishTilesOf(finish) { for (const r of finish.rules) if (r.pattern) finishTile(r); }
// THE FINISH MATERIAL: the tile read at the vertex's own pattern coordinates (`aUV`, metres; the tile is `period`
// metres), lit and snowed on exactly as every other building material is (SHADE_K, SNOW_ON)
const finishShade = wgslFn(`
  fn finishShade(c: vec3<f32>, nW: vec3<f32>, pW: vec3<f32>, snow: f32) -> vec3<f32> {
    let n = normalize(nW);
    let k = ${SHADE_K};
    return ${SNOW_ON("c * k")};
  }
`);
const finishMats = new Map();
function finishMaterial(r, side) {
  const key = finishKey(r) + "|" + (r.scale ?? 1) + "|" + (side ?? "");
  let mat = finishMats.get(key);
  if (!mat) {
    const { tex, size } = finishTile(r), k = r.scale ?? 1;
    const q = attribute("aUV", "vec2").div(uniform(new THREE.Vector2(size[0] * k, size[1] * k))).add(.5);
    mat = new THREE.MeshBasicNodeMaterial({ side: side === "double" ? THREE.DoubleSide : THREE.FrontSide });
    mat.colorNode = finishShade({ c: texture(tex, q).rgb, nW: normalWorld, pW: positionWorld, snow: uniform(0).onRenderUpdate(() => SNOW.value) });
    mat.userData.finish = key;
    finishMats.set(key, mat);
  }
  return mat;
}
// the finished building: its pieces (arch/finish.js), one mesh per rule -- a pattern's in the finish material, a plain
// stone's (and whatever no rule took: the building's `stone`) in the building material, coloured in its vertices;
// the glass no rule took in the glass
const hexOf = (c, d) => c === undefined ? d : typeof c === "number" ? c : parseInt(String(c).replace("#", ""), 16);
function finishMeshes(asm, finish, { side, glassColor = 0x4d5f7a } = {}) {
  // (the pieces pregenerated, if pregen/ has them for exactly this assembly and finish -- they are most of a
  //  building's cost: every surface told inside from outside by rays)
  const pk = pregenOn() ? groupsKey(asm, finish, finishRuleSize) : null;
  const cached = pk && PREGEN.groups.get(pk);
  const groups = cached ? cached.map((g) => ({ ...g, rule: g.rule >= 0 ? finish.rules[g.rule] : null }))
                        : finishPieces(asm, finish, { sizeOf: finishRuleSize }).groups;
  if (pk && !cached && PREGEN.record) recordFor("groups", pk, packGroups(groups, finish));
  // (the generator notes every tile this building's rules draw with -- a material shared with a building made
  //  earlier never asks for its tile again, and the game fetches a building's tiles by this list)
  if (PREGEN.record) for (const g of groups) if (g.rule?.pattern) recordFor("tiles", tileKey(g.rule.pattern, g.rule.palette, ruleParams(g.rule), g.rule.res), null);
  if (pk && !cached) pregenMiss("geometry", finish.building ?? "", pk);
  const stone = finish.stone ?? {};
  const out = new THREE.Group();
  for (const g of groups) {
    if (!g.pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(g.pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(g.nor, 3));
    let mat;
    if (g.rule?.pattern) { geo.setAttribute("aUV", new THREE.BufferAttribute(g.uv, 2)); mat = finishMaterial(g.rule, side); }
    else if (g.glass && !g.rule) { paintGeometry(geo, glassColor, glassColor); mat = glassMat; }
    else {
      const r = g.rule ?? stone;
      paintGeometry(geo, hexOf(r.color, hexOf(stone.color, 0xd9cdb4)), hexOf(r.accent, hexOf(stone.accent, 0xc2b598)));
      mat = archMaterial(side, r.pat ?? (g.rule ? undefined : stone.pat));
    }
    geo.computeBoundingSphere();
    out.add(new THREE.Mesh(geo, mat));
  }
  return out;
}

// AN ITEM, DRAWN (items.js builds it: its triangles one set per material): one mesh per material, each in the finish
// material of its pattern -- shared with every building and item drawn in the same pattern and colours, so the world's
// merge joins them. (A material's `side` "double": thin things seen from both sides.)
export function itemGeometry(g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(g.pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(g.nor, 3));
  geo.setAttribute("aUV", new THREE.BufferAttribute(g.uv, 2));
  geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
  geo.computeBoundingSphere();
  return geo;
}
export const itemMaterial = (m) => finishMaterial({ pattern: m.pattern, palette: m.palette, scale: m.scale, params: m.params }, m.side);
export function itemObject(built) {
  const out = new THREE.Group();
  out.name = built.name ?? "item";
  for (const g of built.groups) out.add(new THREE.Mesh(itemGeometry(g), itemMaterial(g.material)));
  return out;
}
// AN ITEM OUT OF THE CATALOGUE (assets/items), by path: as one group (itemGroup: a barge, a water wheel, a cart's body)
// or as `count` instanced copies (itemInstanced: the freight's casks and sacks, the fleet's wheels) -- the same API the
// parts-list helpers have (buildBuilding, buildInstanced: root, set(i, matrix), commit()), so a prop moves from code to
// an asset without its user changing. `built` is the item as items.js made it (its params, its markers).
export function itemGroup(path, { seed = 1, params = {}, materials = null } = {}) {
  const built = itemOf({ path, seed, params, materials }), g = itemObject(built);
  g.userData.built = built;
  return g;
}
export function itemInstanced(path, count, { seed = 1, params = {}, materials = null } = {}) {
  const built = itemOf({ path, seed, params, materials }), root = new THREE.Group(), meshes = [];
  root.name = built.name ?? path;
  for (const g of built.groups) {
    const im = new THREE.InstancedMesh(itemGeometry(g), itemMaterial(g.material), count);
    im.frustumCulled = false;   // copies roam the whole world
    root.add(im); meshes.push(im);
  }
  return { root, built, set(i, mat) { for (const im of meshes) im.setMatrixAt(i, mat); }, commit() { for (const im of meshes) im.instanceMatrix.needsUpdate = true; } };
}

// wood with grain: door panels and shutters the demo hinges (patterns ride with the object anyway)
// wood with grain: the material is shared, the colour comes from the geometry (paintGeometry)
export const woodMaterial = () => archMaterial(undefined, "wood");

// A PLAIN STONE, for looking at a definition on its own: the world's own light-free shading (how bright a
// face is says which way it points) with no pattern and nothing baked behind it. FLAT SHADING WITHOUT VERTEX
// NORMALS -- architecture wants every face flat and every corner sharp, and the engine wants its vertices
// WELDED, which pull against each other -- so the normal is taken per pixel from the derivatives of the world
// position. The face is then exactly as flat as it is. (arch_lab.html and assets.html draw with it.)
let plainCache = null;
export function plainStone(base = [.80, .76, .66]) {
  const fn = plainCache ?? (plainCache = wgslFn(`
    fn plainStone(pw: vec3<f32>, eye: vec3<f32>, base: vec3<f32>) -> vec3<f32> {
      var n = normalize(cross(dpdx(pw), dpdy(pw)));
      if (dot(n, eye - pw) < 0.0) { n = -n; }
      let k = ${lightWGSL("n")};
      return base * k;
    }
  `));
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  mat.colorNode = fn({ pw: positionWorld, eye: cameraPosition, base: vec3(...base) });
  return mat;
}

// what a part is painted with: its colour and its accent, per vertex, exactly the values the uniforms carried
// (THREE.Color does the same sRGB -> linear conversion either way, so the shader sees the same numbers).
// A DOOR'S PANEL, shaped to its doorway: straight up to `spring` over the floor, then the opening's own head (arch/profiles.js
// archCurve -- flat, segmental, semicircular, pointed...), 3cm clear of the jambs and 2cm under the head, with iron strap
// hinges and a knob on both faces. In the hinge's frame: x across the doorway from the hinge, y up from the floor, z
// through the panel. A door without a head (the older buildings' `{ w, h }`) is flat, 12cm short of `h` as it always was.
// One geometry per shape: the game draws every door of a shape in one instanced draw.
const doorPanels = new Map();
// AN OPENING'S OUTLINE AS A SLAB, `T` thick about z = 0: from the sill (x 0..w) up the jambs to the springing `top`
// and over the head (archCurve, the opening's own) -- a door's panel, a window's pane or shutter, exactly its opening
function openingSlab(w, top, head, T) {
  const curve = archCurve(w / 2, head ?? { profile: "flat" }), shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(w, 0);
  for (let i = curve.length - 1; i >= 0; i--) shape.lineTo(w / 2 + curve[i][0], top + curve[i][1]);   // up one side, over the head, down the other
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -T / 2);
  return g;
}
// a WINDOW's pane (glass) or shutter (wood) shaped to its opening when it has a head (an arched window: the pane
// fills the arch too); one geometry per shape, shared by every window of it
const windowPanes = new Map();
export function windowPane({ w, h, spring, head }, wood = false) {
  const sp = spring ?? h, key = `${w.toFixed(3)}|${sp.toFixed(3)}|${JSON.stringify(head)}|${wood}`;
  if (!windowPanes.has(key)) {
    const g = openingSlab(w, sp, head, .06);
    windowPanes.set(key, wood ? paintGeometry(g, 0x6e4c2e) : g);
  }
  return windowPanes.get(key);
}
export function doorPanel({ w, h, spring, head }) {
  const hd = head ?? { profile: "flat" }, sp = head ? spring ?? h : h - .12;
  const key = `${w.toFixed(3)}|${sp.toFixed(3)}|${JSON.stringify(hd)}`;
  if (doorPanels.has(key)) return doorPanels.get(key);
  const c = 0, top = sp, T = .07, iron = 0x2b2926;   // (the panel IS the opening: jambs, head and sill, no gap round it)
  const panel = openingSlab(w, top, hd, T);
  const parts = [paintGeometry(panel, 0x5a3c22)];
  for (const y of [.3, Math.max(.6, top - .35)]) for (const zs of [-1, 1]) {   // the strap hinges, out from the hinge side
    const g = new THREE.BoxGeometry(w * .72, .05, .012); g.translate(c + w * .36, y, zs * (T / 2 + .006)); parts.push(paintGeometry(g, iron, iron));
  }
  const kx = w - c - .12, ky = Math.min(1.0, top - .25);                        // the knob on the latch side, through the panel
  const spindle = new THREE.CylinderGeometry(.012, .012, T + .1, 6); spindle.rotateX(Math.PI / 2); spindle.translate(kx, ky, 0);
  parts.push(paintGeometry(spindle, iron, iron));
  for (const zs of [-1, 1]) { const k = new THREE.SphereGeometry(.035, 8, 6); k.translate(kx, ky, zs * (T / 2 + .05)); parts.push(paintGeometry(k, iron, iron)); }
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g)), geo = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv", "aC", "aC2"]) {
    const size = flat[0].attributes[name].itemSize, arr = new Float32Array(flat.reduce((n, g) => n + g.attributes[name].count * size, 0));
    let o = 0; for (const g of flat) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  doorPanels.set(key, geo);
  return geo;
}
export function paintGeometry(geo, color, accent) {
  const n = geo.attributes.position.count;
  const c = new THREE.Color(color), a = new THREE.Color(accent ?? 0xffffff);
  const cs = new Float32Array(n * 3), as = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cs[i * 3] = c.r; cs[i * 3 + 1] = c.g; cs[i * 3 + 2] = c.b;
    as[i * 3] = a.r; as[i * 3 + 1] = a.g; as[i * 3 + 2] = a.b;
  }
  geo.setAttribute("aC", new THREE.BufferAttribute(cs, 3));
  geo.setAttribute("aC2", new THREE.BufferAttribute(as, 3));
  return geo;
}

// ---- primitives -----------------------------------------------------------

// triangular prism, ridge along Z, origin at the base-rectangle center --
// one of these is a whole gable roof: the sloped planes plus both pediment
// triangles as its end caps
function gablePrism(w, h, len) {
  const hw = w / 2, hl = len / 2;
  const A0 = [-hw, 0, -hl], B0 = [hw, 0, -hl], C0 = [0, h, -hl];
  const A1 = [-hw, 0, hl], B1 = [hw, 0, hl], C1 = [0, h, hl];
  const tris = [
    A1, B1, C1,                      // front pediment (+z)
    B0, A0, C0,                      // back pediment (-z)
    A0, B0, B1, A0, B1, A1,          // underside
    B0, C0, C1, B0, C1, B1,          // right slope
    A0, A1, C1, A0, C1, C0,          // left slope
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  geo.computeVertexNormals();        // non-indexed -> flat faces
  return geo;
}

const geoCache = new Map();
function geoFor(shape, size, inflate = 0) {
  const key = shape + inflate + JSON.stringify(size);
  if (geoCache.has(key)) return geoCache.get(key);
  let g;
  if (shape === "box") g = new THREE.BoxGeometry(size[0] + 2 * inflate, size[1] + 2 * inflate, size[2] + 2 * inflate);
  // `a0`/`span` (radians, a0 measured from +z the way a yaw is) make it an ARC of a cylinder rather than the
  // whole round: the marble course round a cathedral's tribune, which is five bays of a ten-bay ring and not a
  // ring at all -- drawn full, the other half of it hangs in the air beside the building.
  else if (shape === "cyl") g = new THREE.CylinderGeometry(size.r1 + inflate, size.r2 + inflate, size.h + 2 * inflate, size.seg ?? 10, 1, !!size.open, size.a0 ?? 0, size.span ?? Math.PI * 2);
  else if (shape === "sphere") g = new THREE.SphereGeometry(size.r + inflate, 10, 8);
  else if (shape === "capsule") g = new THREE.CapsuleGeometry(size.r + inflate, size.len, 3, 8);   // { r, len }: len = the straight middle, as in the species rigs
  else if (shape === "panel") g = new THREE.PlaneGeometry(size[0] + 2 * inflate, size[1] + 2 * inflate);   // [w, h]: a flat sheet facing +-z, no thickness (a cut-out crop row: no edge faces)
  else if (shape === "arch") {
    // half-cylinder, flat side down, thickness along z -- a Roman arch top
    g = new THREE.CylinderGeometry(size.r + inflate, size.r + inflate, size.t + 2 * inflate, 10, 1, false, 0, Math.PI);
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI / 2);
  } else if (shape === "hwall") {
    // a wall with real rectangular openings (windows, doors) cut through it:
    // one extruded mesh regardless of hole count. Origin at the wall's base
    // center; size { w, h, t, holes: [[u, y, hw, hh], ...] }.
    const w2 = size.w / 2 + inflate, top = size.h + inflate, y0 = -inflate;
    const s = new THREE.Shape();
    s.moveTo(-w2, y0); s.lineTo(w2, y0); s.lineTo(w2, top); s.lineTo(-w2, top);
    for (const [u, y, hw, hh] of size.holes ?? []) {
      const a = Math.max(.05, hw / 2 - inflate), c = Math.max(.05, hh - 2 * inflate);
      const hp = new THREE.Path();
      hp.moveTo(u - a, y + inflate); hp.lineTo(u - a, y + inflate + c);
      hp.lineTo(u + a, y + inflate + c); hp.lineTo(u + a, y + inflate);
      s.holes.push(hp);
    }
    const dep = size.t + 2 * inflate;
    g = new THREE.ExtrudeGeometry(s, { depth: dep, bevelEnabled: false });
    g.translate(0, 0, -dep / 2);
  } else if (shape === "spandrel") {
    // wall panel with a PERFECT semicircular arch bitten out of its underside
    // (origin at the arch spring line), extruded to real wall depth -- the
    // opening is a true arc you see and walk through, and the inflated
    // outline copy's smaller bite draws the dark rim around the curve
    const w2 = size.w / 2 + inflate, top = size.h + inflate, r = Math.max(.05, size.r - inflate), y0 = -inflate;
    const s = new THREE.Shape();
    s.moveTo(-w2, y0);
    s.lineTo(-r, y0);
    s.absarc(0, y0, r, Math.PI, 0, true);
    s.lineTo(w2, y0);
    s.lineTo(w2, top);
    s.lineTo(-w2, top);
    const d = size.t + 2 * inflate;
    g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 24 });
    g.translate(0, 0, -d / 2);
  } else if (shape === "wedge") {
    // flat right-triangle plate: legs along +x and +z from the origin
    // corner, size = [legX, height, legZ]
    const lx = size[0] + inflate, lz = size[2] + inflate, hh = size[1] + 2 * inflate;
    const s = new THREE.Shape();
    s.moveTo(-inflate, inflate); s.lineTo(lx, inflate); s.lineTo(-inflate, -lz);
    g = new THREE.ExtrudeGeometry(s, { depth: hh, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -hh / 2, 0);
  } else g = gablePrism(size[0] + 3 * inflate, size[1] + 2 * inflate, size[2] + 2 * inflate);
  geoCache.set(key, g);
  return g;
}

// ---- the COMPONENT engine, in the village ------------------------------------------------------------------
// arch/ builds a building the way it is actually composed -- an opening's profile, a wall face, a bay, a ring
// of bays, a storey -- and its triangles are exact: welded, closed, no T-junctions, and a ring of bays that
// meets itself when it comes round. The definitions are JSON (assets/architecture) and the lab that shows them is
// arch_lab.html.
//   Here the parts and their instances are baked into ONE flat-shaded mesh in the village's own stone, because
// the village draws a static building as a single mesh and merges it with its neighbours. Flat normals come
// from the triangles themselves (the engine welds its vertices, which is what makes the pieces MEET, so there
// are no per-corner normals to average and none are wanted: architecture is flat faces and sharp arrises).
const ARCH_DOCS = { arena: ARENA_DOC, basilica: BASILICA_DOC, florence: FLORENCE_DOC, "pantheon": PANTHEON_DOC, "parthenon": PARTHENON_DOC, "hephaestus": HEPHAESTUS_DOC, "taj-mahal": TAJ_DOC, "st-basil": STBASIL_DOC, "frauenkirche": FRAUENKIRCHE_DOC, "zwinger": ZWINGER_DOC, "notre-dame": NOTREDAME_DOC, "milan": MILAN_DOC, "cologne": COLOGNE_DOC, "dendera": DENDERA_DOC, "giza": GIZA_DOC, "didyma": DIDYMA_DOC, "windmill": WINDMILL_DOC, "hagia-sophia": HAGIA_DOC, "melk": MELK_DOC, "schwerin": SCHWERIN_DOC, "karlskirche": KARLSKIRCHE_DOC, "chichen-itza": CHICHEN_DOC, "sacre-coeur": SACRE_DOC, "stephansdom": STEPHAN_DOC, "st-pauls": STPAULS_DOC, "parliament": PARLIAMENT_DOC, "st-isaacs": STISAACS_DOC, "berliner-dom": BERLINERDOM_DOC, "moritzburg": MORITZBURG_DOC, "fishermans-bastion": FISHERMANS_DOC, "mainz": MAINZ_DOC, "el-pilar": EL_PILAR_DOC, "sultan-qaboos": SULTAN_QABOOS_DOC, "ulm": ULM_DOC, "blue-mosque": BLUE_MOSQUE_DOC, "temple-of-heaven": TEMPLE_OF_HEAVEN_DOC,
                    "village/church": V_CHURCH, "village/eaves-house": V_EAVES_HOUSE, "village/gable-house": V_GABLE_HOUSE, "village/gatehouse": V_GATEHOUSE, "village/jettied-house": V_JETTIED_HOUSE, "village/longhouse": V_LONGHOUSE, "village/stone-house": V_STONE_HOUSE, "village/wall": V_WALL, "village/wall-tower": V_WALL_TOWER };
// the COMPONENTS those buildings use (a definition `use`d by another: Florence's tribune morte are `iwan`s, the
// Taj Mahal's minarets carry `chhatri`s, Notre-Dame's nave is the `basilica`)
registerDocs({ "components/chhatri": C_CHHATRI, "components/minaret": C_MINARET, "components/iwan": IWAN_DOC, "components/domed-tower": C_DOMED_TOWER, "components/gallery": C_GALLERY, "components/curved-gallery": C_CURVED_GALLERY, "components/pavilion": C_PAVILION, "components/pinnacle": C_PINNACLE, "components/flying-buttress": C_FLYING_BUTTRESS, "components/bridge": C_BRIDGE, "components/palace-wing": C_PALACE_WING, "components/tower-stair": C_TOWER_STAIR, "components/drum-dome": C_DRUM_DOME, "components/portico": C_PORTICO, "components/apse": C_APSE, "components/round-stair-tower": C_ROUND_STAIR_TOWER, "components/baroque-tower": C_BAROQUE_TOWER, "components/arcade-walk": C_ARCADE_WALK, "components/crenellation": C_CRENELLATION, "components/omani-minaret": C_OMANI_MINARET, "components/portal": C_PORTAL, "components/gothic-tower-stage": C_GOTHIC_TOWER_STAGE, "components/gothic-octagon-stage": C_GOTHIC_OCTAGON_STAGE, "components/gothic-spire": C_GOTHIC_SPIRE, "components/dome-cascade": C_DOME_CASCADE, "components/domed-arcade": C_DOMED_ARCADE, "components/riwaq": C_RIWAQ, "components/ottoman-minaret": C_OTTOMAN_MINARET, "components/dougong": C_DOUGONG, "components/chinese-hall": C_CHINESE_HALL, "components/palace-wall": C_PALACE_WALL, basilica: BASILICA_DOC,
             "furniture/altar": F_ALTAR, "furniture/bakery": F_BAKERY, "furniture/barrels": F_BARRELS, "furniture/bed": F_BED, "furniture/butcher": F_BUTCHER, "furniture/carpenter": F_CARPENTER, "furniture/chest": F_CHEST, "furniture/cooper": F_COOPER, "furniture/hearth": F_HEARTH, "furniture/pew": F_PEW, "furniture/pottery": F_POTTERY, "furniture/smithy": F_SMITHY, "furniture/table": F_TABLE, "furniture/tailor": F_TAILOR, "furniture/tavern-room": F_TAVERN_ROOM, "furniture/weaver": F_WEAVER, "village/church": V_CHURCH, "village/eaves-house": V_EAVES_HOUSE, "village/gable-house": V_GABLE_HOUSE, "village/gatehouse": V_GATEHOUSE, "village/jettied-house": V_JETTIED_HOUSE, "village/longhouse": V_LONGHOUSE, "village/stone-house": V_STONE_HOUSE, "village/wall": V_WALL, "village/wall-tower": V_WALL_TOWER,
             "village/pig-yard": V_PIG_YARD, "village/bridge": V_BRIDGE, "village/market": V_MARKET, "village/apiary": V_APIARY, "village/hen-yard": V_HEN_YARD, "village/stable-yard": V_STABLE_YARD, "components/fence": C_FENCE, "components/gate": C_GATE, "components/pigsty": C_PIGSTY, "components/hen-house": C_HEN_HOUSE, "components/stable": C_STABLE });
// (and every ITEM in the catalogue -- a building's `item` parts, its chairs and beds, by the same paths the asset viewer
//  shows them under: items/furniture/...)
registerDocs(Object.fromEntries([...ASSETS].filter(([k]) => k.startsWith("items/"))));
// (and every other definition the catalogue lists -- the village's fountain, fields, mill, landing and fisherman's hut,
//  Caerphilly, Versailles -- straight from it, with the finish each names as its building's: no import list to keep in
//  step with the index)
registerDocs(Object.fromEntries([...ASSETS].filter(([k]) => k.startsWith("architecture/") && !docOf(k.slice(13))).map(([k, v]) => [k.slice(13), v])));
for (const [k, v] of ASSETS) if (k.startsWith("finishes/") && v.building?.startsWith("architecture/")) FINISHES[v.building.slice(13)] ??= v;
const archCacheAsm = new Map();
// `yaw` (degrees, among the params): the whole building TURNED about its origin -- a house facing its street. The
// assembly itself is turned (every instance of every part), so its mesh, its floors and walls, its finish and its
// markers all come out turned alike, and nothing downstream has to know.
export function archAssembly(name, params = {}, build = null) {
  const { yaw = 0, ...own } = params;
  if (typeof name !== "string") return turnAssembly(assemble(name, build ? { ...own, build } : own), yaw);   // a document itself (the asset viewer's, edited and not yet saved)
  const key = name + "|" + JSON.stringify(params) + "|" + (build ?? []).join(",");
  if (!archCacheAsm.has(key)) {
    const doc = ARCH_DOCS[name] ?? docOf(name);          // (a building, or a component the library holds)
    if (!doc) throw new Error(`architecture: no component definition "${name}"`);
    archCacheAsm.set(key, turnAssembly(assemble(doc, build ? { ...own, build } : own), yaw));
  }
  return archCacheAsm.get(key);
}
function turnAssembly(asm, deg) {
  if (!deg) return asm;
  const Y = deg * Math.PI / 180, c = Math.cos(Y), s = Math.sin(Y);
  return { ...asm, yaw: deg, parts: asm.parts.map((p) => ({ ...p, instances: p.instances.map(([a, x, y, z]) => [a + Y, x * c + z * s, y, -x * s + z * c]) })) };
}
// A BUILDING'S LIFE, read from its MARKERS (arch/assemble.js `marker`): where its beds, doors, windows, seats, fires and
// work places are, in the site's frame (offset by -cx, -cz), each turned with whatever placed it. The shapes are the
// ones the village's hand-built houses always exported, so everything that reads them -- the villagers' day, the
// door panels and shutters, the seats, the fires, the guards -- takes an arch building as it took those.
//   a marker's `face` is a heading in the building's frame (radians, the figures' convention: 0 faces +x, pi/2 -z)
export function lifeOf(asm, cx, cz) {   // (exported: the asset viewer reads a building's statues by it, as the game does)
  const L = { beds: [], doors: [], windows: [], folkSpots: [], seats: [], fires: [], guards: [], up: [], pen: null, blocks: [], vessels: [], statues: [],
              dishes: [], flows: [], cobwebs: [], plants: [], crops: [], quaySlots: [], way: [], boatDock: null, wheelAt: null, wheel: null, drop: null, bargeZ: null,
              lifts: [], paintings: [], mirrors: [], spins: [] };
  for (const p of asm.parts) {
    if (p.kind !== "marker") continue;
    const d0 = p.data ?? {};
    for (const [i, [a, X, Y, Z]] of p.instances.entries()) {
      const d = Object.fromEntries(Object.entries(d0).map(([k, v]) => [k, Array.isArray(v) && p.instances.length > 1 ? v[i] : v]));   // (a value a placement: a `block` marker's w and d per rect)
      const x = X - cx, z = Z - cz, deg = a * 180 / Math.PI, fwd = [Math.sin(a), Math.cos(a)];   // (local +z, turned)
      if (p.role === "bed") {   // its frame's centre; its foot `foot` metres along its own +z, the mattress `top` over it
        const f = d.foot ?? 1.1;
        L.beds.push({ x, y: Y + (d.top ?? .5), z, foot: [x + fwd[0] * f, z + fwd[1] * f], storey: d.storey ?? 0, yaw: a });
      } else if (p.role === "door" || p.role === "window") {   // the opening's middle; its width runs along the marker's +x
        (p.role === "door" ? L.doors : L.windows).push({ x, y: Y + (p.role === "window" ? (d.h ?? 1) / 2 : 0), z, w: d.w ?? 1, h: d.h ?? 2, yaw: -deg,
                                                         ...(d.panel === 0 ? { panel: false } : {}),   // (panel 0: a doorway without a door)
                                                         ...(d.head ? { head: { per90: asm.params?.detail ?? 4, ...d.head }, spring: d.spring ?? d.h } : {}) });   // (its opening's shape, at the building's own detail -- the panel's arch has as many facets as the doorway's: doorPanel)
      } else if (p.role === "spot") {
        L.folkSpots.push({ x, y: Y, z, h: (d.face ?? 0) + a, pose: d.pose ?? "stand", ...(d.work ? { role: "work" } : {}),
                           ...(d.gesture ? { gesture: d.gesture } : {}), ...(d.tool ? { tool: d.tool } : {}), ...(d.bard ? { bard: true } : {}), ...(d.crew ? { crew: d.crew } : {}) });   // (crew: a place the building's own people keep -- a mine's miners -- not the villagers')
      } else if (p.role === "seat" || p.role === "lie") {   // a box to sit or lie on: `w` by `d`, its top `top` over the marker
        const turned = Math.abs(Math.sin(a)) > .7, hw = (d.w ?? .5) / 2, hd = (d.d ?? .5) / 2;
        L.seats.push({ x, z, hx: turned ? hd : hw, hz: turned ? hw : hd, top: Y + (d.top ?? .45), lie: p.role === "lie" });
      } else if (p.role === "fire") L.fires.push({ x, y: Y, z, r: d.r ?? .25, h: d.h ?? .5, ...(d.candle ? { candle: true } : {}), ...(d.flicker !== undefined ? { flicker: d.flicker } : {}) });   // (a candle's flame: one small calm cone, no sound; `flicker` how wild)
      else if (p.role === "guard") L.guards.push({ x, z, h: (d.face ?? 0) + a, arms: d.arms ?? [] });
      // a STATUE (statues.js): a figure carved -- its pose, dress, what it holds, its stone, its size -- standing at
      // the marker facing `face` (on whatever pedestal the definition built under it)
      else if (p.role === "statue") L.statues.push({ x, y: Y, z, h: (d.face ?? 0) + a, kind: d.kind ?? "man", pose: d.pose ?? "stand", style: d.style ?? null,
                                                    outfit: d.outfit ?? null, hold: d.hold ?? null, stone: d.stone ?? "marble", scale: d.scale ?? 1, seed: d.seed ?? 1, gesture: d.gesture ?? null });
      else if (p.role === "way") L.up.push({ order: d.order ?? 0, storey: d.storey ?? 0, at: [x, z] });   // the route up the stairs
      // a farmyard's stock: its `pen` (the range, w by d about the marker, of a `kind`), the `block` rects it keeps out of, its `trough`
      else if (p.role === "pen") L.pen = { x0: x - (d.w ?? 10) / 2, x1: x + (d.w ?? 10) / 2, z0: z - (d.d ?? 10) / 2, z1: z + (d.d ?? 10) / 2, kind: d.kind ?? "pigs" };
      else if (p.role === "block") L.blocks.push({ x0: x - (d.w ?? 1) / 2, x1: x + (d.w ?? 1) / 2, z0: z - (d.d ?? 1) / 2, z1: z + (d.d ?? 1) / 2 });
      else if (p.role === "trough") L.vessels.push({ kind: "trough", x, y: Y, z, fill: d.fill ?? .6, drink: d.drink ?? "water" });
      // the rest of a site's life (2026-10-02: what the fountain, the fisherman's hut, the mill, the landing, the fields
      // and the orchards handed the game as code): a VESSEL to drink from (tableware.js), a DISH of food, running water
      // (`flow`: a falling jet or a rippling pool), a COBWEB in a corner, a PLANT (a fruit tree, a bush: flora grows
      // it), a CROP (its rows painted on the field: cropPanels), the quay's SLOTS and the hands' PATH (in `i` order),
      // the boat's DOCK, the mill wheel's ROTOR (its axle; the wheel's numbers), the sacks' DROP, the barge's BERTH
      else if (p.role === "vessel") L.vessels.push({ kind: d.kind ?? "mug", x, y: Y, z, fill: d.fill ?? .9, drink: d.drink ?? "ale", ...(a ? { yaw: deg } : {}) });
      else if (p.role === "dish") L.dishes.push({ food: d.food ?? "bread", x, y: Y, z });
      else if (p.role === "flow") L.flows.push({ kind: d.kind ?? "pool", x, y: Y, z, r: d.r ?? .5, ...(d.h !== undefined ? { h: d.h } : {}), ...(d.seg ? { seg: d.seg } : {}) });
      else if (p.role === "cobweb") L.cobwebs.push({ x, y: Y, z, sx: d.sx ?? 1, sz: d.sz ?? 1, d: d.d ?? .5 });
      else if (p.role === "plant") L.plants.push({ kind: d.kind ?? "tree", ...(d.species ? { species: d.species } : {}), ...(d.fruit ? { fruit: d.fruit } : {}),
                                                    x, z, seed: d.seed ?? 1, height: d.height ?? 4, rotY: d.rotY ?? a });
      else if (p.role === "crop") L.crops.push({ crop: d.crop ?? "rye", x, z, w: d.w ?? 10, d: d.d ?? 8, yaw: a });
      else if (p.role === "slot") L.quaySlots.push([x, Y, z]);
      else if (p.role === "path") L.way[d.i ?? L.way.length] = [x, Y, z];
      else if (p.role === "dock") L.boatDock = [x, Y, z];
      else if (p.role === "rotor") { L.wheelAt = [x, Y, z]; L.wheel = { r: d.r ?? 3, w: d.w ?? 1.2, axleBack: d.axleBack ?? 5, axleFwd: d.axleFwd ?? .95 }; }
      else if (p.role === "drop") L.drop = { x, z };
      else if (p.role === "berth") L.bargeZ = z;
      // a LIFT (a stair's shortcut: the castle's walk onto a tower deck) from the marker to its top `dx`, `dy`, `dz` away
      // (in the marker's frame); a PAINTING's canvas or a MIRROR's glass, `w` by `h`, facing the marker's +z -- a
      // mirror reflects only within its `room` ([x0, x1, y0, y1, z0, z1] in the building's frame: mirrors.js)
      // a SPIN: a piece of millwork (an item: a gear, a shaft, a runner stone) turned by the game about its own `axis`
      // (x, y or z of the marker's frame) `ratio` times as fast as the building's drive -- its water wheel, its sails
      else if (p.role === "spin") L.spins.push({ x, y: Y, z, yaw: a, item: d.item, params: d0.params ?? {}, axis: d.axis ?? "y", ratio: d.ratio ?? 1 });
      else if (p.role === "lift") {
        const dx = d.dx ?? 0, dz = d.dz ?? 0, c = Math.cos(a), s = Math.sin(a);
        L.lifts.push({ bx: x, bz: z, by: Y, tx: x + dx * c + dz * s, tz: z - dx * s + dz * c, ty: Y + (d.dy ?? 0) });
      } else if (p.role === "painting" || p.role === "mirror") {
        const n = [Math.sin(a), 0, Math.cos(a)].map((v) => (Math.abs(v) < 1e-6 ? 0 : v));
        const rm = Array.isArray(d.room?.[0]) ? d.room[0] : d.room;   // (a room per placement: one placement's list is still a list)
        (p.role === "mirror" ? L.mirrors : L.paintings).push({ x, y: Y, z, w: d.w ?? 1, h: d.h ?? 1, n,
          ...(rm ? { room: [rm[0] - cx, rm[1] - cx, rm[2], rm[3], rm[4] - cz, rm[5] - cz] } : {}) });
      }
    }
  }
  L.up.sort((u, v) => u.order - v.order);
  return L;
}
// `glass: true` makes the building's GLASS instead -- its windows' panes (the definition's "... glass" parts) in the
// shared window material; the stone mesh leaves them out. null when it has none.
export function archMesh(name, { params = {}, build = null, color = 0xd9cdb4, accent = 0xc2b598, pat = "ashlar", side,
                          colors = null, glass = false, glassColor = 0x4d5f7a, floor = null, finish = null } = {}) {
  const asm0 = archAssembly(name, params, build);
  // A FINISHED building is every surface as its rules say, glass and all, in one call (the glass variant is empty)
  if (finish) return glass ? null : withItems(finishMeshes(asm0, finish, { side, glassColor }), asm0);
  const asm = { ...asm0, parts: asm0.parts.filter((p) => (p.kind === "glass") === glass && p.kind !== "item") };
  if (glass) {
    if (!asm.parts.length) return null;
    colors = { "kind:glass": { color: glassColor, accent: glassColor } };
  }
  // A PART MAY HAVE ITS OWN STONE (`colors`, by part name, a component's part by its own name, or by kind) -- and
  // its own PATTERN (`pat` in its colour entry: St Basil's onions are striped, chequered, starred): the parts are
  // grouped by pattern, one mesh each, and within a mesh the colours ride in the vertices.
  // a part's colours: by its name, its name less a trailing number (the pieces of one floor: "aisle roof 3"), its
  // own name inside a component ("cap"), the component's name ("minarets"), then its kind
  const ownOf = (p) => colors ? partNames(p).map((k) => colors[k]).find((v) => v !== undefined) ?? null : null;
  // THE FLOORS ARE FLOORS: with `floor` ({ pat, color, accent }) every flat, up-facing triangle of the stone -- a
  // floor, a landing, a tread, a terrace, the platform -- is baked apart, in the floor's pattern and colours, so a
  // building's floors are tiled or paved rather than the colour of its walls (roofs, domes and vaults keep theirs)
  const isFloor = floor && !glass ? (n, p) => n.y > .9 && !FLOORLESS.has(p.kind) : () => false;
  const groups = new Map();
  for (const p of asm.parts) { const k = ownOf(p)?.pat ?? pat; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const meshes = [...groups].map(([gpat, parts]) => bakeArch(parts, { color, accent, colors, ownOf, material: glass ? glassMat : archMaterial(side, gpat),
                                                                      keep: (n, p) => !isFloor(n, p) }));
  if (floor && !glass) meshes.push(bakeArch(asm.parts, { color: floor.color ?? 0xcfc6b4, accent: floor.accent ?? 0x9d937f, colors: null, ownOf,
                                                         material: archMaterial(side, floor.pat ?? "checker"), keep: isFloor }));
  if (!glass) meshes.push(...itemMeshes(asm0));
  if (meshes.length === 1) return meshes[0];
  const g = new THREE.Group();
  for (const m of meshes) g.add(m);
  return g;
}
const FLOORLESS = new Set(["roof", "dome", "vault", "ribs", "pendentives", "glass"]);   // (their tops are roofs, not floors)
// THE ITEMS a building is furnished with (arch/assemble.js `item` parts: its chairs, tables, beds, chests), drawn in their
// own materials -- every copy of every item merged into one mesh per material (a room's oak, its linen, its iron), in
// the building's frame like the stone round them
function itemMeshes(asm) {
  const by = new Map();
  for (const p of asm.parts) {
    if (p.kind !== "item") continue;
    const it = itemOf(p.item);
    for (const [a, X, Y, Z] of p.instances) for (const g of it.groups) {
      let o = by.get(g.material.key);
      if (!o) by.set(g.material.key, o = { material: g.material, copies: [], verts: 0, idx: 0 });
      o.copies.push([g, Math.cos(a), Math.sin(a), X, Y, Z]); o.verts += g.pos.length / 3; o.idx += g.idx.length;
    }
  }
  return [...by.values()].map((o) => {
    const pos = new Float32Array(o.verts * 3), nor = new Float32Array(o.verts * 3), uv = new Float32Array(o.verts * 2);
    const idx = new (o.verts > 65535 ? Uint32Array : Uint16Array)(o.idx);
    let v = 0, t = 0;
    for (const [g, c, sn, X, Y, Z] of o.copies) {
      const n = g.pos.length / 3;
      for (let i = 0; i < n; i++) {
        const k = (v + i) * 3, x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2], nx = g.nor[i * 3], nz = g.nor[i * 3 + 2];
        pos[k] = x * c + z * sn + X; pos[k + 1] = y + Y; pos[k + 2] = -x * sn + z * c + Z;
        nor[k] = nx * c + nz * sn; nor[k + 1] = g.nor[i * 3 + 1]; nor[k + 2] = -nx * sn + nz * c;
      }
      uv.set(g.uv, v * 2);
      for (let k = 0; k < g.idx.length; k++) idx[t + k] = g.idx[k] + v;
      v += n; t += g.idx.length;
    }
    const m = new THREE.Mesh(itemGeometry({ pos, nor, uv, idx }), itemMaterial(o.material));
    m.name = "items";
    return m;
  });
}
// a finished building's group, with its furniture in it
function withItems(group, asm) {
  for (const m of itemMeshes(asm)) group.add(m);
  return group;
}
// the parts, instanced, flat-shaded, into one mesh -- the triangles `keep` (by world normal and part) keeps
function bakeArch(parts, { color, accent, colors, ownOf, material, keep = () => true }) {
  // (a first pass to count what is kept: the arrays are sized once)
  const A0 = new THREE.Vector3(), B0 = new THREE.Vector3(), C0 = new THREE.Vector3(), U0 = new THREE.Vector3(), V0 = new THREE.Vector3(), N0 = new THREE.Vector3();
  let tris = 0;
  for (const p of parts) {
    const P = p.geometry.position, I = p.geometry.index;
    for (const inst of p.instances) {
      const ca = Math.cos(inst[0]), sa = Math.sin(inst[0]);
      const put = (j, out) => out.set(P[j * 3] * ca + P[j * 3 + 2] * sa, P[j * 3 + 1], -P[j * 3] * sa + P[j * 3 + 2] * ca);
      for (let k = 0; k < I.length; k += 3) {
        put(I[k], A0); put(I[k + 1], B0); put(I[k + 2], C0);
        N0.copy(U0.subVectors(B0, A0)).cross(V0.subVectors(C0, A0));
        if (N0.lengthSq() > 1e-18) N0.normalize(); else N0.set(0, 1, 0);
        if (keep(N0, p)) tris++;
      }
    }
  }
  const pos = new Float32Array(tris * 9), nor = new Float32Array(tris * 9);
  const col = colors ? new Float32Array(tris * 9) : null;
  const acc = colors ? new Float32Array(tris * 9) : null;
  const _c = new THREE.Color(color), _a = new THREE.Color(accent);
  let o = 0;
  const ax = new THREE.Vector3(), bx = new THREE.Vector3(), cx = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (const p of parts) {
    const P = p.geometry.position, I = p.geometry.index;
    if (col) {
      const own = ownOf(p);
      _c.set(own?.color ?? own ?? color); _a.set(own?.accent ?? accent);
    }
    for (const inst of p.instances) {
      const ca = Math.cos(inst[0]), sa = Math.sin(inst[0]);
      const put = (j, out) => out.set(P[j * 3] * ca + P[j * 3 + 2] * sa + inst[1], P[j * 3 + 1] + inst[2],
                                      -P[j * 3] * sa + P[j * 3 + 2] * ca + inst[3]);
      for (let k = 0; k < I.length; k += 3) {
        put(I[k], ax); put(I[k + 1], bx); put(I[k + 2], cx);
        nn.copy(u.subVectors(bx, ax)).cross(v.subVectors(cx, ax));
        if (nn.lengthSq() > 1e-18) nn.normalize(); else nn.set(0, 1, 0);
        if (!keep(nn, p)) continue;
        for (const q of [ax, bx, cx]) {
          pos[o] = q.x; pos[o + 1] = q.y; pos[o + 2] = q.z;
          nor[o] = nn.x; nor[o + 1] = nn.y; nor[o + 2] = nn.z;
          if (col) { col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b; acc[o] = _a.r; acc[o + 1] = _a.g; acc[o + 2] = _a.b; }
          o += 3;
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  if (col) {
    geo.setAttribute("aC", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aC2", new THREE.BufferAttribute(acc, 3));
  } else paintGeometry(geo, color, accent);
  geo.computeBoundingSphere();
  return new THREE.Mesh(geo, material);
}

export function buildBuilding(def) {
  const root = new THREE.Group();
  root.name = def.name;

  // stained glass: a diamond lattice in the building's own frame (as every
  // pattern, see archMaterial), each cell hash-picking a color from the
  // classic palette, with near-opaque lead lines between
  const stainedGlass = wgslFn(`
    fn stainedGlass(pL: vec3<f32>, nL: vec3<f32>) -> vec4<f32> {
      let u = select(pL.x, pL.z, abs(nL.x) > abs(nL.z));
      let q = vec2<f32>(u + pL.y, u - pL.y) / 0.62;
      let h = fract(sin(dot(floor(q), vec2<f32>(127.1, 311.7))) * 43758.5);
      var col = vec3<f32>(0.38, 0.2, 0.5);
      if (h < 0.3) { col = vec3<f32>(0.14, 0.24, 0.55); }
      else if (h < 0.5) { col = vec3<f32>(0.55, 0.12, 0.15); }
      else if (h < 0.68) { col = vec3<f32>(0.72, 0.55, 0.16); }
      else if (h < 0.86) { col = vec3<f32>(0.16, 0.4, 0.24); }
      let f = abs(fract(q) - 0.5);
      let lead = step(0.43, max(f.x, f.y));
      return vec4<f32>(mix(col, vec3<f32>(0.07, 0.06, 0.05), lead), mix(0.55, 0.92, lead));
    }
  `);
  const stained = stainedGlass({ pL: positionGeometry, nL: attribute("normal", "vec3") });
  const stainedMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  stainedMat.colorNode = stained.xyz;
  stainedMat.opacityNode = stained.w;

  // MERGED static geometry: a building never moves, so every part sharing a
  // material collapses into ONE BufferGeometry/draw call (a cathedral goes
  // from ~1000 draws to a handful). World-space patterns and orientation
  // shading read baked positions and normals identically, so nothing changes
  // visually.
  const buckets = new Map();   // material -> [transformed geometries]
  const fillMats = new Map();
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e2 = new THREE.Euler(),
        _vp = new THREE.Vector3(), _vs = new THREE.Vector3();
  const addTo = (mat, geo, p) => {
    const g2 = geo.index ? geo.toNonIndexed() : geo.clone();
    paintGeometry(g2, p.color, p.accent);   // the colour travels with the vertices (see archMaterial)
    const [rx, ry, rz] = (p.rot ?? [0, 0, 0]).map((d) => d * Math.PI / 180);
    _m4.compose(_vp.set(...p.pos), _q.setFromEuler(_e2.set(rx, ry, rz)), _vs.set(...(p.scale ?? [1, 1, 1])));
    g2.applyMatrix4(_m4);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(g2);
  };
  def.parts.forEach((p, pi) => {
    if (p.render === false) return;   // collider-only parts (a solid stand-in under a pitched handrail)
    const mk = (p.side ?? "") + "|" + (p.pat ?? "");     // the colour is no longer part of it: it is in the vertices
    if (!fillMats.has(mk)) fillMats.set(mk, archMaterial(p.side, p.pat));
    // per-part inflation, 1.2-10.8mm cycling with the part index: two parts
    // authored on the same plane end up a few mm apart instead of
    // z-fighting, and flush neighbors overlap rather than gap
    const eps = p.glass ? 0 : (pi % 9 + 1) * .0012;
    addTo(p.glass === "stained" ? stainedMat : p.glass ? glassMat : fillMats.get(mk),
          geoFor(p.shape, p.size, eps), p);
  });
  if (def.arch) {
    // the stone, and the glass in its windows (a second mesh, in the one window material)
    for (const am of [archMesh(def.arch.def, def.arch), archMesh(def.arch.def, { ...def.arch, glass: true })]) {
      if (!am) continue;
      if (def.arch.offset) am.position.set(def.arch.offset[0], 0, def.arch.offset[1]);   // (centred on its site: archBuilding)
      root.add(am);
    }
  }   // a building (or a part of one) from the component engine
  for (const [mat, geos] of buckets) {
    let total = 0;
    for (const g of geos) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    const col = geos[0].attributes.aC ? new Float32Array(total * 3) : null;      // ...and the parts' colours
    const acc = col ? new Float32Array(total * 3) : null;
    let o = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (col) { col.set(g.attributes.aC.array, o * 3); acc.set(g.attributes.aC2.array, o * 3); }
      o += g.attributes.position.count;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    if (col) {
      merged.setAttribute("aC", new THREE.BufferAttribute(col, 3));
      merged.setAttribute("aC2", new THREE.BufferAttribute(acc, 3));
    }
    root.add(new THREE.Mesh(merged, mat));
  }
  return root;
}

// The same merged-material build, but as InstancedMesh copies: one draw
// call per material for `count` identical, independently placed objects
// (every cart wheel of one size across the whole fleet). set(i, matrix)
// places copy i; commit() uploads after a batch of sets.
export function buildInstanced(def, count) {
  const built = buildBuilding(def);
  const root = new THREE.Group();
  root.name = def.name;
  const meshes = [];
  for (const m of built.children) {
    const im = new THREE.InstancedMesh(m.geometry, m.material, count);
    im.frustumCulled = false;   // copies roam the whole world
    root.add(im);
    meshes.push(im);
  }
  return {
    root,
    set(i, mat) { for (const im of meshes) im.setMatrixAt(i, mat); },
    commit() { for (const im of meshes) im.instanceMatrix.needsUpdate = true; },
  };
}

// ---- generic Greek peripteral temple --------------------------------------
// All lengths in meters; y=0 is the ground. `width`/`length` describe the
// stylobate (the top platform the columns stand on).

const linspace = (a, b, k) => Array.from({ length: k }, (_, i) => a + (b - a) * i / (k - 1));

// (the old box stairs -- stairSteps, wellRail, stairY -- went with the last code-built buildings that used them: every
//  stair is an arch flight now, railed by the engine, walked as a slope)

// Polychromy presets -- best-guess reconstructions of how the temples were
// painted. Pick per building so not every temple looks alike.
// (the Greek temples are assets: hephaestus.json, parthenon.json, didyma.json -- tools/archgen/temples.py)

// A STAIR IS WALKED AS A SLOPE: its treads are replaced in the floor field by a ramp through their middles (the
// stair part's `path`), half a tread past the first and last, so running or landing from a jump on it finds one
// smooth surface instead of a comb of 30cm treads with a riser's gap between them. The treads the ramp covers are
// left out; a landing (wider than the ramp's ends) keeps its own flat floor.
function stairRamps(path, W) {
  const tri = [], runs = [];
  let cur = [];
  for (const q of path) {
    const prev = cur[cur.length - 1];
    if (q.landing || (prev && (Math.hypot(q.p[0] - prev.p[0], q.p[2] - prev.p[2]) > 1.2 || Math.abs(q.p[1] - prev.p[1]) > .45))) {
      if (cur.length > 1) runs.push(cur);
      cur = q.landing ? [] : [q];
    } else cur.push(q);
  }
  if (cur.length > 1) runs.push(cur);
  const strips = [];
  for (const r of runs) {
    const n = r.length, P = r.map((q) => W(...q.p));
    const a = P[0], b = P[1], y = P[n - 1], z = P[n - 2];
    const pts = [[2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]], ...P, [y[0] + (y[0] - z[0]) / 2, y[1], y[2] + (y[2] - z[2]) / 2]];
    const ws = [r[0].w, ...r.map((q) => q.w), r[n - 1].w];
    const edges = pts.map((p, i) => {
      const o = pts[Math.min(i + 1, pts.length - 1)], pr = pts[Math.max(i - 1, 0)];
      let dx = o[0] - pr[0], dz = o[2] - pr[2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const h = ws[i] / 2;
      return [[p[0] - dz * h, p[1], p[2] + dx * h], [p[0] + dz * h, p[1], p[2] - dx * h]];
    });
    for (let i = 0; i + 1 < edges.length; i++) {
      const [l0, r0] = edges[i], [l1, r1] = edges[i + 1];
      tri.push(...l0, ...r0, ...r1, ...l0, ...r1, ...l1);
      strips.push([l0, r0, r1], [l0, r1, l1]);
    }
  }
  // (a tread is covered when its middle stands over a ramp triangle, within a riser and a half of the ramp's height)
  const covers = (x, y, z) => strips.some(([a, b, c]) => {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) return false;
    const w0 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, w1 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    if (w0 < -1e-3 || w1 < -1e-3 || w0 + w1 > 1.001) return false;
    return Math.abs(w0 * a[1] + w1 * b[1] + (1 - w0 - w1) * c[1] - y) < .3;
  });
  return { tri, covers };
}

// THE FLOOR, READ FROM THE STONE ITSELF. A building assembled from components has no primitive to guess a
// height field from, and guessing one is how you get a slope where the building has a hole: the village's
// walker climbed the seating straight over the vomitoria, which are tunnels. So the field is the GEOMETRY --
// every up-facing triangle of the assembled building, indexed by its place on the ground. At a point it
// answers with every surface height there (the sand, a step of the cavea, the vault over a tunnel, the deck
// of the upper storey), which is exactly what floorsAt wants, and where the stone has a hole it answers with
// nothing and the walker falls through as it should.
//   Up-facing only (|ny| > .35): a wall is not a floor, and leaving them out cuts the set by two thirds.
export function archFloorField(name, params = {}, cell = 3) {
  const asm = archAssembly(name, params);
  const tri = [];                        // [ax, ay, az, bx, by, bz, cx, cy, cz] per floor triangle
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (const p of asm.parts) {
    const P = p.geometry.position, I = p.geometry.index;
    for (const inst of p.instances) {
      const ca = Math.cos(inst[0]), sa = Math.sin(inst[0]);
      const W = (x, y, z) => [x * ca + z * sa + inst[1], y + inst[2], -x * sa + z * ca + inst[3]];
      const put = (j, out) => out.set(...W(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]));
      const ramps = p.path ? stairRamps(p.path, W) : null;
      for (let k = 0; k < I.length; k += 3) {
        put(I[k], A); put(I[k + 1], B); put(I[k + 2], C);
        nn.copy(u.subVectors(B, A)).cross(v.subVectors(C, A));
        const l = nn.length();
        if (l < 1e-9 || Math.abs(nn.y / l) < .35) continue;
        if (ramps && nn.y > 0 && ramps.covers((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3, (A.z + B.z + C.z) / 3)) continue;
        tri.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
      }
      if (ramps) tri.push(...ramps.tri);
    }
  }
  // ...indexed by the ground cell each one covers
  const grid = new Map(), key = (i, j) => i * 100003 + j;
  const at = (q) => Math.floor(q / cell);
  for (let t = 0; t < tri.length; t += 9) {
    const x0 = at(Math.min(tri[t], tri[t + 3], tri[t + 6])), x1 = at(Math.max(tri[t], tri[t + 3], tri[t + 6]));
    const z0 = at(Math.min(tri[t + 2], tri[t + 5], tri[t + 8])), z1 = at(Math.max(tri[t + 2], tri[t + 5], tri[t + 8]));
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = key(i, j);
      const list = grid.get(k) ?? (grid.set(k, []), grid.get(k));
      list.push(t);
    }
  }
  const out = [];
  return (x, z) => {
    const list = grid.get(key(at(x), at(z)));
    if (!list) return 0;
    out.length = 0;
    for (const t of list) {
      // the point inside the triangle's ground projection, by its barycentric coordinates -- then the height
      const ax = tri[t], az = tri[t + 2], bx = tri[t + 3], bz = tri[t + 5], cx = tri[t + 6], cz = tri[t + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      if (w0 < -1e-4 || w0 > 1.0001) continue;
      const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (w1 < -1e-4 || w0 + w1 > 1.0001) continue;
      const y = w0 * tri[t + 1] + w1 * tri[t + 4] + (1 - w0 - w1) * tri[t + 7];
      let seen = false;
      for (const q of out) if (Math.abs(q - y) < .06) { seen = true; break; }
      if (!seen) out.push(y);
    }
    return out.slice();
  };
}

// CAN EVERY FLOOR BE REACHED? The building walked as the game walks it -- the same floor field and wall field, the
// same rule (the next support is the highest floor at most .5m above the feet, else the fall to the one below; the
// way is shut where stone stands between the knee and the head) -- from the open ground all round it, over a grid
// of `cell`. Then every FLAT floor with a room's headroom (2m) is looked at: the ones the walk never reached, in
// connected regions, are the floors nobody can get to -- a gallery without a stair, a room without a door. A floor
// counts if something is over it with a room's height (not a pitched roof: that is a roof space), or if it is open to
// the sky and its part says it is walked (`walked: true`: a terrace, a roof walk).
// Returns { levels: [{ y, area, reached }], unreached: [{ y, area, at }] } -- areas in square metres.
export function archAccess(name, params = {}, { cell = .25, minArea = 8, probe = null } = {}) {
  const asm = archAssembly(name, params), floors = archFloorField(name, params), walls = archWallField(name, params);
  // the flat floors and what is over them, per grid cell: every triangle's heights, whether it faces up, its kind
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  const tris = [];
  for (const p of asm.parts) {
    if (p.kind === "glass") continue;
    const P = p.geometry.position, I = p.geometry.index;
    for (const [yaw, X, Y, Z] of p.instances) {
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const at = (j) => [P[j * 3] * c + P[j * 3 + 2] * sn + X, P[j * 3 + 1] + Y, -P[j * 3] * sn + P[j * 3 + 2] * c + Z];
      for (let k = 0; k < I.length; k += 3) {
        const a = at(I[k]), b = at(I[k + 1]), d = at(I[k + 2]);
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
        if (l < 1e-9 || Math.abs(ny / l) < .35) continue;
        tris.push({ a, b, d, up: ny / l, kind: p.kind, flatRoof: !!p.flatRoof, walked: !!p.walked || p.kind === "base", name: p.name });
        for (const q of [a, b, d]) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[2] < z0) z0 = q[2]; if (q[2] > z1) z1 = q[2]; }
      }
    }
  }
  x0 -= 2; z0 -= 2; x1 += 2; z1 += 2;
  const NX = Math.ceil((x1 - x0) / cell), NZ = Math.ceil((z1 - z0) / cell);
  const cx = (i) => x0 + (i + .5) * cell, cz = (j) => z0 + (j + .5) * cell;
  const surf = Array.from({ length: NX * NZ }, () => []);
  for (const t of tris) {
    const [a, b, d] = [t.a, t.b, t.d];
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], d[0]) - x0) / cell)), i1 = Math.min(NX - 1, Math.floor((Math.max(a[0], b[0], d[0]) - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a[2], b[2], d[2]) - z0) / cell)), j1 = Math.min(NZ - 1, Math.floor((Math.max(a[2], b[2], d[2]) - z0) / cell));
    const den = (b[2] - d[2]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[2] - d[2]);
    if (Math.abs(den) < 1e-12) continue;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = cx(i), z = cz(j);
      const u = ((b[2] - d[2]) * (x - d[0]) + (d[0] - b[0]) * (z - d[2])) / den, v = ((d[2] - a[2]) * (x - d[0]) + (a[0] - d[0]) * (z - d[2])) / den;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      surf[i * NZ + j].push({ h: u * a[1] + v * b[1] + (1 - u - v) * d[1], up: t.up, kind: t.kind, flatRoof: t.flatRoof, walked: t.walked, name: t.name });
    }
  }
  // the walk: from every cell on the edge, at the ground
  const key = (i, j, h) => `${i},${j},${Math.round(h * 20)}`;
  const reached = new Map(), queue = [];
  const supportAt = (i, j, maxY) => {                      // (as the game's: the highest floor at or below maxY, the ground -- 0 -- only where there is none, so a cellar is walked down into)
    let best = -1e9; const f = floors(cx(i), cz(j));
    for (const h of Array.isArray(f) ? f : []) if (h <= maxY && h > best) best = h;
    return best === -1e9 ? 0 : best;
  };
  const visit = (i, j, h) => { const k = key(i, j, h); if (reached.has(k)) return; reached.set(k, true); queue.push([i, j, h]); };
  for (let i = 0; i < NX; i++) { visit(i, 0, supportAt(i, 0, .5)); visit(i, NZ - 1, supportAt(i, NZ - 1, .5)); }
  for (let j = 0; j < NZ; j++) { visit(0, j, supportAt(0, j, .5)); visit(NX - 1, j, supportAt(NX - 1, j, .5)); }
  while (queue.length) {
    const [i, j, h] = queue.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {   // (diagonals too: a door askew to the grid)
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= NX || j2 >= NZ) continue;
      // (the walker's circle, as the game samples it: its middle and four points of its rim, 0.25m out)
      if ([[0, 0], [.25, 0], [-.25, 0], [0, .25], [0, -.25]].some(([ox, oz]) => walls(cx(i2) + ox, cz(j2) + oz, h + .5, h + 1.7))) continue;
      visit(i2, j2, supportAt(i2, j2, h + .5));
    }
  }
  // WHICH FLAT SURFACES ARE FLOORS: why one is not (null: it is one)
  const notFloor = (list, k, x, z) => {
    const f = list[k];
    if (f.up < .95 || FLOORLESS.has(f.kind) || f.kind === "roof" || f.flatRoof) return "not flat, or a roof";
    if (["wall", "enclosure", "ring"].includes(f.kind) && !f.walked) return "a wall's head or a sill";   // (unless walked: a gallery built as an enclosure)
    const over = list.slice(k + 1).find((q) => q.h > f.h + .05);
    if (over && over.up > 0) return `inside a solid (${over.name} over it faces up)`;
    if (over && over.h < f.h + 2.0) return `no headroom (${over.name} at ${over.h.toFixed(2)})`;
    // (a roof space: the roof is the ceiling, with no floor slab of the storey's own just over it -- the attic; a top
    //  storey's ceiling is its attic floor, which an eave may reach a little below)
    if (over && over.kind === "roof" && !list.some((q) => q.up < 0 && q.kind !== "roof" && q.h > over.h - .01 && q.h < over.h + .5)) return "a roof space";
    if (over && over.h > f.h + 20 && !f.walked) return "a ceiling 20m up";
    if (!over && !f.walked) return "open to the sky, not walked";
    // (where the walker's circle -- the walk's own test -- meets a wall: no one stands there, it is the wall's foot)
    if ([[0, 0], [.25, 0], [-.25, 0], [0, .25], [0, -.25]].some(([ox, oz]) => walls(x + ox, z + oz, f.h + .5, f.h + 1.7))) return "in a wall";
    return null;
  };
  if (probe) {                                            // (what the check sees over one point: every surface, and the walk's heights there)
    const i = Math.floor((probe[0] - x0) / cell), j = Math.floor((probe[1] - z0) / cell);
    const list = surf[i * NZ + j].sort((p, q) => p.h - q.h);
    const hs = [...reached.keys()].filter((k) => k.startsWith(`${i},${j},`)).map((k) => (+k.split(",")[2] / 20).toFixed(2));
    return { reachedAt: hs, surfaces: list.map((q, k) => `${q.h.toFixed(2)} ${q.up > 0 ? "up" : "down"} ${q.kind} ${q.name}` +
      (q.up > .95 ? ` [${notFloor(list, k, cx(i), cz(j)) ?? "FLOOR"}]` : "")) };
  }
  const isReached = (i, j, h) => { for (let d = -1; d <= 1; d++) if (reached.has(`${i},${j},${Math.round(h * 20) + d}`)) return true; return false; };
  // the flat floors with a room's headroom, and which of them the walk reached
  const flat = new Map();                                  // "i,j" -> [h...]
  const levels = new Map();
  const unreachedCells = [];
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    const list = surf[i * NZ + j].sort((p, q) => p.h - q.h);
    for (let k = 0; k < list.length; k++) {
      const f = list[k];
      if (notFloor(list, k, cx(i), cz(j))) continue;
      const over = list.slice(k + 1).find((q) => q.h > f.h + .05);
      const band = Math.round(f.h * 2) / 2, lv = levels.get(band) ?? { y: band, area: 0, reached: 0 };
      lv.area += cell * cell;
      if (isReached(i, j, f.h)) lv.reached += cell * cell; else unreachedCells.push([i, j, f.h, f.name, over ? `${over.name} at ${over.h.toFixed(1)}` : "sky"]);
      levels.set(band, lv);
    }
  }
  // the unreached floors in connected regions
  const left = new Map(unreachedCells.map((c) => [`${c[0]},${c[1]},${Math.round(c[2] * 10)}`, c]));
  const unreached = [];
  for (const [k0, c0] of left) {
    if (!left.has(k0)) continue;
    left.delete(k0);
    const stack = [c0]; let n = 0;
    while (stack.length) {
      const [i, j, h] = stack.pop(); n++;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dh of [-1, 0, 1]) {
        const k = `${i + di},${j + dj},${Math.round(h * 10) + dh}`;
        if (left.has(k)) { stack.push(left.get(k)); left.delete(k); }
      }
    }
    if (n * cell * cell >= minArea) unreached.push({ y: +c0[2].toFixed(2), area: +(n * cell * cell).toFixed(1), at: [+cx(c0[0]).toFixed(1), +cz(c0[1]).toFixed(1)],
                                                   floor: c0[3], under: c0[4] });
  }
  return { levels: [...levels.values()].sort((a, b) => a.y - b.y).map((l) => ({ y: l.y, area: +l.area.toFixed(1), reached: +l.reached.toFixed(1) })), unreached };
}

// ---- the amphitheatre, from the COMPONENT engine ---------------------------
// Verona's arena at its real size (assets/architecture/arena.json): sixty bays of arcade in two storeys, each opening a
// real one with a barrel vault behind it, a cavea of forty rows on a podium, and the vomitoria and stairs cut
// through the seating the way the building's own section shows them. None of that is written here -- it is a
// definition the component engine assembles (buildBuilding, def.arch).
//   What the VILLAGE needs beside the stone is where you can stand, where the crowd sits, how much ground it
// takes and where the show happens. All four are read from the definition's OWN numbers (its resolved
// params), so the floor cannot drift from the stone: change the radius in the JSON and the sand, the seats
// and the walk follow.
//   The COLLIDERS are the piers alone -- you walk in through the arches, as you would -- and the seating is
// not a collider at all: it is a height field, so the slope carries you up it.
// THE WALLS, READ FROM THE STONE: the collision counterpart of archFloorField. Every near-vertical triangle of the
// assembled building is sampled on the ground at `cell` spacing, and each cell keeps the heights its walls span
// (merged into intervals). A walker is blocked where a cell under it has stone between its knees and its head --
// so a doorway, an arch or a window leaves its own gap, with nothing written by hand.
// (0.2m cells: a wall sampled into a cell stands, for the walk, anywhere in that cell -- at 0.4 a doorway had to be
//  1.3m wide to pass the walker's 0.5m circle; at 0.2 a 0.9m one does)
export function archWallField(name, params = {}, cell = .2) {
  const asm = archAssembly(name, params);
  const key = (i, j) => i * 131071 + j;
  // (pregenerated, if pregen/ has this assembly's -- else worked out here)
  const pk = pregenOn() ? wallsKey(asm, cell) : null;
  const cached = pk && PREGEN.walls.get(pk);
  const cells = cached || wallCells(asm, cell, key);
  if (pk && !cached && PREGEN.record) recordFor("walls", pk, packWalls(cells));
  if (pk && !cached) pregenMiss("walls", typeof name === "string" ? name : name?.name ?? "", pk);
  // (each cell's intervals were grown one sample at a time: the samples of one wall join into its full height)
  return (x, z, lo, hi) => {
    const list = cells.get(key(Math.floor(x / cell), Math.floor(z / cell)));
    if (!list) return false;
    for (const [y0, y1] of list) if (y0 < hi && y1 > lo) return true;
    return false;
  };
}
function wallCells(asm, cell, key) {
  const cells = new Map();
  const add = (x, z, y0, y1) => {
    const k = key(Math.floor(x / cell), Math.floor(z / cell));
    const list = cells.get(k);
    if (!list) { cells.set(k, [[y0, y1]]); return; }
    for (const iv of list) if (y0 <= iv[1] + .05 && y1 >= iv[0] - .05) { iv[0] = Math.min(iv[0], y0); iv[1] = Math.max(iv[1], y1); return; }
    list.push([y0, y1]);
  };
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  for (const p of asm.parts) {
    // (a stair's upright faces are its risers and its edges: steps, walked up, not walls -- its open sides have
    //  railings, which are walls; a riser in the wall field stops the walk at the step after next)
    // (but a STRAIGHT flight's SIDES and its UNDERSIDE are in the way: one walks up it, not through it from beside or
    //  beneath -- in its own frame the run is x, so a side faces z and an underside faces down)
    if (p.path && p.kind !== "flight") continue;
    const P = p.geometry.position, I = p.geometry.index;
    const sideOrUnder = p.path ? (k) => {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
      return l > 1e-12 && (Math.abs(nz / l) > .9 || ny / l < -.35);
    } : null;
    for (const inst of p.instances) {
      const ca = Math.cos(inst[0]), sa = Math.sin(inst[0]);
      const put = (j, o) => { o[0] = P[j * 3] * ca + P[j * 3 + 2] * sa + inst[1]; o[1] = P[j * 3 + 1] + inst[2]; o[2] = -P[j * 3] * sa + P[j * 3 + 2] * ca + inst[3]; };
      for (let k = 0; k < I.length; k += 3) {
        if (sideOrUnder && !sideOrUnder(k)) continue;
        put(I[k], A); put(I[k + 1], B); put(I[k + 2], C);
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
        if (l < 1e-9 || (Math.abs(ny / l) > .35 && !sideOrUnder)) continue;   // floors and roofs are not walls (a flight's underside is: it comes down to the floor)
        // sample the triangle at under a cell's spacing (by its full size: a tall thin sliver of wall still has
        // its height), and give each cell it touches ONE interval, from its lowest sample there to its highest
        const len = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]));
        const n = Math.max(1, Math.ceil(len / (cell * .7)));
        const span = new Map();
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          const a = i / n, b = j / n, x = A[0] + ux * a + vx * b, z = A[2] + uz * a + vz * b, y = A[1] + uy * a + vy * b;
          const ck = key(Math.floor(x / cell), Math.floor(z / cell)), iv = span.get(ck);
          if (!iv) span.set(ck, [x, z, y, y]); else { if (y < iv[2]) iv[2] = y; if (y > iv[3]) iv[3] = y; }
        }
        for (const [x, z, y0, y1] of span.values()) add(x, z, y0, y1);
      }
    }
  }
  return cells;
}

// ANY BUILDING FROM ITS DEFINITION: assets/architecture/<doc>.json, assembled, as a site the village can place --
// the mesh (archMesh, coloured by part name or kind), its FLOORS (archFloorField: every up-facing triangle, the
// base platform, stairs and terraces included) and its WALLS (archWallField). Centred on its site: the footprint
// is the rectangle round what it built, and everything is moved so that rectangle's middle is the site's.
// `moat: { hw, hd, w, depth }` is a ring of water round an island hw x hd about the definition's own origin (which
// is not the site's middle when a bridge reaches out over it): the game carves it (index.html `moats`).
// `floor`: the floors' pattern and colours ({ pat, color, accent }) -- checkered marble unless the building says
// `origin`: keep the DEFINITION's origin as the site's (no centring on the bounding box) and take `footprint` as given -- a
// building placed by an edge it measures from its own middle (the mill, the landing and the fisherman's hut against the
// bank: their footprint is the yard, not the jetty or the piles reaching out over the water)
export function archBuilding(doc, { name, params = {}, color = 0xdcd4c2, accent = 0xc4b79f, pat = "ashlar", colors = {}, moat = null,
                                    floor = { pat: "checker", color: 0xd6cfc0, accent: 0x8f877a }, origin = false, footprint = null,
                                    finish = typeof doc === "string" ? FINISHES[doc] ?? null : null } = {}) {
  const asm = archAssembly(doc, params);
  // (a site that keeps its OWN ORIGIN says so -- `site.origin`, the yard it stands in `footW` x `footD`: the mill and the
  // fisherman's hut are set against the bank by their yard, not by the middle of a jetty or a wheel out over the water)
  const site = (typeof doc === "string" ? ARCH_DOCS[doc] ?? docOf(doc) : doc)?.site;
  if (site?.origin) { origin = true; footprint ??= asm.params.footW !== undefined ? [asm.params.footW, asm.params.footD] : null; }
  moat ??= site?.moat ?? null;   // (an island's water, the game carves it: Caerphilly's)
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of asm.parts) {
    const P = p.geometry.position;
    for (const [yaw, X, , Z] of p.instances) {
      const c = Math.cos(yaw), s2 = Math.sin(yaw);
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i] * c + P[i + 2] * s2 + X, z = -P[i] * s2 + P[i + 2] * c + Z;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
    }
  }
  const cx = origin ? 0 : (x0 + x1) / 2, cz = origin ? 0 : (z0 + z1) / 2;
  const floors = archFloorField(doc, params), walls = archWallField(doc, params);
  const life = lifeOf(asm, cx, cz);
  // (an iron railing is iron; a stone or balustered one is the building's stone)
  const iron = (typeof doc === "string" ? ARCH_DOCS[doc] : doc)?.railing?.type === "iron";
  const palette = { "kind:dome": { color: 0xa9532e, accent: 0x8c4426 }, "kind:roof": { color: 0x9a5a3e, accent: 0x7e4631 },
                    "kind:ribs": { color: 0xf1ece0 }, ...(iron ? { "kind:railing": { color: 0x2e2f31, accent: 0x1f2022 } } : {}), ...colors };
  return {
    name: name ?? asm.name, parts: life.crops.flatMap((c) => cropPanels(c)),   // (a field's crop: its painted rows -- the only parts it has of its own)
    arch: { def: doc, params, color, accent, pat, side: "double", colors: palette, offset: [-cx, -cz], floor, finish },
    footprint: footprint ?? [x1 - x0, z1 - z0],
    // (how far it reaches from its site's middle -- past its footprint where it has one of its own: a mine's galleries
    //  run far under the ground round its yard -- for what must know all of it: the walls the walker meets)
    extent: x1 >= x0 ? [Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx)), Math.max(Math.abs(z0 - cz), Math.abs(z1 - cz))] : [0, 0],   // (none: an orchard is only its items)
    // (where the ground is OPEN over it: `site.dig`, rectangles [x0, z0, x1, z1] in its frame -- a shaft's mouth, which
    //  has no floor near the surface to open it as a cellar's stair does)
    ...(site?.dig ? { dig: site.dig.map(([a, b, c, d]) => [a - cx, b - cz, c - cx, d - cz]) } : {}),
    ...(moat ? { moat: { ...moat, ox: -cx, oz: -cz } } : {}),
    floorY: (x, z) => floors(x + cx, z + cz),
    wallField: (x, z, lo, hi) => walls(x + cx, z + cz, lo, hi),
    spirals: spiralsOf(asm, cx, cz),
    // (its life, where it has any: markers in its definition)
    ...(life.beds.length ? { beds: life.beds, ways: { up: life.up.map((u) => u.at), upStorey: life.up.map((u) => u.storey) } } : {}),
    ...(life.doors.length ? { doors: life.doors } : {}), ...(life.windows.length ? { windows: life.windows } : {}),
    ...(life.folkSpots.length ? { folkSpots: life.folkSpots } : {}), ...(life.seats.length ? { seats: life.seats } : {}),
    ...(life.fires.length ? { fires: life.fires } : {}), ...(life.guards.length ? { guards: life.guards } : {}),
    ...(life.pen ? { pen: { ...life.pen, blocks: life.blocks }, kind: life.pen.kind } : {}), ...(life.vessels.length ? { vessels: life.vessels } : {}),
    ...(life.dishes.length ? { dishes: life.dishes } : {}), ...(life.flows.length ? { flows: life.flows } : {}), ...(life.cobwebs.length ? { cobwebs: life.cobwebs } : {}),
    ...(life.plants.length ? { plants: life.plants } : {}), ...(life.crops.length ? { crop: life.crops[0].crop } : {}),
    ...(life.quaySlots.length ? { quaySlots: life.quaySlots } : {}), ...(life.way.length ? { way: life.way } : {}), ...(life.bargeZ !== null ? { bargeZ: life.bargeZ } : {}),
    ...(life.boatDock ? { boatDock: life.boatDock } : {}), ...(life.wheelAt ? { wheelAt: life.wheelAt, wheel: life.wheel } : {}), ...(life.drop ? { drop: life.drop } : {}),
    ...(life.spins.length ? { spins: life.spins } : {}), ...(life.statues.length ? { statues: life.statues } : {}),
    ...(life.lifts.length ? { lifts: life.lifts } : {}), ...(life.paintings.length ? { paintings: life.paintings } : {}), ...(life.mirrors.length ? { mirrors: life.mirrors } : {}),
    ...(site?.glazed || asm.params?.glazed ? { glazed: true } : {}),   // (its windows' panes are glass, not shutters: a palace's, a merchant's stone house)
  };
}
// A FIELD'S CROP, painted: the plants are a shader pattern on thin see-through panels (archFrag PAT 13-16, swaying with
// the wind), rows across the plot both ways so the field reads from every side -- a few dozen panels instead of thousands
// of stalks. Flat panels, not thin boxes: a box's 2cm end and top faces took the pattern across the row, and as the wind
// shifted the stalks a whole end face turned into one long yellow line; 8% taller than the plants, so no ear is cut.
// (The field itself -- its soil, furrows, a cabbage's heads -- is its definition: assets/architecture/village/field-*.)
const CROP_LOOK = { rye: { h: 1.15, gap: .5, c: [0xb2a05a, 0xa89050] }, barley: { h: .85, gap: .5, c: [0xc9b66c, 0xd6c27a] },
                    beans: { h: 1.7, gap: 1.0, c: [0x6a5236, 0x3f8a3a] }, garlic: { h: .45, gap: .5, c: [0x7fb06a, 0x7fb06a] } };
export function cropPanels({ crop, x = 0, z = 0, w, d }) {
  const C = CROP_LOOK[crop]; if (!C) return [];
  const slab = { color: C.c[0], accent: C.c[1], pat: crop, side: "double", collide: false, outline: false }, Hp = C.h * 1.08, out = [];
  for (let zz = -d / 2 + .6; zz <= d / 2 - .6; zz += C.gap) out.push({ shape: "panel", size: [w - 1, Hp], pos: [x, .12 + Hp / 2, z + zz], ...slab });
  for (let xx = -w / 2 + .6; xx <= w / 2 - .6; xx += C.gap) out.push({ shape: "panel", size: [d - 1, Hp], pos: [x + xx, .12 + Hp / 2, z], rot: [0, 90, 0], ...slab });
  return out;
}
// THE SPIRAL STAIRS of an assembly, for the walk: each copy's axis (in the site's frame, offset by -cx, -cz), the
// radius its treads reach and the heights it climbs between -- a walker on one turns with it (index.html)
function spiralsOf(asm, cx = 0, cz = 0) {
  const out = [];
  for (const p of asm.parts) {
    if (p.kind !== "spiral-stair" || !p.path) continue;
    const r = Math.max(...p.path.map((q) => Math.hypot(q.p[0], q.p[2]) + q.w / 2));
    const y0 = Math.min(...p.path.map((q) => q.p[1])), y1 = Math.max(...p.path.map((q) => q.p[1]));
    for (const [, X, Y, Z] of p.instances) out.push({ x: X - cx, z: Z - cz, r, y0: Y + y0 - .3, y1: Y + y1 + .3 });
  }
  return out;
}

export function amphitheatre({ name = "Amphitheatre", def = "arena", params = {} } = {}) {
  const P = archAssembly(def, params).params;
  const { rOuter, wallT, rOuterInner, rInnerFace, rArena, podium, caveaTop, storeyH, bays } = P;
  const rWallIn = rOuter - wallT;
  const parts = [];
  // the piers of both arcade rings, on both storeys: collider-only (the stone itself is the component engine's)
  const bayA = 2 * Math.PI / bays, pierW = Math.max(.8, bayA * rOuter - P.openW), pierIn = Math.max(.7, bayA * rOuterInner - P.innerOpenW);
  for (let s = 0; s < 2; s++) for (let i = 0; i < bays; i++) {
    // A PIER STANDS BETWEEN TWO BAYS, and a bay is CENTRED on its own angle (assemble.js: bay k sits at
    // k * 2pi / n), so the stone between them is at the half-angle -- put a collider on the bay's own angle
    // and it stands in the archway you can see through. And its box must run along the TANGENT, not the
    // radius, or it lies across both neighbours as well.
    const a = bayA * (i + .5), deg = -(a * 180 / Math.PI + 90), y = s * storeyH + storeyH / 2;
    parts.push({ shape: "box", size: [pierW, storeyH, wallT], rot: [0, deg, 0], render: false,
                 pos: [(rOuter - wallT / 2) * Math.cos(a), y, (rOuter - wallT / 2) * Math.sin(a)], color: 0xd9cdb4 });
    parts.push({ shape: "box", size: [pierIn, storeyH, P.innerT], rot: [0, deg, 0], render: false,
                 pos: [(rOuterInner - P.innerT / 2) * Math.cos(a), y, (rOuterInner - P.innerT / 2) * Math.sin(a)], color: 0xd9cdb4 });
  }
  // the walk: read from the stone (archFloorField), so the steps, the vaults, the stairs and the decks are
  // where they are drawn -- and a vomitorium is a hole, not a slope
  const stone = archFloorField(def, params);
  const floorY = (x, z) => (Math.hypot(x, z) > rOuter + 3 ? 0 : stone(x, z));
  const slopeOf = (r) => podium + (r - rArena) * (caveaTop - podium) / (rInnerFace - rArena);   // (the seats, for the crowd below)
  // the publicum: seated up the cavea, facing the sand, thinning out toward the top
  //   (every spot is a PERSON, posed and drawn every frame, so a full house is a frame's worth of work all by
  //    itself: five rows of a scattered crowd read as a crowd and cost a fifth of what a packed bowl would)
  const folkSpots = [];
  for (let row = 0; row < 5; row++) {
    const r = rArena + (rInnerFace - rArena) * (row + 1) / 7, y = slopeOf(r);
    const n = Math.round(2 * Math.PI * r / 6.5);
    for (let k = 0; k < n; k++) {
      if ((row * 5 + k * 3) % 7 < 3) continue;          // a scattered crowd, not a sold-out house
      const a = 2 * Math.PI * (k + (row % 3) * .33) / n, sx = r * Math.cos(a), sz = r * Math.sin(a);
      folkSpots.push({ x: sx, y, z: sz, h: Math.atan2(sz, -sx), pose: "sit" });
    }
  }
  return { name, parts, arch: { def, params, side: "double", finish: FINISHES[def] ?? null },   // (its stone: assets/finishes/arena.json)
           footprint: [2 * rOuter + 6, 2 * rOuter + 6], floorY, folkSpots,
           arena: { r: rArena * .78, y: 0 } };   // the demo stages beasts and gladiators on the sand
}


// ---- Santa Maria del Fiore, from the COMPONENT engine ----------------------
// Florence at its real size (assets/architecture/florence.json): a nave of four 20.3m bays, an octagon 45.5m across the
// flats, Brunelleschi's dome springing from the drum at 54.8m to a crown at 91m with the lantern over it, the
// three tribunes closing the octagon's other sides, and Giotto's campanile standing clear of the facade with
// a flight of stairs in each of its five storeys.
//   The engine builds the STONE -- walls, arcades, vaults, drum, dome, tribunes, tower, stairs. What it has
// no part for yet is a timber roof, so the nave's and the aisles' are prisms of the village's own kind here,
// and so are the colliders: a wall you cannot walk through is a box, whatever drew it.
// (Santa Maria del Fiore is wholly its definition now -- assets/architecture/florence.json, tools/archgen/florence.py:
//  its pavement, its marble bands and its congregation's pews included)

// ---- generic Gothic cathedral ---------------------------------------------
// The classic massing, layer by layer: low aisle block + tall clerestory nave
// + steep great roof; transept crossing it; twin west towers with pyramid
// spires and corner pinnacles; polygonal apse closing the east end; a fleche
// over the crossing; buttress rows along the flanks; portal, rose window and
// lancets as dark inset panels. Facade faces +z, apse -z.

export function gothicCathedral({
  name,
  length, bodyW,                     // overall length / nave-plus-aisles width
  naveW, naveH, ridgeH, aisleH,      // clerestory width, eaves height, roof ridge
  aisles = 3, aisleH2 = aisleH * 1.3,   // 5 = double aisles: four pier rows, ceilings stepping up to the nave
  towers = true,                     // false: tower-less west front (Milan), gable facade instead
  towerW = 0, towerH = 0, spireH = 0,   // the west towers (spireH 0 = flat-topped)
  transeptW = 0, transeptD = 20, transeptZ = 0,
  apse = true, fleche = true, flecheH = 40, buttressEvery = 9,
  pinnacleEvery = 0,                 // >0: a forest of small spires along the aisle cornices
  stone = 0x8a867c, stoneDark = 0x6e6a61, roofC = 0x565b59,
  glassC = 0x33415c,                 // stained glass, as a colored panel rather than a hole
  doorC = 0x4c3a28,                  // wooden doors
}) {
  const parts = [];
  const L2 = length / 2;
  const roofH = ridgeH - naveH;

  // hollow nave body -- same massing outside, a walkable church inside:
  // outer aisle walls (split open at the transept crossing), clerestory
  // walls carried on arcade pier rows, flat ceiling slabs under the
  // exterior roofs, a sealed east wall behind the apse
  const bodyL = towers ? length - towerW : length;
  const zc = towers ? -towerW / 2 : 0;
  const T = 1.2;                                       // wall thickness
  const zA = zc - bodyL / 2, zB = zc + bodyL / 2;
  const gapA = transeptZ - transeptD / 2, gapB = transeptZ + transeptD / 2;
  const innerA = aisles >= 5 ? aisleH2 : aisleH;      // ceiling of the aisle beside the nave
  const x2 = (naveW / 2 + bodyW / 2) / 2;             // the outer arcade when double-aisled
  const winZs = [];                                   // one window bay between each pair of buttresses
  for (let z = zA + 3 + buttressEvery / 2; z < zB - 3; z += buttressEvery)
    if (!(transeptW && z > gapA - 1.5 && z < gapB + 1.5)) winZs.push(z);
  const aWinH = aisleH * .45, aWinY = aisleH * .55 - aWinH / 2;
  const sideWall = (x, z0, z1) => {                   // aisle wall with its windows truly cut out
    if (z1 - z0 < .1) return;
    const mid = (z0 + z1) / 2;
    const holes = winZs.filter((z) => z > z0 + 1.6 && z < z1 - 1.6).map((z) => [z - mid, aWinY, 2.2, aWinH]);
    parts.push({ shape: "hwall", size: { w: z1 - z0, h: aisleH, t: T, holes }, pos: [x, 0, mid], rot: [0, -90, 0], color: stone, pat: "gothic" });
    // ornamental dado band lining the wall's INNER face
    parts.push({ shape: "box", size: [.1, 3.4, z1 - z0 - .5], pos: [x - Math.sign(x) * (T / 2 + .06), 1.7, mid],
                 color: 0x9d937e, pat: "ornament", accent: 0x77644a, outline: false });
  };
  for (const sx of [-1, 1]) {
    const wx = sx * (bodyW - T) / 2;
    if (transeptW) { sideWall(wx, zA, gapA); sideWall(wx, gapB, zB); }
    else sideWall(wx, zA, zB);
    // THE ARCADE AND THE CLERESTORY ARE BUILT BY THE COMPONENT ENGINE (assets/architecture/basilica.json, below): real
    // arches on real piers, with the nave's and the aisles' barrel vaults over them. These two stay as the
    // COLLIDERS they always were -- a wall with its openings, a pier you cannot walk through -- and are not
    // drawn, so the walk is unchanged and the church is no longer a flat-ceilinged box.
    parts.push({ shape: "hwall", render: false, size: { w: bodyL, h: naveH - innerA, t: T,
                 holes: winZs.map((z) => [z - zc, (naveH - innerA) * .3, 2.2, (naveH - innerA) * .5]) },
                 pos: [sx * (naveW - T) / 2, innerA, zc], rot: [0, -90, 0], color: stone, pat: "gothic" });
    for (let z = zA + 3; z < zB - 2; z += buttressEvery) {
      parts.push({ shape: "box", render: false, size: [1.8, innerA, 1.8], pos: [sx * (naveW - T) / 2, innerA / 2, z], color: stone, pat: "ornament", accent: 0x8d7a4f });
      if (aisles >= 5) parts.push({ shape: "box", size: [1.5, aisleH, 1.5], pos: [sx * x2, aisleH / 2, z], color: stone, pat: "ornament", accent: 0x8d7a4f });
    }
    if (aisles >= 5) {
      // stepped double aisles: outer aisle low, inner aisle taller on its own arcade
      parts.push({ shape: "box", size: [T, aisleH2 - aisleH, bodyL], pos: [sx * x2, (aisleH + aisleH2) / 2, zc], color: stone });
      parts.push({ shape: "box", size: [bodyW / 2 - x2, .5, bodyL], pos: [sx * (x2 + bodyW / 2) / 2, aisleH - .25, zc], color: stoneDark });
      parts.push({ shape: "box", size: [x2 - naveW / 2, .5, bodyL], pos: [sx * (naveW / 2 + x2) / 2, aisleH2 - .25, zc], color: stoneDark });
    } else {
      parts.push({ shape: "box", size: [(bodyW - naveW) / 2, .5, bodyL], pos: [sx * (bodyW + naveW) / 4, aisleH - .25, zc], color: stoneDark });
    }
  }
  parts.push({ shape: "box", size: [naveW, .5, bodyL], pos: [0, naveH - .25, zc], color: stoneDark });
  // cornice of the inner-aisle step: edge STRIPS, not a slab -- a slab at
  // chest height walls off the entire walkable terrace beneath it
  if (aisles >= 5) for (const sxc of [-1, 1])
    parts.push({ shape: "box", size: [1.0, .8, bodyL], pos: [sxc * x2, aisleH2 + .4, zc], color: stoneDark });
  parts.push({ shape: "box", size: [bodyW, aisleH, T], pos: [0, aisleH / 2, zA + T / 2], color: stone });
  if (aisles >= 5) parts.push({ shape: "box", size: [2 * x2, aisleH2 - aisleH, T], pos: [0, (aisleH + aisleH2) / 2, zA + T / 2], color: stone });
  parts.push({ shape: "box", size: [naveW, naveH - innerA, T], pos: [0, (naveH + innerA) / 2, zA + T / 2], color: stone });
  // the outer eaves cornice, likewise as edge strips clear of the terrace
  for (const sxc of [-1, 1])
    parts.push({ shape: "box", size: [1.0, .8, bodyL], pos: [sxc * (bodyW / 2 - .1), aisleH + .4, zc], color: stoneDark });
  parts.push({ shape: "gable", size: [naveW + 1.5, roofH, bodyL], pos: [0, naveH, zc], color: roofC, pat: "tiles" });

  // translucent stained-glass panes standing in the real openings
  for (const z of winZs) for (const sx of [-1, 1]) {
    parts.push({ shape: "box", size: [.12, aWinH + .15, 2.35], pos: [sx * (bodyW - T) / 2, aisleH * .55, z], color: glassC, glass: "stained" });
    parts.push({ shape: "box", size: [.12, (naveH - innerA) * .5 + .15, 2.35], pos: [sx * (naveW - T) / 2, innerA + (naveH - innerA) * .55, z], color: glassC, glass: "stained" });
  }
  // paintings on the aisle walls' inner faces: every second space between the windows, at eye height above the
  // dado, in gilt frames (their canvases are views of the world, taken at the start -- paintings.js)
  const paintingsOut = [];
  for (let i = 0; i + 1 < winZs.length; i += 2) {
    const zm = (winZs[i] + winZs[i + 1]) / 2;
    if (transeptW && zm > gapA - 1 && zm < gapB + 1) continue;   // (no wall across the transept's mouth)
    for (const sx of [-1, 1]) {
      const xf = sx * ((bodyW - T) / 2 - T / 2 - .2), py = 4.6, pw = 2.0, ph = 1.5;
      paintingsOut.push({ x: xf - sx * .05, y: py, z: zm, w: pw, h: ph, n: [-sx, 0, 0] });
      for (const [dz, dy, sz, sh] of [[0, ph / 2 + .07, pw + .28, .14], [0, -ph / 2 - .07, pw + .28, .14], [-pw / 2 - .07, 0, .14, ph], [pw / 2 + .07, 0, .14, ph]])
        parts.push({ shape: "box", size: [.08, sh, sz], pos: [xf, py + dy, zm + dz], color: 0xc9a13b, collide: false });
    }
  }

  // hollow transept arms, fully open toward the crossing
  if (transeptW) {
    for (const sx of [-1, 1]) {
      const a0 = bodyW / 2 - T, a1 = transeptW / 2;
      const mid = sx * (a0 + a1) / 2, aw = a1 - a0;
      parts.push({ shape: "box", size: [aw, naveH, T], pos: [mid, naveH / 2, gapA + T / 2], color: stone });
      parts.push({ shape: "box", size: [aw, naveH, T], pos: [mid, naveH / 2, gapB - T / 2], color: stone });
      parts.push({ shape: "hwall", size: { w: transeptD, h: naveH, t: T,
                   holes: [[0, naveH * .55 - naveH * .21, transeptD * .35, naveH * .42]] },
                   pos: [sx * (a1 - T / 2), 0, transeptZ], rot: [0, -90, 0], color: stone, pat: "gothic" });
      parts.push({ shape: "box", size: [aw, .5, transeptD], pos: [mid, naveH - .25, transeptZ], color: stoneDark });
      parts.push({ shape: "box", size: [.12, naveH * .44, transeptD * .37], pos: [sx * (a1 - T / 2), naveH * .55, transeptZ], color: glassC, glass: "stained" });   // great transept window
    }
    parts.push({ shape: "gable", size: [transeptD + 1.5, roofH, transeptW + 1], pos: [0, naveH, transeptZ], rot: [0, 90, 0], color: roofC, pat: "tiles" });
  }

  // west front: either twin towers with a central bay, or a tower-less
  // gable facade (the nave roof's own pediment triangle) with three portals
  const towerX = naveW / 2 + towerW / 2 - 2;
  const towerZ = L2 - towerW / 2;
  const lifts = [];   // shortcut spots: bottom/top of each tower stair
  // a real tight spiral: wide treads wind around a fat newel, 14 per turn,
  // 3.5m rise per turn; each box tread overlaps the next angularly so there
  // are NO gaps anywhere on the climb, and an enclosure wall rings the
  // outer edge so nobody falls off
  const spiralR = 2.15, spiralDA = Math.PI * 2 / 14, spiralOut = 3.8;
  if (towers) {
    const TT = 1.1;
    for (const sx of [-1, 1]) {
      // hollow tower shell: the front and outer walls carry REAL window
      // openings (hwall holes) with stained panes set into them, matching
      // how every other building treats its windows
      const bWin = [0, towerH * .51, towerW * .35, towerH * .22];   // belfry
      const lWin = [0, towerH * .27, towerW * .3, towerH * .14];    // lower window
      parts.push({ shape: "hwall", size: { w: towerW, h: towerH, t: TT, holes: [bWin, lWin] },
                   pos: [sx * towerX, 0, L2 - TT / 2], color: stone, pat: "gothic" });
      parts.push({ shape: "hwall", size: { w: towerW, h: towerH, t: TT, holes: [[0, towerH * .51, towerW * .32, towerH * .2]] },
                   pos: [sx * (towerX + towerW / 2 - TT / 2), 0, towerZ], rot: [0, -90, 0], color: stone, pat: "gothic" });
      // back wall carries a REAL door into the tower: the spiral stair
      // inside climbs all the way to the roof deck
      parts.push({ shape: "hwall", size: { w: towerW, h: towerH, t: TT, holes: [[0, 0, 1.8, 2.8]] },
                   pos: [sx * towerX, 0, towerZ - towerW / 2 + TT / 2], color: stone, pat: "gothic" });
      parts.push({ shape: "box", size: [TT, towerH, towerW], pos: [sx * (towerX - towerW / 2 + TT / 2), towerH / 2, towerZ], color: stone, pat: "gothic" });
      // roof deck: a full slab whose shaft opening sits just inside the
      // stair's outer edge -- stepping off the top tread lands ON the deck
      // with no moat, and the square hole stays inside the round enclosure
      const hole = 7.0, strip = (towerW - hole) / 2;
      for (const [sw, sd, ox, oz] of [
        [towerW, strip, 0, hole / 2 + strip / 2], [towerW, strip, 0, -(hole / 2 + strip / 2)],
        [strip, hole, hole / 2 + strip / 2, 0], [strip, hole, -(hole / 2 + strip / 2), 0]])
        parts.push({ shape: "box", size: [sw, .4, sd], pos: [sx * towerX + ox, towerH - .2, towerZ + oz], color: stone });
      // triangular plates over the square opening's corners (which poke past
      // the round tread circle): same cover, less footprint, fewer polygons
      for (const [ox, oz, ry] of [[3.5, 3.5, 180], [-3.5, 3.5, 90], [-3.5, -3.5, 0], [3.5, -3.5, 270]])
        parts.push({ shape: "wedge", size: [2.15, .4, 2.15], rot: [0, ry, 0], outline: false,
                     pos: [sx * towerX + ox, towerH - .2, towerZ + oz], color: stone });
      // the spiral: wedge-overlapping treads around a stone newel. Phased so
      // the stair's entry slot faces the nave door (-z): you walk straight
      // from the door, down a short corridor, onto tread 0.
      const a0 = 4.71239 - spiralDA / 2;
      parts.push({ shape: "cyl", size: { r1: 1.0, r2: 1.0, h: towerH, seg: 10 }, pos: [sx * towerX, towerH / 2, towerZ], color: stone });
      const nSteps = Math.round(towerH / .25);
      for (let i = 0; i < nSteps; i++) {
        const a = a0 + i * spiralDA;
        parts.push({ shape: "box", size: [2.6, .29, 1.7], rot: [0, -a * 57.29578, 0], outline: false,
                     pos: [sx * towerX + Math.cos(a) * spiralR, i * .25 + .145, towerZ + Math.sin(a) * spiralR], color: stoneDark });
      }
      // enclosure wall around the stair's outer edge -- 14 chord segments
      // to the deck's underside; the segment over the entry starts 3m up
      for (let i = 0; i < 14; i++) {
        const a = a0 + (i + .5) * spiralDA;
        const entry = i === 0;
        const wh = (towerH - .4) - (entry ? 3 : 0);
        parts.push({ shape: "box", size: [1.9, wh, .3], rot: [0, -(a * 57.29578 + 90), 0], outline: false,
                     pos: [sx * towerX + Math.cos(a) * spiralOut, (entry ? 3 : 0) + wh / 2, towerZ + Math.sin(a) * spiralOut],
                     color: stone, pat: "ashlar" });
      }
      // the tower's own floor slab -- the portal slab only spans between
      // the towers, so without this the outer half showed bare ground
      parts.push({ shape: "box", size: [towerW, .25, towerW], pos: [sx * towerX, .125, towerZ], color: 0xd3cab6, pat: "checker", accent: 0x4c463e });
      // corridor from the nave door straight to the stair entry; its walls
      // seal off the dead ring space between the stair and the tower shell
      const corrL = towerW / 2 - TT - spiralOut + .4;
      for (const cx2 of [-1.15, 1.15])
        parts.push({ shape: "box", size: [.3, 3, corrL], pos: [sx * towerX + cx2, 1.5, towerZ - towerW / 2 + TT + corrL / 2], color: stone, pat: "ashlar" });
      lifts.push({ bx: sx * towerX, bz: towerZ - towerW / 2 + 2.6, by: .25,
                   tx: sx * towerX, tz: towerZ - (hole / 2 + strip / 2), ty: towerH });
      // open-air railing around the deck: 1m -- high enough to stop a fall,
      // low enough to see the whole world over it
      for (const [sw, sd, ox, oz] of [
        [towerW, .3, 0, towerW / 2 - .15], [towerW, .3, 0, -(towerW / 2 - .15)],
        [.3, towerW - .6, towerW / 2 - .15, 0], [.3, towerW - .6, -(towerW / 2 - .15), 0]])
        parts.push({ shape: "box", size: [sw, 1.0, sd], pos: [sx * towerX + ox, towerH + .5, towerZ + oz], color: stone });
      for (const [u, y, hw, hh] of [bWin, lWin])
        parts.push({ shape: "box", size: [hw, hh, .15], pos: [sx * towerX + u, y + hh / 2, L2 - TT - .12], color: glassC, glass: "stained" });
      parts.push({ shape: "box", size: [.15, towerH * .2, towerW * .32],
                   pos: [sx * (towerX + towerW / 2 - TT - .12), towerH * .61, towerZ], color: glassC, glass: "stained" });
      // outline: false -- the deck sits INSIDE the spire's base, and the
      // inverted-hull outline would wrap the viewer in darkness up there
      if (spireH) parts.push({ shape: "cyl", size: { r1: 0, r2: towerW * .52, h: spireH, seg: 4, open: true }, pos: [sx * towerX, towerH + spireH / 2, towerZ], rot: [0, 45, 0], color: stoneDark, outline: false });
      for (const [cx, cz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]])
        parts.push({ shape: "cyl", size: { r1: 0, r2: 1.5, h: 8, seg: 4, open: true }, pos: [sx * towerX + cx * (towerW / 2 - 1), towerH + 4, towerZ + cz * (towerW / 2 - 1)], rot: [0, 45, 0], color: stone });
    }
    // central bay with a REAL portal: a doorway tunnel between the towers
    const bayW = 2 * (towerX - towerW / 2);
    const doorW = Math.min(6, bayW * .55), doorH = 11, jambW = (bayW - doorW) / 2;
    for (const sx of [-1, 1])
      parts.push({ shape: "box", size: [jambW, naveH, towerW], pos: [sx * (doorW + jambW) / 2, naveH / 2, L2 - towerW / 2], color: stone });
    parts.push({ shape: "box", size: [doorW, naveH - doorH, towerW], pos: [0, doorH + (naveH - doorH) / 2, L2 - towerW / 2], color: stone });
    parts.push({ shape: "box", size: [Math.min(4.8, bayW * .45), 7.5, .6], pos: [0, doorH + 5, L2 + .3], color: glassC });                                // great window over the portal
    parts.push({ shape: "cyl", size: { r1: bayW * .38, r2: bayW * .38, h: .6, seg: 12 }, pos: [0, naveH * .68, L2 + .3], rot: [90, 0, 0], color: glassC });   // rose window
  } else {
    // full-width west wall with a real central doorway; side portals painted
    const doorW = Math.min(5, naveW * .4), doorH = 10, jambW = (bodyW - doorW) / 2;
    for (const sx of [-1, 1])
      parts.push({ shape: "box", size: [jambW, aisleH, T], pos: [sx * (doorW + jambW) / 2, aisleH / 2, L2 - T / 2], color: stone });
    parts.push({ shape: "box", size: [doorW, aisleH - doorH, T], pos: [0, doorH + (aisleH - doorH) / 2, L2 - T / 2], color: stone });
    parts.push({ shape: "box", size: [naveW, naveH - aisleH, T], pos: [0, (naveH + aisleH) / 2, L2 - T / 2], color: stone });
    for (const sx of [-1, 1])
      parts.push({ shape: "box", size: [5, 9, .8], pos: [sx * bodyW * .28, 4.5, L2 + .4], color: doorC });                                                 // side portal doors
    parts.push({ shape: "box", size: [naveW * .35, aisleH * .3, .6], pos: [0, aisleH * .66, L2 + .3], color: glassC });                                    // great west window
    for (const sx of [-1, 1]) {
      parts.push({ shape: "box", size: [4, aisleH * .27, .6], pos: [sx * bodyW * .28, aisleH * .56, L2 + .3], color: glassC });                            // over the side portals
      parts.push({ shape: "box", size: [3, aisleH * .22, .6], pos: [sx * bodyW * .14, aisleH * .5, L2 + .3], color: glassC });                             // inner aisle windows
    }
    parts.push({ shape: "cyl", size: { r1: naveW * .28, r2: naveW * .28, h: .6, seg: 12 }, pos: [0, naveH * .72, L2 + .3], rot: [90, 0, 0], color: glassC });   // rose window
    // six facade buttress piers, each crowned by a spire, stepping taller
    // toward the central gable -- the corners are just the outermost pair
    const cornerX = bodyW / 2 - 2.2;
    const xs = linspace(-cornerX, cornerX, 6);
    for (let i = 0; i < 6; i++) {
      const rank = Math.floor(Math.abs(i - 2.5));    // 0 innermost pair .. 2 corners
      const th = aisleH + 26 - rank * 5;
      const w = rank === 2 ? 4 : 2.6;
      parts.push({ shape: "box", size: [w, th, w], pos: [xs[i], th / 2, L2 - 1.2], color: stone });
      parts.push({ shape: "cyl", size: { r1: 0, r2: rank === 2 ? 2.4 : 1.6, h: rank === 2 ? 16 : 12, seg: 4 },
                   pos: [xs[i], th + (rank === 2 ? 8 : 6), L2 - 1.2], rot: [0, 45, 0], color: stone });
    }
  }

  // pinnacle forest along the aisle cornices (plus the facade corners)
  if (pinnacleEvery)
    for (let z = -L2 + 3; z <= L2 - 2; z += pinnacleEvery)
      for (const sx of [-1, 1])
        parts.push({ shape: "cyl", size: { r1: 0, r2: 1.3, h: 10, seg: 4 }, pos: [sx * (bodyW / 2 - .8), aisleH + 5, z], rot: [0, 45, 0], color: stone });

  // apse: polygonal east end + half-cone roof
  if (apse) {
    parts.push({ shape: "cyl", size: { r1: naveW / 2 + 1, r2: naveW / 2 + 1, h: naveH, seg: 8 }, pos: [0, naveH / 2, -L2], color: stone });
    parts.push({ shape: "cyl", size: { r1: 0, r2: naveW / 2 + 2, h: roofH, seg: 8 }, pos: [0, naveH, -L2], color: roofC, pat: "tiles" });
  }

  // fleche over the crossing
  if (fleche) {
    parts.push({ shape: "box", size: [5, 7, 5], pos: [0, ridgeH + 1, transeptZ], color: stoneDark });
    parts.push({ shape: "cyl", size: { r1: 0, r2: 3.4, h: flecheH, seg: 4 }, pos: [0, ridgeH + 4.5 + flecheH / 2, transeptZ], rot: [0, 45, 0], color: roofC });
  }

  // buttress rows along the nave flanks
  for (let z = -L2 + 6; z < L2 - towerW - 3; z += buttressEvery)
    for (const sx of [-1, 1])
      parts.push({ shape: "box", size: [1.4, aisleH + 6, 2.8], pos: [sx * (bodyW / 2 + .7), (aisleH + 6) / 2, z], color: stoneDark });

  // pews: two banks flanking the central aisle in the nave west of the
  // crossing, every row facing the altar; length follows the nave width
  const pewLen = (naveW - 3.4) / 2;
  const pz0 = (transeptW ? gapB : zA + 10) + 4;
  const pz1 = Math.min(pz0 + 38, zB - 8);
  for (let z = pz0; z < pz1; z += 2.3)
    for (const sx of [-1, 1])
      for (const p of furniture("pew", { len: pewLen }))
        parts.push({ ...p, pos: [sx * (pewLen / 2 + 1.1) + p.pos[0], .25 + p.pos[1], z + p.pos[2]] });

  // the high altar at the chancel entrance, just east of the crossing --
  // not deep in the apse, where long choirs would swallow it
  const altarZ = transeptW ? gapA - 6 : zA + 12;
  for (const p of furniture("altar"))
    parts.push({ ...p, pos: [p.pos[0], .25 + p.pos[1], altarZ + p.pos[2]] });

  // where people belong: scattered worshippers on the pews (facing the
  // altar) and a few clergy standing behind it, exported for the demo to
  // populate with static figures
  const folkSpots = [];
  let si = 0;
  for (let zz = pz0; zz < pz1; zz += 2.3)
    for (const sx of [-1, 1]) {
      si++;
      if (si % 3 === 0) continue;                        // some rows stay empty
      for (let k = 0, kn = 1 + (si % 2); k < kn; k++) {
        const u = (((si * 7 + k * 13) % 10) / 10 - .5) * (pewLen - .9);
        folkSpots.push({ x: sx * (pewLen / 2 + 1.1) + u, y: .25 + .505, z: zz - .02, h: Math.PI / 2, pose: "sit" });   // y = the pew seat top (on the .25 nave platform)
      }
    }
  for (const dx of [-1.6, .2, 1.7]) folkSpots.push({ x: dx, y: .25, z: altarZ - 2.4, h: -Math.PI / 2, pose: "stand" });

  // stone floor throughout (nave, transept, and the portal passage)
  // one continuous checkerboard: nave, the transept wings, and the portal
  // passage all share the same floor treatment
  parts.push({ shape: "box", size: [bodyW, .25, bodyL], pos: [0, .125, zc], color: 0xd3cab6, pat: "checker", accent: 0x4c463e });
  if (transeptW) parts.push({ shape: "box", size: [transeptW, .25, transeptD], pos: [0, .125, transeptZ], color: 0xd3cab6, pat: "checker", accent: 0x4c463e });
  if (towers) parts.push({ shape: "box", size: [2 * towerX, .25, towerW], pos: [0, .125, L2 - towerW / 2], color: 0xd3cab6, pat: "checker", accent: 0x4c463e });

  // walkable aisle-roof terraces (Milan's famous ones -- every cathedral
  // gets the floor levels), ringed by a parapet along the outer eaves
  const turret = !towers ? { x: bodyW / 2 + 3.3, z: zB - 4.5 } : null;
  for (const sx of [-1, 1]) {
    const segs = (turret && sx > 0) ? [[zA, turret.z - 2.3], [turret.z + 2.3, zB]] : [[zA, zB]];
    for (const [z0, z1] of segs)
      if (z1 - z0 > .5)
        parts.push({ shape: "box", size: [.3, 1.0, z1 - z0], pos: [sx * (bodyW / 2 - .15), aisleH + .5, (z0 + z1) / 2], color: stone });
  }
  if (turret) {
    // Milan's roof-access stair turret: the same enclosed spiral, standing
    // against the south-west flank, opening onto the outer terrace
    const topH = aisleH;
    parts.push({ shape: "cyl", size: { r1: 1.0, r2: 1.0, h: topH + 1.6, seg: 10 }, pos: [turret.x, (topH + 1.6) / 2, turret.z], color: stone });
    for (let i = 0, nS = Math.round(topH / .25); i < nS; i++) {
      const a = i * spiralDA;
      parts.push({ shape: "box", size: [2.6, .29, 1.7], rot: [0, -a * 57.29578, 0], outline: false,
                   pos: [turret.x + Math.cos(a) * spiralR, i * .25 + .145, turret.z + Math.sin(a) * spiralR], color: stoneDark });
    }
    for (let i = 0; i < 14; i++) {
      const a = (i + .5) * spiralDA;
      const entry = i === 0;                     // ground-level way in, from the churchyard
      const exitSide = Math.cos(a) < -.5;        // faces the church: open above the roof line
      const wh = (exitSide ? topH : topH + 1.6) - (entry ? 3 : 0);
      parts.push({ shape: "box", size: [1.9, wh, .3], rot: [0, -(a * 57.29578 + 90), 0], outline: false,
                   pos: [turret.x + Math.cos(a) * spiralOut, (entry ? 3 : 0) + wh / 2, turret.z + Math.sin(a) * spiralOut],
                   color: stone, pat: "ashlar" });
    }
    lifts.push({ bx: turret.x + 2.6, bz: turret.z, by: 0, tx: bodyW / 2 - 2.2, tz: turret.z, ty: aisleH });
  }

  const floorY = (x, z) => {
    if (turret) {
      const rx = x - turret.x, rz = z - turret.z;
      if (Math.hypot(rx, rz) < 3.6 && x > bodyW / 2 + .1) {   // inside the turret shaft
        const lv = [0];
        if (Math.hypot(rx, rz) < 1.05) lv.push(aisleH + 1.6);   // the turret newel's top
        if (Math.hypot(rx, rz) > .85) {
          let th = Math.atan2(rz, rx);
          if (th < 0) th += Math.PI * 2;
          for (let k = 0; ; k++) {
            const h = (th / (Math.PI * 2) + k) * 3.5;
            if (h > aisleH + .1) break;
            lv.push(Math.floor(h / .25) * .25 + .29);
          }
        }
        return lv;
      }
    }
    if (towers) for (const sx of [-1, 1]) {   // inside a tower: the spiral stair + the roof deck
      const rx = x - sx * towerX, rz = z - towerZ;
      // the zone spans the WHOLE tower plan, wall tops included -- the deck
      // level must exist over the wall band too, or its top face is a pit
      if (Math.abs(rx) >= towerW / 2 + .2 || Math.abs(rz) >= towerW / 2 + .2) continue;
      const lv = [.25];
      const rr = Math.hypot(rx, rz);
      if (rr > .85 && rr < 3.5) {   // on the spiral treads around the newel
        let th = Math.atan2(rz, rx) - (4.71239 - spiralDA / 2);   // same phase as the treads
        th = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const risePerTurn = Math.PI * 2 / spiralDA * .25;   // 3.5m
        for (let k = 0; ; k++) {
          const h = (th / (Math.PI * 2) + k) * risePerTurn;
          if (h > towerH + .1) break;
          lv.push(Math.floor(h / .25) * .25 + .29);
        }
      }
      if (Math.max(Math.abs(rx), Math.abs(rz)) > 3.45 ||
          Math.abs(rx) + Math.abs(rz) > 4.85) lv.push(towerH);   // deck + the triangular corner plates
      if (rr < 1.05) lv.push(towerH);   // the newel's flat top -- not a chute
      return lv;
    }
    if (Math.abs(x) <= 2.3 && Math.abs(z - altarZ) <= 1.7) return .61;   // the altar's predella
    if (Math.abs(x) <= bodyW / 2 && z >= zA && z <= L2) {
      const ax2 = Math.abs(x), lv = [.25];
      if (z <= zB && ax2 >= naveW / 2 + .5)   // the aisle-roof terraces overhead
        lv.push(aisles >= 5 && ax2 < x2 ? aisleH2 : aisleH);
      return lv;
    }
    if (transeptW && Math.abs(x) <= transeptW / 2 && z >= gapA && z <= gapB) return .25;
    return 0;
  };

  const facadeW = towers ? 2 * towerX + towerW : bodyW;
  // THE INTERIOR, FROM THE COMPONENT ENGINE. The massing above is the church seen from outside -- walls,
  // roofs, towers, spires, buttresses, the apse -- and it was also the church seen from INSIDE, which meant
  // square piers carrying nothing and a flat slab for a ceiling. The nave is composed now: an arcade of
  // arches on each side, a clerestory over it, a barrel vault over the nave and one over each aisle, all
  // from assets/architecture/basilica.json and all following the numbers this generator already has.
  //   Everything is derived, nothing is repeated: the bays are the buttress spacing (so a pier stands where
  // a buttress does), the nave vault springs low enough that its crown clears the old ceiling line, and the
  // aisle vault's extrados is the aisle's own roof line.
  // EVERY HEIGHT FOLLOWS FROM THE ONES THE CHURCH ALREADY HAS, and a vault's rise is not negotiable: a round
  // or pointed head over a span of naveW rises naveW / 2, so the nave's vault must spring that far below the
  // ceiling line it reaches. Where that leaves no room for a clerestory (Milan's aisles stand 30m up under a
  // 38m nave) the ARCADE gives way, not the vault -- the engine refuses a vault that would cut its own
  // arches, and rightly.
  const bays = Math.max(4, Math.round(bodyL / buttressEvery));
  const bayLen = bodyL / bays, pierT = T + .8, aisleT = T;
  const aisleW = Math.max(3, (bodyW - naveW - 2 * pierT - 2 * aisleT) / 2);
  // HOW FAR AN ARCH RISES IS THE PROFILE'S BUSINESS, not a guess: a round head rises half its span, a POINTED
  // one (which is what a Gothic church is) rises .87 of it, and a vault written for the round rise cuts
  // straight through its own crown when the profile changes. Ask the profile.
  //   A POINTED HEAD'S RISE IS ITS SPREAD. The two centres sit `spread` half-widths apart, and the crown then
  // stands (w/2) * sqrt(1 + 2 * spread) over the springing -- the equilateral arch (spread 1) at .87 of the
  // span, a drop arch lower. So an arch that has to fit a given height is not a compromise between profiles:
  // it is the spread that fits, and only where even a semicircle is too tall does the vault become a shallow
  // SEGMENTAL one (which is what a wide, low aisle is built with anyway).
  const riseOf = (w, spread) => (w / 2) * Math.sqrt(1 + 2 * spread);
  const spreadFor = (w, h) => ((2 * h / w) ** 2 - 1) / 2;
  const fit = (w, h) => Math.max(0, Math.min(1, spreadFor(w, h)));
  const clearH = Math.max(8, Math.min(naveH, ridgeH - 2) - riseOf(naveW, 1) - .8);
  const arcadeH = Math.max(6, Math.min(innerA, clearH - 2.5));
  const spring = Math.max(3.0, Math.min(innerA * .42, arcadeH * .5));
  const openW = Math.max(2.4, Math.min(bayLen - 2.6, naveW * .92));
  const arcSpread = fit(openW, arcadeH - spring - .6);
  const crown = spring + riseOf(openW, arcSpread);
  // the nave vault: from the clerestory's head to just under the roof
  const naveRoom = Math.min(naveH, ridgeH - 2) - clearH - .8;
  const naveFlat = spreadFor(naveW, naveRoom) < -1e-9;
  const naveSpread = fit(naveW, naveRoom);
  // the aisle vault: it springs at the arcade's crown (below it, it would cut the arches) and has the aisle's
  // own roof over it
  const aisleSpring = Math.max(crown, 2.6);
  const aisleRoom = Math.max(.8, aisleH - .5 - aisleSpring - .5);
  const aisleFlat = spreadFor(aisleW, aisleRoom) < -1e-9;
  const aisleSpread = fit(aisleW, aisleRoom);
  const aisleTop = aisleSpring + (aisleFlat ? Math.min(aisleRoom, aisleW * .49) : riseOf(aisleW, aisleSpread)) + .5;
  // the clerestory is whatever band is left between the arcade and the vault: where a church is steep and its
  // aisles high (Milan) that is a course of blind wall, and its windows shrink to fit or go
  const band = clearH - arcadeH, clearSill = Math.min(1.4, band * .2), clearSpring = clearSill + Math.min(1.2, band * .2);
  const clearWinW = Math.max(.6, Math.min(2.6, naveW * .2, (band - clearSpring - .5) / .87));
  const arch = {
    def: "basilica", color: stone, accent: stoneDark, pat: "gothic", side: "double",
    build: ["arcade", "clerestory", "nave vault", "nave ribs", "aisle vault", "aisle ribs"],
    params: {
      arch: "pointed", detail: 4, bays, bayLen, naveW, aisleW, pierT, aisleT, zc,
      openW, spring, gap: bayLen - openW, arcadeH, clearH, crown,
      arcSpread, naveSpread, aisleSpread,
      naveArch: naveFlat ? "segmental" : "pointed", naveRise: Math.min(naveRoom, naveW * .49),
      aisleArch: aisleFlat ? "segmental" : "pointed", aisleRise: Math.min(aisleRoom, aisleW * .49),
      // ...and the arch ALONG the bay, which is a different span and so a different arch: a groin vault's
      // crown is set by its longer one, and a bay is rarely square
      naveAlongArch: spreadFor(bayLen, naveRoom) < -1e-9 ? "segmental" : "pointed",
      naveAlongSpread: fit(bayLen, naveRoom), naveAlongRise: Math.min(naveRoom, bayLen * .49),
      aisleAlongArch: spreadFor(bayLen, aisleRoom) < -1e-9 ? "segmental" : "pointed",
      aisleAlongSpread: fit(bayLen, aisleRoom), aisleAlongRise: Math.min(aisleRoom, bayLen * .49),
      naveTop: clearH + (naveFlat ? Math.min(naveRoom, naveW * .49) : riseOf(naveW, naveSpread)) + .8,
      aisleSpring, aisleTop,
      clearWinW, clearSill, clearSpring, clearSpread: fit(clearWinW, clearH - arcadeH - clearSpring - .4),
      winW: 2.2, winSill: 4,
    },
  };
  return { name, parts, arch, footprint: [Math.max(bodyW, transeptW, facadeW), length], floorY, folkSpots, lifts, paintings: paintingsOut };
}

// (the Egyptian temple is an asset: dendera.json -- tools/archgen/dendera.py)

// (Caerphilly Castle is an asset: caerphilly.json -- tools/archgen/caerphilly.py; its moat and its lifts onto the tower
//  decks the definition's)

// ---- windmill ---------------------------------------------------------------
// A tapered stone tower mill under a conical cap. The rotating sail cross is
// NOT part of the static build: its hub position is exported as `sailAt` and
// the demo hangs a live, world-clock-driven cross there.

// (the windmill is an asset: windmill.json -- tools/archgen/windmill.py; its sail cross items/components/windmill-sails)

// (the goods -- barrels, kegs, sacks -- are items now: items/furniture/barrel, barrel-on-side, items/tools/sack, sack-standing)

// ---- water mill --------------------------------------------------------------
// An undershot water wheel, axis along z, centered on its axle: two felloe
// rims joined by radial paddle boards, spokes, hub, and the axle running
// back into the mill (with the pit wheel on it) -- the whole thing turns
// as one group, driven by the demo at flow speed / radius.
// the mill's water wheel is an asset now (items/components/water-wheel): its numbers -> the item's params
export const waterWheelParams = ({ r = 3.05, w = 1.2, axleBack = 5.2, axleFwd = .95 } = {}) => ({ r, w, axleBack, axleFwd, paddles: r > 2.6 ? 14 : 12 });

// (the water mill and the river landing are assets now: assets/architecture/village/watermill.json and landing.json,
//  tools/archgen/riverside.py -- the wheel's axle, the sacks' drop, the quay's slots, the hands' way and the barge's
//  berth their markers; built below in BUILD_FACTORIES)

// ---- the barge --------------------------------------------------------------
// A river barge, 11 x 3.5m: raked bow and stern, plank deck .6m above the
// water, gunwales, a stern cabin with the tiller, ten cargo places on
// deck, and a gangplank off the north side that lands on the stage when
// moored. Origin at the waterline amidships, forward = +x.
export function barge({ name = "Barge" } = {}) {
  // (the river barge is an asset now: items/ships/barge -- its hold's places and the plank's foot its markers)
  const b = itemOf({ path: "items/ships/barge" }), at = (role) => b.markers.filter((m) => m.role === role);
  return { name, item: "items/ships/barge", holdSlots: at("hold").sort((p, q) => p.data.i - q.data.i).map((m) => m.at.slice()),
           deckY: b.params.deckY, halfL: b.params.halfL, halfW: b.params.halfW, plankEnd: at("plank")[0].at.slice() };
}

// ---- furniture --------------------------------------------------------------
// Basic pieces as part lists, origin on the floor (the chandelier hangs from its origin instead) -- the old Gothic
// cathedral's pews and altar (gothicCathedral above); the palace's and the castle's table, chairs, sofa, beds,
// wardrobes and chandeliers are items now (items/furniture/plain-*, sofa, chandelier: tools/propgen.py)
export function furniture(kind, o = {}) {
  return furnitureParts(kind, o).map((p) => (p.color === 0x6b4a2c && !p.pat ? { ...p, pat: "wood" } : p));   // grain on every wooden piece
}
function furnitureParts(kind, o = {}) {
  const wood = 0x6b4a2c, cloth = 0x8e2f35, gold = 0xc9a13b, linen = 0xe8dfc9;
  switch (kind) {
    case "altar": return [              // stepped predella, mensa, cloth, candles, cross
      // `solid`: the mensa blocks walking like a wall (the low predella
      // steps stay walk-up-able -- they sit under the step-height band)
      { shape: "box", size: [4.6, .18, 3.4], pos: [0, .09, 0], color: 0xcfc8b8, pat: "marble" },
      { shape: "box", size: [3.6, .18, 2.6], pos: [0, .27, 0], color: 0xcfc8b8, pat: "marble" },
      { shape: "box", size: [2.4, .95, 1.15], pos: [0, .84, 0], color: 0xdfd8ca, pat: "marble", solid: true },
      { shape: "box", size: [2.6, .07, 1.3], pos: [0, 1.35, 0], color: 0xf0ead8 },
      { shape: "cyl", size: { r1: .05, r2: .07, h: .55, seg: 6 }, pos: [-.9, 1.66, -.35], color: gold },
      { shape: "cyl", size: { r1: .05, r2: .07, h: .55, seg: 6 }, pos: [.9, 1.66, -.35], color: gold },
      { shape: "box", size: [.07, .85, .07], pos: [0, 1.82, -.42], color: gold },
      { shape: "box", size: [.42, .07, .07], pos: [0, 2.02, -.42], color: gold },
    ];
    case "pew": {                       // church bench; o.len sets its width
      const L = o.len ?? 2.4;
      return [   // `solid`: benches block walking -- you go around, not through
        { shape: "box", size: [L, .07, .48], pos: [0, .47, 0], color: wood, solid: true, sit: true },
        { shape: "box", size: [L, .6, .08], pos: [0, .75, .26], color: wood, solid: true },
        { shape: "box", size: [L, .12, .4], pos: [0, .2, .02], color: wood, outline: false },
      ];
    }
    case "table": return [
      { shape: "box", size: [1.8, .08, .95], pos: [0, .75, 0], color: wood },
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) =>
        ({ shape: "box", size: [.09, .72, .09], pos: [a * .8, .36, b * .38], color: wood })),
    ];
    case "chair": return [
      { shape: "box", size: [.46, .07, .46], pos: [0, .46, 0], color: cloth, sit: true },
      { shape: "box", size: [.46, .55, .07], pos: [0, .77, -.2], color: wood },
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) =>
        ({ shape: "box", size: [.05, .44, .05], pos: [a * .19, .22, b * .19], color: wood })),
    ];
    case "wardrobe": return [
      { shape: "box", size: [1.6, 2.3, .65], pos: [0, 1.25, 0], color: wood },
      { shape: "box", size: [1.72, .14, .74], pos: [0, 2.46, 0], color: wood },
      { shape: "box", size: [.04, 1.9, .06], pos: [0, 1.2, .34], color: gold },
    ];
    case "bed": return [
      { shape: "box", size: [1.7, .35, 2.15], pos: [0, .3, 0], color: wood },
      { shape: "box", size: [1.6, .22, 2.05], pos: [0, .58, 0], color: linen, lie: true },
      { shape: "box", size: [1.7, 1.0, .09], pos: [0, .8, -1.05], color: wood },
      { shape: "box", size: [1.2, .16, .5], pos: [0, .74, -.7], color: 0xf2ece0 },
    ];
    case "sofa": return [
      { shape: "box", size: [2.1, .42, .85], pos: [0, .35, 0], color: cloth, sit: true },
      { shape: "box", size: [2.1, .55, .18], pos: [0, .82, -.33], color: cloth },
      { shape: "box", size: [.18, .38, .85], pos: [-.96, .73, 0], color: cloth },
      { shape: "box", size: [.18, .38, .85], pos: [.96, .73, 0], color: cloth },
    ];
    case "chandelier": return [
      { shape: "cyl", size: { r1: .035, r2: .035, h: 1.0, seg: 6 }, pos: [0, -.5, 0], color: gold },
      { shape: "cyl", size: { r1: .58, r2: .3, h: .28, seg: 10 }, pos: [0, -1.12, 0], color: gold },
      { shape: "cyl", size: { r1: .6, r2: .6, h: .07, seg: 10 }, pos: [0, -.96, 0], color: gold },
      { shape: "sphere", size: { r: .14 }, pos: [0, -1.35, 0], color: gold },
    ];
  }
  return [];
}

// (the baroque palace -- Versailles' plan of blocks, party walls, enfilades and the Hall of Mirrors -- is an asset:
//  versailles.json, tools/archgen/versailles.py)

// ---- the catalogue --------------------------------------------------------

// THE CATALOGUE, as FACTORIES: a building is built the first time something asks for it, not when the module
// loads -- the village places three of them, and the rest cost nothing.
const BUILD_FACTORIES = {
  // a village water mill (placed by the demo on the river bank, not in the facade row)
  watermill: () => archBuilding("village/watermill", { name: "Water mill" }),
  landing: () => archBuilding("village/landing", { name: "Landing" }),
  // the village's land and its riverside, each its own definition (assets/architecture/village): the fisherman's hut
  // with its jetty, the fountain on the square, the fields, the currant rows, the orchard -- town.js places them
  fisherHut: () => archBuilding("village/fisher-hut", { name: "Fisherman's hut" }),
  fountain: () => archBuilding("village/fountain", { name: "Fountain" }),
  ...Object.fromEntries([["ryeField", "rye"], ["barleyField", "barley"], ["cabbageField", "cabbage"], ["beanField", "beans"], ["garlicField", "garlic"], ["soilField", "soil"]]
    .map(([k, crop]) => [k, () => archBuilding("village/field-" + crop)])),
  berries: () => archBuilding("village/berries", { name: "Currant bushes" }),
  // the MINE, one of a world (index.html places it by the seed): silver, copper or salt -- one definition, the ore its word
  // and its finish (assets/finishes/mine-<ore>)
  ...Object.fromEntries(["silver", "copper", "salt"].map((ore) => ["mine" + ore[0].toUpperCase() + ore.slice(1),
    () => archBuilding("village/mine", { name: { silver: "Silver mine", copper: "Copper mine", salt: "Salt mine" }[ore], params: { ore }, finish: ASSETS.get("finishes/mine-" + ore) })])),
  orchard: () => archBuilding("village/orchard", { name: "Orchard" }),
  // Palace of Versailles, garden front and court (simplified plan, real
  // scale): 100m corps central flanked by 115m wings on a continuous ~330m
  // garden facade, court arms embracing the Cour Royale, three storeys
  // (ground, piano nobile, attic) to a balustraded flat roofline at ~18.5m.
  // The court opens toward +z; enter there or from the garden side.
  versailles: () => archBuilding("versailles", { name: "Palace of Versailles" }),   // (tools/archgen/versailles.py: the plan, its party walls, the Hall of Mirrors)
  // Temple of Hathor, Dendera (Ptolemaic, ~54 BC). Pronaos of six Hathor
  // columns behind screen walls, 24-column hypostyle in four rows, the lower
  // inner temple with its naos. ~81m long, facade ~34m wide, ~17m tall.
  dendera: () => archBuilding("dendera", { name: "Temple of Hathor, Dendera" }),
  // Khufu's, Khafre's and Menkaure's pyramids at a quarter size (tools/pyramidgen.py): a passage from each north face
  // to a burial chamber painted with tomb scenes (murals.js)
  giza: () => archBuilding("giza", { name: "The Pyramids of Giza" }),
  // Town houses in two sizes -- the village's own definitions (town.js builds the town of them), not landmarks.
  house: () => archBuilding("village/gable-house", { name: "Town House" }),
  bighouse: () => archBuilding("village/eaves-house", { name: "Merchant House", params: { W: 11, D: 10, n: 3, build: ["walls 0", "walls 1", "walls 2", "windows 0 front", "windows 0 back", "windows 1", "windows 2", "floor 0",
    "floor 1 beside", "floor 1 front", "floor 1 back", "floor 2 beside", "floor 2 front", "floor 2 back", "floor 2 col A", "flight 0", "flight 1",
    "way 1", "way 1 top", "way 2", "way 2 top", "roof", "chimney", "hearth", "table", "bed 1", "sleep 1", "bed 2", "sleep 2", "door"] } }),
  windmill: () => {   // (its sail cross turns at the hub the definition says: sx, sy, sz, sailR -- in the site's frame)
    const d = archBuilding("windmill", { name: "Windmill" }), P = archAssembly("windmill").params, [ox, oz] = d.arch.offset;
    return Object.assign(d, { sailAt: [P.sx + ox, P.sy, P.sz + oz], sailR: P.sailR });
  },
  caerphilly: () => archBuilding("caerphilly", { name: "Caerphilly Castle" }),
  didyma: () => archBuilding("didyma", { name: "Temple of Apollo, Didyma" }),
  // The amphitheatre: Verona's arena at its real size (138m across, two 11m storeys of arcade, forty rows of
  // seating from a 4m podium to 20m), built by the component engine from assets/architecture/arena.json -- every arch a
  // real opening with its vault, the cavea cut through by vomitoria and stairs.
  colosseum: () => amphitheatre({ name: "Arena" }),
  // Santa Maria del Fiore: the whole church from the component engine, dome and campanile and all
  florence: () => archBuilding("florence", { name: "Santa Maria del Fiore", params: { base: false } }),   // (the game lays it at the ground: no platform)
  // ---- FROM THE COMPONENT ENGINE: whole buildings defined in assets/architecture, walls, floors and all
  pantheon: () => archBuilding("pantheon", { name: "Pantheon" }),
  tajmahal: () => archBuilding("taj-mahal", { name: "Taj Mahal" }),
  // St Basil's: red brick with white trim, and no two onions alike -- each chapel's cap its own colours and pattern
  stbasil: () => archBuilding("st-basil", { name: "St Basil's Cathedral" }),
  frauenkirche: () => archBuilding("frauenkirche", { name: "Frauenkirche" }),
  zwinger: () => archBuilding("zwinger", { name: "Zwinger", moat: { hw: 115, hd: 56.5, w: 12, depth: 4.4 } }),
  // Hagia Sophia: rendered walls the colour of its ochre plaster, the domes in lead
  hagiasophia: () => archBuilding("hagia-sophia", { name: "Hagia Sophia" }),
  // Stift Melk: Melk yellow with white trim, red roofs, the church's caps and dome in green copper
  melk: () => archBuilding("melk", { name: "Stift Melk" }),
  // Schloss Schwerin on its island: sandstone and terracotta, slate roofs, the cupolas gilded; the lake round it
  schwerin: () => archBuilding("schwerin", { name: "Schloss Schwerin", moat: { hw: SCHWERIN_DOC._moat.hw, hd: SCHWERIN_DOC._moat.hd, w: SCHWERIN_DOC._moat.w, depth: 4.4 } }),
  // the Karlskirche: pale stone, the dome and the roofs in green copper
  karlskirche: () => archBuilding("karlskirche", { name: "Karlskirche" }),
  chichenitza: () => archBuilding("chichen-itza", { name: "Chichen Itza" }),
  // Sacre-Coeur: white travertine throughout, domes and all
  sacrecoeur: () => archBuilding("sacre-coeur", { name: "Sacre-Coeur" }),
  // the Stephansdom: weathered sandstone, the great roof in its yellow-and-green tiles, the spires in stone
  stephansdom: () => archBuilding("stephansdom", { name: "Stephansdom" }),
  // St Paul's: Portland stone, the dome and the roofs in lead, the ball and cross gilt
  stpauls: () => archBuilding("st-pauls", { name: "St Paul's Cathedral" }),
  // the Hungarian Parliament: white limestone, red roofs, the dome red between white ribs
  parliament: () => archBuilding("parliament", { name: "Hungarian Parliament" }),
  // the Berliner Dom: sandstone, the domes green copper, the cross gilt
  berlinerdom: () => archBuilding("berliner-dom", { name: "Berliner Dom" }),
  // Moritzburg on its island: ochre and white, red roofs, the lake round it
  // Mainz Cathedral: red sandstone, green copper roofs, the vaults limewashed
  mainz: () => archBuilding("mainz", { name: "Mainz Cathedral" }),
  // El Pilar, Zaragoza: brick, stone trim, the domes in coloured glazed tiles
  elpilar: () => archBuilding("el-pilar", { name: "El Pilar, Zaragoza" }),
  // the Sultan Qaboos Grand Mosque: pale sandstone and marble, the gilded dome
  sultanqaboos: () => archBuilding("sultan-qaboos", { name: "Sultan Qaboos Grand Mosque" }),
  // Ulm Minster: grey-white stone, slate roofs
  ulm: () => archBuilding("ulm", { name: "Ulm Minster" }),
  // the Blue Mosque: grey stone, lead domes, gilded finials
  bluemosque: () => archBuilding("blue-mosque", { name: "Blue Mosque" }),
  // the Temple of Heaven: white marble altar and balustrades, red lacquered columns and lattice, painted beams and brackets,
  // blue glazed tiles, the finial gilt; the court's walls red under green copings
  templeofheaven: () => archBuilding("temple-of-heaven", { name: "Temple of Heaven" }),
  // the Fisherman's Bastion: white limestone, dark tent caps
  fishermansbastion: () => archBuilding("fishermans-bastion", { name: "Fisherman's Bastion" }),
  moritzburg: () => archBuilding("moritzburg", { name: "Moritzburg Castle", moat: { hw: MORITZBURG_DOC._moat.hw, hd: MORITZBURG_DOC._moat.hd, w: MORITZBURG_DOC._moat.w, depth: 4.4 } }),
  // St Isaac's: grey marble, the portico columns red granite, the domes gilded
  stisaacs: () => archBuilding("st-isaacs", { name: "St Isaac's Cathedral" }),
};
// (the temples and two of the cathedrals were drawn in code; they are the component engine's definitions now)
Object.assign(BUILD_FACTORIES, {
  hephaestus: () => archBuilding("hephaestus", { name: "Temple of Hephaestus" }),
  parthenon: () => archBuilding("parthenon", { name: "Parthenon" }),
  notredame: () => archBuilding("notre-dame", { name: "Notre-Dame de Paris" }),
  cologne: () => archBuilding("cologne", { name: "Cologne Cathedral" }),
  milan: () => archBuilding("milan", { name: "Milan Cathedral" }),
});
export const BUILDINGS = {};
for (const [k, make] of Object.entries(BUILD_FACTORIES)) {
  let built;
  Object.defineProperty(BUILDINGS, k, { enumerable: true, configurable: true,
    get: () => (built ??= make()), set: (v) => { built = v; } });
}
// the DRESS of a landmark's people (clothes: the wardrobe's `styles`): its congregation wears it, and so does a share of
// the world's wanderers when the landmark stands (index.html)
export const DRESS = { hephaestus: "greek", parthenon: "greek", didyma: "greek", colosseum: "roman", pantheon: "roman", templeofheaven: "chinese",
                       giza: "egyptian", notredame: "gothic", cologne: "gothic", milan: "gothic", ulm: "gothic", stephansdom: "gothic", florence: "gothic", mainz: "gothic", caerphilly: "gothic" };
// THE VILLAGE'S LAND AND ITS RIVERSIDE: definitions in their own finishes, the same in every world -- pregen caches them
// as it does the landmarks (pregen.html), and the game asks for them (index.html loadPregen)
export const LAND = ["watermill", "windmill", "landing", "fisherHut", "fountain", "ryeField", "barleyField", "cabbageField", "beanField", "garlicField", "soilField", "berries", "orchard",
                     "mineSilver", "mineCopper", "mineSalt"];
export const LANDMARKS = ["florence", "dendera", "giza", "didyma", "milan", "notredame", "cologne", "hephaestus", "parthenon", "colosseum",
                          "versailles", "caerphilly", "pantheon", "tajmahal", "stbasil", "frauenkirche", "zwinger", "hagiasophia", "melk", "schwerin", "karlskirche", "chichenitza", "sacrecoeur", "stephansdom", "stpauls", "parliament", "stisaacs", "berlinerdom", "moritzburg", "fishermansbastion", "mainz", "elpilar", "sultanqaboos", "ulm", "bluemosque", "templeofheaven"];
