// src/lib/mesh/geometry.ts
//
// Triangle-soup surgery. No three.js here on purpose: this code runs
// inside a serverless function on the way to the printer, where the
// browser-shaped half of three.js is dead weight and where being able to
// unit-test a cube in 40ms matters more than convenience.
//
// The representation is deliberately dumb — a flat Float64Array of
// vertex positions plus a Uint32Array of triangle indices, exactly what
// STL and 3MF both want. Everything below is a pure function over that
// pair, so the whole repair pipeline is testable with meshes you can
// write out by hand.
//
// Coordinate conventions, which have bitten every project that skipped
// writing them down:
//   • glTF/GLB is Y-up, metres.
//   • STL/3MF for FDM printing is Z-up, millimetres, sitting on Z=0.
// `toPrintOrientation` is the one place that conversion happens.

export interface Mesh {
    /** xyz triples, length = 3 * vertexCount */
    positions: Float64Array
    /** vertex indices, length = 3 * triangleCount */
    indices: Uint32Array
}

export interface Bounds {
    min: [number, number, number]
    max: [number, number, number]
    size: [number, number, number]
    center: [number, number, number]
}

export function triangleCount(mesh: Mesh): number {
    return Math.floor(mesh.indices.length / 3)
}

export function vertexCount(mesh: Mesh): number {
    return Math.floor(mesh.positions.length / 3)
}

export function emptyMesh(): Mesh {
    return { positions: new Float64Array(0), indices: new Uint32Array(0) }
}

/** Build a mesh from plain arrays. Used by tests and by the GLB reader. */
export function meshFrom(positions: ArrayLike<number>, indices: ArrayLike<number>): Mesh {
    return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) }
}

export function boundsOf(mesh: Mesh): Bounds {
    if (mesh.positions.length === 0) {
        return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] }
    }
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < mesh.positions.length; i += 3) {
        for (let a = 0; a < 3; a++) {
            const v = mesh.positions[i + a]
            if (v < min[a]) min[a] = v
            if (v > max[a]) max[a] = v
        }
    }
    const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    const center: [number, number, number] = [
        (max[0] + min[0]) / 2,
        (max[1] + min[1]) / 2,
        (max[2] + min[2]) / 2,
    ]
    return { min, max, size, center }
}

/** Signed volume via the tetrahedron sum. Positive for a closed mesh with
 *  outward-facing triangles; the sign is therefore also our winding test.
 *  Units follow the mesh, so call it after scaling to millimetres. */
export function signedVolume(mesh: Mesh): number {
    let total = 0
    const p = mesh.positions
    for (let t = 0; t < mesh.indices.length; t += 3) {
        const a = mesh.indices[t] * 3
        const b = mesh.indices[t + 1] * 3
        const c = mesh.indices[t + 2] * 3
        total +=
            (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
                p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
                p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
            6
    }
    return total
}

export function surfaceArea(mesh: Mesh): number {
    let total = 0
    for (let t = 0; t < mesh.indices.length; t += 3) {
        total += triangleArea(mesh, t)
    }
    return total
}

export function triangleArea(mesh: Mesh, t: number): number {
    const p = mesh.positions
    const a = mesh.indices[t] * 3
    const b = mesh.indices[t + 1] * 3
    const c = mesh.indices[t + 2] * 3
    const ux = p[b] - p[a]
    const uy = p[b + 1] - p[a + 1]
    const uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a]
    const vy = p[c + 1] - p[a + 1]
    const vz = p[c + 2] - p[a + 2]
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2
}

/** Unit normal of triangle t, or null when the triangle is degenerate. */
export function triangleNormal(mesh: Mesh, t: number): [number, number, number] | null {
    const p = mesh.positions
    const a = mesh.indices[t] * 3
    const b = mesh.indices[t + 1] * 3
    const c = mesh.indices[t + 2] * 3
    const ux = p[b] - p[a]
    const uy = p[b + 1] - p[a + 1]
    const uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a]
    const vy = p[c + 1] - p[a + 1]
    const vz = p[c + 2] - p[a + 2]
    let cx = uy * vz - uz * vy
    let cy = uz * vx - ux * vz
    let cz = ux * vy - uy * vx
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz)
    if (!(len > 1e-12)) return null
    cx /= len
    cy /= len
    cz /= len
    return [cx, cy, cz]
}

export function centroidOf(mesh: Mesh, t: number): [number, number, number] {
    const p = mesh.positions
    const a = mesh.indices[t] * 3
    const b = mesh.indices[t + 1] * 3
    const c = mesh.indices[t + 2] * 3
    return [
        (p[a] + p[b] + p[c]) / 3,
        (p[a + 1] + p[b + 1] + p[c + 1]) / 3,
        (p[a + 2] + p[b + 2] + p[c + 2]) / 3,
    ]
}

/** Merge vertices that land in the same cube of side `epsilon`.
 *
 *  Image-to-3D output is almost always a soup of unshared vertices: the
 *  surface LOOKS closed and every single edge is a boundary edge, so a
 *  watertightness check on the raw mesh is meaningless. Welding first is
 *  what makes the manifold check say anything true. */
export function weldVertices(mesh: Mesh, epsilon = 1e-4): Mesh {
    const n = vertexCount(mesh)
    if (n === 0) return emptyMesh()
    const inv = 1 / Math.max(epsilon, 1e-9)
    const map = new Map<string, number>()
    const remap = new Uint32Array(n)
    const out: number[] = []
    for (let i = 0; i < n; i++) {
        const x = mesh.positions[i * 3]
        const y = mesh.positions[i * 3 + 1]
        const z = mesh.positions[i * 3 + 2]
        const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`
        const hit = map.get(key)
        if (hit === undefined) {
            const id = out.length / 3
            map.set(key, id)
            out.push(x, y, z)
            remap[i] = id
        } else {
            remap[i] = hit
        }
    }
    const indices = new Uint32Array(mesh.indices.length)
    for (let i = 0; i < mesh.indices.length; i++) indices[i] = remap[mesh.indices[i]]
    return { positions: Float64Array.from(out), indices }
}

/** Drop triangles with zero area or a repeated vertex.
 *
 *  Welding creates these — three corners of a sliver collapse onto two
 *  points — and a slicer treats them as a hole. */
export function dropDegenerateTriangles(mesh: Mesh, minArea = 1e-10): { mesh: Mesh; removed: number } {
    const keep: number[] = []
    let removed = 0
    for (let t = 0; t < mesh.indices.length; t += 3) {
        const a = mesh.indices[t]
        const b = mesh.indices[t + 1]
        const c = mesh.indices[t + 2]
        if (a === b || b === c || a === c || triangleArea(mesh, t) <= minArea) {
            removed++
            continue
        }
        keep.push(a, b, c)
    }
    return { mesh: { positions: mesh.positions, indices: Uint32Array.from(keep) }, removed }
}

/** Vertex-cluster decimation: snap vertices onto a grid, weld, drop
 *  what collapsed. Crude next to quadric simplification and perfectly
 *  adequate for its one job — the model the BROWSER sees.
 *
 *  The print file is the product. Streaming it to a viewer hands the
 *  thing being sold to anyone who opens the network tab, so the 3D
 *  preview is served from a version with the detail taken out: enough to
 *  turn around and recognise, not enough to print and be happy with.
 *  `cells` is roughly how many grid steps the model's longest side is
 *  divided into. */
export function clusterDecimate(mesh: Mesh, cells = 64): Mesh {
    const b = boundsOf(mesh)
    const longest = Math.max(b.size[0], b.size[1], b.size[2])
    if (!(longest > 0)) return mesh
    const cell = longest / Math.max(8, cells)
    const snapped = weldVertices(mesh, cell)
    const { mesh: cleaned } = dropDegenerateTriangles(snapped, cell * cell * 0.05)
    return compact(cleaned)
}

/** Throw away vertices nothing references, so file sizes stay honest. */
export function compact(mesh: Mesh): Mesh {
    const used = new Map<number, number>()
    const positions: number[] = []
    const indices = new Uint32Array(mesh.indices.length)
    for (let i = 0; i < mesh.indices.length; i++) {
        const v = mesh.indices[i]
        let id = used.get(v)
        if (id === undefined) {
            id = positions.length / 3
            used.set(v, id)
            positions.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
        }
        indices[i] = id
    }
    return { positions: Float64Array.from(positions), indices }
}

export function transformMesh(
    mesh: Mesh,
    scale: [number, number, number],
    translate: [number, number, number],
): Mesh {
    const positions = new Float64Array(mesh.positions.length)
    for (let i = 0; i < mesh.positions.length; i += 3) {
        positions[i] = mesh.positions[i] * scale[0] + translate[0]
        positions[i + 1] = mesh.positions[i + 1] * scale[1] + translate[1]
        positions[i + 2] = mesh.positions[i + 2] * scale[2] + translate[2]
    }
    // A negative scale on an odd number of axes mirrors the mesh, which
    // flips every triangle inside out. Swap two corners back.
    const flips = [scale[0], scale[1], scale[2]].filter(s => s < 0).length
    const indices = flips % 2 === 1 ? flipWinding(mesh.indices) : Uint32Array.from(mesh.indices)
    return { positions, indices }
}

function flipWinding(indices: Uint32Array): Uint32Array {
    const out = new Uint32Array(indices.length)
    for (let t = 0; t < indices.length; t += 3) {
        out[t] = indices[t]
        out[t + 1] = indices[t + 2]
        out[t + 2] = indices[t + 1]
    }
    return out
}

/** Y-up glTF metres → Z-up print millimetres, standing on the plate.
 *
 *  `targetHeightMm` is measured on Z after the rotation, i.e. the height
 *  of the toy as it stands, which is the number the parent picked. */
export function toPrintOrientation(mesh: Mesh, targetHeightMm: number): Mesh {
    // Rotate -90° about X: (x, y, z) → (x, -z, y). Written out rather
    // than matrix-multiplied because it is exact and free.
    const rotated = new Float64Array(mesh.positions.length)
    for (let i = 0; i < mesh.positions.length; i += 3) {
        rotated[i] = mesh.positions[i]
        rotated[i + 1] = -mesh.positions[i + 2]
        rotated[i + 2] = mesh.positions[i + 1]
    }
    const upright: Mesh = { positions: rotated, indices: Uint32Array.from(mesh.indices) }
    return scaleToHeight(upright, targetHeightMm)
}

/** Uniform scale so the Z extent equals `targetHeightMm`, then sit it on
 *  the plate and centre it over the origin. Uniform, because a toy
 *  stretched on one axis stops looking like the drawing. */
export function scaleToHeight(mesh: Mesh, targetHeightMm: number): Mesh {
    const b = boundsOf(mesh)
    const height = b.size[2]
    const factor = height > 1e-9 ? targetHeightMm / height : 1
    return transformMesh(
        mesh,
        [factor, factor, factor],
        [-b.center[0] * factor, -b.center[1] * factor, -b.min[2] * factor],
    )
}

/** Move the mesh so its lowest point is exactly Z=0. */
export function sitOnPlate(mesh: Mesh): Mesh {
    const b = boundsOf(mesh)
    if (Math.abs(b.min[2]) < 1e-9) return mesh
    return transformMesh(mesh, [1, 1, 1], [0, 0, -b.min[2]])
}

export interface ManifoldReport {
    /** Edges used by exactly one triangle — holes in the surface. */
    boundaryEdges: number
    /** Edges used by three or more — surfaces that meet illegally. */
    nonManifoldEdges: number
    /** Edges used twice but with the same direction both times, i.e. the
     *  two triangles disagree about which side is outside. */
    inconsistentEdges: number
    watertight: boolean
}

/** Half-edge census over a WELDED mesh. On unwelded soup every edge is a
 *  boundary edge and the answer is noise, so weld first. */
export function manifoldReport(mesh: Mesh): ManifoldReport {
    const seen = new Map<string, number[]>()
    for (let t = 0; t < mesh.indices.length; t += 3) {
        const tri = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]
        for (let e = 0; e < 3; e++) {
            const a = tri[e]
            const b = tri[(e + 1) % 3]
            const key = a < b ? `${a}_${b}` : `${b}_${a}`
            const dir = a < b ? 1 : -1
            const bucket = seen.get(key)
            if (bucket) bucket.push(dir)
            else seen.set(key, [dir])
        }
    }
    let boundaryEdges = 0
    let nonManifoldEdges = 0
    let inconsistentEdges = 0
    for (const dirs of seen.values()) {
        if (dirs.length === 1) boundaryEdges++
        else if (dirs.length > 2) nonManifoldEdges++
        else if (dirs[0] === dirs[1]) inconsistentEdges++
    }
    return {
        boundaryEdges,
        nonManifoldEdges,
        inconsistentEdges,
        watertight: boundaryEdges === 0 && nonManifoldEdges === 0,
    }
}

/** Triangle indices grouped by connected component, in mesh order.
 *
 *  Returned as indices into the SAME mesh rather than as standalone
 *  meshes, because the printability checks need to ask "which solid does
 *  this triangle belong to" while still ray-casting against everything. */
export function shellTriangleGroups(mesh: Mesh): number[][] {
    const n = vertexCount(mesh)
    if (n === 0) return []
    const parent = new Uint32Array(n)
    for (let i = 0; i < n; i++) parent[i] = i
    const find = (x: number): number => {
        let r = x
        while (parent[r] !== r) r = parent[r]
        while (parent[x] !== r) {
            const next = parent[x]
            parent[x] = r
            x = next
        }
        return r
    }
    const union = (a: number, b: number) => {
        const ra = find(a)
        const rb = find(b)
        if (ra !== rb) parent[ra] = rb
    }
    for (let t = 0; t < mesh.indices.length; t += 3) {
        union(mesh.indices[t], mesh.indices[t + 1])
        union(mesh.indices[t + 1], mesh.indices[t + 2])
    }
    const groups = new Map<number, number[]>()
    for (let t = 0; t < mesh.indices.length; t += 3) {
        const root = find(mesh.indices[t])
        const bucket = groups.get(root)
        if (bucket) bucket.push(t / 3)
        else groups.set(root, [t / 3])
    }
    return Array.from(groups.values())
}

/** Split into connected components over shared vertices, biggest first.
 *
 *  This is the "prints as one object" rule made
 *  measurable: a toy that arrives as one printed object is one shell.
 *  Floating specks — very common in image-to-3D output — show up here as
 *  extra shells with negligible volume, and the repair pass deletes
 *  them. Solids that OVERLAP are separate shells here but a single
 *  printed part; printability.ts groups them before judging. */
export function shells(mesh: Mesh): Mesh[] {
    return shellTriangleGroups(mesh)
        .map(tris => {
            const indices = new Uint32Array(tris.length * 3)
            for (let i = 0; i < tris.length; i++) {
                indices[i * 3] = mesh.indices[tris[i] * 3]
                indices[i * 3 + 1] = mesh.indices[tris[i] * 3 + 1]
                indices[i * 3 + 2] = mesh.indices[tris[i] * 3 + 2]
            }
            return compact({ positions: mesh.positions, indices })
        })
        .sort((a, b) => Math.abs(signedVolume(b)) - Math.abs(signedVolume(a)))
}

/** Bounds of one shell, without materialising it as its own mesh. */
export function boundsOfTriangles(mesh: Mesh, tris: number[]): Bounds {
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const t of tris) {
        for (let c = 0; c < 3; c++) {
            const v = mesh.indices[t * 3 + c] * 3
            for (let a = 0; a < 3; a++) {
                const p = mesh.positions[v + a]
                if (p < min[a]) min[a] = p
                if (p > max[a]) max[a] = p
            }
        }
    }
    if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] }
    return {
        min,
        max,
        size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
        center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    }
}

/** Make every triangle wind the same way, then make that way outward.
 *
 *  Walks the adjacency graph flipping neighbours that disagree, exactly
 *  as a mesh repair tool does. The outward decision is made PER
 *  CONNECTED COMPONENT, not once for the whole file: a sculpt is often
 *  several solids, and a global check on the summed volume lets a single
 *  inverted eyeball hide behind a correctly wound body. A closed shell
 *  wound outward encloses a positive volume, so each component is
 *  measured on its own and flipped if it comes out negative. */
export function orientConsistently(mesh: Mesh): { mesh: Mesh; flipped: number } {
    const triCount = triangleCount(mesh)
    if (triCount === 0) return { mesh, flipped: 0 }
    const edgeMap = new Map<string, number[]>()
    for (let i = 0; i < triCount; i++) {
        for (let e = 0; e < 3; e++) {
            const a = mesh.indices[i * 3 + e]
            const b = mesh.indices[i * 3 + ((e + 1) % 3)]
            const key = a < b ? `${a}_${b}` : `${b}_${a}`
            const bucket = edgeMap.get(key)
            if (bucket) bucket.push(i)
            else edgeMap.set(key, [i])
        }
    }
    const indices = Uint32Array.from(mesh.indices)
    const visited = new Uint8Array(triCount)
    let flipped = 0
    const flip = (i: number) => {
        const tmp = indices[i * 3 + 1]
        indices[i * 3 + 1] = indices[i * 3 + 2]
        indices[i * 3 + 2] = tmp
        flipped++
    }
    const hasDirectedEdge = (tri: number, a: number, b: number) => {
        for (let e = 0; e < 3; e++) {
            if (indices[tri * 3 + e] === a && indices[tri * 3 + ((e + 1) % 3)] === b) return true
        }
        return false
    }
    for (let seed = 0; seed < triCount; seed++) {
        if (visited[seed]) continue
        visited[seed] = 1
        const component = [seed]
        const queue = [seed]
        while (queue.length) {
            const cur = queue.pop() as number
            for (let e = 0; e < 3; e++) {
                const a = indices[cur * 3 + e]
                const b = indices[cur * 3 + ((e + 1) % 3)]
                const key = a < b ? `${a}_${b}` : `${b}_${a}`
                const neighbours = edgeMap.get(key) || []
                for (const nb of neighbours) {
                    if (nb === cur || visited[nb]) continue
                    // Neighbours agree when they traverse the shared edge
                    // in OPPOSITE directions. Same direction = one of them
                    // is inside out.
                    if (hasDirectedEdge(nb, a, b)) flip(nb)
                    visited[nb] = 1
                    component.push(nb)
                    queue.push(nb)
                }
            }
        }
        const component_mesh: Mesh = {
            positions: mesh.positions,
            indices: Uint32Array.from(component.flatMap(t => [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]])),
        }
        if (signedVolume(component_mesh) < 0) for (const t of component) flip(t)
    }
    return { mesh: { positions: mesh.positions, indices }, flipped }
}
