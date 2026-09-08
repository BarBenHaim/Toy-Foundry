// POST /api/projects/[projectId]/approve
//
// The parent picks the design they want made. Everything downstream —
// the sculpt, the print file, the order — hangs off this one id, so it
// is recorded explicitly rather than inferred from "the latest preview".
// A parent who liked the second render and asked for a third has to be
// able to go back to the second.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { fail, notFound, ok, tokenFrom } from '@/lib/http'
import { publicProject, requireProject, updateProject } from '@/lib/store'

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params
    const project = await requireProject(projectId, tokenFrom(req))
    if (!project) return notFound()

    const body = await req.json().catch(() => ({}))
    const previewId = typeof body?.previewId === 'string' ? body.previewId : project.selectedPreviewId
    const preview = project.previews.find(p => p.id === previewId)
    if (!preview) return fail('Pick a design to approve.')

    await updateProject(projectId, {
        approvedPreviewId: preview.id,
        selectedPreviewId: preview.id,
        status: 'approved',
    })
    const updated = { ...project, approvedPreviewId: preview.id, selectedPreviewId: preview.id, status: 'approved' as const }
    return ok({ project: publicProject(updated) })
}
