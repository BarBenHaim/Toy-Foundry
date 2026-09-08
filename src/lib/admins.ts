// src/lib/admins.ts
//
// Who can open the production queue, and who gets the "an order needs
// printing" email. Comma-separated in one env var, compared in
// lowercase because Firebase normalises emails on signup and a
// mixed-case env var would silently lock the owner out of their own
// back office.

const raw = process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || ''

export const ADMIN_EMAILS = raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

/** Where production and order notifications go. */
export const PRIMARY_ADMIN_EMAIL = ADMIN_EMAILS[0] || process.env.MAIL_USER || ''

export function isAdmin(email: string | undefined | null): boolean {
    if (!email) return false
    // An empty list means nobody is an admin. The alternative — an empty
    // list meaning everybody — is the kind of default that opens a back
    // office to the internet on the first deploy that forgets an env var.
    return ADMIN_EMAILS.includes(email.toLowerCase())
}
