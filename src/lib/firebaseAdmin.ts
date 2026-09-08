// src/lib/firebaseAdmin.ts
//
// Server-side Firebase. Firestore holds projects and orders; Storage
// holds drawings, previews and print files.
//
// Initialised LAZILY, behind functions, and that is not a style
// preference. `cert()` throws the moment it is handed an undefined
// project id, so initialising at module scope means every build — CI,
// a preview deploy, a fresh clone running `npm run build` — needs a
// production service account just to collect page data. Nothing here
// touches credentials until a request actually reaches Firestore.
//
// The private key arrives from the environment with its newlines
// escaped: every hosting provider's UI does this, and the resulting
// "Invalid PEM formatted message" is the most common way a first deploy
// of something like this fails.

import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getStorage, type Storage } from 'firebase-admin/storage'

function normalizePrivateKey(raw: string | undefined): string | undefined {
    if (!raw) return undefined
    return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

let cached: App | null = null

function app(): App {
    if (cached) return cached
    if (getApps().length > 0) {
        cached = getApp()
        return cached
    }
    const projectId = process.env.FIREBASE_PROJECT_ID
    if (!projectId) {
        // Named plainly, because the alternative message — Firebase's own
        // "Service account object must contain a string project_id" — sends
        // people looking for a malformed JSON file that does not exist.
        throw new Error('Firebase is not configured: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY')
    }
    cached = initializeApp({
        credential: cert({
            projectId,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    })
    return cached
}

export function adminDb(): Firestore {
    return getFirestore(app())
}

export function adminAuth(): Auth {
    return getAuth(app())
}

export function adminStorage(): Storage {
    return getStorage(app())
}
