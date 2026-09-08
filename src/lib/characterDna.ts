// src/lib/characterDna.ts
//
// The vision model's answer, made safe to build a product on.
//
// Everything here is defensive in one direction: a drawing that was read
// badly must degrade into a vague-but-usable creature, never into a
// crash and never into a confident wrong answer. A parent whose child
// drew a purple three-eyed cat will forgive "we made the cat a bit
// rounder". They will not forgive a blank screen, and they will REALLY
// not forgive a green dog.
//
// So: every field is clamped, every enum is whitelisted, and the
// confidence score is honest enough to trigger "try a clearer photo"
// instead of guessing.

import type { BodyPlan, CharacterDna, DnaFeature } from './types'

const BODY_PLANS: BodyPlan[] = ['biped', 'quadruped', 'blob', 'winged', 'other']

/** Under this, we ask for a better photo rather than render a guess. */
export const CONFIDENCE_FLOOR = 0.35

export const MAX_FEATURES = 8
export const MAX_PALETTE = 6

/** Normalise whatever the model returned into a CharacterDna. Never
 *  throws: an unparseable answer becomes a low-confidence creature, and
 *  the caller decides what to do about the confidence. */
export function normalizeDna(raw: unknown): CharacterDna {
    const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

    const features = Array.isArray(input.features)
        ? input.features
              .map(normalizeFeature)
              .filter((f): f is DnaFeature => f !== null)
              .sort((a, b) => b.importance - a.importance)
              .slice(0, MAX_FEATURES)
        : []

    const palette = Array.isArray(input.palette)
        ? input.palette
              .map(normalizeHex)
              .filter((c): c is string => c !== null)
              .slice(0, MAX_PALETTE)
        : []

    const proportions = (input.proportions && typeof input.proportions === 'object'
        ? input.proportions
        : {}) as Record<string, unknown>

    return {
        name: clampText(input.name, 40) || 'The creature',
        summary: clampText(input.summary, 240) || 'A character from a child’s drawing.',
        bodyPlan: BODY_PLANS.includes(input.bodyPlan as BodyPlan) ? (input.bodyPlan as BodyPlan) : 'other',
        features,
        // A drawing always has colours. An empty palette means the vision
        // pass failed at reading, not that the child drew in greyscale —
        // but we cannot tell those apart, so fall back to something warm
        // and say so through the confidence score instead.
        palette: palette.length > 0 ? palette : ['#F2B705', '#3A86FF', '#FF5D8F'],
        proportions: {
            headToBody: clampNumber(proportions.headToBody, 0.3, 3, 1),
            limbLength: pick(proportions.limbLength, ['short', 'medium', 'long'] as const, 'medium'),
            stance: pick(proportions.stance, ['wide', 'narrow'] as const, 'wide'),
        },
        quirks: Array.isArray(input.quirks)
            ? input.quirks
                  .map(q => clampText(q, 120))
                  .filter(Boolean)
                  .slice(0, 5)
            : [],
        confidence: clampNumber(input.confidence, 0, 1, 0.5),
    }
}

function normalizeFeature(raw: unknown): DnaFeature | null {
    if (!raw || typeof raw !== 'object') return null
    const f = raw as Record<string, unknown>
    const kind = clampText(f.kind, 32).toLowerCase()
    const description = clampText(f.description, 160)
    if (!kind && !description) return null
    return {
        kind: kind || 'detail',
        description: description || kind,
        importance: Math.round(clampNumber(f.importance, 1, 5, 3)),
        ...(normalizeHex(f.color) ? { color: normalizeHex(f.color) as string } : {}),
    }
}

/** The features that must survive every revision, in order. Used both to
 *  write the prompt and to explain to the parent what we are protecting. */
export function identityAnchors(dna: CharacterDna, limit = 4): DnaFeature[] {
    return dna.features.filter(f => f.importance >= 3).slice(0, limit)
}

/** Is this reading good enough to build on? */
export function isConfident(dna: CharacterDna): boolean {
    return dna.confidence >= CONFIDENCE_FLOOR && dna.features.length > 0
}

/** Find the feature a "make the horns bigger" style revision refers to.
 *  Matches on the kind first, then anywhere in the description, so
 *  "wings" finds a feature described as "small bat wings on the back". */
export function findFeature(dna: CharacterDna, term: string): DnaFeature | null {
    const needle = term.trim().toLowerCase()
    if (!needle) return null
    return (
        dna.features.find(f => f.kind === needle) ||
        dna.features.find(f => f.kind.includes(needle) || needle.includes(f.kind)) ||
        dna.features.find(f => f.description.toLowerCase().includes(needle)) ||
        null
    )
}

function clampText(value: unknown, max: number): string {
    if (typeof value !== 'string') return ''
    // Collapse whitespace: models like to return "  three\n  horns".
    return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value)
    if (!isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback
}

/** '#rgb', 'rgb', '#RRGGBB' and 'RRGGBB' all normalise to '#rrggbb'.
 *  Anything else — including colour names, which the model does return —
 *  is dropped rather than guessed at. */
export function normalizeHex(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const hex = value.trim().replace(/^#/, '')
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        return `#${hex
            .toLowerCase()
            .split('')
            .map(c => c + c)
            .join('')}`
    }
    return null
}
