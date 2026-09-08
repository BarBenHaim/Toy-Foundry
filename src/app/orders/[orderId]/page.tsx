'use client'

// src/app/orders/[orderId]/page.tsx
//
// Step 10: where is my toy.
//
// This page is also the landing spot after checkout, which makes it the
// place where a payment becomes an order. It calls /confirm on arrival
// — the route that asks the payment provider whether this was really
// paid, re-derives the print file at the ordered size, and hands it to
// production. Landing here is not proof of payment and this page does
// not treat it as any.
//
// The timeline is the six order statuses, and every one of them
// carries a sentence and a rough duration. A status with no elapsed-time
// story reads as stalled within a day.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { STATUS_FLOW, currentStatus, stepIndex } from '@/lib/orderStatus'
import { formatMinor } from '@/lib/pricing'
import type { OrderStatus, OrderStatusEvent, OrderPricing, ShippingAddress } from '@/lib/types'

interface OrderView {
    id: string
    pricing: OrderPricing
    address: ShippingAddress
    history: OrderStatusEvent[]
    payment: { provider: string; paidAt: string | null }
    production: { provider: string; reference: string | null; sentAt: string | null }
    createdAt: string
}

export default function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
    const { orderId } = use(params)
    const [token, setToken] = useState('')
    const [order, setOrder] = useState<OrderView | null>(null)
    const [toy, setToy] = useState<{ name: string; imageUrl: string | null } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(
        async (authToken: string) => {
            const res = await fetch(`/api/orders/${orderId}?token=${encodeURIComponent(authToken)}`)
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data?.error || 'We could not find that order.')
            setOrder(data.order)
            setToy(data.toy)
        },
        [orderId],
    )

    useEffect(() => {
        let cancelled = false
        const run = async () => {
            // The token comes from this browser, or from the link in the
            // confirmation email. Never from the order id alone — that
            // would make every order readable by anyone who can count.
            let found = new URLSearchParams(window.location.search).get('token') || ''
            if (!found) {
                try {
                    const saved: { id: string; token: string }[] = JSON.parse(
                        localStorage.getItem('toyfoundry.orders') || '[]',
                    )
                    found = saved.find(o => o.id === orderId)?.token || ''
                } catch {
                    found = ''
                }
            }
            if (!found) {
                setError('This order was placed on another device. Open the link from your confirmation email.')
                setLoading(false)
                return
            }
            setToken(found)

            try {
                // Arriving from checkout: turn the payment into an order
                // before showing anything, so the first render is the
                // truth rather than "awaiting payment" for one beat.
                if (new URLSearchParams(window.location.search).get('paid') === '1') {
                    await fetch(`/api/orders/${orderId}/confirm`, {
                        method: 'POST',
                        headers: { 'x-toyfoundry-token': found },
                    })
                }
                if (!cancelled) await load(found)
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your order.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        run()
        return () => {
            cancelled = true
        }
    }, [orderId, load])

    // A toy is in production for days, so a slow poll is plenty: it
    // catches the transition if the tab is left open and costs nothing.
    useEffect(() => {
        if (!token) return
        const timer = window.setInterval(() => load(token).catch(() => {}), 60000)
        return () => window.clearInterval(timer)
    }, [token, load])

    if (loading) {
        return (
            <main className='tf-shell tf-shell--narrow'>
                <p className='tf-muted'>Loading your order…</p>
            </main>
        )
    }

    if (error || !order) {
        return (
            <main className='tf-shell tf-shell--narrow'>
                <div className='tf-note tf-note--error'>{error || 'Order not found.'}</div>
                <Link href='/' className='tf-btn tf-btn--ghost'>
                    Back to ToyFoundry
                </Link>
            </main>
        )
    }

    const status = currentStatus(order.history)
    const atIndex = stepIndex(status)
    const cancelled = status === 'cancelled'

    return (
        <main className='tf-shell tf-shell--narrow'>
            <div className='tf-spread' style={{ marginBottom: 26 }}>
                <div>
                    <span className='tf-eyebrow'>Order {order.id}</span>
                    <h1 style={{ fontSize: 'clamp(30px, 4.5vw, 42px)', marginTop: 14 }}>
                        {status === 'delivered' ? 'It arrived.' : `${toy?.name || 'Your toy'} is on its way`}
                    </h1>
                </div>
            </div>

            <div className='tf-two' style={{ alignItems: 'start' }}>
                <div className='tf-card tf-card--flush'>
                    {toy?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={toy.imageUrl} alt={toy.name} style={{ width: '100%', display: 'block' }} />
                    ) : (
                        <div style={{ aspectRatio: '1', display: 'grid', placeItems: 'center' }}>
                            <span className='tf-muted'>No preview</span>
                        </div>
                    )}
                </div>

                <div className='tf-stack'>
                    {status === 'awaiting_payment' && (
                        <div className='tf-note tf-note--warn'>
                            We have not seen the payment yet. If you just paid, give it a moment and refresh.
                        </div>
                    )}
                    {cancelled && <div className='tf-note tf-note--error'>This order was cancelled.</div>}

                    <div className='tf-timeline'>
                        {STATUS_FLOW.map((step, i) => {
                            const done = atIndex > i || status === 'delivered'
                            const now = atIndex === i && !cancelled
                            const event = order.history.find(h => h.status === step.id)
                            return (
                                <div
                                    className={`tf-tl${done ? ' is-done' : ''}${now ? ' is-now' : ''}`}
                                    key={step.id}
                                >
                                    <div className='tf-tl-rail'>
                                        <span className='tf-tl-dot'>{done ? '✓' : i + 1}</span>
                                        {i < STATUS_FLOW.length - 1 && <span className='tf-tl-line' />}
                                    </div>
                                    <div className='tf-tl-body'>
                                        <h3>{step.label}</h3>
                                        <p>{step.detail}</p>
                                        {now && step.eta && <div className='tf-tl-eta'>Usually {step.eta}</div>}
                                        {event && (
                                            <div className='tf-tl-eta'>
                                                {new Date(event.at).toLocaleDateString('en-GB', {
                                                    day: 'numeric',
                                                    month: 'short',
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>

            <div className='tf-card' style={{ marginTop: 26 }}>
                <div className='tf-spread'>
                    <div>
                        <h3>Order details</h3>
                        <p style={{ fontSize: 14, marginTop: 8 }}>
                            {order.pricing.heightMm / 10} cm tall · {formatMinor(order.pricing.totalMinor, order.pricing.currency)}{' '}
                            paid
                        </p>
                        <p style={{ fontSize: 14, marginTop: 4 }}>
                            {order.address.name}, {order.address.street1}, {order.address.city}{' '}
                            {order.address.postcode}, {order.address.countryCode}
                        </p>
                    </div>
                    <StatusBadge status={status} />
                </div>
            </div>

            <p className='tf-muted' style={{ marginTop: 22 }}>
                Questions about this order? Reply to your confirmation email and quote {order.id}.
            </p>
        </main>
    )
}

function StatusBadge({ status }: { status: OrderStatus }) {
    const meta = STATUS_FLOW.find(s => s.id === status)
    return (
        <span className={`tf-badge ${status === 'delivered' ? 'tf-badge--live' : 'tf-badge--demo'}`}>
            {meta?.label || status.replace(/_/g, ' ')}
        </span>
    )
}
