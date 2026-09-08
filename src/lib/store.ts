// src/lib/store.ts
//
// Firestore and Storage for ToyFoundry. Server only — importing this
// from a client component pulls firebase-admin into the browser bundle
// and fails the build, which is the intended guard rail.
//
// Two collections, both flat:
//   toyfoundry_projects/{projectId}  — a drawing on its way to a design
//   toyfoundry_orders/{orderId}      — a paid design on its way to a door
//
// The client never touches either directly; every read and write goes
// through an API route that checks the owner token first. That is why
// there are no Firestore rules for these collections: nothing is
// reachable from a browser to rule on.
//
// Files live under toyfoundry/{projectId}/ in Firebase Storage, private,
// served through long-lived signed URLs. Private rather than public
// because a child's drawing is not ours to make world-readable, and
// signed rather than proxied because the image-to-3D provider has to
// fetch the drawing over plain HTTPS from its own servers.

import { adminDb, adminStorage } from '@/lib/firebaseAdmin'
import { newId, newToken, tokensMatch } from './ids'
import type {
    CharacterDna,
    OrderPricing,
    OrderStatusEvent,
    ProjectStatus,
    ShippingAddress,
    ToyModel,
    ToyPreview,
    RevisionRequest,
} from './types'

export const PROJECTS = 'toyfoundry_projects'
export const ORDERS = 'toyfoundry_orders'

/** Ten years. These URLs go into a printer's job queue and into an email
 *  a parent keeps; an expiry measured in days turns into a support
 *  ticket the week after a shipment slips. */
const SIGNED_URL_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000

export interface ToyProjectDoc {
    id: string
    ownerToken: string
    status: ProjectStatus
    drawingUrl: string
    drawingPath: string
    dna: CharacterDna | null
    previews: ToyPreview[]
    /** Index into `previews` — what the parent is currently looking at. */
    selectedPreviewId: string | null
    revisions: RevisionRequest[]
    approvedPreviewId: string | null
    model: ToyModel | null
    /** Set when a step failed, cleared when it is retried. Shown to the
     *  parent as plain language, so nothing internal goes in here. */
    error: string | null
    demo: boolean
    createdAt: string
    updatedAt: string
}

export interface ToyOrderDoc {
    id: string
    projectId: string
    ownerToken: string
    pricing: OrderPricing
    address: ShippingAddress
    history: OrderStatusEvent[]
    payment: {
        provider: string
        reference: string | null
        paidAt: string | null
    }
    production: {
        provider: string
        reference: string | null
        sentAt: string | null
        /** What we actually handed the printer, frozen at send time so a
         *  later re-render cannot change what is being made. */
        stlUrl: string | null
        threeMfUrl: string | null
    }
    createdAt: string
    updatedAt: string
}

// ── Projects ────────────────────────────────────────────────────────

export async function createProject(input: {
    drawing: { bytes: Uint8Array; contentType: string }
    demo: boolean
}): Promise<{ project: ToyProjectDoc; ownerToken: string }> {
    const id = newId('toy')
    const ownerToken = newToken()
    const ext = extensionFor(input.drawing.contentType)
    const path = `toyfoundry/${id}/drawing.${ext}`
    const drawingUrl = await saveFile(path, input.drawing.bytes, input.drawing.contentType)

    const now = new Date().toISOString()
    const project: ToyProjectDoc = {
        id,
        ownerToken,
        status: 'uploaded',
        drawingUrl,
        drawingPath: path,
        dna: null,
        previews: [],
        selectedPreviewId: null,
        revisions: [],
        approvedPreviewId: null,
        model: null,
        error: null,
        demo: input.demo,
        createdAt: now,
        updatedAt: now,
    }
    await adminDb().collection(PROJECTS).doc(id).set(project)
    return { project, ownerToken }
}

export async function getProject(id: string): Promise<ToyProjectDoc | null> {
    if (!id) return null
    const snap = await adminDb().collection(PROJECTS).doc(id).get()
    if (!snap.exists) return null
    return snap.data() as ToyProjectDoc
}

/** The authorisation check for every project mutation. Returns null for
 *  both "no such project" and "wrong token" on purpose: a caller
 *  probing for valid project ids learns nothing from the difference. */
export async function requireProject(id: string, token: unknown): Promise<ToyProjectDoc | null> {
    const project = await getProject(id)
    if (!project) return null
    if (!tokensMatch(project.ownerToken, token)) return null
    return project
}

export async function updateProject(id: string, patch: Partial<ToyProjectDoc>): Promise<void> {
    await adminDb()
        .collection(PROJECTS)
        .doc(id)
        .set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true })
}

/** Strip the owner token before anything leaves the server. The client
 *  already has its own copy; echoing it back in every response is how it
 *  ends up in a log or a screenshot. */
export function publicProject(project: ToyProjectDoc): Omit<ToyProjectDoc, 'ownerToken' | 'drawingPath'> {
    const { ownerToken: _token, drawingPath: _path, ...rest } = project
    return rest
}

// ── Orders ──────────────────────────────────────────────────────────

export async function createOrder(input: {
    projectId: string
    ownerToken: string
    pricing: OrderPricing
    address: ShippingAddress
    paymentProvider: string
    history: OrderStatusEvent[]
}): Promise<ToyOrderDoc> {
    const id = newId('ord')
    const now = new Date().toISOString()
    const order: ToyOrderDoc = {
        id,
        projectId: input.projectId,
        ownerToken: input.ownerToken,
        pricing: input.pricing,
        address: input.address,
        history: input.history,
        payment: { provider: input.paymentProvider, reference: null, paidAt: null },
        production: { provider: 'pending', reference: null, sentAt: null, stlUrl: null, threeMfUrl: null },
        createdAt: now,
        updatedAt: now,
    }
    await adminDb().collection(ORDERS).doc(id).set(order)
    return order
}

export async function getOrder(id: string): Promise<ToyOrderDoc | null> {
    if (!id) return null
    const snap = await adminDb().collection(ORDERS).doc(id).get()
    if (!snap.exists) return null
    return snap.data() as ToyOrderDoc
}

export async function requireOrder(id: string, token: unknown): Promise<ToyOrderDoc | null> {
    const order = await getOrder(id)
    if (!order) return null
    if (!tokensMatch(order.ownerToken, token)) return null
    return order
}

export async function updateOrder(id: string, patch: Partial<ToyOrderDoc>): Promise<void> {
    await adminDb()
        .collection(ORDERS)
        .doc(id)
        .set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true })
}

export async function listOrders(limit = 100): Promise<ToyOrderDoc[]> {
    const snap = await adminDb().collection(ORDERS).orderBy('createdAt', 'desc').limit(limit).get()
    return snap.docs.map(d => d.data() as ToyOrderDoc)
}

export function publicOrder(order: ToyOrderDoc): Omit<ToyOrderDoc, 'ownerToken'> {
    const { ownerToken: _token, ...rest } = order
    return rest
}

// ── Files ───────────────────────────────────────────────────────────

/** Save bytes and hand back a URL that will still work in five years. */
export async function saveFile(path: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const file = adminStorage().bucket().file(path)
    await file.save(Buffer.from(bytes), {
        contentType,
        // A drawing is uploaded once and read many times, and the URL is
        // stable, so let the CDN keep it.
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    })
    const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + SIGNED_URL_TTL_MS })
    return url
}

/** Read bytes back out of the bucket. Used when a print file has to be
 *  re-derived at a different size: the source of truth is the stored
 *  model, not whatever is still in memory. */
export async function readFile(path: string): Promise<Uint8Array> {
    const [buffer] = await adminStorage().bucket().file(path).download()
    return new Uint8Array(buffer)
}

export function assetPath(projectId: string, name: string): string {
    return `toyfoundry/${projectId}/${name}`
}

export async function saveProjectAsset(
    projectId: string,
    name: string,
    bytes: Uint8Array,
    contentType: string,
): Promise<string> {
    return saveFile(`toyfoundry/${projectId}/${name}`, bytes, contentType)
}

const EXTENSIONS: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
}

export function extensionFor(contentType: string): string {
    return EXTENSIONS[contentType?.toLowerCase()] || 'bin'
}

/** The formats a phone camera actually produces. HEIC is accepted
 *  because that is what an iPhone hands over by default, and rejecting
 *  it reads to the parent as "your photo is broken". */
export function isAcceptedImage(contentType: string): boolean {
    return Boolean(EXTENSIONS[contentType?.toLowerCase()])
}
