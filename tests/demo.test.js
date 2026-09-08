import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { demoPreview, isProviderReadable, normalizeUpload, samplePalette } from '@/lib/demo'
import { normalizeDna } from '@/lib/characterDna'
import { buildStandInToy } from '@/lib/mesh/standIn'
import { prepareForPrint } from '@/lib/printability'
import { readBinaryStl, writeBinaryStl } from '@/lib/mesh/stl'
import { writeThreeMf } from '@/lib/mesh/threemf'
import { triangleCount, boundsOf } from '@/lib/mesh/geometry'

/** A stand-in for a photographed drawing: a magenta creature on white
 *  paper, which is the colour distribution every one of these has. */
async function fakeDrawing(size = 300) {
    return sharp({
        create: { width: size, height: size, channels: 3, background: '#ffffff' },
    })
        .composite([
            {
                input: Buffer.from(
                    `<svg width="${size}" height="${size}">
                       <circle cx="${size / 2}" cy="${size / 2}" r="${size / 4}" fill="#d81b8c" />
                       <circle cx="${size / 2}" cy="${size / 3}" r="${size / 9}" fill="#2b7fd8" />
                     </svg>`,
                ),
                top: 0,
                left: 0,
            },
        ])
        .png()
        .toBuffer()
}

describe('demo mode', () => {
    it('reads the drawing’s real colours, not the paper and not the pencil', async () => {
        const palette = await samplePalette(new Uint8Array(await fakeDrawing()))
        expect(palette.length).toBeGreaterThan(0)
        // Near-white is skipped: it is the paper, never the character.
        for (const hex of palette) {
            const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
            expect(Math.min(r, g, b) > 230 && Math.max(r, g, b) - Math.min(r, g, b) < 25).toBe(false)
        }
        // The magenta body is the biggest area, so it leads.
        const [r, g, b] = [1, 3, 5].map(i => parseInt(palette[0].slice(i, i + 2), 16))
        expect(r).toBeGreaterThan(b)
        expect(r).toBeGreaterThan(g)
    })

    it('falls back to brand colours rather than throwing on a file it cannot read', async () => {
        const palette = await samplePalette(new Uint8Array([1, 2, 3, 4]))
        expect(palette).toEqual(['#6c4cf1', '#f5476b', '#f2b705'])
    })

    it('restages the drawing as a square product shot', async () => {
        const preview = await demoPreview(new Uint8Array(await fakeDrawing()), ['#d81b8c', '#2b7fd8'])
        expect(preview.contentType).toBe('image/png')
        const meta = await sharp(Buffer.from(preview.bytes)).metadata()
        expect(meta.width).toBe(1024)
        expect(meta.height).toBe(1024)
    })

    it('caps huge phone photos and leaves reasonable ones alone', async () => {
        const big = await normalizeUpload(new Uint8Array(await fakeDrawing(3000)), 'image/png')
        const meta = await sharp(Buffer.from(big.bytes)).metadata()
        expect(Math.max(meta.width, meta.height)).toBe(2048)
        expect(big.contentType).toBe('image/jpeg')

        const raw = new Uint8Array(await fakeDrawing(400))
        const small = await normalizeUpload(raw, 'image/png')
        expect(small.bytes).toBe(raw)
        expect(small.contentType).toBe('image/png')
    })

    it('knows which formats the providers downstream can open', () => {
        expect(isProviderReadable('image/jpeg')).toBe(true)
        expect(isProviderReadable('image/png')).toBe(true)
        expect(isProviderReadable('image/heic')).toBe(false)
        expect(isProviderReadable('')).toBe(false)
    })
})

describe('a drawing all the way to print files', () => {
    it('produces an STL and a 3MF that a printer would accept', async () => {
        const drawing = new Uint8Array(await fakeDrawing())
        const palette = await samplePalette(drawing)

        const dna = normalizeDna({
            name: 'Test creature',
            summary: 'a round creature with two eyes and one horn',
            bodyPlan: 'biped',
            features: [
                { kind: 'eyes', description: 'two eyes', importance: 5 },
                { kind: 'horn', description: 'one horn', importance: 4 },
            ],
            palette,
            proportions: { headToBody: 1.3, limbLength: 'short', stance: 'wide' },
            confidence: 0.4,
        })

        const { mesh, report } = prepareForPrint(buildStandInToy(dna), 100, { sourceUp: 'z' })
        expect(report.ok).toBe(true)

        const stl = writeBinaryStl(mesh, 'ToyFoundry test')
        expect(stl.byteLength).toBe(80 + 4 + triangleCount(mesh) * 50)
        // Round-tripping through the file is the real check: a printer
        // reads the bytes, not our in-memory mesh.
        const reread = readBinaryStl(stl)
        expect(triangleCount(reread)).toBe(triangleCount(mesh))
        const b = boundsOf(reread)
        expect(b.size[2]).toBeCloseTo(100, 1)
        expect(b.min[2]).toBeCloseTo(0, 1)

        const threeMf = await writeThreeMf(mesh, { color: palette[0], title: dna.name })
        expect(threeMf.byteLength).toBeGreaterThan(1000)
        expect(threeMf[0]).toBe(0x50)
    })
})
