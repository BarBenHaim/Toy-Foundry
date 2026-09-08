// src/lib/http.ts
//
// The three things every ToyFoundry route does the same way: find the
// owner token, shape a success, shape a failure.
//
// Errors are the interesting part. A parent mid-flow needs a sentence
// they can act on; the log needs the provider's actual words. ProviderError
// carries both, so routes throw and this turns it into the right pair.

import { NextResponse } from 'next/server'
import { ProviderError } from './providers/errors'

export const TOKEN_HEADER = 'x-toyfoundry-token'

/** Header first, query string second. GETs that a browser navigates to
 *  cannot set a header; POSTs always should. */
export function tokenFrom(req: Request): string {
    const header = req.headers.get(TOKEN_HEADER)
    if (header) return header.trim()
    try {
        return new URL(req.url).searchParams.get('token')?.trim() || ''
    } catch {
        return ''
    }
}

export function ok<T>(data: T, status = 200): NextResponse {
    return NextResponse.json(data as Record<string, unknown>, {
        status,
        // Nothing here is cacheable: it is one parent's in-progress
        // project, and a CDN hit would show them someone else's toy.
        headers: { 'cache-control': 'no-store' },
    })
}

export function fail(message: string, status = 400): NextResponse {
    return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } })
}

/** The catch-all. Provider failures become their user-facing sentence;
 *  anything else becomes a generic apology, because an unexpected
 *  exception's message is as likely to contain a stack path or a key
 *  fragment as anything useful. */
export function failFrom(error: unknown, context: string): NextResponse {
    if (error instanceof ProviderError) {
        console.error(`[toyfoundry] ${context}:`, error.message)
        return fail(error.userMessage, error.status)
    }
    console.error(`[toyfoundry] ${context}:`, error)
    return fail('Something went wrong. Try again in a moment.', 500)
}

/** 404 for "not yours" as well as "not there". A caller probing project
 *  ids should not be able to tell the two apart. */
export function notFound(): NextResponse {
    return fail('Not found', 404)
}
