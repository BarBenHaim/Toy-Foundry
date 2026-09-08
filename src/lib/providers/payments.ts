// src/lib/providers/payments.ts
//
// Taking the money, behind an interface with two implementations.
//
// Stripe is called over its REST API with a form-encoded body rather
// than through the SDK. That is a deliberate choice, not laziness: the
// SDK is 4MB of TypeScript for one POST, it pins its own fetch stack,
// and the whole surface used here is two endpoints. Checkout Sessions
// also mean no card data ever touches this app, which is the difference
// between "we take payments" and "we are in PCI scope".
//
// The second implementation is a demo provider that marks an order paid
// without charging anything. It exists so the flow can feel complete
// before every integration is live, and it is fenced behind an explicit
// env flag rather than "no Stripe key configured" —
// a missing key in production is an outage, and an outage must not
// silently start giving toys away.

import { ProviderError, fetchWithTimeout, fromResponse } from './errors'
import type { OrderPricing } from '../types'

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions'

export type PaymentProviderId = 'stripe' | 'demo'

export interface CheckoutSession {
    provider: PaymentProviderId
    /** Where to send the parent. For the demo provider this is our own
     *  page, which says in as many words that no card will be charged. */
    url: string
    reference: string | null
}

export function activeProvider(): PaymentProviderId | null {
    if (process.env.STRIPE_SECRET_KEY) return 'stripe'
    if (process.env.TOYFOUNDRY_DEMO_PAYMENTS === '1') return 'demo'
    return null
}

export function isConfigured(): boolean {
    return activeProvider() !== null
}

export async function createCheckout(input: {
    orderId: string
    pricing: OrderPricing
    email: string
    toyName: string
    successUrl: string
    cancelUrl: string
}): Promise<CheckoutSession> {
    const provider = activeProvider()
    if (provider === 'demo') {
        return { provider: 'demo', url: input.successUrl, reference: `demo_${input.orderId}` }
    }
    if (provider !== 'stripe') {
        throw new ProviderError(
            'not_configured',
            'No payment provider configured',
            'Checkout is not switched on yet.',
            503,
        )
    }

    // Stripe's API is form-encoded with bracket notation for nested
    // fields. Written out rather than generated so the shape is
    // readable next to their docs.
    const body = new URLSearchParams({
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': input.pricing.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(input.pricing.toyMinor),
        'line_items[0][price_data][product_data][name]': `${input.toyName} — ${input.pricing.heightMm / 10}cm toy`,
        'line_items[0][price_data][product_data][description]': 'A one-off 3D printed toy of your child’s character',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer_email: input.email,
        'metadata[orderId]': input.orderId,
        // The reference Stripe shows on the payment itself, so a refund
        // request in the dashboard can be traced back without a lookup.
        client_reference_id: input.orderId,
    })
    if (input.pricing.shippingMinor > 0) {
        body.set('line_items[1][quantity]', '1')
        body.set('line_items[1][price_data][currency]', input.pricing.currency.toLowerCase())
        body.set('line_items[1][price_data][unit_amount]', String(input.pricing.shippingMinor))
        body.set('line_items[1][price_data][product_data][name]', 'Shipping')
    }

    const res = await fetchWithTimeout(
        STRIPE_API,
        {
            method: 'POST',
            headers: {
                authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'content-type': 'application/x-www-form-urlencoded',
                // Two clicks on "pay" must not create two sessions and
                // two charges. The order id is unique per attempt.
                'idempotency-key': `toyfoundry_${input.orderId}`,
            },
            body: body.toString(),
        },
        20000,
        'Checkout',
    )
    if (!res.ok) throw fromResponse('Checkout', res.status, await res.text())

    const data = (await res.json()) as { id?: string; url?: string }
    if (!data.url) {
        throw new ProviderError('unusable_result', 'Stripe returned no checkout URL', 'Could not open checkout. Try again.')
    }
    return { provider: 'stripe', url: data.url, reference: data.id || null }
}

/** Confirm a payment before believing the browser.
 *
 *  The success_url is a URL the parent's browser lands on, which means
 *  anyone can visit it. It is never treated as proof of payment: this
 *  reads the session back from Stripe and checks that Stripe itself says
 *  it is paid. The demo provider is the one exception, and it is the
 *  exception on purpose — nothing was charged there either. */
export async function verifyPayment(reference: string): Promise<{ paid: boolean; amountMinor: number | null }> {
    const provider = activeProvider()
    if (provider === 'demo' || reference.startsWith('demo_')) {
        return { paid: process.env.TOYFOUNDRY_DEMO_PAYMENTS === '1', amountMinor: null }
    }
    if (!process.env.STRIPE_SECRET_KEY) return { paid: false, amountMinor: null }

    const res = await fetchWithTimeout(
        `${STRIPE_API}/${encodeURIComponent(reference)}`,
        { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } },
        20000,
        'Payment check',
    )
    if (!res.ok) throw fromResponse('Payment check', res.status, await res.text())
    const data = (await res.json()) as { payment_status?: string; amount_total?: number }
    return { paid: data.payment_status === 'paid', amountMinor: data.amount_total ?? null }
}
