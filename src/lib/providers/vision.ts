// src/lib/providers/vision.ts
//
// Step 2: read the drawing and write down what makes it
// itself. Claude with vision, asked for JSON, normalised hard on the way
// back out.
//
// The prompt lives in toyBrief.ts next to the prompt that CONSUMES this
// output, because the two have to agree about what a "feature" is and
// they drift apart the moment they live in different files.

import { normalizeDna } from '../characterDna'
import { DNA_SYSTEM_PROMPT } from '../toyBrief'
import type { CharacterDna } from '../types'
import { ProviderError, fetchWithTimeout, fromResponse, notConfigured } from './errors'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

/** Sonnet, not Haiku. Reading a child's drawing is a judgement call —
 *  which of the seven blobs is a hand, whether that line is a tail or a
 *  shadow — and judgement is the thing model tiers actually differ on.
 *  One call per project makes the cost difference a rounding error. */
export const VISION_MODEL = process.env.TOYFOUNDRY_VISION_MODEL || 'claude-sonnet-4-5'

export function isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY)
}

export async function analyzeDrawing(image: { bytes: Uint8Array; contentType: string }): Promise<CharacterDna> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw notConfigured('Drawing analysis')

    const res = await fetchWithTimeout(
        API_URL,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': API_VERSION,
            },
            body: JSON.stringify({
                model: VISION_MODEL,
                max_tokens: 1200,
                system: DNA_SYSTEM_PROMPT,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: normalizeMediaType(image.contentType),
                                    data: Buffer.from(image.bytes).toString('base64'),
                                },
                            },
                            { type: 'text', text: 'Record this character.' },
                        ],
                    },
                ],
            }),
        },
        45000,
        'Drawing analysis',
    )

    if (!res.ok) throw fromResponse('Drawing analysis', res.status, await res.text())

    const data = (await res.json()) as { content?: { type: string; text?: string }[] }
    const text = (data.content || [])
        .filter(block => block.type === 'text')
        .map(block => block.text || '')
        .join('\n')

    return normalizeDna(extractJson(text))
}

/** Models put JSON inside prose and inside code fences no matter how
 *  firmly you ask them not to. Take the outermost object and parse that;
 *  a failure here becomes a low-confidence creature, not a crash. */
export function extractJson(text: string): unknown {
    if (!text) return {}
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const candidate = fenced ? fenced[1] : text
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start) return {}
    try {
        return JSON.parse(candidate.slice(start, end + 1))
    } catch {
        return {}
    }
}

/** The API takes four media types. A phone that hands us HEIC has to be
 *  converted before it gets here — the upload route does that — so
 *  anything unexpected is labelled JPEG rather than refused, which is
 *  what the bytes almost always are. */
function normalizeMediaType(contentType: string): string {
    const type = (contentType || '').toLowerCase()
    if (type === 'image/png' || type === 'image/gif' || type === 'image/webp') return type
    return 'image/jpeg'
}
