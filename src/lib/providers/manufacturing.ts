// src/lib/providers/manufacturing.ts
//
// Step 9: hand the print file to whoever is going to make it.
//
// Two paths, and which one runs is a deployment decision, not a code
// change:
//
//   • API. JLC3DP's 3D-printing ordering API is granted per account
//     rather than self-serve, so the endpoint, the auth header and the
//     body shape are all env-configurable and the request is built from
//     an order the same way regardless. When credentials appear, orders
//     start flowing without a deploy.
//   • Handoff. Otherwise the order is queued for a human: an email with
//     the STL, the 3MF, the printability report and the address, and the
//     order moves to "ready for production". Someone downloads the file,
//     places the order with a print shop, and moves the status along from
//     /admin. The customer experience is identical either way, which is
//     the whole point of doing it this way before the API exists.
//
// The important part in both paths: what gets sent is FROZEN onto the
// order. A model regenerated later must not silently change what is
// being printed.

import nodemailer from 'nodemailer'
import { PRIMARY_ADMIN_EMAIL } from '@/lib/admins'
import { formatMinor } from '../pricing'
import type { PrintabilityReport, ShippingAddress, OrderPricing } from '../types'
import { fetchWithTimeout, fromResponse } from './errors'

export interface ProductionRequest {
    orderId: string
    toyName: string
    stlUrl: string
    threeMfUrl: string | null
    pricing: OrderPricing
    address: ShippingAddress
    report: PrintabilityReport | null
    /** True when the model came from the stand-in sculptor rather than
     *  the image-to-3D service. A human MUST look at these before they
     *  are printed, and the email says so in the subject line. */
    standIn: boolean
}

export interface ProductionResult {
    provider: 'jlc3dp' | 'manual'
    reference: string | null
    sentAt: string
}

export function apiConfigured(): boolean {
    return Boolean(process.env.JLC3DP_API_URL && process.env.JLC3DP_API_KEY)
}

export async function sendToProduction(req: ProductionRequest): Promise<ProductionResult> {
    if (apiConfigured()) return sendToJlc(req)
    await emailProductionQueue(req)
    return { provider: 'manual', reference: null, sentAt: new Date().toISOString() }
}

async function sendToJlc(req: ProductionRequest): Promise<ProductionResult> {
    const res = await fetchWithTimeout(
        process.env.JLC3DP_API_URL as string,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${process.env.JLC3DP_API_KEY}`,
            },
            body: JSON.stringify({
                external_order_id: req.orderId,
                files: [{ url: req.stlUrl, filename: `${req.orderId}.stl` }],
                process: 'FDM',
                material: process.env.JLC3DP_MATERIAL || 'PLA',
                // Layer height is the one setting that decides whether a
                // face reads at this scale. 0.15mm is slower than the
                // default 0.2 and visibly better on a 10cm character.
                layer_height_mm: Number(process.env.JLC3DP_LAYER_HEIGHT || 0.15),
                infill_percent: Number(process.env.JLC3DP_INFILL || 20),
                color: process.env.JLC3DP_COLOR || 'white',
                quantity: 1,
                shipping: {
                    name: req.address.name,
                    phone: req.address.phone || '',
                    email: req.address.email,
                    address1: req.address.street1,
                    address2: req.address.street2 || '',
                    city: req.address.city,
                    postcode: req.address.postcode,
                    country: req.address.countryCode,
                },
            }),
        },
        30000,
        'Production order',
    )
    if (!res.ok) throw fromResponse('Production order', res.status, await res.text())
    const data = (await res.json()) as { order_id?: string; id?: string; data?: { orderId?: string } }
    return {
        provider: 'jlc3dp',
        reference: data.order_id || data.id || data.data?.orderId || null,
        sentAt: new Date().toISOString(),
    }
}

/** The manual path. Deliberately verbose: whoever picks this up has to
 *  be able to place the order without opening the admin panel. */
export async function emailProductionQueue(req: ProductionRequest): Promise<void> {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
        // No mailer configured. The order is already marked ready for
        // production in Firestore and shows in the admin queue, so this
        // is a missing notification, not a lost order — and throwing
        // here would roll back a paid order's status.
        console.warn('[toyfoundry] production email skipped: MAIL_USER/MAIL_PASS not set', req.orderId)
        return
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    })

    const warnings = (req.report?.checks || []).filter(c => c.level !== 'pass')
    const warningRows = warnings.length
        ? warnings.map(c => `<li><strong>${c.level.toUpperCase()}</strong> — ${escapeHtml(c.message)}</li>`).join('')
        : '<li>All print checks passed.</li>'

    await transporter.sendMail({
        from: process.env.MAIL_USER,
        to: PRIMARY_ADMIN_EMAIL,
        subject: `${req.standIn ? '⚠️ REVIEW FIRST — ' : '🧸 '}ToyFoundry order ${req.orderId} ready to print`,
        html: `
        <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#171326">
          <div style="background:linear-gradient(135deg,#6C4CF1,#F5476B);padding:24px;border-radius:16px 16px 0 0">
            <h1 style="color:#fff;margin:0;font-size:22px">Order ${escapeHtml(req.orderId)}</h1>
            <p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px">${escapeHtml(req.toyName)} — ${
                req.pricing.heightMm
            }mm — ${formatMinor(req.pricing.totalMinor, req.pricing.currency)}</p>
          </div>
          <div style="background:#fff;border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 16px 16px">
            ${
                req.standIn
                    ? '<p style="background:#FFF3CD;border:1px solid #FFE08A;padding:12px;border-radius:8px"><strong>This model came from the fallback sculptor,</strong> not the image-to-3D service. Look at it before printing.</p>'
                    : ''
            }
            <h3>Print files</h3>
            <p><a href="${req.stlUrl}">STL</a>${req.threeMfUrl ? ` &nbsp;·&nbsp; <a href="${req.threeMfUrl}">3MF</a>` : ''}</p>
            <h3>Print checks</h3>
            <ul>${warningRows}</ul>
            <p style="color:#666;font-size:13px">${req.report ? `${req.report.widthMm} × ${req.report.depthMm} × ${req.report.heightMm} mm · ${req.report.volumeCm3} cm³ · ${req.report.triangleCount.toLocaleString('en-US')} triangles` : ''}</p>
            <h3>Ship to</h3>
            <p style="line-height:1.6">
              ${escapeHtml(req.address.name)}<br>
              ${escapeHtml(req.address.street1)}${req.address.street2 ? `<br>${escapeHtml(req.address.street2)}` : ''}<br>
              ${escapeHtml(req.address.city)} ${escapeHtml(req.address.postcode)}<br>
              ${escapeHtml(req.address.countryCode)}<br>
              ${escapeHtml(req.address.email)}${req.address.phone ? ` · ${escapeHtml(req.address.phone)}` : ''}
            </p>
          </div>
        </div>`,
    })
}

function escapeHtml(s: string): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}
