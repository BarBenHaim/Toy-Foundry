// GET /api/projects/[projectId]?token=…
//
// The studio's source of truth. Everything the parent can see about
// their project, minus the owner token they already hold.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { notFound, ok, tokenFrom } from '@/lib/http'
import { publicProject, requireProject } from '@/lib/store'

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params
    const project = await requireProject(projectId, tokenFrom(req))
    if (!project) return notFound()
    return ok({ project: publicProject(project) })
}
