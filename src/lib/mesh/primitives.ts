// src/lib/mesh/primitives.ts
//
// Closed, outward-wound primitives and the transforms to place them.
// Z-up, millimetres — print space, not render space.
//
// Every primitive here is watertight by construction (poles are single
// vertices, caps are fans around a centre vertex), because a primitive
// with a hole in it would fail the printability check for a reason that
// has nothing to do with the toy.

import { Mesh } from './geometry'

export function boxMesh(sx: number, sy: number, sz: number): Mesh {
    const x = sx / 2
    const y = sy / 2
    const z = sz / 2
    const positions = Float64Array.from([
        -x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z,
        -x, -y, z, x, -y, z, x, y, z, -x, y, z,
    ])
    const indices = Uint32Array.from([
        0, 3, 2, 0, 2, 1,
        4, 5, 6, 4, 6, 7,
        0, 1, 5, 0, 5, 4,
        1, 2, 6, 1, 6, 5,
        2, 3, 7, 2, 7, 6,
        3, 0, 4, 3, 4, 7,
    ])
    return { positions, indices }
}

/** UV sphere centred on the origin. `segments` around, `rings` from pole
 *  to pole; 16x12 is plenty for a toy at 10cm, where the layer height is
 *  a coarser limit than the mesh. */
export function sphereMesh(radius: number, segments = 16, rings = 12): Mesh {
    const positions: number[] = [0, 0, radius]
    const indices: number[] = []
    for (let r = 1; r < rings; r++) {
        const phi = (Math.PI * r) / rings
        const z = Math.cos(phi) * radius
        const ringRadius = Math.sin(phi) * radius
        for (let s = 0; s < segments; s++) {
            const theta = (2 * Math.PI * s) / segments
            positions.push(Math.cos(theta) * ringRadius, Math.sin(theta) * ringRadius, z)
        }
    }
    const south = positions.length / 3
    positions.push(0, 0, -radius)

    const ringStart = (r: number) => 1 + (r - 1) * segments
    for (let s = 0; s < segments; s++) {
        indices.push(0, ringStart(1) + s, ringStart(1) + ((s + 1) % segments))
    }
    for (let r = 1; r < rings - 1; r++) {
        for (let s = 0; s < segments; s++) {
            const a = ringStart(r) + s
            const b = ringStart(r) + ((s + 1) % segments)
            const c = ringStart(r + 1) + s
            const d = ringStart(r + 1) + ((s + 1) % segments)
            indices.push(a, c, d, a, d, b)
        }
    }
    for (let s = 0; s < segments; s++) {
        indices.push(south, ringStart(rings - 1) + ((s + 1) % segments), ringStart(rings - 1) + s)
    }
    return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) }
}

/** Cylinder or cone along +Z, base at z=0. `topRadius` of 0 gives a
 *  cone; a small non-zero value gives the blunted tip a print actually
 *  wants — a needle point is the classic snapped horn. */
export function cylinderMesh(bottomRadius: number, topRadius: number, height: number, segments = 16): Mesh {
    const positions: number[] = []
    const indices: number[] = []
    const pointy = topRadius <= 1e-6

    for (let s = 0; s < segments; s++) {
        const theta = (2 * Math.PI * s) / segments
        positions.push(Math.cos(theta) * bottomRadius, Math.sin(theta) * bottomRadius, 0)
    }
    if (!pointy) {
        for (let s = 0; s < segments; s++) {
            const theta = (2 * Math.PI * s) / segments
            positions.push(Math.cos(theta) * topRadius, Math.sin(theta) * topRadius, height)
        }
    }
    const apex = positions.length / 3
    if (pointy) positions.push(0, 0, height)
    const bottomCentre = positions.length / 3
    positions.push(0, 0, 0)
    const topCentre = pointy ? -1 : positions.length / 3
    if (!pointy) positions.push(0, 0, height)

    for (let s = 0; s < segments; s++) {
        const next = (s + 1) % segments
        if (pointy) {
            indices.push(s, next, apex)
        } else {
            const a = s
            const b = next
            const c = segments + s
            const d = segments + next
            indices.push(a, b, d, a, d, c)
        }
        indices.push(bottomCentre, next, s)
        if (!pointy) indices.push(topCentre, segments + s, segments + next)
    }
    return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) }
}

export function translated(mesh: Mesh, [dx, dy, dz]: [number, number, number]): Mesh {
    const positions = new Float64Array(mesh.positions.length)
    for (let i = 0; i < mesh.positions.length; i += 3) {
        positions[i] = mesh.positions[i] + dx
        positions[i + 1] = mesh.positions[i + 1] + dy
        positions[i + 2] = mesh.positions[i + 2] + dz
    }
    return { positions, indices: Uint32Array.from(mesh.indices) }
}

/** Non-uniform scale. Used to squash spheres into bodies and heads —
 *  a chunky toy is an ellipsoid, never a ball. */
export function scaled(mesh: Mesh, [sx, sy, sz]: [number, number, number]): Mesh {
    const positions = new Float64Array(mesh.positions.length)
    for (let i = 0; i < mesh.positions.length; i += 3) {
        positions[i] = mesh.positions[i] * sx
        positions[i + 1] = mesh.positions[i + 1] * sy
        positions[i + 2] = mesh.positions[i + 2] * sz
    }
    const negatives = [sx, sy, sz].filter(s => s < 0).length
    const indices = Uint32Array.from(mesh.indices)
    if (negatives % 2 === 1) {
        for (let t = 0; t < indices.length; t += 3) {
            const tmp = indices[t + 1]
            indices[t + 1] = indices[t + 2]
            indices[t + 2] = tmp
        }
    }
    return { positions, indices }
}

export type Axis = 'x' | 'y' | 'z'

export function rotated(mesh: Mesh, axis: Axis, radians: number): Mesh {
    const c = Math.cos(radians)
    const s = Math.sin(radians)
    const positions = new Float64Array(mesh.positions.length)
    for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i]
        const y = mesh.positions[i + 1]
        const z = mesh.positions[i + 2]
        if (axis === 'x') {
            positions[i] = x
            positions[i + 1] = y * c - z * s
            positions[i + 2] = y * s + z * c
        } else if (axis === 'y') {
            positions[i] = x * c + z * s
            positions[i + 1] = y
            positions[i + 2] = -x * s + z * c
        } else {
            positions[i] = x * c - y * s
            positions[i + 1] = x * s + y * c
            positions[i + 2] = z
        }
    }
    return { positions, indices: Uint32Array.from(mesh.indices) }
}
