// src/lib/orderStatus.ts
//
// The tracking page, as a state machine.
//
// Two rules, both learned from products that get this wrong:
//
//   1. Status only moves forward. A parent who saw "Printing" and then
//      sees "Ready for production" the next morning assumes something
//      broke, and they are usually right — but the damage is done by the
//      display, not by the event. `canTransition` refuses to go
//      backwards; a genuine regression is expressed as a note on the
//      current status, or as a cancellation.
//   2. Every status has a sentence saying what is happening and roughly
//      how long it lasts. "Printing" alone reads as stalled after a day;
//      "Printing — usually 2–3 days" does not.

import type { OrderStatus, OrderStatusEvent } from './types'

export interface StatusMeta {
    id: OrderStatus
    /** What the customer sees. Six words, chosen so a parent knows
     *  what is happening without a glossary. */
    label: string
    /** What is actually going on, in the parent's words. */
    detail: string
    /** Shown under the label so silence never reads as a stall. */
    eta: string
    /** Terminal statuses stop the timeline. */
    terminal?: boolean
}

/** The visible timeline, in order. `awaiting_payment` and `cancelled`
 *  are real statuses but not steps — see TRACKED_STATUSES. */
export const STATUS_FLOW: StatusMeta[] = [
    {
        id: 'creating_design',
        label: 'Creating design',
        detail: 'Turning the drawing into a toy design.',
        eta: 'about a minute',
    },
    {
        id: 'creating_3d_model',
        label: 'Creating 3D model',
        detail: 'Sculpting the approved design into a printable 3D model.',
        eta: 'a few minutes',
    },
    {
        id: 'ready_for_production',
        label: 'Ready for production',
        detail: 'The model passed its print checks and is queued with the printer.',
        eta: 'within a day',
    },
    { id: 'printing', label: 'Printing', detail: 'Being printed, layer by layer.', eta: 'usually 2–3 days' },
    { id: 'shipped', label: 'Shipped', detail: 'On its way to you.', eta: '5–12 days' },
    { id: 'delivered', label: 'Delivered', detail: 'It arrived. Go and see the face.', eta: '', terminal: true },
]

export const ALL_STATUSES: StatusMeta[] = [
    {
        id: 'awaiting_payment',
        label: 'Awaiting payment',
        detail: 'The order is held until checkout completes.',
        eta: '',
    },
    ...STATUS_FLOW,
    { id: 'cancelled', label: 'Cancelled', detail: 'This order was cancelled.', eta: '', terminal: true },
]

export function statusMeta(status: OrderStatus): StatusMeta {
    return ALL_STATUSES.find(s => s.id === status) || ALL_STATUSES[0]
}

export function isTerminal(status: OrderStatus): boolean {
    return Boolean(statusMeta(status).terminal)
}

/** Index in the visible timeline, or -1 for the statuses that sit
 *  outside it. */
export function stepIndex(status: OrderStatus): number {
    return STATUS_FLOW.findIndex(s => s.id === status)
}

/** 0–1, for the progress bar. `awaiting_payment` is 0; `cancelled`
 *  keeps whatever progress it had, which the UI greys out. */
export function progress(status: OrderStatus): number {
    const i = stepIndex(status)
    if (i < 0) return 0
    return (i + 1) / STATUS_FLOW.length
}

/** Forward-only, with two exceptions: anything may be cancelled, and
 *  `awaiting_payment` may jump straight to any early stage because
 *  payment can complete after the model is already built. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
    if (from === to) return false
    if (to === 'cancelled') return from !== 'delivered'
    if (from === 'cancelled' || from === 'delivered') return false
    if (to === 'awaiting_payment') return false
    if (from === 'awaiting_payment') return true
    const a = stepIndex(from)
    const b = stepIndex(to)
    if (a < 0 || b < 0) return false
    return b > a
}

/** Append an event, refusing illegal moves. Returns null when the move
 *  is not allowed, so callers can 409 rather than silently no-op. */
export function applyTransition(
    history: OrderStatusEvent[],
    to: OrderStatus,
    by: string,
    note?: string,
    now: Date = new Date(),
): OrderStatusEvent[] | null {
    const current = currentStatus(history)
    if (!canTransition(current, to)) return null
    return [...history, { status: to, at: now.toISOString(), by, ...(note ? { note } : {}) }]
}

export function currentStatus(history: OrderStatusEvent[]): OrderStatus {
    if (!history || history.length === 0) return 'awaiting_payment'
    return history[history.length - 1].status
}

/** What the parent should see next, for the "what happens now" line. */
export function nextStep(status: OrderStatus): StatusMeta | null {
    const i = stepIndex(status)
    if (status === 'awaiting_payment') return STATUS_FLOW[0]
    if (i < 0 || i >= STATUS_FLOW.length - 1) return null
    return STATUS_FLOW[i + 1]
}
