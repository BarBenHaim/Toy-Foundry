// src/lib/providers/imageTo3d.ts
//
// Step 6: the approved picture becomes geometry.
//
// Meshy's image-to-3D is asynchronous — you post an image, get a task
// id, and poll. That shape is kept in the interface rather than hidden
// behind an await loop, because a serverless function cannot sit for the
// three to five minutes a sculpt takes. The route starts the task and
// returns; the studio polls our own status route, which polls Meshy.
//
// The provider is behind an interface with two implementations: Meshy,
// and a local stand-in that builds a chunky figure out of primitives
// (see mesh/standIn.ts). The stand-in is not a mock — it produces a real
// mesh that goes through the real repair, the real printability check
// and the real STL writer, so the whole pipeline is exercised end to end
// without an API key, and so a Meshy outage degrades to "a simpler toy"
// instead of a dead order.

import { ProviderError, fetchWithTimeout, fromResponse, notConfigured } from './errors'

const BASE_URL = process.env.MESHY_API_BASE || 'https://api.meshy.ai/openapi/v1'

export type SculptStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface SculptTask {
    provider: string
    taskId: string
}

export interface SculptResult {
    status: SculptStatus
    /** 0–100 while running, for the progress bar. */
    progress: number
    glbUrl: string | null
    error: string | null
}

export function isConfigured(): boolean {
    return Boolean(process.env.MESHY_API_KEY)
}

/** Kick off a sculpt from a publicly fetchable image URL.
 *
 *  The URL has to be reachable by Meshy's servers, which is why previews
 *  are stored with long-lived signed URLs rather than proxied through an
 *  authenticated route. */
export async function startSculpt(input: { imageUrl: string; name?: string }): Promise<SculptTask> {
    const apiKey = process.env.MESHY_API_KEY
    if (!apiKey) throw notConfigured('3D sculpting')

    const res = await fetchWithTimeout(
        `${BASE_URL}/image-to-3d`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                image_url: input.imageUrl,
                // Quads remesh to a lower, cleaner poly count. We are
                // printing this, not rendering it in a game engine: the
                // repair pass is happier with an even mesh, and 30k
                // triangles is already more than a 0.4mm nozzle can
                // resolve on a 10cm toy.
                should_remesh: true,
                should_texture: true,
                enable_pbr: false,
                topology: 'quad',
                target_polycount: 30000,
                // A single upright figure is what the whole product is
                // designed around, and Meshy's symmetry auto-detection
                // sometimes mirrors an asymmetric character — which is
                // exactly the child's-drawing quirk we are protecting.
                symmetry_mode: 'off',
            }),
        },
        30000,
        '3D sculpting',
    )

    if (!res.ok) throw fromResponse('3D sculpting', res.status, await res.text())

    const data = (await res.json()) as { result?: string; id?: string }
    const taskId = data.result || data.id
    if (!taskId) {
        throw new ProviderError('unusable_result', 'Sculpt task id missing from response', 'Could not start the 3D model. Try again.')
    }
    return { provider: 'meshy', taskId }
}

export async function pollSculpt(taskId: string): Promise<SculptResult> {
    const apiKey = process.env.MESHY_API_KEY
    if (!apiKey) throw notConfigured('3D sculpting')

    const res = await fetchWithTimeout(
        `${BASE_URL}/image-to-3d/${encodeURIComponent(taskId)}`,
        { headers: { authorization: `Bearer ${apiKey}` } },
        30000,
        '3D sculpting',
    )
    if (!res.ok) throw fromResponse('3D sculpting', res.status, await res.text())

    const data = (await res.json()) as {
        status?: string
        progress?: number
        model_urls?: { glb?: string }
        model_url?: string
        task_error?: { message?: string }
    }
    return normalizeSculpt(data)
}

/** Pulled out of the fetch so the status mapping is unit-testable — the
 *  provider spells its states in caps and has changed the shape of the
 *  URL block once already. */
export function normalizeSculpt(data: {
    status?: string
    progress?: number
    model_urls?: { glb?: string }
    model_url?: string
    task_error?: { message?: string }
}): SculptResult {
    const raw = (data.status || '').toUpperCase()
    const glbUrl = data.model_urls?.glb || data.model_url || null
    const progress = typeof data.progress === 'number' ? Math.max(0, Math.min(100, data.progress)) : 0

    if (raw === 'SUCCEEDED' || (raw === 'COMPLETED' && glbUrl)) {
        // A "succeeded" task with no model is a failure wearing a success
        // label; treating it as done would hand an empty STL to a printer.
        if (!glbUrl) return { status: 'failed', progress: 100, glbUrl: null, error: 'Sculpt finished without a model file' }
        return { status: 'succeeded', progress: 100, glbUrl, error: null }
    }
    if (raw === 'FAILED' || raw === 'CANCELED' || raw === 'CANCELLED' || raw === 'EXPIRED') {
        return { status: 'failed', progress, glbUrl: null, error: data.task_error?.message || `Sculpt ${raw.toLowerCase()}` }
    }
    if (raw === 'IN_PROGRESS' || raw === 'RUNNING' || raw === 'PROCESSING') {
        return { status: 'running', progress, glbUrl: null, error: null }
    }
    return { status: 'pending', progress, glbUrl: null, error: null }
}

/** Fetch the finished GLB. Kept here so the caller never has to think
 *  about which provider's CDN it is talking to. */
export async function downloadModel(url: string): Promise<Uint8Array> {
    const res = await fetchWithTimeout(url, {}, 60000, '3D model download')
    if (!res.ok) throw fromResponse('3D model download', res.status, await res.text())
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength < 20) {
        throw new ProviderError('unusable_result', 'Downloaded model is empty', 'The 3D model file came back empty. Try again.')
    }
    return new Uint8Array(buffer)
}
