// src/lib/mesh/glb.ts
//
// A GLB reader that keeps only what a printer cares about: triangles in
// world space. Materials, textures, animations and skins are discarded.
//
// Why hand-rolled rather than three.js's GLTFLoader: the loader wants a
// DOM (URL.createObjectURL, ImageBitmap) and pulls the whole renderer in
// behind it. This runs in a Node serverless function whose only job is
// to turn the provider's GLB into an STL, and 120 lines of buffer maths
// is a smaller liability than a browser shim.
//
// Supported, because that is what image-to-3D services emit: triangle
// primitives, float32 POSITION, scalar indices (u8/u16/u32), node
// hierarchies with either a matrix or TRS. Anything else throws with a
// message that names the thing, so a failure is diagnosable instead of
// producing a silently empty model.

import { Mesh, emptyMesh } from './geometry'

const MAGIC_GLTF = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

type Mat4 = number[]

interface GltfJson {
    scene?: number
    scenes?: { nodes?: number[] }[]
    nodes?: {
        mesh?: number
        children?: number[]
        matrix?: number[]
        translation?: number[]
        rotation?: number[]
        scale?: number[]
    }[]
    meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[]
    accessors?: {
        bufferView?: number
        byteOffset?: number
        componentType: number
        count: number
        type: string
        sparse?: unknown
    }[]
    bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[]
    buffers?: { byteLength: number; uri?: string }[]
}

export interface GlbContents {
    mesh: Mesh
    json: GltfJson
}

/** Parse a .glb into one merged, world-space triangle soup. */
export function parseGlb(buffer: ArrayBuffer | Uint8Array): GlbContents {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.byteLength < 12) throw new Error('GLB too short to contain a header')
    if (view.getUint32(0, true) !== MAGIC_GLTF) throw new Error('Not a GLB file (bad magic)')

    let offset = 12
    let json: GltfJson | null = null
    let bin: Uint8Array | null = null
    while (offset + 8 <= bytes.byteLength) {
        const length = view.getUint32(offset, true)
        const type = view.getUint32(offset + 4, true)
        const start = offset + 8
        const end = start + length
        if (end > bytes.byteLength) throw new Error('GLB chunk runs past end of file')
        if (type === CHUNK_JSON) {
            json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, end))) as GltfJson
        } else if (type === CHUNK_BIN) {
            bin = bytes.subarray(start, end)
        }
        // Chunks are 4-byte aligned; `length` already includes the padding
        // for well-formed files, but round up defensively.
        offset = end + ((4 - (length % 4)) % 4)
    }
    if (!json) throw new Error('GLB has no JSON chunk')

    const positions: number[] = []
    const indices: number[] = []
    const nodes = json.nodes || []
    const roots =
        json.scenes?.[json.scene ?? 0]?.nodes ??
        // Some exporters omit the scene list. Fall back to every node that
        // nothing else claims as a child.
        nodes.map((_, i) => i).filter(i => !nodes.some(n => (n.children || []).includes(i)))

    const walk = (nodeIndex: number, parent: Mat4) => {
        const node = nodes[nodeIndex]
        if (!node) return
        const world = multiply(parent, localMatrix(node))
        if (node.mesh !== undefined) {
            appendMesh(json as GltfJson, bin, node.mesh, world, positions, indices)
        }
        for (const child of node.children || []) walk(child, world)
    }
    for (const root of roots) walk(root, identity())

    if (indices.length === 0) return { mesh: emptyMesh(), json }
    return { mesh: { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) }, json }
}

function appendMesh(
    json: GltfJson,
    bin: Uint8Array | null,
    meshIndex: number,
    world: Mat4,
    positions: number[],
    indices: number[],
) {
    const mesh = json.meshes?.[meshIndex]
    if (!mesh) return
    for (const prim of mesh.primitives || []) {
        // mode 4 === TRIANGLES. Strips and fans are legal glTF but no
        // image-to-3D service emits them; refuse loudly rather than
        // silently dropping half a model.
        if (prim.mode !== undefined && prim.mode !== 4) {
            throw new Error(`GLB primitive mode ${prim.mode} is not triangles`)
        }
        const posAccessor = prim.attributes?.POSITION
        if (posAccessor === undefined) continue
        const verts = readAccessor(json, bin, posAccessor, 3)
        const base = positions.length / 3
        for (let i = 0; i < verts.length; i += 3) {
            const [x, y, z] = applyMatrix(world, verts[i], verts[i + 1], verts[i + 2])
            positions.push(x, y, z)
        }
        if (prim.indices !== undefined) {
            const idx = readAccessor(json, bin, prim.indices, 1)
            for (let i = 0; i < idx.length; i++) indices.push(base + idx[i])
        } else {
            const count = verts.length / 3
            for (let i = 0; i < count; i++) indices.push(base + i)
        }
    }
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

function readAccessor(json: GltfJson, bin: Uint8Array | null, index: number, expectedComponents: number): number[] {
    const accessor = json.accessors?.[index]
    if (!accessor) throw new Error(`GLB accessor ${index} missing`)
    if (accessor.sparse) throw new Error('GLB sparse accessors are not supported')
    const components = TYPE_COUNT[accessor.type]
    if (!components) throw new Error(`GLB accessor type ${accessor.type} not supported`)
    if (components !== expectedComponents) {
        throw new Error(`GLB accessor ${index} is ${accessor.type}, expected ${expectedComponents} components`)
    }
    if (accessor.bufferView === undefined) {
        // Legal glTF: an accessor with no bufferView reads as all zeros.
        return new Array(accessor.count * components).fill(0)
    }
    const bufferView = json.bufferViews?.[accessor.bufferView]
    if (!bufferView) throw new Error(`GLB bufferView ${accessor.bufferView} missing`)
    if (!bin) throw new Error('GLB references binary data but has no BIN chunk')

    const compSize = COMPONENT_SIZE[accessor.componentType]
    if (!compSize) throw new Error(`GLB componentType ${accessor.componentType} not supported`)
    const elementSize = compSize * components
    const stride = bufferView.byteStride || elementSize
    const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0)
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)

    const out: number[] = new Array(accessor.count * components)
    for (let e = 0; e < accessor.count; e++) {
        const elementStart = start + e * stride
        for (let c = 0; c < components; c++) {
            const at = elementStart + c * compSize
            if (at + compSize > bin.byteLength) throw new Error('GLB accessor reads past the binary chunk')
            out[e * components + c] = readComponent(view, at, accessor.componentType)
        }
    }
    return out
}

function readComponent(view: DataView, at: number, componentType: number): number {
    switch (componentType) {
        case 5120:
            return view.getInt8(at)
        case 5121:
            return view.getUint8(at)
        case 5122:
            return view.getInt16(at, true)
        case 5123:
            return view.getUint16(at, true)
        case 5125:
            return view.getUint32(at, true)
        case 5126:
            return view.getFloat32(at, true)
        default:
            throw new Error(`GLB componentType ${componentType} not supported`)
    }
}

// ── Tiny column-major 4x4 maths, glTF's convention ──────────────────

function identity(): Mat4 {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function localMatrix(node: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): Mat4 {
    if (node.matrix && node.matrix.length === 16) return node.matrix.slice()
    const t = node.translation || [0, 0, 0]
    const r = node.rotation || [0, 0, 0, 1]
    const s = node.scale || [1, 1, 1]
    const [x, y, z, w] = r
    const x2 = x + x
    const y2 = y + y
    const z2 = z + z
    const xx = x * x2
    const xy = x * y2
    const xz = x * z2
    const yy = y * y2
    const yz = y * z2
    const zz = z * z2
    const wx = w * x2
    const wy = w * y2
    const wz = w * z2
    return [
        (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
        (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
        (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
        t[0], t[1], t[2], 1,
    ]
}

function multiply(a: Mat4, b: Mat4): Mat4 {
    const out = new Array(16).fill(0)
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            let sum = 0
            for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]
            out[c * 4 + r] = sum
        }
    }
    return out
}

function applyMatrix(m: Mat4, x: number, y: number, z: number): [number, number, number] {
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    ]
}
