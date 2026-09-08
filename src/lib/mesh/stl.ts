// src/lib/mesh/stl.ts
//
// Binary STL in and out. STL is the format every FDM shop accepts
// without a conversation, including JLC3DP, so it is what we ship even
// though 3MF is the better file.
//
// The format, in full, because it is small enough to state: 80 bytes of
// header nobody reads, a uint32 triangle count, then 50 bytes per
// triangle — three floats of normal, nine floats of vertices, and a
// uint16 "attribute byte count" that is always zero. Little-endian
// throughout. There are no units in the file; the whole industry agrees
// they are millimetres and nothing enforces it, which is exactly why
// `toPrintOrientation` scales to millimetres before we get here.

import { Mesh, triangleNormal } from './geometry'

const HEADER_BYTES = 80
const TRIANGLE_BYTES = 50

export function writeBinaryStl(mesh: Mesh, header = 'ToyFoundry'): Uint8Array {
    const count = Math.floor(mesh.indices.length / 3)
    const bytes = new Uint8Array(HEADER_BYTES + 4 + count * TRIANGLE_BYTES)
    const view = new DataView(bytes.buffer)

    // The header is free-form ASCII. It must NOT start with "solid" —
    // some readers sniff that word and then try to parse the binary body
    // as ASCII STL, producing an empty model with no error.
    const headerBytes = new TextEncoder().encode(header.slice(0, HEADER_BYTES))
    bytes.set(headerBytes.subarray(0, HEADER_BYTES), 0)
    view.setUint32(HEADER_BYTES, count, true)

    let at = HEADER_BYTES + 4
    for (let t = 0; t < mesh.indices.length; t += 3) {
        const n = triangleNormal(mesh, t) || [0, 0, 0]
        view.setFloat32(at, n[0], true)
        view.setFloat32(at + 4, n[1], true)
        view.setFloat32(at + 8, n[2], true)
        at += 12
        for (let c = 0; c < 3; c++) {
            const v = mesh.indices[t + c] * 3
            view.setFloat32(at, mesh.positions[v], true)
            view.setFloat32(at + 4, mesh.positions[v + 1], true)
            view.setFloat32(at + 8, mesh.positions[v + 2], true)
            at += 12
        }
        view.setUint16(at, 0, true)
        at += 2
    }
    return bytes
}

/** Read a binary STL back into a soup. Used by the tests, and by the
 *  re-check path when a model file is inspected after upload. */
export function readBinaryStl(input: ArrayBuffer | Uint8Array): Mesh {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
    if (bytes.byteLength < HEADER_BYTES + 4) throw new Error('STL too short to contain a header')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = view.getUint32(HEADER_BYTES, true)
    const expected = HEADER_BYTES + 4 + count * TRIANGLE_BYTES
    if (bytes.byteLength < expected) {
        throw new Error(`STL claims ${count} triangles but the file holds ${bytes.byteLength} bytes`)
    }
    const positions = new Float64Array(count * 9)
    const indices = new Uint32Array(count * 3)
    let at = HEADER_BYTES + 4
    for (let t = 0; t < count; t++) {
        at += 12 // normal, recomputed on demand rather than trusted
        for (let c = 0; c < 3; c++) {
            positions[t * 9 + c * 3] = view.getFloat32(at, true)
            positions[t * 9 + c * 3 + 1] = view.getFloat32(at + 4, true)
            positions[t * 9 + c * 3 + 2] = view.getFloat32(at + 8, true)
            indices[t * 3 + c] = t * 3 + c
            at += 12
        }
        at += 2
    }
    return { positions, indices }
}
