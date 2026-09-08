// Shared mesh fixtures for the ToyFoundry print pipeline tests.
//
// Hand-written on purpose: every check in printability.ts has to be
// provable against a shape whose correct answer we know by arithmetic,
// not against a captured provider blob whose properties we would be
// guessing at.

/** Axis-aligned box from (0,0,0) to (sx,sy,sz), outward-wound, welded. */
export function box(sx = 1, sy = 1, sz = 1, offset = [0, 0, 0]) {
    const [ox, oy, oz] = offset
    const positions = [
        ox, oy, oz,
        ox + sx, oy, oz,
        ox + sx, oy + sy, oz,
        ox, oy + sy, oz,
        ox, oy, oz + sz,
        ox + sx, oy, oz + sz,
        ox + sx, oy + sy, oz + sz,
        ox, oy + sy, oz + sz,
    ]
    const indices = [
        0, 3, 2, 0, 2, 1, // bottom  (-z)
        4, 5, 6, 4, 6, 7, // top     (+z)
        0, 1, 5, 0, 5, 4, // front   (-y)
        1, 2, 6, 1, 6, 5, // right   (+x)
        2, 3, 7, 2, 7, 6, // back    (+y)
        3, 0, 4, 3, 4, 7, // left    (-x)
    ]
    return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) }
}

/** Same box, but every triangle owns its own three vertices — which is
 *  exactly what image-to-3D providers hand us. */
export function unweldedBox(sx = 1, sy = 1, sz = 1, offset = [0, 0, 0]) {
    const welded = box(sx, sy, sz, offset)
    const positions = []
    const indices = []
    for (let i = 0; i < welded.indices.length; i++) {
        const v = welded.indices[i] * 3
        positions.push(welded.positions[v], welded.positions[v + 1], welded.positions[v + 2])
        indices.push(i)
    }
    return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) }
}

/** Two boxes with a gap between them: the "floating fragment" case. */
export function boxPlusSpeck() {
    const body = box(10, 10, 10)
    const speck = box(0.5, 0.5, 0.5, [30, 0, 0])
    const positions = Float64Array.from([...body.positions, ...speck.positions])
    const base = body.positions.length / 3
    const indices = Uint32Array.from([...body.indices, ...Array.from(speck.indices, i => i + base)])
    return { positions, indices }
}

/** Build a minimal GLB around a single triangle-mesh node. */
export function buildGlb({ positions, indices, matrix }) {
    const posBytes = new Float32Array(positions)
    const idxBytes = new Uint16Array(indices)
    const idxPadded = idxBytes.byteLength % 4 === 0 ? idxBytes.byteLength : idxBytes.byteLength + 2

    const json = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, ...(matrix ? { matrix } : {}) }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
        accessors: [
            { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
        ],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength },
            { buffer: 0, byteOffset: posBytes.byteLength, byteLength: idxBytes.byteLength },
        ],
        buffers: [{ byteLength: posBytes.byteLength + idxPadded }],
    }

    const jsonText = JSON.stringify(json)
    const jsonBytes = new TextEncoder().encode(jsonText)
    const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4
    const jsonChunk = new Uint8Array(jsonBytes.byteLength + jsonPad).fill(0x20)
    jsonChunk.set(jsonBytes)

    const binChunk = new Uint8Array(posBytes.byteLength + idxPadded)
    binChunk.set(new Uint8Array(posBytes.buffer), 0)
    binChunk.set(new Uint8Array(idxBytes.buffer, 0, idxBytes.byteLength), posBytes.byteLength)

    const total = 12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength
    const out = new Uint8Array(total)
    const view = new DataView(out.buffer)
    view.setUint32(0, 0x46546c67, true)
    view.setUint32(4, 2, true)
    view.setUint32(8, total, true)
    view.setUint32(12, jsonChunk.byteLength, true)
    view.setUint32(16, 0x4e4f534a, true)
    out.set(jsonChunk, 20)
    const binHeader = 20 + jsonChunk.byteLength
    view.setUint32(binHeader, binChunk.byteLength, true)
    view.setUint32(binHeader + 4, 0x004e4942, true)
    out.set(binChunk, binHeader + 8)
    return out
}
