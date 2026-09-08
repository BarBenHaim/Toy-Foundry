// src/lib/demo.ts
//
// Demo mode: the whole flow, walkable, with no API keys at all.
//
// The brief asks for an MVP where some steps can be manual behind the
// scenes as long as the experience feels complete. This is the extreme
// version of that — every AI step switched off — and it exists for three
// reasons: a founder can show the product before paying for anything, a
// reviewer can walk the flow on a preview deploy, and when a provider
// falls over mid-order the flow degrades instead of dying.
//
// What is real here and what is not, stated plainly because a demo that
// pretends to be the product is worse than no demo:
//   • The palette IS read from the uploaded drawing (sharp samples it).
//   • The features are NOT read from the drawing. They are a generic
//     creature, and the UI says the analysis is off.
//   • The preview IS the child's drawing, restaged as a product shot.
//     No model touched it.
//   • The 3D model IS real geometry, really checked for printability,
//     really exported as STL and 3MF.
//
// Demo mode is on when TOYFOUNDRY_DEMO=1, and it is also the automatic
// fallback for any single step whose provider is not configured.

import sharp from 'sharp'
import { normalizeDna } from './characterDna'
import type { CharacterDna } from './types'

export function demoModeEnabled(): boolean {
    return process.env.TOYFOUNDRY_DEMO === '1'
}

/** A creature whose colours come from the actual drawing.
 *
 *  Sampling the palette matters more than it looks: the colours are what
 *  a parent checks first, and a demo toy in the wrong colours reads as
 *  broken in a way that a demo toy with the wrong number of horns does
 *  not. */
export async function demoDna(image: { bytes: Uint8Array }): Promise<CharacterDna> {
    const palette = await samplePalette(image.bytes)
    return normalizeDna({
        name: 'Your character',
        summary: 'A character from a drawing, staged without the AI analysis step.',
        bodyPlan: 'biped',
        features: [
            { kind: 'eyes', description: 'two big friendly eyes', importance: 5 },
            { kind: 'ears', description: 'two rounded ears', importance: 4 },
            { kind: 'arms', description: 'two short arms', importance: 3 },
        ],
        palette,
        proportions: { headToBody: 1.4, limbLength: 'short', stance: 'wide' },
        quirks: [],
        // Honest: this is a placeholder reading, and every surface that
        // shows confidence will say so.
        confidence: 0.4,
    })
}

/** Dominant colours, cheaply. Shrink to a tiny thumbnail so every pixel
 *  is already an average of its neighbourhood, then take the most
 *  common non-paper, non-ink buckets. */
export async function samplePalette(bytes: Uint8Array, count = 4): Promise<string[]> {
    try {
        const { data, info } = await sharp(Buffer.from(bytes))
            .resize(48, 48, { fit: 'inside' })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true })

        const buckets = new Map<string, { n: number; r: number; g: number; b: number }>()
        for (let i = 0; i < data.length; i += info.channels) {
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            const max = Math.max(r, g, b)
            const min = Math.min(r, g, b)
            // Skip the paper and the pencil: near-white and near-black
            // are the two things every drawing is mostly made of, and
            // neither is the character's colour.
            if (max > 235 && max - min < 25) continue
            if (max < 55) continue
            const key = `${Math.round(r / 32)}_${Math.round(g / 32)}_${Math.round(b / 32)}`
            const bucket = buckets.get(key)
            if (bucket) {
                bucket.n++
                bucket.r += r
                bucket.g += g
                bucket.b += b
            } else {
                buckets.set(key, { n: 1, r, g, b })
            }
        }
        const sorted = Array.from(buckets.values())
            .sort((a, b) => b.n - a.n)
            .slice(0, count)
            .map(c => rgbToHex(c.r / c.n, c.g / c.n, c.b / c.n))
        return sorted.length > 0 ? sorted : ['#6c4cf1', '#f5476b', '#f2b705']
    } catch {
        return ['#6c4cf1', '#f5476b', '#f2b705']
    }
}

function rgbToHex(r: number, g: number, b: number): string {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
    return `#${[clamp(r), clamp(g), clamp(b)].map(n => n.toString(16).padStart(2, '0')).join('')}`
}

/** The drawing, restaged as a product shot: trimmed to its content,
 *  dropped onto a soft studio backdrop with a contact shadow, square.
 *
 *  This is compositing, not generation. It is here so the preview step
 *  has something to show that looks like the rest of the product rather
 *  than a phone snapshot with a thumb in the corner — and the studio
 *  labels it as a placeholder. */
export async function demoPreview(bytes: Uint8Array, palette: string[]): Promise<{ bytes: Uint8Array; contentType: string }> {
    const size = 1024
    const top = palette[0] || '#6c4cf1'
    const bottom = palette[1] || '#f5476b'
    const backdrop = Buffer.from(
        `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="g" cx="50%" cy="38%" r="72%">
              <stop offset="0%" stop-color="#ffffff"/>
              <stop offset="60%" stop-color="${top}22"/>
              <stop offset="100%" stop-color="${bottom}33"/>
            </radialGradient>
            <radialGradient id="s" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#00000033"/>
              <stop offset="100%" stop-color="#00000000"/>
            </radialGradient>
          </defs>
          <rect width="${size}" height="${size}" fill="url(#g)"/>
          <ellipse cx="${size / 2}" cy="${size * 0.86}" rx="${size * 0.3}" ry="${size * 0.045}" fill="url(#s)"/>
        </svg>`,
    )

    // trim() throws on an image it decides is entirely blank, and a
    // photo of a faint pencil drawing on white paper is exactly the input
    // that triggers it. Falling back to the untrimmed image loses some
    // framing and keeps the flow alive, which is the right trade.
    const framed = Math.round(size * 0.68)
    const subject = await sharp(Buffer.from(bytes))
        .rotate() // honour EXIF, or a phone photo arrives on its side
        .trim({ threshold: 18 })
        .resize(framed, framed, { fit: 'inside', withoutEnlargement: false })
        .modulate({ saturation: 1.12 })
        .png()
        .toBuffer()
        .catch(() =>
            sharp(Buffer.from(bytes))
                .rotate()
                .resize(framed, framed, { fit: 'inside', withoutEnlargement: false })
                .png()
                .toBuffer(),
        )

    const composed = await sharp(backdrop)
        .composite([{ input: subject, gravity: 'centre' }])
        .png()
        .toBuffer()

    return { bytes: new Uint8Array(composed), contentType: 'image/png' }
}

/** Phones hand over HEIC, and neither the vision API nor the image model
 *  takes it. Convert on the way in so the rest of the pipeline only ever
 *  sees JPEG or PNG. Also caps the long edge: a 12MP photo of an A4
 *  drawing is 8MB of paper texture.
 *
 *  `contentType` comes back unchanged when sharp could not read the file
 *  at all. The caller checks for that rather than storing an image no
 *  provider downstream can open — a HEIC that fails here fails again
 *  three steps later, as a confusing error about the drawing rather than
 *  a clear one about the file. */
export async function normalizeUpload(
    bytes: Uint8Array,
    contentType: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
    const needsConversion = /heic|heif/i.test(contentType)
    try {
        const image = sharp(Buffer.from(bytes)).rotate()
        const meta = await image.metadata()
        const tooBig = (meta.width || 0) > 2048 || (meta.height || 0) > 2048
        if (!needsConversion && !tooBig) return { bytes, contentType }
        const out = await image.resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer()
        return { bytes: new Uint8Array(out), contentType: 'image/jpeg' }
    } catch {
        return { bytes, contentType }
    }
}

/** The formats every downstream provider accepts. Anything else has to
 *  have been converted by `normalizeUpload` first. */
export function isProviderReadable(contentType: string): boolean {
    return /^image\/(jpeg|jpg|png|webp)$/i.test(contentType || '')
}
