// src/lib/firebaseClient.ts
//
// Browser Firebase, used for exactly one thing: signing in to the
// production queue at /admin. Parents never authenticate — their
// projects are held by an owner token, not an account — so nothing in
// the customer flow imports this.
//
// Lazy, like the server side, and for the same reason: `initializeApp`
// with an undefined API key throws, and at module scope that throw
// happens while Next is prerendering /admin, failing the build of an
// app whose customer-facing pages do not use Firebase in the browser at
// all. Called from inside an effect, it only ever runs in a real
// browser with real config.

import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

export function isFirebaseConfigured(): boolean {
    return Boolean(config.apiKey && config.projectId)
}

/** Returns null when the browser config is missing, so the admin page can
 *  say "not configured" instead of throwing a white screen. */
export function browserAuth(): Auth | null {
    if (!isFirebaseConfigured()) return null
    const app = getApps().length ? getApp() : initializeApp(config)
    return getAuth(app)
}
