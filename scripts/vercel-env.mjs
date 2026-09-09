#!/usr/bin/env node
//
// Turn a Firebase service-account JSON into the block you paste into
// Vercel's Environment Variables box.
//
//     node scripts/vercel-env.mjs ~/Downloads/my-project-firebase-adminsdk.json
//     node scripts/vercel-env.mjs key.json --admin you@example.com --live
//
// Why this exists rather than "just copy the four values": the private
// key is a multi-line PEM, and every hosting UI mangles it differently.
// Pasting it raw is the single most common way a first deploy of a
// Firebase app dies, with an error ("Invalid PEM formatted message")
// that sends people looking at the wrong thing entirely. This prints it
// the way Vercel stores correctly — one line, newlines escaped — which
// is exactly what src/lib/firebaseAdmin.ts un-escapes at boot.
//
// Nothing is sent anywhere. It reads one local file and writes to your
// terminal.

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)

/** `--admin foo` and `--admin=foo` both. */
function flag(name) {
    const joined = args.find(a => a.startsWith(name + '='))
    if (joined) return joined.slice(name.length + 1)
    const at = args.indexOf(name)
    return at !== -1 ? args[at + 1] : ''
}

const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--admin')
const admin = flag('--admin')
const live = args.includes('--live')

if (!file) {
    console.error(`Usage: node scripts/vercel-env.mjs <serviceAccountKey.json> [--admin you@example.com] [--live]

Get the file: Firebase console → ⚙ Project settings → Service accounts
→ "Generate new private key" → it downloads a .json.

  --admin  the email that may open /admin (also gets the "order needs
           printing" mail). Defaults to the service account's own
           project, which is almost certainly not what you want.
  --live   leave demo mode off, for when the AI and payment keys are in.`)
    process.exit(1)
}

let key
try {
    key = JSON.parse(readFileSync(file, 'utf8'))
} catch (err) {
    console.error(`Could not read ${file} as JSON: ${err.message}`)
    process.exit(1)
}

for (const field of ['project_id', 'client_email', 'private_key']) {
    if (!key[field]) {
        console.error(`${file} has no "${field}" — that is not a service-account key.
Firebase console → ⚙ Project settings → Service accounts → Generate new private key.`)
        process.exit(1)
    }
}

// The bucket name is not in the key file. Firebase's default is
// <project>.appspot.com; newer projects get <project>.firebasestorage.app,
// and the console's Storage page shows which. Print the common one and
// say so, rather than guessing silently.
const bucket = `${key.project_id}.appspot.com`

const lines = [
    `FIREBASE_PROJECT_ID=${key.project_id}`,
    `FIREBASE_CLIENT_EMAIL=${key.client_email}`,
    `FIREBASE_PRIVATE_KEY="${key.private_key.replace(/\n/g, '\\n')}"`,
    `FIREBASE_STORAGE_BUCKET=${bucket}`,
    '',
    `ADMIN_EMAILS=${admin || 'you@example.com'}`,
]

if (!live) {
    lines.push(
        '',
        '# Demo mode: every AI step falls back to something that still works,',
        '# and checkout completes without charging. Delete these two once the',
        '# real keys are in.',
        'TOYFOUNDRY_DEMO=1',
        'TOYFOUNDRY_DEMO_PAYMENTS=1',
    )
} else {
    lines.push(
        '',
        '# Fill these in, or drop them and set TOYFOUNDRY_DEMO=1 instead.',
        'ANTHROPIC_API_KEY=',
        'OPENAI_API_KEY=',
        'MESHY_API_KEY=',
        'STRIPE_SECRET_KEY=',
    )
}

console.log(lines.join('\n'))
console.error(`
Paste all of it into Vercel → your project → Settings → Environment
Variables. The box takes a whole block at once; you do not have to add
them one at a time.

Check the bucket name before you deploy: Firebase console → Storage
shows it at the top. If it ends in .firebasestorage.app rather than
.appspot.com, change that one line.${admin ? '' : `

No --admin given, so ADMIN_EMAILS is a placeholder. /admin refuses
everyone until it holds a real address.`}`)
