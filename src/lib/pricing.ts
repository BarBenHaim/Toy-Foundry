// src/lib/pricing.ts
//
// What the toy costs, and why that number.
//
// The business model is premium, made-to-order, zero inventory: one
// child's character, printed once, shipped once. The price is therefore
// NOT cost-plus on filament — filament is a couple of dollars — it is
// priced against what the object is, which is the only one that will
// ever exist. Cost only appears here so the admin screen can show margin
// per order and catch the day a provider's price moves.
//
// Money is integer minor units everywhere. A float somewhere in a
// checkout is a bug that shows up as one cent, once, in production.

import { estimateFilamentGrams } from './printability'
import type { OrderPricing, ToySizeId } from './types'

export const CURRENCY = process.env.NEXT_PUBLIC_TOYFOUNDRY_CURRENCY || 'USD'

export interface ToySize {
    id: ToySizeId
    heightMm: number
    label: string
    /** The one line that makes a parent pick this one. */
    blurb: string
    priceMinor: number
}

/** Three sizes, because two feels like a lie and four is a decision.
 *
 *  Heights are the range the print rules are built around: below 80mm a
 *  face loses its detail at a 0.2mm layer, above 120mm the print takes
 *  most of a day. */
export const SIZES: ToySize[] = [
    { id: 'small', heightMm: 80, label: '8 cm', blurb: 'Pocket size. Goes to kindergarten.', priceMinor: 6900 },
    { id: 'medium', heightMm: 100, label: '10 cm', blurb: 'The one most people pick. Shelf presence.', priceMinor: 8900 },
    { id: 'large', heightMm: 120, label: '12 cm', blurb: 'A proper centrepiece. Every detail readable.', priceMinor: 11900 },
]

/** Flat rate, because a shipping calculator on a one-item cart costs
 *  more in abandoned checkouts than it saves in postage. Waived on the
 *  large size, which is where the margin can carry it. */
export const SHIPPING_MINOR = 990

export function sizeById(id: string): ToySize | null {
    return SIZES.find(s => s.id === id) || null
}

export function priceFor(sizeId: string): OrderPricing | null {
    const size = sizeById(sizeId)
    if (!size) return null
    const shipping = size.id === 'large' ? 0 : SHIPPING_MINOR
    return {
        sizeId: size.id,
        heightMm: size.heightMm,
        toyMinor: size.priceMinor,
        shippingMinor: shipping,
        totalMinor: size.priceMinor + shipping,
        currency: CURRENCY,
    }
}

/** '$89.00'. Intl handles the symbol, the separator and the position of
 *  both, which differ per currency and are not worth hand-rolling. */
export function formatMinor(minor: number, currency = CURRENCY, locale = 'en-US'): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    }).format(minor / 100)
}

/** Internal only. What we expect to pay to have one printed and posted,
 *  so the admin queue can show margin and flag an order that has stopped
 *  making sense. These rates are hardcoded and therefore go stale: the
 *  constant below is the honesty marker, and margin on the admin screen
 *  is wrong from the day a provider moves its prices until someone edits
 *  this file. */
export const PROVIDER_RATES_CHECKED_ON = '2026-09-08'

export interface CostEstimate {
    filamentGrams: number
    printMinor: number
    shippingMinor: number
    totalMinor: number
    marginMinor: number
    marginShare: number
}

export function estimateCost(volumeCm3: number, pricing: OrderPricing): CostEstimate {
    const grams = estimateFilamentGrams(volumeCm3)
    // A small FDM part at a job shop is priced on a setup fee plus
    // material, not on material alone; the setup fee dominates at this
    // size. ~$4.50 setup + ~$0.06/g is where JLC3DP's FDM PLA lands for
    // one-off parts in this volume range.
    const printMinor = Math.round(450 + grams * 6)
    const shippingMinor = 1200
    const totalMinor = printMinor + shippingMinor
    const marginMinor = pricing.totalMinor - totalMinor
    return {
        filamentGrams: grams,
        printMinor,
        shippingMinor,
        totalMinor,
        marginMinor,
        marginShare: pricing.totalMinor > 0 ? marginMinor / pricing.totalMinor : 0,
    }
}
