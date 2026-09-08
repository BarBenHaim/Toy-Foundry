// POST /api/projects/[projectId]/analyze
//
// Step 2: read the drawing and write down what makes it itself.
//
// Idempotent by design — calling it twice returns the same DNA rather
// than paying for a second vision call — but `force: true` re-reads,
// which is what the "that's not my drawing" button needs.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { isConfident } from '@/lib/characterDna'
import { failFrom, notFound, ok, tokenFrom } from '@/lib/http'
import { analyzeProject } from '@/lib/pipeline'
import { requireProject } from '@/lib/store'

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params
    const project = await requireProject(projectId, tokenFrom(req))
    if (!project) return notFound()

    const body = await req.json().catch(() => ({}))
    if (project.dna && !body?.force) {
        return ok({ dna: project.dna, confident: isConfident(project.dna), demo: project.demo })
    }

    try {
        const dna = await analyzeProject(project)
        return ok({ dna, confident: isConfident(dna), demo: project.demo })
    } catch (error) {
        return failFrom(error, `analyze ${projectId}`)
    }
}
