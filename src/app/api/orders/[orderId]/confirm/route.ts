// POST /api/orders/[orderId]/confirm
//
// The step between "the browser came back from checkout" and "we are
// making your toy".
//
// Three things happen here, in this order and only if the previous one
// succeeded:
//   1. Ask the PAYMENT PROVIDER whether this was paid. The success URL
//      proves nothing — anyone can visit it.
//   2. Re-derive the print files at the size that was actually ordered,
//      and re-run the print checks at that size. Wall thickness is a
//      millimetre property: a model that passed at 10cm can fail at 8cm.
//   3. Hand the file to production, or to the human queue.
//
// Safe to call twice. Payment providers redirect, browsers reload, and a
// parent who refreshes the tracking page must not cause a second print
// job. Each stage checks whether it has already run.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

import { sendOrderConfirmation } from '@/lib/emails'
import { fail, failFrom, notFound, ok, tokenFrom } from '@/lib/http'
import { applyTransition, currentStatus } from '@/lib/orderStatus'
import { printFilesForOrder } from '@/lib/pipeline'
import { sendToProduction } from '@/lib/providers/manufacturing'
import { verifyPayment } from '@/lib/providers/payments'
import { getProject, publicOrder, requireOrder, updateOrder } from '@/lib/store'
import type { OrderStatusEvent } from '@/lib/types'

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
    const { orderId } = await params
    const order = await requireOrder(orderId, tokenFrom(req))
    if (!order) return notFound()

    try {
        // ── 1. Was it actually paid ──────────────────────────────────
        let paidAt = order.payment.paidAt
        if (!paidAt) {
            if (!order.payment.reference) return fail('This order has no payment to confirm.', 409)
            const { paid } = await verifyPayment(order.payment.reference)
            if (!paid) return ok({ order: publicOrder(order), paid: false })
            paidAt = new Date().toISOString()
            await updateOrder(orderId, { payment: { ...order.payment, paidAt } })
        }

        // ── 2. The file that gets printed, at the ordered size ───────
        let production = order.production
        let history: OrderStatusEvent[] = order.history
        if (!production.sentAt) {
            const project = await getProject(order.projectId)
            if (!project) return fail('The design behind this order is missing.', 409)

            const files = await printFilesForOrder(project, order.pricing.heightMm)
            if (!files.report.ok) {
                // Paid, but not printable at this size. Stop here rather
                // than shipping something that will fail: the admin
                // queue picks it up and a human decides.
                await updateOrder(orderId, {
                    production: { ...production, stlUrl: files.stlUrl, threeMfUrl: files.threeMfUrl },
                })
                return fail(
                    'Your toy needs a small adjustment at this size before it can be printed. We have flagged it and will be in touch.',
                    409,
                )
            }

            // ── 3. To the printer, or to the queue ───────────────────
            const result = await sendToProduction({
                orderId,
                toyName: project.dna?.name || 'ToyFoundry toy',
                stlUrl: files.stlUrl,
                threeMfUrl: files.threeMfUrl,
                pricing: order.pricing,
                address: order.address,
                report: files.report,
                standIn: project.model?.provider === 'standin',
            })

            production = {
                provider: result.provider,
                reference: result.reference,
                sentAt: result.sentAt,
                stlUrl: files.stlUrl,
                threeMfUrl: files.threeMfUrl,
            }
            history = applyTransition(history, 'ready_for_production', 'system', `sent to ${result.provider}`) || history
            await updateOrder(orderId, { production, history })

            // The link in this email is the only way back to the order
            // from another device — there is no login. Sent after the
            // order is safely queued, and never allowed to fail the
            // request: a missing email is recoverable, a 500 on a paid
            // order is not.
            const approved = project.previews.find(p => p.id === project.approvedPreviewId) || null
            const origin = new URL(req.url).origin
            try {
                await sendOrderConfirmation({
                    orderId,
                    toyName: project.dna?.name || 'Your toy',
                    imageUrl: approved?.imageUrl || null,
                    pricing: order.pricing,
                    address: order.address,
                    trackingUrl: `${origin}/orders/${orderId}?token=${encodeURIComponent(order.ownerToken)}`,
                })
            } catch (mailError) {
                console.error('[toyfoundry] confirmation email failed', orderId, mailError)
            }
        }

        return ok({
            order: publicOrder({ ...order, payment: { ...order.payment, paidAt }, production, history }),
            paid: true,
            status: currentStatus(history),
        })
    } catch (error) {
        return failFrom(error, `order confirm ${orderId}`)
    }
}
