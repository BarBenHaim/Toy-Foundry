// src/lib/printability.ts
//
// Step 7: the printability check, and the automatic repair that runs
// before it.
//
// The order matters and is not obvious, so it is written out here:
//
//   1. WELD first. Image-to-3D output is a soup of unshared vertices.
//      Every check downstream — watertightness, shells, orientation —
//      reads as catastrophically broken on unwelded soup and as fine
//      after a weld, and the mesh is identical. Checking before welding
//      is the single easiest way to build a checker that always says no.
//   2. Repair what is mechanical (degenerate triangles, floating specks,
//      inside-out winding). These are provider artefacts, not design
//      problems, and a human looking at them would just fix them.
//   3. THEN scale, stand it up, and measure. Thickness in millimetres is
//      meaningless before the model is at its final size — the same mesh
//      is fine at 12cm and unprintable at 8cm.
//   4. Report. A `fail` means we do not send it to a printer. A `warn`
//      prints, with something worth knowing (supports, a wobble).
//
// The thickness check is a sampled estimate, not a proof. It casts rays
// inward from a stratified sample of the surface and reports the
// thinnest thing it hit. It will miss a thin feature it did not sample;
// it will not invent one. Everywhere that number is shown, it is
// labelled as an estimate.

import {
    Bounds,
    Mesh,
    boundsOf,
    centroidOf,
    compact,
    dropDegenerateTriangles,
    manifoldReport,
    orientConsistently,
    boundsOfTriangles,
    shells,
    shellTriangleGroups,
    signedVolume,
    sitOnPlate,
    surfaceArea,
    toPrintOrientation,
    triangleArea,
    triangleCount,
    triangleNormal,
    weldVertices,
} from './mesh/geometry'
import {
    FLOATER_VOLUME_SHARE,
    HEIGHT_RANGE_MM,
    MATERIAL,
    MAX_OVERHANG_SHARE,
    MIN_BASE_RATIO,
    MIN_WALL_MM,
    OVERHANG_ANGLE_DEG,
} from './printRules'
import type { PrintabilityCheck, PrintabilityReport } from './types'

export interface PrepareResult {
    mesh: Mesh
    report: PrintabilityReport
}

/** Weld → repair → stand up at `targetHeightMm` → measure.
 *
 *  `sourceUp` says which axis is up in the incoming mesh. GLB from every
 *  image-to-3D provider is Y-up; a mesh that has already been through
 *  here is Z-up. */
export function prepareForPrint(
    input: Mesh,
    targetHeightMm: number,
    options: { sourceUp?: 'y' | 'z' } = {},
): PrepareResult {
    const repairs: string[] = []

    const welded = weldVertices(input, 1e-4)
    if (welded.positions.length < input.positions.length) {
        const merged = (input.positions.length - welded.positions.length) / 3
        repairs.push(`welded ${merged.toLocaleString('en-US')} duplicate vertices`)
    }

    const { mesh: solid, removed } = dropDegenerateTriangles(welded)
    if (removed > 0) repairs.push(`removed ${removed} degenerate triangle${removed === 1 ? '' : 's'}`)

    const { mesh: bodied, shellCount, dropped } = dropFloatingShells(solid)
    if (dropped > 0) repairs.push(`deleted ${dropped} floating fragment${dropped === 1 ? '' : 's'}`)

    const { mesh: oriented, flipped } = orientConsistently(bodied)
    if (flipped > 0) repairs.push(`re-oriented ${flipped} inside-out triangle${flipped === 1 ? '' : 's'}`)

    const standing =
        options.sourceUp === 'z'
            ? sitOnPlate(scaleZTo(oriented, targetHeightMm))
            : toPrintOrientation(oriented, targetHeightMm)
    repairs.push(`scaled to ${targetHeightMm}mm tall and seated on the build plate`)

    const mesh = compact(standing)
    return { mesh, report: inspect(mesh, targetHeightMm, shellCount, repairs) }
}

function scaleZTo(mesh: Mesh, targetHeightMm: number): Mesh {
    const b = boundsOf(mesh)
    const factor = b.size[2] > 1e-9 ? targetHeightMm / b.size[2] : 1
    const positions = new Float64Array(mesh.positions.length)
    for (let i = 0; i < mesh.positions.length; i += 3) {
        positions[i] = (mesh.positions[i] - b.center[0]) * factor
        positions[i + 1] = (mesh.positions[i + 1] - b.center[1]) * factor
        positions[i + 2] = (mesh.positions[i + 2] - b.min[2]) * factor
    }
    return { positions, indices: Uint32Array.from(mesh.indices) }
}

/** Keep the main body; delete specks.
 *
 *  "Separate shell" and "separate part" are not the same thing, and
 *  conflating them was the first version of this function. A sculpt is
 *  routinely built from solids that OVERLAP — an eye sunk into a head,
 *  a horn rooted in a skull — and those are separate shells by vertex
 *  connectivity while being one object to any slicer, which unions
 *  overlapping solids as it slices. Deleting them because they were
 *  small would have quietly removed the eyes.
 *
 *  So shells are first grouped by overlap; a GROUP is a part. Only a
 *  group that touches nothing else and carries a negligible share of
 *  the volume gets deleted. */
function dropFloatingShells(mesh: Mesh): { mesh: Mesh; shellCount: number; dropped: number } {
    const parts = shells(mesh)
    if (parts.length <= 1) return { mesh, shellCount: parts.length, dropped: 0 }

    const groups = groupByOverlap(parts)
    const volumes = groups.map(group => group.reduce((sum, i) => sum + Math.abs(signedVolume(parts[i])), 0))
    const biggest = Math.max(...volumes)
    const keptGroups = groups.filter((_, i) => volumes[i] >= biggest * FLOATER_VOLUME_SHARE)
    const keptShells = keptGroups.flat().map(i => parts[i])
    const dropped = parts.length - keptShells.length

    return {
        mesh: dropped > 0 ? mergeMeshes(keptShells) : mesh,
        shellCount: keptGroups.length,
        dropped,
    }
}

/** Union-find over shells whose bounding boxes overlap.
 *
 *  Boxes, not exact geometry: a true solid-intersection test is a
 *  boolean operation, which is orders of magnitude more work and more
 *  code than this decision deserves. The failure mode is generous — two
 *  parts whose boxes overlap but whose surfaces do not (a horn passing
 *  through the hole of a ring) count as one part when they are two — and
 *  generous is the right direction: the alternative rejects a perfectly
 *  printable toy. */
export function groupByOverlap(parts: Mesh[], tolerance = 0.01): number[][] {
    const boxes = parts.map(boundsOf)
    const parent = parts.map((_, i) => i)
    const find = (x: number): number => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]]
            x = parent[x]
        }
        return x
    }
    for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
            if (!boxesOverlap(boxes[i], boxes[j], tolerance)) continue
            const a = find(i)
            const b = find(j)
            if (a !== b) parent[a] = b
        }
    }
    const groups = new Map<number, number[]>()
    for (let i = 0; i < parts.length; i++) {
        const root = find(i)
        const bucket = groups.get(root)
        if (bucket) bucket.push(i)
        else groups.set(root, [i])
    }
    return Array.from(groups.values())
}

function boxesOverlap(a: Bounds, b: Bounds, tolerance: number): boolean {
    for (let axis = 0; axis < 3; axis++) {
        if (a.min[axis] > b.max[axis] + tolerance) return false
        if (b.min[axis] > a.max[axis] + tolerance) return false
    }
    return true
}

export function mergeMeshes(parts: Mesh[]): Mesh {
    const totalVerts = parts.reduce((n, p) => n + p.positions.length, 0)
    const totalIdx = parts.reduce((n, p) => n + p.indices.length, 0)
    const positions = new Float64Array(totalVerts)
    const indices = new Uint32Array(totalIdx)
    let vAt = 0
    let iAt = 0
    for (const part of parts) {
        const base = vAt / 3
        positions.set(part.positions, vAt)
        for (let i = 0; i < part.indices.length; i++) indices[iAt + i] = part.indices[i] + base
        vAt += part.positions.length
        iAt += part.indices.length
    }
    return { positions, indices }
}

/** Measure a mesh that is already standing at final size. */
export function inspect(
    mesh: Mesh,
    targetHeightMm: number,
    shellCountBefore: number,
    repairs: string[] = [],
): PrintabilityReport {
    const b = boundsOf(mesh)
    const volumeMm3 = Math.abs(signedVolume(mesh))
    const tris = triangleCount(mesh)
    const checks: PrintabilityCheck[] = []

    // ── Is there a model at all ─────────────────────────────────────
    if (tris === 0) {
        return {
            ok: false,
            widthMm: 0,
            depthMm: 0,
            heightMm: 0,
            volumeCm3: 0,
            triangleCount: 0,
            shellCount: 0,
            checks: [{ id: 'empty', level: 'fail', message: 'The 3D model came back empty.' }],
            repairs,
        }
    }

    // ── Size ────────────────────────────────────────────────────────
    const heightMm = b.size[2]
    checks.push(
        Math.abs(heightMm - targetHeightMm) <= 0.5
            ? sizeCheck('pass', `Stands ${heightMm.toFixed(1)}mm tall, exactly the size ordered.`, heightMm)
            : sizeCheck('fail', `Height came out ${heightMm.toFixed(1)}mm instead of ${targetHeightMm}mm.`, heightMm),
    )

    // ── Watertight ──────────────────────────────────────────────────
    const manifold = manifoldReport(mesh)
    if (manifold.watertight) {
        checks.push({ id: 'watertight', level: 'pass', message: 'The surface is closed — no holes to fill.' })
    } else if (manifold.boundaryEdges > 0 && manifold.boundaryEdges <= tris * 0.02) {
        checks.push({
            id: 'watertight',
            level: 'warn',
            message: `${manifold.boundaryEdges} small holes in the surface. Slicers close gaps this size on their own.`,
            value: manifold.boundaryEdges,
        })
    } else {
        checks.push({
            id: 'watertight',
            level: 'fail',
            message: `The surface is open in ${manifold.boundaryEdges} places — a printer cannot tell inside from outside.`,
            value: manifold.boundaryEdges,
        })
    }

    // ── One part ────────────────────────────────────────────────────
    // Counted in groups, not shells: overlapping solids fuse in the
    // slicer, so an eye sunk into a head is one part, and a fragment
    // floating 3cm away is two.
    const partCount = groupByOverlap(shells(mesh)).length
    checks.push(
        partCount <= 1
            ? { id: 'single_part', level: 'pass', message: 'One connected piece — it prints as a single toy.' }
            : {
                  id: 'single_part',
                  level: 'fail',
                  message: `The model is ${partCount} separate pieces. A toy has to print as one.`,
                  value: partCount,
              },
    )

    // ── Thin parts ──────────────────────────────────────────────────
    const thickness = estimateMinThickness(mesh)
    if (thickness.samples === 0) {
        checks.push({
            id: 'wall_thickness',
            level: 'warn',
            message: 'Could not measure wall thickness on this model.',
        })
    } else if (thickness.minMm >= MIN_WALL_MM) {
        checks.push({
            id: 'wall_thickness',
            level: 'pass',
            // Phrased as a floor, not a measurement: rays are capped at
            // 3x the rule, so on a chunky toy this number IS the cap
            // rather than the true thickness of the torso.
            message: `No part thinner than about ${thickness.minMm.toFixed(1)}mm — thick enough to survive a child.`,
            value: round(thickness.minMm, 2),
            unit: 'mm',
        })
    } else if (thickness.thinShare <= 0.02) {
        checks.push({
            id: 'wall_thickness',
            level: 'warn',
            message: `A small area measures about ${thickness.minMm.toFixed(
                1,
            )}mm, under our ${MIN_WALL_MM}mm rule. It will print, but treat that spot gently.`,
            value: round(thickness.minMm, 2),
            unit: 'mm',
        })
    } else {
        checks.push({
            id: 'wall_thickness',
            level: 'fail',
            message: `Parts of the toy are only about ${thickness.minMm.toFixed(
                1,
            )}mm thick. Anything under ${MIN_WALL_MM}mm snaps.`,
            value: round(thickness.minMm, 2),
            unit: 'mm',
        })
    }

    // ── Stands up ───────────────────────────────────────────────────
    const stance = stability(mesh)
    const baseRatio = heightMm > 0 ? stance.baseMinSideMm / heightMm : 0
    if (!stance.centerOverBase) {
        checks.push({
            id: 'stability',
            level: 'fail',
            message: 'The toy is off balance — its weight falls outside its feet and it tips over.',
            value: round(baseRatio, 3),
        })
    } else if (baseRatio >= MIN_BASE_RATIO) {
        checks.push({
            id: 'stability',
            level: 'pass',
            message: 'Wide, planted stance — it stands on a shelf without help.',
            value: round(baseRatio, 3),
        })
    } else {
        checks.push({
            id: 'stability',
            level: 'warn',
            message: 'Narrow footing. It stands, but it will not survive a knock to the table.',
            value: round(baseRatio, 3),
        })
    }

    // ── Overhangs ───────────────────────────────────────────────────
    const overhang = overhangShare(mesh)
    checks.push(
        overhang <= MAX_OVERHANG_SHARE
            ? {
                  id: 'overhangs',
                  level: 'pass',
                  message: 'Little to no support material needed — the surface comes out clean.',
                  value: round(overhang, 3),
              }
            : {
                  id: 'overhangs',
                  level: 'warn',
                  message: `${Math.round(
                      overhang * 100,
                  )}% of the surface overhangs steeply. It prints with supports, which leave faint marks underneath.`,
                  value: round(overhang, 3),
              },
    )

    const ok = !checks.some(c => c.level === 'fail')
    return {
        ok,
        widthMm: round(b.size[0], 2),
        depthMm: round(b.size[1], 2),
        heightMm: round(heightMm, 2),
        volumeCm3: round(volumeMm3 / 1000, 2),
        triangleCount: tris,
        shellCount: Math.max(shellCountBefore, partCount),
        checks,
        repairs,
    }
}

function sizeCheck(level: 'pass' | 'fail', message: string, heightMm: number): PrintabilityCheck {
    return { id: 'size', level, message, value: round(heightMm, 2), unit: 'mm' }
}

/** Estimated grams of filament, and from that the material cost. Uses
 *  the infill factor from printRules: a printed toy is a shell plus a
 *  lattice, never a solid block. */
export function estimateFilamentGrams(volumeCm3: number): number {
    return round(volumeCm3 * MATERIAL.infillFactor * MATERIAL.densityGramsPerCm3, 1)
}

/** True when the height a parent picked is one this product supports. */
export function heightIsSupported(mm: number): boolean {
    return mm >= HEIGHT_RANGE_MM.min && mm <= HEIGHT_RANGE_MM.max
}

// ── Thickness by inward ray casting ─────────────────────────────────
//
// For a sample of triangles: step just inside the surface at the
// centroid, fire a ray along the inward normal, and take the distance to
// the first triangle hit. That distance is the local thickness. Rays are
// capped at 3x the rule — we do not care whether a thick torso is 20mm
// or 40mm, only whether anything is under 2mm — and the cap is what
// makes a grid of short segments fast enough to run in a request.

interface ThicknessResult {
    minMm: number
    thinShare: number
    samples: number
    /** Where the thinnest reading was taken, in model coordinates. The
     *  admin view marks it, because "somewhere on this toy is 1.4mm" is
     *  not something anyone can act on. */
    thinnestAt: [number, number, number] | null
}

export function estimateMinThickness(mesh: Mesh, thresholdMm = MIN_WALL_MM): ThicknessResult {
    const tris = triangleCount(mesh)
    if (tris === 0) return { minMm: 0, thinShare: 0, samples: 0, thinnestAt: null }

    const maxRay = thresholdMm * 3
    const grid = buildGrid(mesh, Math.max(maxRay, 1))
    const budget = clamp(Math.round(400000 / Math.max(tris, 1)) * 20, 60, 600)
    const step = Math.max(1, Math.floor(tris / budget))

    // Only the OUTER surface of the union counts.
    //
    // A sculpt made of overlapping solids has surfaces buried inside
    // other solids — the back of an eye inside a head, the root of a
    // horn inside a skull. Those surfaces do not exist in the printed
    // object; the slicer unions them away. Measuring from them reports
    // the eye's own diameter as a "1mm wall" and refuses a toy that is
    // solid all the way through, which is exactly the false alarm that
    // makes a printability checker something people switch off.
    //
    // So each sample is first tested for being buried, and skipped if it
    // is. On a single-solid model (a Meshy sculpt, the usual case) there
    // is nothing to bury and this costs one bounding-box comparison.
    const groups = shellTriangleGroups(mesh)
    const groupBounds = groups.map(g => boundsOfTriangles(mesh, g))
    let minMm = Infinity
    let thin = 0
    let samples = 0
    let thinnestAt: [number, number, number] | null = null
    // Start at a prime-ish offset so a regularly-structured mesh does not
    // get sampled along one seam.
    for (let t = 7 % Math.max(tris, 1); t < tris; t += step) {
        const normal = triangleNormal(mesh, t * 3)
        if (!normal) continue
        const c = centroidOf(mesh, t * 3)
        const eps = 0.01
        if (groups.length > 1) {
            const outward: [number, number, number] = [
                c[0] + normal[0] * eps,
                c[1] + normal[1] * eps,
                c[2] + normal[2] * eps,
            ]
            if (isBuried(mesh, groups, groupBounds, outward)) continue
        }
        const origin: [number, number, number] = [
            c[0] - normal[0] * eps,
            c[1] - normal[1] * eps,
            c[2] - normal[2] * eps,
        ]
        const dir: [number, number, number] = [-normal[0], -normal[1], -normal[2]]
        const hit = castRay(mesh, grid, origin, dir, maxRay, t)
        samples++
        if (hit === null) continue
        if (hit < minMm) {
            minMm = hit
            thinnestAt = [c[0], c[1], c[2]]
        }
        if (hit < thresholdMm) thin++
    }
    if (!isFinite(minMm)) return { minMm: maxRay, thinShare: 0, samples, thinnestAt: null }
    return { minMm, thinShare: samples > 0 ? thin / samples : 0, samples, thinnestAt }
}

/** Is this point inside another solid — i.e. is the surface it sits on
 *  hidden inside the union and therefore absent from the print?
 *
 *  Every component is tested, INCLUDING the one the sample came from,
 *  and that is not an oversight. A point pushed outward along its own
 *  surface normal is by definition outside its own solid, so testing it
 *  costs one parity check and returns false — but a "component" is only
 *  a vertex-connectivity group, and two primitives that happen to share
 *  a single vertex (a foot cylinder and its toe cap meeting at the
 *  centre of the sole, which is exactly what the stand-in sculptor
 *  builds) land in one component while remaining two solids. Skipping
 *  the sample's own component missed those, and the buried inside of a
 *  toe cap got reported as a 1.1mm wall. */
function isBuried(
    mesh: Mesh,
    groups: number[][],
    groupBounds: ReturnType<typeof boundsOfTriangles>[],
    point: [number, number, number],
): boolean {
    for (let g = 0; g < groups.length; g++) {
        const b = groupBounds[g]
        if (
            point[0] < b.min[0] ||
            point[0] > b.max[0] ||
            point[1] < b.min[1] ||
            point[1] > b.max[1] ||
            point[2] < b.min[2] ||
            point[2] > b.max[2]
        ) {
            continue
        }
        if (pointInsideGroup(mesh, groups[g], point)) return true
    }
    return false
}

/** Is `point` inside the solid material of this component?
 *
 *  Signed crossings, not odd/even. Odd/even is the textbook
 *  point-in-mesh test and it is wrong here for exactly the case this
 *  product produces: a point inside TWO overlapping solids crosses two
 *  surfaces on its way out, counts two, and reports itself as outside.
 *  Counting each crossing as +1 when the ray leaves material and -1 when
 *  it enters gives the containment depth instead, which is > 0 for a
 *  point inside any number of overlapping solids and 0 outside all of
 *  them. Same rule a slicer uses to union bodies.
 *
 *  The probe direction is deliberately not axis-aligned: on the
 *  axis-aligned geometry this product is full of (boxes, cylinder caps)
 *  an axis ray lands exactly on shared edges and counts them twice. */
const PROBE_DIR: [number, number, number] = [0.5773502691896258, 0.3313565, 0.7448192]

export function pointInsideGroup(mesh: Mesh, tris: number[], point: [number, number, number]): boolean {
    let depth = 0
    for (const t of tris) {
        const d = intersectTriangle(mesh, t, point, PROBE_DIR)
        if (d === null || d <= 1e-9) continue
        const n = triangleNormal(mesh, t * 3)
        if (!n) continue
        const facing = PROBE_DIR[0] * n[0] + PROBE_DIR[1] * n[1] + PROBE_DIR[2] * n[2]
        if (Math.abs(facing) < 1e-9) continue
        depth += facing > 0 ? 1 : -1
    }
    return depth > 0
}

interface Grid {
    cell: number
    min: [number, number, number]
    dims: [number, number, number]
    buckets: Map<number, number[]>
}

function buildGrid(mesh: Mesh, cell: number): Grid {
    const b = boundsOf(mesh)
    const dims: [number, number, number] = [
        Math.max(1, Math.ceil(b.size[0] / cell)),
        Math.max(1, Math.ceil(b.size[1] / cell)),
        Math.max(1, Math.ceil(b.size[2] / cell)),
    ]
    const buckets = new Map<number, number[]>()
    const tris = triangleCount(mesh)
    for (let t = 0; t < tris; t++) {
        const lo: [number, number, number] = [Infinity, Infinity, Infinity]
        const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
        for (let c = 0; c < 3; c++) {
            const v = mesh.indices[t * 3 + c] * 3
            for (let a = 0; a < 3; a++) {
                const p = mesh.positions[v + a]
                if (p < lo[a]) lo[a] = p
                if (p > hi[a]) hi[a] = p
            }
        }
        forEachCell(b.min, dims, cell, lo, hi, key => {
            const bucket = buckets.get(key)
            if (bucket) bucket.push(t)
            else buckets.set(key, [t])
        })
    }
    return { cell, min: b.min, dims, buckets }
}

function forEachCell(
    origin: [number, number, number],
    dims: [number, number, number],
    cell: number,
    lo: [number, number, number],
    hi: [number, number, number],
    fn: (key: number) => void,
) {
    const i0 = clampInt(Math.floor((lo[0] - origin[0]) / cell), 0, dims[0] - 1)
    const i1 = clampInt(Math.floor((hi[0] - origin[0]) / cell), 0, dims[0] - 1)
    const j0 = clampInt(Math.floor((lo[1] - origin[1]) / cell), 0, dims[1] - 1)
    const j1 = clampInt(Math.floor((hi[1] - origin[1]) / cell), 0, dims[1] - 1)
    const k0 = clampInt(Math.floor((lo[2] - origin[2]) / cell), 0, dims[2] - 1)
    const k1 = clampInt(Math.floor((hi[2] - origin[2]) / cell), 0, dims[2] - 1)
    for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
            for (let k = k0; k <= k1; k++) fn((i * dims[1] + j) * dims[2] + k)
        }
    }
}

function castRay(
    mesh: Mesh,
    grid: Grid,
    origin: [number, number, number],
    dir: [number, number, number],
    maxDistance: number,
    skipTriangle: number,
): number | null {
    // The ray is short by construction, so instead of walking the grid
    // cell by cell we take every cell the whole segment's box touches.
    // For a 6mm segment on a 100mm toy that is a handful of cells.
    const end: [number, number, number] = [
        origin[0] + dir[0] * maxDistance,
        origin[1] + dir[1] * maxDistance,
        origin[2] + dir[2] * maxDistance,
    ]
    const lo: [number, number, number] = [
        Math.min(origin[0], end[0]),
        Math.min(origin[1], end[1]),
        Math.min(origin[2], end[2]),
    ]
    const hi: [number, number, number] = [
        Math.max(origin[0], end[0]),
        Math.max(origin[1], end[1]),
        Math.max(origin[2], end[2]),
    ]
    const candidates = new Set<number>()
    forEachCell(grid.min, grid.dims, grid.cell, lo, hi, key => {
        const bucket = grid.buckets.get(key)
        if (bucket) for (const t of bucket) candidates.add(t)
    })

    // Every hit along the ray, not just the first — and each one labelled
    // as entering or leaving a solid.
    //
    // The reason is unions. A sculpt is built from solids that overlap:
    // an eye sunk into a head, a horn rooted in a skull. The first
    // surface a ray meets inside the head is the BACK of the eye, and
    // stopping there would report the toy as 1mm thick and refuse to
    // print a perfectly solid model. Instead we track depth — +1 on
    // entering a solid, -1 on leaving — and the thickness is the
    // distance at which depth first returns to zero, i.e. where the ray
    // actually leaves the material. This is the same nonzero rule a
    // slicer applies when it unions overlapping bodies.
    const hits: { distance: number; entering: boolean }[] = []
    for (const t of candidates) {
        if (t === skipTriangle) continue
        const d = intersectTriangle(mesh, t, origin, dir)
        if (d === null || d <= 1e-4 || d > maxDistance) continue
        const n = triangleNormal(mesh, t * 3)
        if (!n) continue
        const facing = dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]
        if (Math.abs(facing) < 1e-9) continue
        hits.push({ distance: d, entering: facing < 0 })
    }
    if (hits.length === 0) return null
    hits.sort((a, b) => a.distance - b.distance)

    let depth = 1 // the ray starts just inside the surface it left
    for (const hit of hits) {
        depth += hit.entering ? 1 : -1
        if (depth <= 0) return hit.distance
    }
    return null
}

/** Möller–Trumbore, two-sided (we cross the surface from the inside). */
function intersectTriangle(
    mesh: Mesh,
    t: number,
    origin: [number, number, number],
    dir: [number, number, number],
): number | null {
    const p = mesh.positions
    const a = mesh.indices[t * 3] * 3
    const b = mesh.indices[t * 3 + 1] * 3
    const c = mesh.indices[t * 3 + 2] * 3
    const e1x = p[b] - p[a]
    const e1y = p[b + 1] - p[a + 1]
    const e1z = p[b + 2] - p[a + 2]
    const e2x = p[c] - p[a]
    const e2y = p[c + 1] - p[a + 1]
    const e2z = p[c + 2] - p[a + 2]
    const hx = dir[1] * e2z - dir[2] * e2y
    const hy = dir[2] * e2x - dir[0] * e2z
    const hz = dir[0] * e2y - dir[1] * e2x
    const det = e1x * hx + e1y * hy + e1z * hz
    if (Math.abs(det) < 1e-12) return null
    const inv = 1 / det
    const sx = origin[0] - p[a]
    const sy = origin[1] - p[a + 1]
    const sz = origin[2] - p[a + 2]
    const u = (sx * hx + sy * hy + sz * hz) * inv
    if (u < -1e-9 || u > 1 + 1e-9) return null
    const qx = sy * e1z - sz * e1y
    const qy = sz * e1x - sx * e1z
    const qz = sx * e1y - sy * e1x
    const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv
    if (v < -1e-9 || u + v > 1 + 1e-9) return null
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv
    return d > 0 ? d : null
}

// ── Standing up ─────────────────────────────────────────────────────

interface Stability {
    baseMinSideMm: number
    centerOverBase: boolean
}

/** Look at the bottom 2mm of the model — that is what touches the plate
 *  — and ask two questions: how wide is that footprint, and does the
 *  centre of mass fall inside it. */
export function stability(mesh: Mesh): Stability {
    const b = boundsOf(mesh)
    const sliceTop = b.min[2] + Math.max(2, b.size[2] * 0.02)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let found = false
    for (let i = 0; i < mesh.positions.length; i += 3) {
        if (mesh.positions[i + 2] > sliceTop) continue
        found = true
        const x = mesh.positions[i]
        const y = mesh.positions[i + 1]
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }
    if (!found) return { baseMinSideMm: 0, centerOverBase: false }

    const com = centerOfMass(mesh)
    // A 10% margin: dead on the edge of the footprint is not standing,
    // it is balancing.
    const marginX = (maxX - minX) * 0.1
    const marginY = (maxY - minY) * 0.1
    const centerOverBase =
        com[0] >= minX - marginX && com[0] <= maxX + marginX && com[1] >= minY - marginY && com[1] <= maxY + marginY

    return { baseMinSideMm: Math.min(maxX - minX, maxY - minY), centerOverBase }
}

/** Volume centroid via the same tetrahedron decomposition as the volume
 *  itself. Assumes uniform density, which for a uniformly-infilled print
 *  is close enough to true. */
export function centerOfMass(mesh: Mesh): [number, number, number] {
    let vol = 0
    let cx = 0
    let cy = 0
    let cz = 0
    const p = mesh.positions
    for (let t = 0; t < mesh.indices.length; t += 3) {
        const a = mesh.indices[t] * 3
        const b = mesh.indices[t + 1] * 3
        const c = mesh.indices[t + 2] * 3
        const v =
            (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
                p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
                p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
            6
        vol += v
        cx += ((p[a] + p[b] + p[c]) / 4) * v
        cy += ((p[a + 1] + p[b + 1] + p[c + 1]) / 4) * v
        cz += ((p[a + 2] + p[b + 2] + p[c + 2]) / 4) * v
    }
    if (Math.abs(vol) < 1e-12) {
        const b = boundsOf(mesh)
        return b.center
    }
    return [cx / vol, cy / vol, cz / vol]
}

/** Share of surface area facing downward more steeply than the overhang
 *  angle. The build plate itself (the flat underside) is excluded — it
 *  is not an overhang, it is the base. */
export function overhangShare(mesh: Mesh): number {
    const b = boundsOf(mesh)
    const plateZ = b.min[2] + 0.5
    const limit = -Math.cos((OVERHANG_ANGLE_DEG * Math.PI) / 180)
    let overhang = 0
    const total = surfaceArea(mesh)
    if (total <= 0) return 0
    for (let t = 0; t < mesh.indices.length; t += 3) {
        const n = triangleNormal(mesh, t)
        if (!n) continue
        if (n[2] > limit) continue
        const c = centroidOf(mesh, t)
        if (c[2] <= plateZ) continue
        overhang += triangleArea(mesh, t)
    }
    return overhang / total
}

function round(n: number, digits: number): number {
    const f = Math.pow(10, digits)
    return Math.round(n * f) / f
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n))
}

function clampInt(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, Math.trunc(n)))
}
