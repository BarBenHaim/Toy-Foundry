// POST /api/projects/[projectId]/preview
//
// Step 3 and step 5: draw the toy, and redraw it when the parent asks
// for a change.
//
// Revisions accumulate on the project rather than being applied to the
// last image, so "bigger horns" followed by "make it purple" produces
// one prompt asking for both. Applying the second to the output of the
// first is how a character drifts away from the drawing in three moves.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

import { fail, failFrom, notFound, ok, tokenFrom } from '@/lib/http'
import { renderPreview } from '@/lib/pipeline'
import { requireProject } from '@/lib/store'
import { MAX_REVISIONS, parseRevision } from '@/lib/toyBrief'

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params
    const project = await requireProject(projectId, tokenFrom(req))
    if (!project) return notFound()
    if (!project.dna) return fail('We have not read the drawing yet.', 409)

    const body = await req.json().catch(() => ({}))
    let revisions = project.revisions || []

    if (body?.revision) {
        const revision = parseRevision(body.revision)
        if (!revision) return fail('That change is not one we can make.')
        if (revisions.length >= MAX_REVISIONS) {
            return fail(
                `That is ${MAX_REVISIONS} changes. Approve the one you like best, or start again from the drawing — past this point the toy drifts further from it, not closer.`,
                429,
            )
        }
        revisions = [...revisions, revision]
    } else if (project.previews.length > 0) {
        // No revision and a preview already exists: this is a retry of a
        // render that failed or that the parent wants rolled again.
        // Same revisions, new image.
        revisions = project.revisions || []
    }

    try {
        const { preview, demo } = await renderPreview(project, revisions)
        return ok({ preview, revisions, demo })
    } catch (error) {
        return failFrom(error, `preview ${projectId}`)
    }
}
