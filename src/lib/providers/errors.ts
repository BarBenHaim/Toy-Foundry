// src/lib/providers/errors.ts
//
// One error type for every outside service, so an API route can decide
// what to tell the parent without knowing which provider failed.
//
// `userMessage` is the whole point. "Meshy returned 429" is true and
// useless on a screen; "our sculptor is busy — try again in a minute" is
// what the parent needs, and the true version goes to the log.

export type ProviderErrorCode =
    | 'not_configured'
    | 'rate_limited'
    | 'rejected'
    | 'timeout'
    | 'upstream'
    | 'unusable_result'

export class ProviderError extends Error {
    code: ProviderErrorCode
    userMessage: string
    status: number

    constructor(code: ProviderErrorCode, message: string, userMessage: string, status = 502) {
        super(message)
        this.name = 'ProviderError'
        this.code = code
        this.userMessage = userMessage
        this.status = status
    }
}

export function notConfigured(what: string): ProviderError {
    return new ProviderError(
        'not_configured',
        `${what} is not configured`,
        'This step is not switched on yet. Your project is saved — we will pick it up from here.',
        503,
    )
}

/** Map a provider's HTTP status onto something a parent can read. */
export function fromResponse(what: string, status: number, body: string): ProviderError {
    const detail = body.slice(0, 400)
    if (status === 429) {
        return new ProviderError(
            'rate_limited',
            `${what} rate limited: ${detail}`,
            'Lots of drawings are coming through right now. Give it a minute and try again.',
            429,
        )
    }
    if (status === 400 || status === 422) {
        return new ProviderError(
            'rejected',
            `${what} rejected the request: ${detail}`,
            'That image could not be used. Try a clearer, brighter photo of the drawing.',
            400,
        )
    }
    return new ProviderError('upstream', `${what} failed (${status}): ${detail}`, 'Something went wrong on our side. Try again in a moment.')
}

/** fetch with a deadline. Without one, a hung provider connection holds
 *  a serverless invocation until the platform kills it, and the parent
 *  watches a spinner for the whole timeout. */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, what: string): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new ProviderError('timeout', `${what} did not answer in ${timeoutMs}ms: ${message}`, 'That took too long. Try again.', 504)
    }
}
