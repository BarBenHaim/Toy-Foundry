// src/lib/emails.ts
//
// The one email a customer gets, and why it matters more than it looks.
//
// There is no login in this product. The link in this email — order id
// plus owner token — is the ONLY way a parent gets back to their order
// from a different device, or after clearing their browser. It is not a
// receipt with a tracking link attached; it is the key to the order,
// which is why it is sent the moment payment is confirmed and before
// anything else can fail.

import nodemailer from 'nodemailer'
import { formatMinor } from './pricing'
import { STATUS_FLOW } from './orderStatus'
import type { OrderPricing, ShippingAddress } from './types'

export interface OrderEmail {
    orderId: string
    toyName: string
    imageUrl: string | null
    pricing: OrderPricing
    address: ShippingAddress
    trackingUrl: string
}

export async function sendOrderConfirmation(email: OrderEmail): Promise<void> {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
        // No mailer configured. The order is already paid and queued —
        // this is a missing email, not a lost order, and throwing here
        // would fail a request that has already taken someone's money.
        console.warn('[toyfoundry] confirmation email skipped: MAIL_USER/MAIL_PASS not set', email.orderId)
        return
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    })

    const steps = STATUS_FLOW.map(
        step => `<li style="margin:6px 0"><b>${step.label}</b> — ${step.detail}${step.eta ? ` (${step.eta})` : ''}</li>`,
    ).join('')

    await transporter.sendMail({
        from: process.env.MAIL_USER,
        to: email.address.email,
        subject: `${email.toyName} is being made — ToyFoundry order ${email.orderId}`,
        html: `
        <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;color:#14121F">
          <div style="background:linear-gradient(135deg,#6C4CF1,#F5476B);padding:28px;border-radius:18px 18px 0 0">
            <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:-0.02em">We're making ${escapeHtml(
                email.toyName,
            )}</h1>
            <p style="color:rgba(255,255,255,.88);margin:8px 0 0;font-size:15px">Order ${escapeHtml(email.orderId)}</p>
          </div>
          <div style="background:#fff;border:1px solid #eee;border-top:none;padding:28px;border-radius:0 0 18px 18px">
            ${
                email.imageUrl
                    ? `<img src="${email.imageUrl}" alt="${escapeHtml(
                          email.toyName,
                      )}" style="width:100%;border-radius:14px;margin-bottom:22px" />`
                    : ''
            }
            <p style="font-size:16px;line-height:1.6;margin:0 0 20px">
              Your ${email.pricing.heightMm / 10}cm toy is queued for printing. Here is what happens next:
            </p>
            <ol style="font-size:14.5px;line-height:1.6;color:#4A4560;padding-left:20px;margin:0 0 24px">${steps}</ol>
            <p style="margin:0 0 24px">
              <a href="${email.trackingUrl}"
                 style="display:inline-block;background:#6C4CF1;color:#fff;text-decoration:none;padding:14px 26px;border-radius:999px;font-weight:600">
                Track your order
              </a>
            </p>
            <p style="font-size:13px;color:#7D7794;line-height:1.6;margin:0">
              Keep this email — that link is how you get back to your order. Sending it to someone else lets them see
              the order too.
            </p>
            <hr style="border:none;border-top:1px solid #eee;margin:22px 0" />
            <p style="font-size:13px;color:#7D7794;line-height:1.6;margin:0">
              ${formatMinor(email.pricing.totalMinor, email.pricing.currency)} paid · shipping to
              ${escapeHtml(email.address.name)}, ${escapeHtml(email.address.street1)},
              ${escapeHtml(email.address.city)} ${escapeHtml(email.address.postcode)},
              ${escapeHtml(email.address.countryCode)}
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
