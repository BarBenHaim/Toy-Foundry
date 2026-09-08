// src/lib/toyBrief.ts
//
// Turning a child's drawing into the words an image model needs.
//
// The whole product lives or dies on one tension. Ask for "a beautiful
// 3D collectible toy" and you get a beautiful toy that is not the
// child's character — the model quietly replaces the wonky three-legged
// cat with a well-proportioned cat, and the parent's reaction is "that's
// not it", which is worse than an ugly render. Ask for "copy this
// drawing exactly" and you get a flat, literal extrusion nobody wants on
// a shelf.
//
// The resolution here is to make identity explicit and non-negotiable
// while leaving craft open:
//
//   1. The drawing itself is always attached to the request. Words alone
//      never carry a child's shapes.
//   2. The features the vision pass scored 3+ are restated as a list the
//      model is told it may not drop. That list is the difference
//      between "your kid's monster" and "a monster".
//   3. Printability is stated as design language, not as engineering
//      constraints — "thick, chunky limbs", not "minimum 2mm walls" —
//      because image models act on the former and ignore the latter.
//      The millimetres are checked later, in printability.ts, against
//      the same rules in printRules.ts.
//   4. Revisions are additive directives appended in order, so "bigger
//      horns" then "make it purple" produces one prompt asking for both
//      rather than two prompts that fight.
//
// This file is pure. It builds strings and is fully unit-tested; the
// network call that uses them lives in providers/imageModel.ts.

import { identityAnchors } from './characterDna'
import { DESIGN_FOR_PRINT_RULES } from './printRules'
import type { CharacterDna, RevisionKind, RevisionRequest } from './types'

/** How many revisions a parent gets before we ask them to approve or
 *  start over. Each one is a paid image generation, and past about six
 *  the character has usually drifted further from the drawing than the
 *  first render was. */
export const MAX_REVISIONS = 6

/** Free text is passed to a model, so it is clamped hard and stripped of
 *  the two things that turn a revision into a prompt injection: role
 *  words and instruction-shaped punctuation runs. */
export const MAX_CUSTOM_REVISION_CHARS = 120

export interface PreviewState {
    dna: CharacterDna
    revisions: RevisionRequest[]
}

const STYLE = [
    'a designer vinyl collectible toy of this character',
    'stylised 3D character sculpt, smooth matte vinyl surfaces, soft rounded forms',
    'clean studio product photograph, soft even lighting, gentle contact shadow',
    'plain light neutral background, no text, no logos, no packaging, no props',
    'full body, standing, facing the camera, centred, whole toy visible with margin around it',
].join('; ')

/** The single most important paragraph in the product. */
function identityBlock(dna: CharacterDna): string {
    const anchors = identityAnchors(dna, 5)
    const lines = anchors.map(f => `- ${f.kind}: ${f.description}${f.color ? ` (${f.color})` : ''}`)
    const palette = dna.palette.join(', ')
    const head =
        dna.proportions.headToBody >= 1.2
            ? 'keep the oversized head — it is most of why the drawing looks like itself'
            : 'keep the head-to-body ratio of the drawing'

    return [
        `The character is ${dna.name}: ${dna.summary}`,
        'This is a real child’s drawing. Sculpt THIS character — do not substitute a better-drawn or more conventional creature.',
        lines.length > 0 ? `Features that must all appear, in these counts and positions:\n${lines.join('\n')}` : '',
        `Keep the drawing’s colours: ${palette}.`,
        `${head}. Body plan: ${dna.bodyPlan}. Stance: ${dna.proportions.stance}. Limbs: ${dna.proportions.limbLength}.`,
        dna.quirks.length > 0 ? `Keep these oddities exactly as drawn: ${dna.quirks.join('; ')}.` : '',
        'The wonky, asymmetric, hand-drawn qualities are the point. Tidy the craft, never the character.',
    ]
        .filter(Boolean)
        .join('\n')
}

function printBlock(): string {
    return ['Design it so it can be 3D printed as one solid object:', ...DESIGN_FOR_PRINT_RULES.map(r => `- ${r}`)].join(
        '\n',
    )
}

/** One directive per revision, in the order the parent asked for them. */
export function revisionDirective(revision: RevisionRequest, dna: CharacterDna): string {
    switch (revision.kind) {
        case 'bigger_feature': {
            const target = (revision.detail || '').trim() || 'the main feature'
            return `Make the ${target} noticeably bigger and bolder than in the previous version, while keeping everything else identical.`
        }
        case 'change_color': {
            const target = (revision.detail || '').trim()
            const palette = dna.palette.slice(0, 2).join(' and ')
            return target
                ? `Recolour the toy so its dominant colour is ${target}. Keep the character, the shapes and the markings unchanged; only the colour changes.`
                : `Shift the palette away from ${palette} while keeping the character and shapes unchanged.`
        }
        case 'cuter':
            return 'Make it cuter: rounder body, bigger eyes, softer edges, friendlier expression. Keep every distinguishing feature — cuter, not different.'
        case 'closer_to_drawing':
            return 'Stay much closer to the original drawing. Match its exact proportions, its asymmetries and its colours even where they look naive. Prefer faithfulness over polish.'
        case 'custom':
            return `The parent asked for this change, and only this change: "${sanitizeCustom(revision.detail || '')}". Keep everything else identical.`
        default:
            return ''
    }
}

/** Build the full prompt for a preview render.
 *
 *  `attempt` is the render number for this state — passed through to the
 *  provider so a retry after a bad render is not bit-identical. */
export function buildToyPrompt(state: PreviewState): string {
    const directives = state.revisions
        .map(r => revisionDirective(r, state.dna))
        .filter(Boolean)
        .map((line, i) => `${i + 1}. ${line}`)

    const revisionBlock =
        directives.length > 0
            ? `Changes requested by the parent, applied in order on top of the character above:\n${directives.join('\n')}`
            : ''

    return [
        STYLE + '.',
        identityBlock(state.dna),
        printBlock(),
        revisionBlock,
        'Output: one toy, one image, no variants side by side.',
    ]
        .filter(Boolean)
        .join('\n\n')
}

/** The system prompt for the vision pass. Asks for JSON and nothing
 *  else; normalizeDna cleans up whatever actually comes back. */
export const DNA_SYSTEM_PROMPT = `You are a toy designer looking at a child's drawing.

Your job is to record what makes THIS character recognisable, so that a 3D toy of it can be sculpted later without losing its identity. Be literal. If the creature has three eyes of different sizes, that is the single most important thing about it.

Reply with JSON only, no prose, in exactly this shape:
{
  "name": "short name for the creature, use the child's written name if one is visible",
  "summary": "one sentence a parent would recognise",
  "bodyPlan": "biped | quadruped | blob | winged | other",
  "features": [
    { "kind": "horns", "description": "two curved horns, the left one longer", "importance": 5, "color": "#8a5cff" }
  ],
  "palette": ["#hex", "#hex"],
  "proportions": { "headToBody": 1.4, "limbLength": "short|medium|long", "stance": "wide|narrow" },
  "quirks": ["one shoe is a different colour"],
  "confidence": 0.0
}

Rules:
- importance 5 = removing it would make the parent say "that isn't it". 1 = incidental.
- Colours must be hex sampled from the drawing, not colour names.
- confidence is how clearly you can read the drawing: a crisp marker drawing is 0.9, a faint pencil sketch photographed in poor light is 0.3, a photo with no drawing in it at all is 0.0.
- List every limb, eye, horn, wing, spike, tail and accessory you can see, with counts.`

/** Guard the one free-text field that reaches a model.
 *
 *  Not a security boundary on its own — the image model cannot act, and
 *  the vision output is re-normalised — but it removes the obvious
 *  "ignore previous instructions" shape and keeps the prompt short
 *  enough to stay coherent. */
export function sanitizeCustom(text: string): string {
    return text
        .replace(/[\r\n]+/g, ' ')
        .replace(/\b(ignore|disregard|forget)\b[^.]*\b(instructions?|prompt|above|previous)\b/gi, '')
        .replace(/\b(system|assistant|developer)\s*:/gi, '')
        .replace(/["`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_CUSTOM_REVISION_CHARS)
}

/** Validate a revision coming off the wire. Returns null for anything we
 *  do not offer, so an API route can 400 on it. */
export function parseRevision(raw: unknown): RevisionRequest | null {
    if (!raw || typeof raw !== 'object') return null
    const input = raw as Record<string, unknown>
    const kinds: RevisionKind[] = ['bigger_feature', 'change_color', 'cuter', 'closer_to_drawing', 'custom']
    if (!kinds.includes(input.kind as RevisionKind)) return null
    const kind = input.kind as RevisionKind
    const detail = typeof input.detail === 'string' ? input.detail : ''

    if (kind === 'custom') {
        const clean = sanitizeCustom(detail)
        if (clean.length < 3) return null
        return { kind, detail: clean }
    }
    if (kind === 'bigger_feature' || kind === 'change_color') {
        const clean = sanitizeCustom(detail)
        if (!clean) return null
        return { kind, detail: clean }
    }
    return { kind }
}

/** Parent-facing label for a revision, for the "what you asked for" list
 *  under the preview. */
export function describeRevision(revision: RevisionRequest): string {
    switch (revision.kind) {
        case 'bigger_feature':
            return `Bigger ${revision.detail || 'features'}`
        case 'change_color':
            return `Colour → ${revision.detail}`
        case 'cuter':
            return 'Cuter'
        case 'closer_to_drawing':
            return 'Closer to the drawing'
        case 'custom':
            return revision.detail || 'Custom change'
        default:
            return 'Change'
    }
}
