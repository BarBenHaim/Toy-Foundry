// POST /api/projects
//
// Step 1: a parent uploads a photo of a drawing.
//
// The upload comes as multipart rather than base64 JSON because a phone
// photo is 3–8MB and base64 inflates that by a third for no reason. It
// is normalised on the way in — EXIF rotation applied, HEIC converted,
// long edge capped — so that every later step sees a plain JPEG or PNG
// the size of a drawing rather than the size of a camera sensor.
//
// The response carries the owner token exactly once. It is the only time
// it is ever sent to the client; from here the client sends it back.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { demoModeEnabled, isProviderReadable, normalizeUpload } from '@/lib/demo'
import { fail, failFrom, ok } from '@/lib/http'
import { createProject, isAcceptedImage, publicProject } from '@/lib/store'

/** 12MB. Above this it is not a drawing, it is a video frame or an
 *  attack, and the platform's own body limit is not far above it. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

export async function POST(req: Request) {
    try {
        const form = await req.formData()
        const file = form.get('drawing')
        if (!(file instanceof File)) return fail('Attach a photo of the drawing.')
        if (file.size === 0) return fail('That file is empty.')
        if (file.size > MAX_UPLOAD_BYTES) return fail('That photo is too large. Try one under 12MB.')
        if (!isAcceptedImage(file.type)) {
            return fail('That file is not a photo. Use a JPEG, PNG, WebP or HEIC image.')
        }

        const raw = new Uint8Array(await file.arrayBuffer())
        const drawing = await normalizeUpload(raw, file.type)
        if (!isProviderReadable(drawing.contentType)) {
            // Almost always a HEIC on a host without libheif. Say the
            // useful thing now rather than failing two steps later with
            // an error about the drawing.
            return fail('We could not open that photo. Save or export it as a JPEG and try again.')
        }

        const { project, ownerToken } = await createProject({ drawing, demo: demoModeEnabled() })
        return ok({ project: publicProject(project), ownerToken }, 201)
    } catch (error) {
        return failFrom(error, 'project upload')
    }
}
