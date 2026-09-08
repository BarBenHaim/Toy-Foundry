// GET /api/orders/[orderId]?token=…
//
// Step 10: where is my toy. Returns the order plus just enough of the
// project — the approved picture and the toy's name — that the tracking
// page can show the parent what is being made without a second call.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { notFound, ok, tokenFrom } from '@/lib/http'
import { getProject, publicOrder, requireOrder } from '@/lib/store'

export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
    const { orderId } = await params
    const order = await requireOrder(orderId, tokenFrom(req))
    if (!order) return notFound()

    const project = await getProject(order.projectId)
    const approved = project?.previews.find(p => p.id === project.approvedPreviewId) || null

    return ok({
        order: publicOrder(order),
        toy: {
            name: project?.dna?.name || 'Your toy',
            imageUrl: approved?.imageUrl || null,
            palette: project?.dna?.palette || [],
        },
    })
}
