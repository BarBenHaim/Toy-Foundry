// src/lib/ids.ts
//
// Ids and the owner token.
//
// There is no login in the MVP. A parent uploads a drawing and gets a
// project; the thing that proves the project is theirs is a random token
// held in their browser and never shown in a URL that gets shared. That
// is a deliberate trade: an account wall in front of "see your child's
// drawing become a toy" costs more conversions than the token costs in
// security, and nothing behind the token is worth stealing except the
// drawing the thief would have to already have.
//
// The token is 256 bits from the platform CSPRNG. Comparison is
// constant-time so a wrong token cannot be discovered a character at a
// time by timing the response.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomBytes(n: number): Uint8Array {
    const out = new Uint8Array(n)
    // Present in Node 18+ and every browser we support. No node:crypto
    // import, so this file is safe to pull into a client component.
    globalThis.crypto.getRandomValues(out)
    return out
}

/** Short, URL-safe, and unmistakable in a support conversation:
 *  'toy_k3f9xq2m'. Not a secret — that is what the token is for. */
export function newId(prefix: string, length = 10): string {
    const bytes = randomBytes(length)
    let out = ''
    for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
    return `${prefix}_${out}`
}

/** 64 hex characters. */
export function newToken(): string {
    const bytes = randomBytes(32)
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time string compare. Returns false for length mismatch,
 *  which does leak the length — the token length is a public constant,
 *  so that leaks nothing. */
export function tokensMatch(a: unknown, b: unknown): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false
    if (a.length !== b.length || a.length === 0) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}
