// GET   /api/admin/orders  — the production queue
// PATCH /api/admin/orders  — move an order along
//
// The manual half of the MVP. Until a printing API is wired, someone
// downloads the STL, places the order, and comes back here to say
// "printing", "shipped", "delivered". The parent's tracking page is
// driven by exactly these transitions, so the experience is complete
// whether or not the automation behind it is.
//
// Auth is a Firebase ID token in the Authorization header whose email is
// on the ADMIN_EMAILS list. The token is verified server-side on every
// request — the /admin page's own sign-in state decides what to render,
// never what may be read.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

import { adminAuth } from '@/lib/firebaseAdmin'
import { isAdmin } from '@/lib/admins'
import { fail, ok } from '@/lib/http'
import { applyTransition, currentStatus } from '@/lib/orderStatus'
import { estimateCost } from '@/lib/pricing'
import { getOrder, getProject, listOrders, publicOrder, updateOrder } from '@/lib/store'
import type { OrderStatus } from '@/lib/types'

async function verifyAdmin(req: Request): Promise<{ email?: string } | null> {
    const header = req.headers.get('authorization')
    if (!header?.startsWith('Bearer ')) return null
    try {
        const decoded = await adminAuth().verifyIdToken(header.slice('Bearer '.length))
        if (!isAdmin(decoded.email)) return null
        return decoded
    } catch {
        return null
    }
}

export async function GET(req: Request) {
    const admin = await verifyAdmin(req)
    if (!admin) return fail('Forbidden', 403)

    const orders = await listOrders(200)
    const rows = await Promise.all(
        orders.map(async order => {
            const project = await getProject(order.projectId)
            const approved = project?.previews.find(p => p.id === project.approvedPreviewId) || null
            return {
                order: publicOrder(order),
                status: currentStatus(order.history),
                toy: {
                    name: project?.dna?.name || 'Unnamed',
                    imageUrl: approved?.imageUrl || null,
                    drawingUrl: project?.drawingUrl || null,
                    provider: project?.model?.provider || null,
                    report: project?.model?.report || null,
                    demo: Boolean(project?.demo),
                },
                // Margin per order, so the day a print price moves is
                // visible here rather than at the end of the quarter.
                cost: project?.model?.report
                    ? estimateCost(project.model.report.volumeCm3, order.pricing)
                    : null,
            }
        }),
    )
    return ok({ orders: rows })
}

export async function PATCH(req: Request) {
    const admin = await verifyAdmin(req)
    if (!admin) return fail('Forbidden', 403)

    const body = await req.json().catch(() => ({}))
    const orderId = String(body?.orderId || '')
    const status = String(body?.status || '') as OrderStatus
    const note = typeof body?.note === 'string' ? body.note.slice(0, 300) : undefined

    const order = await getOrder(orderId)
    if (!order) return fail('No such order', 404)

    const history = applyTransition(order.history, status, admin.email || 'admin', note)
    if (!history) {
        return fail(`Cannot move an order from ${currentStatus(order.history)} to ${status}.`, 409)
    }
    await updateOrder(orderId, { history })
    return ok({ order: publicOrder({ ...order, history }), status: currentStatus(history) })
}
