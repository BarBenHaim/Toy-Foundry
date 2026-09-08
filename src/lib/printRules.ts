// src/lib/printRules.ts
//
// The physical rules of the product, in one place, because they are
// stated twice and must not drift: once in English to the image model
// ("design it so it can be printed") and once in millimetres to the
// printability checker ("did it actually come out that way").
//
// A toy that fails the checker is a toy the image model was asked for
// badly. When a rule changes, it changes for both.

/** Standing height range the whole product is designed around. Below
 *  ~70mm the face details vanish at a 0.2mm layer height; above ~130mm
 *  the print time and the filament cost stop supporting the price. */
export const HEIGHT_RANGE_MM = { min: 80, max: 120 } as const

/** Anything thinner than this is a snap risk in a child's hands, and
 *  below ~1.2mm an FDM nozzle cannot lay down two walls plus infill at
 *  all. 2mm is the number quoted to the model and enforced here. */
export const MIN_WALL_MM = 2

/** Wide-set, planted feet. Measured as the footprint's smaller side
 *  against total height: a toy whose base is under a fifth of its height
 *  falls over on a table. */
export const MIN_BASE_RATIO = 0.2

/** Overhang steeper than 45° needs support material, which on a
 *  single-part toy means visible scarring where it is removed. A little
 *  is unavoidable (under a chin, beneath a wing); a lot means the model
 *  was designed as art, not as a print. */
export const MAX_OVERHANG_SHARE = 0.25
export const OVERHANG_ANGLE_DEG = 45

/** One object, one print. Small detached specks are deleted by the
 *  repair pass; anything above this share of the main body's volume is a
 *  real second part and the model gets rejected instead. */
export const FLOATER_VOLUME_SHARE = 0.02

/** PLA. Density in g/cm³, and the share of the model's volume actually
 *  extruded once the walls-and-infill scheme is applied. 20% infill on a
 *  chunky toy with three perimeters lands near 0.35 of solid volume;
 *  it is an estimate used for pricing, not a slicer result. */
export const MATERIAL = {
    name: 'PLA',
    densityGramsPerCm3: 1.24,
    infillFactor: 0.35,
} as const

/** The sentences handed to the image model. Kept as prose, not as a
 *  list of numbers, because that is what image models act on — but every
 *  line here maps to a check in printability.ts. */
export const DESIGN_FOR_PRINT_RULES = [
    'chunky, solid, stylised proportions — thick limbs, thick neck, no wire-thin parts',
    'the character stands upright on its own two feet (or on a small integrated base) with a wide, planted stance',
    'one single connected object: no floating pieces, no separately hanging accessories',
    'ears, horns, wings, tails and spikes are thick, short and tucked toward the body rather than long and spindly',
    'no thin gaps between the arms and the body, and no deep undercuts under the chin or the belly',
    'a flat, stable underside where the feet or the base meet the ground',
    'details are bold and carved rather than fine and engraved, readable at 10 centimetres tall',
] as const
