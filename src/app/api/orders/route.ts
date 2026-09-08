// POST /api/orders
//
// Step 8: size, price, address, checkout.
//
// An order can only be created once there is a finished, checked model.
// Taking money for a toy whose printability is still unknown is the one
// sequencing mistake in this product that turns into refunds, so the
// route refuses rather than trusting the client to have waited.
//
// Price comes from the size id and the server's own table. Nothing about
// money is read from the request body.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { validateAddress } from '@/lib/address'
import { fail, failFrom, notFound, ok, tokenFrom } from '@/lib/http'
import { priceFor } from '@/lib/pricing'
import { createCheckout, isConfigured as paymentsConfigured } from '@/lib/providers/payments'
import { createOrder, publicOrder, requireProject, updateOrder } from '@/lib/store'

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}))
        const token = tokenFrom(req)
        const project = await requireProject(String(body?.projectId || ''), token)
        if (!project) return notFound()
        if (!project.model?.stlUrl) return fail('This toy has no finished 3D model yet.', 409)
        if (project.model.report && !project.model.report.ok) {
            return fail('This model did not pass its print checks, so we cannot make it yet.', 409)
        }

        const pricing = priceFor(String(body?.sizeId || ''))
        if (!pricing) return fail('Pick a size.')

        const { address, problems } = validateAddress(body?.address)
        if (!address) return fail(problems[0]?.message || 'Check the shipping address.', 422)

        if (!paymentsConfigured()) return fail('Checkout is not switched on yet.', 503)

        const order = await createOrder({
            projectId: project.id,
            ownerToken: project.ownerToken,
            pricing,
            address,
            paymentProvider: 'pending',
            history: [{ status: 'awaiting_payment', at: new Date().toISOString(), by: 'system' }],
        })

        const origin = new URL(req.url).origin
        const checkout = await createCheckout({
            orderId: order.id,
            pricing,
            email: address.email,
            toyName: project.dna?.name || 'Your toy',
            // The confirm step verifies with the payment provider before
            // believing any of this; the URL is a place to land, not
            // proof of anything.
            successUrl: `${origin}/orders/${order.id}?paid=1`,
            cancelUrl: `${origin}/studio?project=${project.id}&cancelled=1`,
        })

        await updateOrder(order.id, {
            payment: { provider: checkout.provider, reference: checkout.reference, paidAt: null },
        })

        return ok(
            {
                order: publicOrder({ ...order, payment: { provider: checkout.provider, reference: checkout.reference, paidAt: null } }),
                checkoutUrl: checkout.url,
            },
            201,
        )
    } catch (error) {
        return failFrom(error, 'order create')
    }
}
