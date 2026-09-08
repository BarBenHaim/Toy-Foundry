import { describe, it, expect } from 'vitest'
import {
    boundsOf,
    compact,
    dropDegenerateTriangles,
    manifoldReport,
    orientConsistently,
    scaleToHeight,
    shells,
    signedVolume,
    sitOnPlate,
    surfaceArea,
    toPrintOrientation,
    triangleCount,
    vertexCount,
    weldVertices,
} from '@/lib/mesh/geometry'
import { readBinaryStl, writeBinaryStl } from '@/lib/mesh/stl'
import { writeThreeMf } from '@/lib/mesh/threemf'
import { parseGlb } from '@/lib/mesh/glb'
import { box, boxPlusSpeck, buildGlb, unweldedBox } from './fixtures'

describe('geometry', () => {
    it('measures a box', () => {
        const cube = box(2, 3, 4)
        expect(signedVolume(cube)).toBeCloseTo(24, 6)
        expect(surfaceArea(cube)).toBeCloseTo(2 * (2 * 3 + 2 * 4 + 3 * 4), 6)
        expect(boundsOf(cube).size).toEqual([2, 3, 4])
    })

    it('welds provider soup back into a closed surface', () => {
        const soup = unweldedBox()
        // Unwelded, every edge is a boundary edge — which is why checking
        // watertightness before welding always says "broken".
        expect(manifoldReport(soup).watertight).toBe(false)
        const welded = weldVertices(soup)
        expect(vertexCount(welded)).toBe(8)
        expect(manifoldReport(welded).watertight).toBe(true)
    })

    it('drops degenerate triangles', () => {
        const cube = box()
        const withSliver = {
            positions: cube.positions,
            indices: Uint32Array.from([...cube.indices, 0, 1, 1]),
        }
        const { mesh, removed } = dropDegenerateTriangles(withSliver)
        expect(removed).toBe(1)
        expect(triangleCount(mesh)).toBe(12)
    })

    it('finds separate shells, biggest first', () => {
        const parts = shells(boxPlusSpeck())
        expect(parts).toHaveLength(2)
        expect(Math.abs(signedVolume(parts[0]))).toBeGreaterThan(Math.abs(signedVolume(parts[1])))
    })

    it('flips an inside-out mesh back the right way', () => {
        const cube = box()
        const inverted = { positions: cube.positions, indices: Uint32Array.from(cube.indices) }
        for (let t = 0; t < inverted.indices.length; t += 3) {
            const tmp = inverted.indices[t + 1]
            inverted.indices[t + 1] = inverted.indices[t + 2]
            inverted.indices[t + 2] = tmp
        }
        expect(signedVolume(inverted)).toBeLessThan(0)
        const { mesh } = orientConsistently(inverted)
        expect(signedVolume(mesh)).toBeGreaterThan(0)
    })

    it('repairs one triangle that disagrees with its neighbours', () => {
        const cube = box()
        const indices = Uint32Array.from(cube.indices)
        const tmp = indices[1]
        indices[1] = indices[2]
        indices[2] = tmp
        const broken = { positions: cube.positions, indices }
        expect(manifoldReport(broken).inconsistentEdges).toBeGreaterThan(0)
        const { mesh, flipped } = orientConsistently(broken)
        expect(flipped).toBeGreaterThan(0)
        expect(manifoldReport(mesh).inconsistentEdges).toBe(0)
        expect(signedVolume(mesh)).toBeCloseTo(1, 6)
    })

    it('scales to a target height and sits on the plate', () => {
        const cube = box(1, 1, 1, [5, 5, 5])
        const standing = sitOnPlate(scaleToHeight(cube, 100))
        const b = boundsOf(standing)
        expect(b.size[2]).toBeCloseTo(100, 6)
        expect(b.min[2]).toBeCloseTo(0, 6)
        // Uniform scale — a stretched toy stops looking like the drawing.
        expect(b.size[0]).toBeCloseTo(100, 6)
        expect(b.center[0]).toBeCloseTo(0, 6)
    })

    it('converts Y-up glTF metres into Z-up print millimetres', () => {
        // 2 wide (x), 1 tall (y), 3 deep (z) in glTF terms.
        const cube = box(2, 1, 3)
        const printed = toPrintOrientation(cube, 100)
        const b = boundsOf(printed)
        expect(b.size[2]).toBeCloseTo(100, 6) // the glTF Y extent became height
        expect(b.size[0]).toBeCloseTo(200, 6)
        expect(b.size[1]).toBeCloseTo(300, 6)
        expect(b.min[2]).toBeCloseTo(0, 6)
        // Rotation must not turn the model inside out.
        expect(signedVolume(printed)).toBeGreaterThan(0)
    })

    it('compacts unused vertices away', () => {
        const cube = box()
        const wasteful = {
            positions: Float64Array.from([...cube.positions, 99, 99, 99]),
            indices: cube.indices,
        }
        expect(vertexCount(compact(wasteful))).toBe(8)
    })
})

describe('stl', () => {
    it('round-trips a box through binary STL', () => {
        const cube = box(10, 10, 10)
        const bytes = writeBinaryStl(cube)
        expect(bytes.byteLength).toBe(80 + 4 + 12 * 50)
        const back = readBinaryStl(bytes)
        expect(triangleCount(back)).toBe(12)
        expect(signedVolume(weldVertices(back, 1e-3))).toBeCloseTo(1000, 2)
    })

    it('never starts the header with "solid"', () => {
        // Readers that sniff for it try to parse the binary body as ASCII
        // and hand back an empty model with no error.
        const bytes = writeBinaryStl(box())
        const header = new TextDecoder().decode(bytes.subarray(0, 5))
        expect(header.toLowerCase()).not.toBe('solid')
    })

    it('rejects a truncated file instead of returning half a model', () => {
        const bytes = writeBinaryStl(box())
        expect(() => readBinaryStl(bytes.subarray(0, 200))).toThrow(/triangles/)
    })
})

describe('3mf', () => {
    it('writes a zip carrying millimetre units and the toy colour', async () => {
        const bytes = await writeThreeMf(box(10, 10, 10), { color: '#ff5d8f', title: 'Blobby' })
        expect(bytes[0]).toBe(0x50) // 'P' — it is a zip
        expect(bytes[1]).toBe(0x4b)
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(bytes)
        const model = await zip.file('3D/3dmodel.model').async('string')
        expect(model).toContain('unit="millimeter"')
        expect(model).toContain('displaycolor="#FF5D8FFF"')
        expect(model).toContain('<triangle v1=')
        expect(await zip.file('[Content_Types].xml').async('string')).toContain('3dmanufacturing-3dmodel')
    })
})

describe('glb', () => {
    it('reads positions and indices out of a GLB', () => {
        const glb = buildGlb({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] })
        const { mesh } = parseGlb(glb)
        expect(triangleCount(mesh)).toBe(1)
        expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    })

    it('applies the node matrix, so a scaled scene is not printed at the wrong size', () => {
        const scaleBy2 = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 0, 0, 1]
        const glb = buildGlb({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], matrix: scaleBy2 })
        const { mesh } = parseGlb(glb)
        expect(Array.from(mesh.positions.slice(0, 3))).toEqual([5, 0, 0])
        expect(Array.from(mesh.positions.slice(3, 6))).toEqual([7, 0, 0])
    })

    it('refuses a file that is not a GLB', () => {
        expect(() => parseGlb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(/bad magic/)
    })
})
