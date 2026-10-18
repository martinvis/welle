// The village's LAND and its odd works -- what a town needs beyond its buildings -- are all definitions now: the bridge,
// the yards, the market, the apiary (tools/archgen/village.py), the fountain, the fields, the currant rows and the
// orchard (village.py fountain, fields), the fisherman's hut, the water mill and the landing (tools/archgen/riverside.py),
// under assets/architecture/village; the fisherman's boat, its oars, the pole and the line are items (tools/propgen.py).
// architecture.js BUILD_FACTORIES builds them, town.js and the demo place them. What is left here is a number the map
// needs before any of that is loaded.

// ---- the stone bridge is an asset (assets/architecture/village/bridge, tools/archgen/village.py bridge): index.html
// gives it the river's numbers. A pier may stand in no more than MAX_PIER_DEPTH of water: mapgen.js keeps the bridge's
// site within it.
export const MAX_PIER_DEPTH = 4.5;
