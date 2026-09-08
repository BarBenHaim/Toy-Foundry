// src/lib/address.ts
//
// Shipping address validation, kept pure so it runs identically in the
// checkout form and in the route that trusts nothing the form said.
//
// The rules are deliberately loose on format and strict on presence.
// Postcodes, street formats and phone shapes differ per country and
// every clever regex rejects somebody's real address; what actually
// causes a failed delivery is a missing line, so that is what is
// enforced. The one format check is the email, because that is how the
// parent hears about their order.

import type { ShippingAddress } from './types'

export interface AddressProblem {
    field: keyof ShippingAddress
    message: string
}

const REQUIRED: { field: keyof ShippingAddress; label: string; max: number }[] = [
    { field: 'name', label: 'Full name', max: 120 },
    { field: 'email', label: 'Email', max: 160 },
    { field: 'street1', label: 'Street address', max: 200 },
    { field: 'city', label: 'City', max: 100 },
    { field: 'postcode', label: 'Postcode', max: 20 },
    { field: 'countryCode', label: 'Country', max: 2 },
]

/** Deliberately permissive: one @, something either side, a dot in the
 *  domain. Anything stricter rejects valid addresses, and the real
 *  check is whether the confirmation email arrives. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateAddress(raw: unknown): { address: ShippingAddress | null; problems: AddressProblem[] } {
    const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const problems: AddressProblem[] = []
    const clean: Record<string, string> = {}

    for (const { field, label, max } of REQUIRED) {
        const value = typeof input[field] === 'string' ? (input[field] as string).trim() : ''
        if (!value) {
            problems.push({ field, message: `${label} is required.` })
            continue
        }
        if (value.length > max) {
            problems.push({ field, message: `${label} is too long.` })
            continue
        }
        clean[field] = value
    }

    if (clean.email && !EMAIL.test(clean.email)) {
        problems.push({ field: 'email', message: 'That email address does not look right.' })
    }
    if (clean.countryCode) {
        const code = clean.countryCode.toUpperCase()
        if (!/^[A-Z]{2}$/.test(code)) {
            problems.push({ field: 'countryCode', message: 'Country must be a two-letter code, like IL or US.' })
        } else {
            clean.countryCode = code
        }
    }

    if (problems.length > 0) return { address: null, problems }

    return {
        address: {
            name: clean.name,
            email: clean.email,
            street1: clean.street1,
            city: clean.city,
            postcode: clean.postcode,
            countryCode: clean.countryCode,
            ...(typeof input.street2 === 'string' && input.street2.trim()
                ? { street2: input.street2.trim().slice(0, 200) }
                : {}),
            ...(typeof input.phone === 'string' && input.phone.trim()
                ? { phone: input.phone.trim().slice(0, 40) }
                : {}),
        },
        problems: [],
    }
}
