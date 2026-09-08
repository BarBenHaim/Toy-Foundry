// GET /api/projects/[projectId]/model/preview?token=…
//
// The geometry the 3D viewer spins, as binary STL.
//
// Two reasons it is a route rather than the storage URL:
//
//   1. CORS. A signed Firebase Storage URL fetched from the browser
//      needs bucket-level CORS to allow this origin. Serving it from our
//      own domain removes an entire class of "works locally, blank in
//      production" bug.
//   2. It is not the print file. The model is the product; handing the
//      printable STL to the browser hands the product to anyone with a
//      network tab. What goes out here is decimated — recognisable at
//      arm's length, disappointing on a printer.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { clusterDecimate } from '@/lib/mesh/geometry'
import { readBinaryStl, writeBinaryStl } from '@/lib/mesh/stl'
import { fail, notFound, tokenFrom } from '@/lib/http'
import { REFERENCE_HEIGHT_MM } from '@/lib/pipeline'
import { assetPath, readFile, requireProject } from '@/lib/store'

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params
    const project = await requireProject(projectId, tokenFrom(req))
    if (!project) return notFound()
    if (!project.model?.stlUrl) return fail('No model yet.', 409)

    try {
        const source = readBinaryStl(await readFile(assetPath(projectId, `model-${REFERENCE_HEIGHT_MM}mm.stl`)))
        const preview = writeBinaryStl(clusterDecimate(source, 72), 'ToyFoundry preview')
        return new Response(Buffer.from(preview), {
            headers: {
                'content-type': 'model/stl',
                'content-length': String(preview.byteLength),
                // Private: this is one parent's toy, and the token in the
                // query string must not end up as a shared cache key.
                'cache-control': 'private, max-age=300',
                'x-robots-tag': 'noindex',
            },
        })
    } catch (error) {
        console.error('[toyfoundry] preview mesh', error)
        return fail('Could not load the 3D preview.', 500)
    }
}
