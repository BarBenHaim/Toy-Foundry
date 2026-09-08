'use client'

// src/app/admin/page.tsx
//
// The production queue — the human half of the MVP.
//
// Until a printing API is wired up, this is the whole back office:
// download the file, place the order with a print shop, come back and
// move the status along. The parent's tracking page is driven by exactly
// these buttons, which is what lets the customer experience be complete
// while the operation behind it is a person with a laptop.
//
// It also shows margin per order. The one number that decides whether
// this business works is what a print actually costs against what was
// charged, and it belongs where the orders are, not in a spreadsheet
// someone updates monthly.

import { useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { browserAuth } from '@/lib/firebaseClient'
import { STATUS_FLOW, canTransition } from '@/lib/orderStatus'
import { formatMinor } from '@/lib/pricing'
import type { OrderStatus, PrintabilityReport } from '@/lib/types'

interface Row {
    order: {
        id: string
        projectId: string
        pricing: { heightMm: number; totalMinor: number; currency: string }
        address: { name: string; city: string; countryCode: string; email: string }
        production: { provider: string; reference: string | null; stlUrl: string | null; threeMfUrl: string | null }
        payment: { provider: string; paidAt: string | null }
        createdAt: string
    }
    status: OrderStatus
    toy: {
        name: string
        imageUrl: string | null
        drawingUrl: string | null
        provider: string | null
        report: PrintabilityReport | null
        demo: boolean
    }
    cost: { filamentGrams: number; totalMinor: number; marginMinor: number; marginShare: number } | null
}

export default function ToyFoundryAdmin() {
    const [idToken, setIdToken] = useState<string | null>(null)
    const [rows, setRows] = useState<Row[]>([])
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [configured, setConfigured] = useState(true)

    useEffect(() => {
        // Resolved here rather than at module scope: this page is
        // prerendered at build time, where there is no browser and no
        // Firebase config.
        const auth = browserAuth()
        if (!auth) {
            setConfigured(false)
            setLoading(false)
            return
        }
        return onAuthStateChanged(auth, async user => {
            if (!user) {
                setIdToken(null)
                setLoading(false)
                return
            }
            setIdToken(await user.getIdToken())
        })
    }, [])

    const load = useCallback(async () => {
        if (!idToken) return
        setLoading(true)
        try {
            const res = await fetch('/api/admin/orders', {
                headers: { authorization: `Bearer ${idToken}` },
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data?.error || 'Could not load orders.')
            setRows(data.orders)
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load orders.')
        } finally {
            setLoading(false)
        }
    }, [idToken])

    useEffect(() => {
        load()
    }, [load])

    const move = async (orderId: string, status: OrderStatus) => {
        if (!idToken) return
        const res = await fetch('/api/admin/orders', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ orderId, status }),
        })
        if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            setError(data?.error || 'That status change was refused.')
            return
        }
        load()
    }

    if (!idToken && !loading) {
        return (
            <main className='tf-shell tf-shell--narrow'>
                <h1 style={{ fontSize: 32 }}>Production queue</h1>
                {configured ? (
                    <p style={{ marginTop: 12 }}>
                        Sign in with an account whose email is on <code>ADMIN_EMAILS</code> to see orders. Every request
                        from this page is re-checked on the server, so signing in is not what grants access — being on
                        that list is.
                    </p>
                ) : (
                    <div className='tf-note tf-note--warn' style={{ marginTop: 16 }}>
                        Firebase is not configured in the browser. Set the <code>NEXT_PUBLIC_FIREBASE_*</code> variables
                        to sign in here.
                    </div>
                )}
            </main>
        )
    }

    return (
        <main className='tf-shell'>
            <div className='tf-spread' style={{ marginBottom: 22 }}>
                <h1 style={{ fontSize: 34 }}>Production queue</h1>
                <button className='tf-btn tf-btn--ghost' onClick={load} disabled={loading}>
                    {loading ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            {error && <div className='tf-note tf-note--error'>{error}</div>}
            {!loading && rows.length === 0 && <p className='tf-muted'>No orders yet.</p>}

            {rows.length > 0 && (
                <div className='tf-card tf-card--flush' style={{ overflowX: 'auto' }}>
                    <table className='tf-table'>
                        <thead>
                            <tr>
                                <th>Toy</th>
                                <th>Order</th>
                                <th>Ship to</th>
                                <th>Files</th>
                                <th>Margin</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.order.id}>
                                    <td>
                                        <div className='tf-row' style={{ gap: 10 }}>
                                            {row.toy.imageUrl && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img className='tf-thumb' src={row.toy.imageUrl} alt='' />
                                            )}
                                            <div>
                                                <b>{row.toy.name}</b>
                                                <div className='tf-muted'>
                                                    {row.order.pricing.heightMm}mm
                                                    {row.toy.provider === 'standin' && ' · stand-in sculpt'}
                                                    {row.toy.demo && ' · demo'}
                                                </div>
                                                {row.toy.report && !row.toy.report.ok && (
                                                    <div style={{ color: '#b21e42', fontSize: 12.5 }}>
                                                        failed print checks
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>
                                            {row.order.id}
                                        </div>
                                        <div className='tf-muted'>
                                            {new Date(row.order.createdAt).toLocaleDateString('en-GB')} ·{' '}
                                            {formatMinor(row.order.pricing.totalMinor, row.order.pricing.currency)}
                                        </div>
                                        <div className='tf-muted'>
                                            {row.order.payment.paidAt ? 'paid' : 'unpaid'} · {row.order.payment.provider}
                                        </div>
                                    </td>
                                    <td>
                                        {row.order.address.name}
                                        <div className='tf-muted'>
                                            {row.order.address.city}, {row.order.address.countryCode}
                                        </div>
                                        <div className='tf-muted'>{row.order.address.email}</div>
                                    </td>
                                    <td>
                                        {row.order.production.stlUrl ? (
                                            <div className='tf-row' style={{ gap: 8 }}>
                                                <a href={row.order.production.stlUrl}>STL</a>
                                                {row.order.production.threeMfUrl && (
                                                    <a href={row.order.production.threeMfUrl}>3MF</a>
                                                )}
                                            </div>
                                        ) : (
                                            <span className='tf-muted'>not sent</span>
                                        )}
                                        {row.order.production.reference && (
                                            <div className='tf-muted'>ref {row.order.production.reference}</div>
                                        )}
                                    </td>
                                    <td>
                                        {row.cost ? (
                                            <>
                                                <b
                                                    style={{
                                                        color: row.cost.marginMinor > 0 ? '#0d6b52' : '#b21e42',
                                                    }}
                                                >
                                                    {formatMinor(row.cost.marginMinor, row.order.pricing.currency)}
                                                </b>
                                                <div className='tf-muted'>
                                                    {Math.round(row.cost.marginShare * 100)}% ·{' '}
                                                    {row.cost.filamentGrams}g
                                                </div>
                                            </>
                                        ) : (
                                            <span className='tf-muted'>—</span>
                                        )}
                                    </td>
                                    <td>
                                        <div className='tf-row' style={{ gap: 6 }}>
                                            {STATUS_FLOW.filter(s => canTransition(row.status, s.id)).map(s => (
                                                <button
                                                    key={s.id}
                                                    className='tf-chip'
                                                    style={{ padding: '6px 12px', fontSize: 12.5 }}
                                                    onClick={() => move(row.order.id, s.id)}
                                                >
                                                    {s.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div className='tf-muted' style={{ marginTop: 6 }}>
                                            now: {row.status.replace(/_/g, ' ')}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </main>
    )
}
