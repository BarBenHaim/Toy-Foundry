import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Every test in this project is pure: mesh maths, prompt building,
// pricing, the order state machine, and the demo image path (which uses
// sharp but no network). Nothing loads Next, React or Firebase, and
// that is a rule worth keeping — it is why the suite runs in a second
// and why the print engine is testable at all.

export default defineConfig({
    resolve: {
        alias: { '@': path.resolve(process.cwd(), 'src') },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.{test,spec}.{js,mjs}'],
        reporters: 'default',
    },
})
