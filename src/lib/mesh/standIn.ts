// src/lib/mesh/standIn.ts
//
// A printable toy built from primitives, driven by the character DNA.
//
// What this is FOR, since a procedural sculpt sitting next to a real
// image-to-3D integration invites the wrong reading: it is the floor
// under the product. It runs in two situations —
//
//   1. Demo mode, where nobody has entered an API key yet, and the whole
//      flow still has to be walkable end to end. The brief explicitly
//      allows steps to be manual behind the scenes as long as the
//      EXPERIENCE is complete; a stand-in sculpt is the same bargain.
//   2. A sculpting outage. A parent who has paid should get a toy that
//      is chunky, printable and roughly their child's creature rather
//      than a refund email, with a human in the loop before it ships.
//
// It is not a mock. The mesh it returns goes through the same weld, the
// same repair, the same printability check and the same STL writer as a
// Meshy sculpt, and the admin queue marks the order so nothing ships
// without someone looking at it first.
//
// The geometry is deliberately naive — spheres and cones — because the
// job is "chunky, stable, recognisably has the right parts", not
// "beautiful". Beauty is what the image model and Meshy are for.

import { identityAnchors } from '../characterDna'
import type { CharacterDna } from '../types'
import { Mesh } from './geometry'
import { boxMesh, cylinderMesh, rotated, scaled, sphereMesh, translated } from './primitives'

/** Nominal build height. Everything below is proportioned against it and
 *  then scaled to whatever the parent ordered. */
const H = 100

interface Part {
    mesh: Mesh
}

export function buildStandInToy(dna: CharacterDna): Mesh {
    const rng = seeded(dna.name + dna.summary)
    const parts: Part[] = []

    // Head-to-body from the drawing. A child's drawing is usually a big
    // head on a small body, and keeping that is most of why the toy
    // still reads as theirs.
    const headRatio = clamp(dna.proportions.headToBody, 0.6, 2.2)
    const headR = (H * 0.19 * headRatio) / 1.2
    const bodyR = H * 0.2
    const legH = dna.proportions.limbLength === 'long' ? H * 0.2 : dna.proportions.limbLength === 'short' ? H * 0.1 : H * 0.15
    const stance = dna.proportions.stance === 'wide' ? 1.25 : 0.9

    const legTop = legH
    const bodyZ = legTop + bodyR * 0.85
    const headZ = bodyZ + bodyR * 0.75 + headR * 0.75

    const quadruped = dna.bodyPlan === 'quadruped'
    const blob = dna.bodyPlan === 'blob'

    // ── Feet ────────────────────────────────────────────────────────
    // Wide, planted, and always thicker than the 2mm rule by a factor of
    // several: feet are what the stability check measures.
    const footR = Math.max(H * 0.075, 4)
    const footOffsets: [number, number][] = quadruped
        ? [
              [-bodyR * 0.75, -bodyR * 0.5 * stance],
              [-bodyR * 0.75, bodyR * 0.5 * stance],
              [bodyR * 0.75, -bodyR * 0.5 * stance],
              [bodyR * 0.75, bodyR * 0.5 * stance],
          ]
        : [
              [0, -bodyR * 0.45 * stance],
              [0, bodyR * 0.45 * stance],
          ]

    for (const [x, y] of footOffsets) {
        parts.push({ mesh: translated(cylinderMesh(footR, footR * 0.95, legTop + bodyR * 0.3, 20), [x, y, 0]) })
        // A rounded toe cap, so the foot does not read as a peg. Its
        // centre sits exactly one squashed radius up: dropped any lower
        // the toy ends up standing on two tangent points instead of on
        // its base, and the stability check is right to complain.
        parts.push({ mesh: translated(scaled(sphereMesh(footR, 16, 10), [1, 1, 0.6]), [x, y, footR * 0.6]) })
    }

    // ── Body ────────────────────────────────────────────────────────
    const bodyScale: [number, number, number] = blob
        ? [1.25, 1.15, 1.05]
        : quadruped
          ? [1.5, 0.95, 0.9]
          : [1, 0.9, 1.15]
    parts.push({ mesh: translated(scaled(sphereMesh(bodyR, 22, 16), bodyScale), [0, 0, bodyZ]) })

    // ── Head ────────────────────────────────────────────────────────
    const headX = quadruped ? bodyR * 1.1 : 0
    const headPos: [number, number, number] = [headX, 0, quadruped ? bodyZ + headR * 0.5 : headZ]
    parts.push({ mesh: translated(scaled(sphereMesh(headR, 22, 16), [1, 0.95, 1]), headPos) })
    // Neck: keeps head and body one solid even when the two spheres
    // barely touch, which is what a slicer needs and what the part
    // grouping check looks for.
    parts.push({
        mesh: translated(cylinderMesh(headR * 0.55, headR * 0.55, Math.max(headPos[2] - bodyZ, 1), 16), [
            headX * 0.5,
            0,
            bodyZ,
        ]),
    })

    // ── Arms ────────────────────────────────────────────────────────
    if (!quadruped && !blob) {
        for (const side of [-1, 1]) {
            const arm = rotated(cylinderMesh(H * 0.045, H * 0.04, bodyR * 1.1, 14), 'x', side * 0.55)
            parts.push({ mesh: translated(arm, [0, side * bodyR * 0.75, bodyZ + bodyR * 0.1]) })
        }
    }

    // ── Whatever the child actually drew ────────────────────────────
    for (const feature of identityAnchors(dna, 6)) {
        const kind = feature.kind.toLowerCase()
        const count = countIn(feature.description)

        if (/horn|antler|spike/.test(kind)) {
            const n = clamp(count || 2, 1, 4)
            for (let i = 0; i < n; i++) {
                const spread = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2
                const horn = rotated(cylinderMesh(headR * 0.3, headR * 0.1, headR * 0.9, 12), 'y', spread * 0.35)
                parts.push({ mesh: translated(horn, [headPos[0] + spread * headR * 0.15, spread * headR * 0.5, headPos[2] + headR * 0.55]) })
            }
        } else if (/wing/.test(kind)) {
            for (const side of [-1, 1]) {
                const wing = rotated(scaled(sphereMesh(bodyR * 0.75, 14, 10), [0.9, 0.25, 1.1]), 'x', side * 0.25)
                parts.push({ mesh: translated(wing, [-bodyR * 0.35, side * bodyR * 0.85, bodyZ + bodyR * 0.35]) })
            }
        } else if (/tail/.test(kind)) {
            const tail = rotated(cylinderMesh(bodyR * 0.28, bodyR * 0.12, bodyR * 1.1, 12), 'y', -1.9)
            parts.push({ mesh: translated(tail, [-bodyR * 0.9, 0, bodyZ + bodyR * 0.1]) })
        } else if (/ear/.test(kind)) {
            for (const side of [-1, 1]) {
                parts.push({
                    mesh: translated(scaled(sphereMesh(headR * 0.38, 14, 10), [0.6, 0.9, 1.1]), [
                        headPos[0],
                        side * headR * 0.8,
                        headPos[2] + headR * 0.5,
                    ]),
                })
            }
        } else if (/eye/.test(kind)) {
            const n = clamp(count || 2, 1, 3)
            for (let i = 0; i < n; i++) {
                const spread = n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.4
                // Eyes are proud of the face, not sunk into it: a
                // printed sphere reads, a printed dimple does not.
                parts.push({
                    mesh: translated(sphereMesh(headR * (n > 2 ? 0.24 : 0.3), 14, 10), [
                        headPos[0] + headR * 0.72,
                        spread * headR * 0.55,
                        headPos[2] + headR * 0.15,
                    ]),
                })
            }
        } else if (/nose|snout|beak/.test(kind)) {
            parts.push({
                mesh: translated(scaled(sphereMesh(headR * 0.33, 14, 10), [1.1, 0.8, 0.8]), [
                    headPos[0] + headR * 0.8,
                    0,
                    headPos[2] - headR * 0.1,
                ]),
            })
        } else if (/fin|shell|hump|backpack/.test(kind)) {
            parts.push({
                mesh: translated(scaled(sphereMesh(bodyR * 0.6, 14, 10), [0.7, 1, 0.8]), [-bodyR * 0.6, 0, bodyZ + bodyR * 0.4]),
            })
        } else {
            // Something we do not have a shape for. Give it a chunky
            // bump somewhere plausible rather than dropping it: the
            // parent asked for a creature with a thing, and a bump is
            // closer to a thing than nothing is.
            const angle = rng() * Math.PI * 2
            parts.push({
                mesh: translated(sphereMesh(bodyR * 0.28, 12, 8), [
                    Math.cos(angle) * bodyR * 0.8,
                    Math.sin(angle) * bodyR * 0.7,
                    bodyZ + bodyR * (rng() - 0.2),
                ]),
            })
        }
    }

    // A small integrated base under the feet. It is the cheapest
    // insurance against the stability check, and every collectible on a
    // shelf has one.
    const baseR = Math.max(...footOffsets.map(([x, y]) => Math.hypot(x, y))) + footR * 1.35
    parts.push({ mesh: translated(cylinderMesh(baseR, baseR * 0.97, H * 0.03, 28), [0, 0, 0]) })

    return mergeParts(parts.map(p => p.mesh))
}

function mergeParts(meshes: Mesh[]): Mesh {
    const totalV = meshes.reduce((n, m) => n + m.positions.length, 0)
    const totalI = meshes.reduce((n, m) => n + m.indices.length, 0)
    const positions = new Float64Array(totalV)
    const indices = new Uint32Array(totalI)
    let v = 0
    let i = 0
    for (const mesh of meshes) {
        const base = v / 3
        positions.set(mesh.positions, v)
        for (let k = 0; k < mesh.indices.length; k++) indices[i + k] = mesh.indices[k] + base
        v += mesh.positions.length
        i += mesh.indices.length
    }
    return { positions, indices }
}

/** "three eyes", "2 horns" → 3, 2. Returns 0 when there is no count to
 *  read, and the caller picks a sensible default. */
export function countIn(text: string): number {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
    const digits = text.match(/\b(\d{1,2})\b/)
    if (digits) return Number(digits[1])
    for (const [word, n] of Object.entries(words)) {
        if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return n
    }
    return 0
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n))
}

/** Deterministic per-character randomness: the same drawing must always
 *  produce the same stand-in, or a page refresh silently reshapes the
 *  toy the parent is looking at. */
function seeded(text: string): () => number {
    let h = 2166136261
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return () => {
        h += 0x6d2b79f5
        let t = h
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
