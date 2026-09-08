// src/lib/types.ts
//
// The shapes that travel between the four stages of ToyFoundry:
// drawing → character DNA → toy preview → printable model → order.
//
// Everything here is data only. No Firebase, no fetch, no React — this
// file is imported by the pure libs, the API routes and the client
// components alike, and any dependency added here would leak the server
// into the browser bundle.

/** What the vision pass extracts from a child's drawing.
 *
 *  This is the contract that keeps the toy recognisable. The image model
 *  never sees the drawing alone — it sees the drawing PLUS this record,
 *  and the record is what we diff against when a parent says "that's not
 *  my kid's monster any more". Every field is a thing a five-year-old
 *  would notice is missing. */
export interface CharacterDna {
    /** A short, parent-facing name for the creature. Comes from the
     *  drawing itself when the child wrote one, otherwise invented. */
    name: string
    /** One sentence a human would use to describe it. */
    summary: string
    /** Body plan: 'biped' | 'quadruped' | 'blob' | 'winged' | 'other'.
     *  Drives the pose the toy is designed in. */
    bodyPlan: BodyPlan
    /** Ordered, most-important-first. These are the identity anchors:
     *  three horns, one big eye, a stripey tail. */
    features: DnaFeature[]
    /** Hex colours in order of dominance, as read off the drawing. */
    palette: string[]
    /** Head-to-body ratio as drawn (a child's drawing is usually 1:1;
     *  keeping it is most of why the toy still looks like the drawing). */
    proportions: {
        headToBody: number
        limbLength: 'short' | 'medium' | 'long'
        stance: 'wide' | 'narrow'
    }
    /** Free-text notes the vision pass thought worth keeping. */
    quirks: string[]
    /** 0–1. How sure the vision pass is that it read the drawing well.
     *  Below CONFIDENCE_FLOOR we tell the parent to try a clearer photo
     *  rather than quietly inventing a creature. */
    confidence: number
}

export type BodyPlan = 'biped' | 'quadruped' | 'blob' | 'winged' | 'other'

export interface DnaFeature {
    /** 'horns', 'eyes', 'wings', 'tail', 'spikes', 'ears', … */
    kind: string
    /** "two curved horns, left one longer" */
    description: string
    /** How central this is to the character, 1 (incidental) – 5 (the
     *  whole point). Used when a revision has to trade one off. */
    importance: number
    /** Hex, when the feature has a colour of its own. */
    color?: string
}

/** The nine steps a project moves through, in order.
 *
 *  `status` on the project doc is one of these. The order matters: the
 *  studio UI derives "which step am I on" from the index, so never
 *  reorder without updating PROJECT_STEPS. */
export type ProjectStatus =
    | 'uploaded'
    | 'analyzing'
    | 'analyzed'
    | 'rendering'
    | 'preview_ready'
    | 'approved'
    | 'modeling'
    | 'model_ready'
    | 'failed'

/** A single generated toy image the parent can look at and judge. */
export interface ToyPreview {
    id: string
    imageUrl: string
    /** The prompt that produced it, kept so a revision can build on it
     *  and so a bad render can be diagnosed after the fact. */
    prompt: string
    /** null for the first render; the revision that produced this one
     *  otherwise. */
    revision: RevisionRequest | null
    createdAt: string
}

/** The four things a parent is allowed to ask for, plus free text.
 *
 *  Deliberately a closed set. "Make it cuter" is a prompt we can write
 *  well once; an open text box is a prompt we write badly every time,
 *  and each revision costs an image generation. */
export type RevisionKind =
    | 'bigger_feature'
    | 'change_color'
    | 'cuter'
    | 'closer_to_drawing'
    | 'custom'

export interface RevisionRequest {
    kind: RevisionKind
    /** For 'bigger_feature': which feature ('horns'). For
     *  'change_color': the target colour, hex or plain word. For
     *  'custom': the parent's own words, clamped. */
    detail?: string
}

/** A printable model, after the image-to-3D pass and the repair pass. */
export interface ToyModel {
    /** The raw result from the image-to-3D provider (GLB). Kept for the
     *  viewer and for re-deriving print files if the repair rules
     *  change. */
    glbUrl: string | null
    /** What actually goes to the printer. */
    stlUrl: string | null
    threeMfUrl: string | null
    report: PrintabilityReport | null
    provider: string
    providerTaskId: string | null
    createdAt: string
}

export interface PrintabilityCheck {
    id: string
    level: 'pass' | 'warn' | 'fail'
    /** Parent-facing, one line, no jargon. */
    message: string
    /** The measurement behind the verdict, when there is one. */
    value?: number
    unit?: string
}

export interface PrintabilityReport {
    /** False only when a check FAILED — warnings still print. */
    ok: boolean
    widthMm: number
    depthMm: number
    heightMm: number
    volumeCm3: number
    triangleCount: number
    shellCount: number
    checks: PrintabilityCheck[]
    /** Human-readable list of what auto-repair changed. Shown to the
     *  admin, not to the parent. */
    repairs: string[]
}

/** The six statuses the spec asks for, and the two that precede them.
 *  `creating_design` and `creating_3d_model` overlap with the project
 *  statuses on purpose: an order can be placed before the model exists
 *  (we take the money at approval), and the parent should see the same
 *  vocabulary in both places. */
export type OrderStatus =
    | 'awaiting_payment'
    | 'creating_design'
    | 'creating_3d_model'
    | 'ready_for_production'
    | 'printing'
    | 'shipped'
    | 'delivered'
    | 'cancelled'

export interface OrderStatusEvent {
    status: OrderStatus
    at: string
    /** 'system' | 'admin' | 'provider' — who moved it. */
    by: string
    note?: string
}

export type ToySizeId = 'small' | 'medium' | 'large'

export interface ShippingAddress {
    name: string
    email: string
    phone?: string
    street1: string
    street2?: string
    city: string
    postcode: string
    countryCode: string
}

export interface OrderPricing {
    sizeId: ToySizeId
    heightMm: number
    /** Minor units (agorot / cents), because floats and money do not mix. */
    toyMinor: number
    shippingMinor: number
    totalMinor: number
    currency: string
}
