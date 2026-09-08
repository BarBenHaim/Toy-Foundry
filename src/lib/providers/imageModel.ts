// src/lib/providers/imageModel.ts
//
// Step 3: the picture the parent falls in love with.
//
// This calls the EDIT endpoint, not the generate endpoint, and that is
// the single most important decision in the file. Generation from words
// alone produces a lovely toy that is not the child's character — the
// vision pass can describe "three eyes, the middle one biggest", but it
// cannot describe the particular wonky way a five-year-old drew them,
// and that wonkiness is the entire product. Handing the model the actual
// drawing as the image to work from keeps the shapes.
//
// The image comes back as base64 and is stored by the caller. We never
// hand the provider's own URL to a parent: those expire, and a preview
// that 404s a day later looks like the toy was taken away.

import { ProviderError, fetchWithTimeout, fromResponse, notConfigured } from './errors'

const EDITS_URL = 'https://api.openai.com/v1/images/edits'

/** The pictures here carry no text — no captions, no packaging, no
 *  logos — which is the one thing newer image models are dramatically
 *  better at. So the default stays on the model whose behaviour on
 *  toy-like subjects is known, and the env var is there for the day
 *  someone wants to A/B a newer one without a deploy. */
export const IMAGE_MODEL = process.env.TOYFOUNDRY_IMAGE_MODEL || 'gpt-image-1'

/** Square, because a toy standing in the middle of a frame is what every
 *  downstream surface wants: the preview card, the order email, and the
 *  image-to-3D service, which reconstructs a centred subject far better
 *  than an off-centre one. */
export const IMAGE_SIZE = '1024x1024'

export function isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY)
}

export interface RenderedImage {
    bytes: Uint8Array
    contentType: string
}

export async function renderToyPreview(input: {
    prompt: string
    drawing: { bytes: Uint8Array; contentType: string }
}): Promise<RenderedImage> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw notConfigured('Toy preview rendering')

    const form = new FormData()
    form.append('model', IMAGE_MODEL)
    form.append('prompt', input.prompt)
    form.append('size', IMAGE_SIZE)
    form.append('n', '1')
    form.append(
        'image',
        new Blob([Buffer.from(input.drawing.bytes)], { type: input.drawing.contentType }),
        `drawing.${input.drawing.contentType.includes('png') ? 'png' : 'jpg'}`,
    )

    // Image generation is slow and the parent is watching a progress
    // animation. Two minutes is the point past which the request is
    // worth failing and retrying rather than waiting out.
    const res = await fetchWithTimeout(
        EDITS_URL,
        { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form },
        120000,
        'Toy preview rendering',
    )

    if (!res.ok) throw fromResponse('Toy preview rendering', res.status, await res.text())

    const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] }
    const first = data.data?.[0]
    if (!first?.b64_json) {
        throw new ProviderError(
            'unusable_result',
            'Image model returned no image data',
            'The toy design did not come out. Try again.',
        )
    }
    return { bytes: new Uint8Array(Buffer.from(first.b64_json, 'base64')), contentType: 'image/png' }
}
