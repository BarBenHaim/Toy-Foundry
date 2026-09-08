// src/app/layout.tsx
//
// The shell every page sits in: the brand bar, the stylesheet, and the
// metadata. Deliberately thin — the studio is the product, and anything
// that renders above it on every page is competing with a parent's
// first look at their child's toy.

import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { Mark } from '@/components/Mark'
import './globals.css'

export const metadata: Metadata = {
    title: 'ToyFoundry — turn a drawing into a real toy',
    description:
        'Upload the drawing your child made. We design it into a collectible toy, 3D print it, and post it to you.',
    openGraph: {
        title: 'ToyFoundry — turn a drawing into a real toy',
        description: 'Your kid drew it. We’ll make it real.',
        type: 'website',
    },
}

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    themeColor: '#6c4cf1',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang='en'>
            {/* `tf` is the app shell class every rule in globals.css hangs
                off. Keeping the styles scoped to one class rather than
                loose on the element selectors keeps the cascade readable
                as the app grows. */}
            <body className='tf'>
                <header className='tf-top'>
                    <Link href='/' className='tf-brand'>
                        <Mark />
                        ToyFoundry
                    </Link>
                    <nav className='tf-top-links'>
                        <Link href='/#how'>How it works</Link>
                        <Link href='/#pricing'>Pricing</Link>
                        <Link href='/studio' className='tf-btn tf-btn--ghost' style={{ padding: '10px 20px', fontSize: 15 }}>
                            Start
                        </Link>
                    </nav>
                </header>
                {children}
            </body>
        </html>
    )
}
