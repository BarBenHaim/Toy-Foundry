// src/lib/pipeline.ts
//
// The four AI/production steps, orchestrated. Server only.
//
// Each function here does one step, writes its result to the project
// document, and returns. Nothing loops waiting for a provider: a
// serverless invocation cannot sit through a five-minute sculpt, so the
// long step (image-to-3D) is start/poll and the studio drives it.
//
// Every step degrades rather than dying. If a provider is not
// configured, or fails, the demo path runs instead and the project is
// marked so that nothing ships without a human seeing it. That is the
// difference between a demo that is a toy and a demo that is a floor
// under a real order.

import { demoDna, demoModeEnabled, demoPreview } from './demo'
import { buildStandInToy } from './mesh/standIn'
import { parseGlb } from './mesh/glb'
import { readBinaryStl, writeBinaryStl } from './mesh/stl'
import { writeThreeMf } from './mesh/threemf'
import { Mesh, scaleToHeight, sitOnPlate } from './mesh/geometry'
import { inspect, prepareForPrint } from './printability'
import { newId } from './ids'
import { buildToyPrompt } from './toyBrief'
import * as vision from './providers/vision'
import * as imageModel from './providers/imageModel'
import * as imageTo3d from './providers/imageTo3d'
import { ProviderError } from './providers/errors'
import {
    ToyProjectDoc,
    assetPath,
    readFile,
    saveProjectAsset,
    updateProject,
} from './store'
import type { CharacterDna, PrintabilityReport, RevisionRequest, ToyModel, ToyPreview } from './types'

/** The size the model is built and checked at. Orders re-derive their
 *  print files at the size the parent actually chose — thickness is a
 *  millimetre property, so an 8cm toy has to be re-checked, not just
 *  re-scaled. */
export const REFERENCE_HEIGHT_MM = 100

// ── Step 2: read the drawing ────────────────────────────────────────

export async function analyzeProject(project: ToyProjectDoc): Promise<CharacterDna> {
    await updateProject(project.id, { status: 'analyzing', error: null })
    const drawing = { bytes: await readFile(project.drawingPath), contentType: 'image/jpeg' }

    let dna: CharacterDna
    let demo = project.demo
    if (!demoModeEnabled() && vision.isConfigured()) {
        dna = await vision.analyzeDrawing(drawing)
    } else {
        dna = await demoDna(drawing)
        demo = true
    }

    await updateProject(project.id, { dna, demo, status: 'analyzed' })
    return dna
}

// ── Step 3: draw the toy ────────────────────────────────────────────

export async function renderPreview(
    project: ToyProjectDoc,
    revisions: RevisionRequest[],
): Promise<{ preview: ToyPreview; demo: boolean }> {
    const dna = project.dna
    if (!dna) throw new ProviderError('rejected', 'Preview requested before analysis', 'We have not read the drawing yet.', 409)

    await updateProject(project.id, { status: 'rendering', error: null })
    const prompt = buildToyPrompt({ dna, revisions })
    const drawing = { bytes: await readFile(project.drawingPath), contentType: 'image/jpeg' }

    let image: { bytes: Uint8Array; contentType: string }
    let demo = project.demo
    if (!demoModeEnabled() && imageModel.isConfigured()) {
        image = await imageModel.renderToyPreview({ prompt, drawing })
    } else {
        image = await demoPreview(drawing.bytes, dna.palette)
        demo = true
    }

    const id = newId('pv', 8)
    const imageUrl = await saveProjectAsset(project.id, `${id}.png`, image.bytes, image.contentType)
    const preview: ToyPreview = {
        id,
        imageUrl,
        prompt,
        revision: revisions.length > 0 ? revisions[revisions.length - 1] : null,
        createdAt: new Date().toISOString(),
    }

    await updateProject(project.id, {
        previews: [...project.previews, preview],
        selectedPreviewId: id,
        revisions,
        demo,
        status: 'preview_ready',
    })
    return { preview, demo }
}

// ── Step 6: sculpt it ───────────────────────────────────────────────

export interface ModelProgress {
    status: 'running' | 'ready' | 'failed'
    progress: number
    model: ToyModel | null
    message: string
}

/** Kick off the sculpt. Returns immediately: Meshy takes minutes, and
 *  the studio polls `advanceModel`. When there is no sculpting provider
 *  the stand-in runs inline and the model is ready on return. */
export async function startModel(project: ToyProjectDoc): Promise<ModelProgress> {
    const preview = project.previews.find(p => p.id === project.approvedPreviewId)
    if (!preview) {
        throw new ProviderError('rejected', 'Model requested before approval', 'Approve a design first.', 409)
    }
    await updateProject(project.id, { status: 'modeling', error: null })

    if (!demoModeEnabled() && imageTo3d.isConfigured()) {
        const task = await imageTo3d.startSculpt({ imageUrl: preview.imageUrl, name: project.dna?.name })
        const model: ToyModel = {
            glbUrl: null,
            stlUrl: null,
            threeMfUrl: null,
            report: null,
            provider: task.provider,
            providerTaskId: task.taskId,
            createdAt: new Date().toISOString(),
        }
        await updateProject(project.id, { model })
        return { status: 'running', progress: 5, model, message: 'Sculpting your toy…' }
    }

    return finishWithStandIn(project)
}

/** Poll the sculpt, and when it lands, turn it into print files. */
export async function advanceModel(project: ToyProjectDoc): Promise<ModelProgress> {
    const model = project.model
    if (model?.stlUrl) {
        return { status: 'ready', progress: 100, model, message: 'Your toy is ready to print.' }
    }
    if (!model?.providerTaskId) return startModel(project)

    const result = await imageTo3d.pollSculpt(model.providerTaskId)
    if (result.status === 'failed') {
        // A failed sculpt is not a failed order. Fall back to the
        // stand-in and flag it: a human checks it before it prints.
        console.warn('[toyfoundry] sculpt failed, falling back to stand-in', project.id, result.error)
        return finishWithStandIn(project)
    }
    if (result.status !== 'succeeded' || !result.glbUrl) {
        return {
            status: 'running',
            // Meshy's own percentage, floored so the bar never sits at 0
            // while something is clearly happening.
            progress: Math.max(5, result.progress),
            model,
            message: 'Sculpting your toy…',
        }
    }

    const glb = await imageTo3d.downloadModel(result.glbUrl)
    const glbUrl = await saveProjectAsset(project.id, 'model.glb', glb, 'model/gltf-binary')
    const { mesh: parsed } = parseGlb(glb)
    const { mesh, report } = prepareForPrint(parsed, REFERENCE_HEIGHT_MM, { sourceUp: 'y' })
    const finished = await writePrintFiles(project, mesh, report, {
        glbUrl,
        provider: model.provider,
        providerTaskId: model.providerTaskId,
    })
    return { status: 'ready', progress: 100, model: finished, message: 'Your toy is ready to print.' }
}

async function finishWithStandIn(project: ToyProjectDoc): Promise<ModelProgress> {
    const dna = project.dna
    if (!dna) throw new ProviderError('rejected', 'No character to sculpt', 'We have not read the drawing yet.', 409)
    const { mesh, report } = prepareForPrint(buildStandInToy(dna), REFERENCE_HEIGHT_MM, { sourceUp: 'z' })
    const model = await writePrintFiles(project, mesh, report, {
        glbUrl: null,
        provider: 'standin',
        providerTaskId: null,
    })
    return { status: 'ready', progress: 100, model, message: 'Your toy is ready to print.' }
}

async function writePrintFiles(
    project: ToyProjectDoc,
    mesh: Mesh,
    report: PrintabilityReport,
    meta: { glbUrl: string | null; provider: string; providerTaskId: string | null },
): Promise<ToyModel> {
    const stl = writeBinaryStl(mesh, `ToyFoundry ${project.id}`)
    const threeMf = await writeThreeMf(mesh, {
        color: project.dna?.palette?.[0],
        title: project.dna?.name || 'ToyFoundry toy',
    })
    const stlUrl = await saveProjectAsset(project.id, `model-${REFERENCE_HEIGHT_MM}mm.stl`, stl, 'model/stl')
    const threeMfUrl = await saveProjectAsset(
        project.id,
        `model-${REFERENCE_HEIGHT_MM}mm.3mf`,
        threeMf,
        'model/3mf',
    )

    const model: ToyModel = {
        glbUrl: meta.glbUrl,
        stlUrl,
        threeMfUrl,
        report,
        provider: meta.provider,
        providerTaskId: meta.providerTaskId,
        createdAt: new Date().toISOString(),
    }
    await updateProject(project.id, { model, status: 'model_ready' })
    return model
}

// ── Step 8/9: the file that actually gets printed ───────────────────

/** Re-derive the print files at the ordered size.
 *
 *  Not just a scale factor on the stored file: wall thickness is
 *  measured in millimetres, so a model that passes at 12cm can fail at
 *  8cm, and the parent has to be told before it is printed rather than
 *  after. The reference STL is the source — it is what was checked and
 *  what the parent saw. */
export async function printFilesForOrder(
    project: ToyProjectDoc,
    heightMm: number,
): Promise<{ stlUrl: string; threeMfUrl: string; report: PrintabilityReport }> {
    if (!project.model?.stlUrl) {
        throw new ProviderError('rejected', 'No model to print', 'This toy has no 3D model yet.', 409)
    }
    if (heightMm === REFERENCE_HEIGHT_MM && project.model.report) {
        return {
            stlUrl: project.model.stlUrl,
            threeMfUrl: project.model.threeMfUrl || project.model.stlUrl,
            report: project.model.report,
        }
    }

    const source = readBinaryStl(await readFile(assetPath(project.id, `model-${REFERENCE_HEIGHT_MM}mm.stl`)))
    const scaled = sitOnPlate(scaleToHeight(source, heightMm))
    const report = inspect(scaled, heightMm, 1, [`re-scaled from the ${REFERENCE_HEIGHT_MM}mm master to ${heightMm}mm`])

    const stl = writeBinaryStl(scaled, `ToyFoundry ${project.id} ${heightMm}mm`)
    const threeMf = await writeThreeMf(scaled, {
        color: project.dna?.palette?.[0],
        title: project.dna?.name || 'ToyFoundry toy',
    })
    const stlUrl = await saveProjectAsset(project.id, `model-${heightMm}mm.stl`, stl, 'model/stl')
    const threeMfUrl = await saveProjectAsset(project.id, `model-${heightMm}mm.3mf`, threeMf, 'model/3mf')
    return { stlUrl, threeMfUrl, report }
}
