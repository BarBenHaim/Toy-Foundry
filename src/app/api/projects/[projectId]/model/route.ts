// POST /api/projects/[projectId]/model  — start the sculpt
// GET  /api/projects/[projectId]/model  — how is it going
//
// Steps 6 and 7. Split into start and poll because image-to-3D takes
// minutes and a serverless function does not get minutes; the studio
// polls this every few seconds and gets a progress number back.
//
// The GET is where the print files appear: the moment the sculpt lands,
// it is welded, repaired, stood up, measured and written out as STL and
// 3MF before this route answers. That is deliberate — a parent must
// never see "your model is ready" for a model that has not passed its
// print checks.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

import { failFrom, notFound, ok, tokenFrom } from '@/lib/http'
import { advanceModel, startModel } from '@/lib/pipeline'
import { requireProject } from '@/lib/store'

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params
    const project = await requireProject(projectId, tokenFrom(req))
    if (!project) return notFound()
    try {
        return ok(await startModel(project))
    } catch (error) {
        return failFrom(error, `model start ${projectId}`)
    }
}

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params
    const project = await requireProject(projectId, tokenFrom(req))
    if (!project) return notFound()
    try {
        return ok(await advanceModel(project))
    } catch (error) {
        return failFrom(error, `model poll ${projectId}`)
    }
}
