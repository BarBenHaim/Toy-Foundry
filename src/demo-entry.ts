// Browser entry for the hosted demo: the real engine, minus anything
// that needs a server. Bundled with esbuild and inlined into the demo
// page, so the 3D toy a visitor turns around is built by exactly the
// code that builds the printed one — and the character it is built from
// is read out of their drawing by the same system prompt and the same
// normaliser the API route uses.
export { normalizeDna, identityAnchors, isConfident, CONFIDENCE_FLOOR } from './lib/characterDna'
export { buildStandInToy } from './lib/mesh/standIn'
export { prepareForPrint, estimateFilamentGrams } from './lib/printability'
export { writeBinaryStl } from './lib/mesh/stl'
export { boundsOf, triangleCount } from './lib/mesh/geometry'
export { buildToyPrompt, describeRevision, DNA_SYSTEM_PROMPT, MAX_REVISIONS } from './lib/toyBrief'
export { SIZES, formatMinor, SHIPPING_MINOR, estimateCost } from './lib/pricing'
export { STATUS_FLOW, statusMeta, currentStatus, applyTransition, canTransition } from './lib/orderStatus'
export { newId } from './lib/ids'
export { DESIGN_FOR_PRINT_RULES, MIN_WALL_MM, HEIGHT_RANGE_MM, MATERIAL } from './lib/printRules'
