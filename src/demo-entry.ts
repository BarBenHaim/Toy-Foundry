// Browser entry for the hosted demo: the real engine, minus anything
// that needs a server. Bundled with esbuild and inlined into the demo
// page, so the 3D toy a visitor turns around is built by exactly the
// code that builds the printed one.
export { normalizeDna, identityAnchors } from './lib/characterDna'
export { buildStandInToy } from './lib/mesh/standIn'
export { prepareForPrint, estimateFilamentGrams } from './lib/printability'
export { writeBinaryStl } from './lib/mesh/stl'
export { boundsOf, triangleCount } from './lib/mesh/geometry'
export { buildToyPrompt, describeRevision, MAX_REVISIONS } from './lib/toyBrief'
export { SIZES, formatMinor, SHIPPING_MINOR } from './lib/pricing'
export { STATUS_FLOW } from './lib/orderStatus'
export { DESIGN_FOR_PRINT_RULES, MIN_WALL_MM, HEIGHT_RANGE_MM, MATERIAL } from './lib/printRules'
