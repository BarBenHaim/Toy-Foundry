import { describe, it, expect } from 'vitest'
import { SIZES, estimateCost, formatMinor, priceFor, sizeById } from '@/lib/pricing'
import {
    STATUS_FLOW,
    applyTransition,
    canTransition,
    currentStatus,
    isTerminal,
    nextStep,
    progress,
    statusMeta,
} from '@/lib/orderStatus'
import { newId, newToken, tokensMatch } from '@/lib/ids'
import { HEIGHT_RANGE_MM } from '@/lib/printRules'

describe('pricing', () => {
    it('offers three sizes inside the printable height range', () => {
        expect(SIZES).toHaveLength(3)
        for (const size of SIZES) {
            expect(size.heightMm).toBeGreaterThanOrEqual(HEIGHT_RANGE_MM.min)
            expect(size.heightMm).toBeLessThanOrEqual(HEIGHT_RANGE_MM.max)
        }
    })

    it('adds shipping except on the size that carries it', () => {
        const medium = priceFor('medium')
        expect(medium.totalMinor).toBe(medium.toyMinor + medium.shippingMinor)
        expect(medium.shippingMinor).toBeGreaterThan(0)
        expect(priceFor('large').shippingMinor).toBe(0)
    })

    it('refuses a size that does not exist rather than pricing it at zero', () => {
        expect(priceFor('enormous')).toBeNull()
        expect(sizeById('enormous')).toBeNull()
    })

    it('formats money without floating point', () => {
        expect(formatMinor(8900, 'USD')).toBe('$89')
        expect(formatMinor(9990, 'USD')).toBe('$99.90')
    })

    it('keeps a premium margin at the expected print cost', () => {
        const cost = estimateCost(60, priceFor('medium'))
        expect(cost.marginMinor).toBeGreaterThan(0)
        expect(cost.marginShare).toBeGreaterThan(0.6)
    })
})

describe('order status', () => {
    it('walks the six customer-facing statuses in order', () => {
        expect(STATUS_FLOW.map(s => s.label)).toEqual([
            'Creating design',
            'Creating 3D model',
            'Ready for production',
            'Printing',
            'Shipped',
            'Delivered',
        ])
    })

    it('never goes backwards', () => {
        expect(canTransition('printing', 'shipped')).toBe(true)
        expect(canTransition('shipped', 'printing')).toBe(false)
        expect(canTransition('printing', 'printing')).toBe(false)
    })

    it('lets an unpaid order jump to wherever production actually is', () => {
        expect(canTransition('awaiting_payment', 'ready_for_production')).toBe(true)
        expect(canTransition('printing', 'awaiting_payment')).toBe(false)
    })

    it('allows cancellation right up until it is delivered', () => {
        expect(canTransition('printing', 'cancelled')).toBe(true)
        expect(canTransition('delivered', 'cancelled')).toBe(false)
        expect(isTerminal('delivered')).toBe(true)
    })

    it('appends history and refuses illegal moves', () => {
        const start = [{ status: 'creating_design', at: '2026-01-01T00:00:00.000Z', by: 'system' }]
        const moved = applyTransition(start, 'creating_3d_model', 'system')
        expect(currentStatus(moved)).toBe('creating_3d_model')
        expect(applyTransition(moved, 'creating_design', 'admin')).toBeNull()
    })

    it('records who moved it and why', () => {
        const history = applyTransition([], 'creating_design', 'admin', 'manual kick')
        expect(history[0].by).toBe('admin')
        expect(history[0].note).toBe('manual kick')
    })

    it('reports progress and what comes next', () => {
        expect(progress('awaiting_payment')).toBe(0)
        expect(progress('delivered')).toBe(1)
        expect(progress('printing')).toBeCloseTo(4 / 6, 6)
        expect(nextStep('printing').label).toBe('Shipped')
        expect(nextStep('delivered')).toBeNull()
        expect(nextStep('awaiting_payment').label).toBe('Creating design')
    })

    it('has a sentence and an eta for every status a parent can see', () => {
        for (const step of STATUS_FLOW) {
            const meta = statusMeta(step.id)
            expect(meta.detail.length).toBeGreaterThan(10)
            if (!meta.terminal) expect(meta.eta.length).toBeGreaterThan(0)
        }
    })
})

describe('ids and tokens', () => {
    it('makes readable ids and unguessable tokens', () => {
        expect(newId('toy')).toMatch(/^toy_[a-z0-9]{10}$/)
        expect(newToken()).toMatch(/^[0-9a-f]{64}$/)
        expect(newToken()).not.toBe(newToken())
    })

    it('compares tokens without leaking them a character at a time', () => {
        const token = newToken()
        // Change the last character to something it definitely is not.
        // Appending a fixed '0' looks equivalent and is a one-in-sixteen
        // flake: a token that already ends in '0' rebuilds itself.
        const almost = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')
        expect(tokensMatch(token, token)).toBe(true)
        expect(tokensMatch(token, almost)).toBe(false)
        expect(tokensMatch(token, undefined)).toBe(false)
        expect(tokensMatch('', '')).toBe(false)
    })
})
