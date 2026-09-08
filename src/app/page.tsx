// src/app/page.tsx — the landing page.
//
// One job: make a parent believe the drawing on their fridge can become
// an object on a shelf, and get them to the studio. Everything on this
// page is either that promise, the three steps that make it credible, or
// the price.
//
// Prices come from the same table the checkout charges from, so a page
// promising $89 and a checkout asking $99 cannot happen.

import Link from 'next/link'
import { SIZES, formatMinor } from '@/lib/pricing'
import { HEIGHT_RANGE_MM, MATERIAL } from '@/lib/printRules'

export default function ToyFoundryLanding() {
    return (
        <main className='tf-shell'>
            <section className='tf-hero'>
                <div>
                    <span className='tf-eyebrow'>Made once, for one child</span>
                    <h1 style={{ marginTop: 18 }}>
                        Your kid drew it.
                        <br />
                        <span className='tf-gradient-text'>We&rsquo;ll make it real.</span>
                    </h1>
                    <p className='tf-lead' style={{ marginTop: 22 }}>
                        Upload a photo of the drawing. Watch it become a collectible toy — the same wonky horns, the
                        same three eyes, the same colours. Approve it, and we 3D print it and post it to your door.
                    </p>
                    <div className='tf-hero-actions'>
                        <Link href='/studio' className='tf-btn tf-btn--primary'>
                            Upload a drawing
                        </Link>
                        <Link href='#how' className='tf-btn tf-btn--ghost'>
                            See how it works
                        </Link>
                    </div>
                    <p className='tf-hero-note'>
                        Free to design and preview. You only pay if you love it.
                    </p>
                </div>

                <div className='tf-hero-card'>
                    <div className='tf-hero-half'>
                        <div className='tf-hero-frame tf-hero-frame--paper'>
                            <DrawingArt />
                        </div>
                        <span>The drawing</span>
                    </div>
                    <div className='tf-hero-arrow' aria-hidden='true'>
                        &rarr;
                    </div>
                    <div className='tf-hero-half'>
                        <div className='tf-hero-frame tf-hero-frame--toy'>
                            <ToyArt />
                        </div>
                        <span>The toy</span>
                    </div>
                </div>
            </section>

            <section style={{ paddingBottom: 24 }}>
                <div className='tf-steps'>
                    <Step
                        n='01'
                        title='The drawing'
                        body='A photo of the real thing, crayon smudges and all.'
                        art={<DrawingArt />}
                    />
                    <Step
                        n='02'
                        title='The design'
                        body='A toy version that keeps every feature it had.'
                        art={<DesignArt />}
                    />
                    <Step n='03' title='The toy' body='Printed, packed, and in the post.' art={<ToyArt />} />
                </div>
            </section>

            <section className='tf-section' id='how'>
                <div className='tf-section-head'>
                    <h2>Three minutes from fridge to order</h2>
                    <p>
                        The hard part — making a drawing into something that can actually be printed — happens while
                        you watch.
                    </p>
                </div>
                <div className='tf-grid-3'>
                    <article className='tf-card'>
                        <span className='tf-eyebrow'>Step 1</span>
                        <h3 style={{ marginTop: 14 }}>We read the drawing</h3>
                        <p style={{ marginTop: 8, fontSize: 15 }}>
                            Every horn, eye, wing and stripe gets written down before anything is redrawn — that list
                            is what stops your child&rsquo;s creature turning into a generic one.
                        </p>
                    </article>
                    <article className='tf-card'>
                        <span className='tf-eyebrow'>Step 2</span>
                        <h3 style={{ marginTop: 14 }}>You approve the design</h3>
                        <p style={{ marginTop: 8, fontSize: 15 }}>
                            Bigger horns? A different colour? Closer to the original? Ask, and it is redrawn in
                            seconds. Nothing is made until you say yes.
                        </p>
                    </article>
                    <article className='tf-card'>
                        <span className='tf-eyebrow'>Step 3</span>
                        <h3 style={{ marginTop: 14 }}>We print and post it</h3>
                        <p style={{ marginTop: 8, fontSize: 15 }}>
                            The 3D model is checked for thin parts, balance and overhangs before it goes near a
                            printer, then printed in {MATERIAL.name} and shipped to you.
                        </p>
                    </article>
                </div>
            </section>

            <section className='tf-section' id='pricing'>
                <div className='tf-section-head'>
                    <h2>One toy. One price.</h2>
                    <p>
                        Every toy is designed and printed for one child, so there is nothing to keep in stock and
                        nothing to discount. Pick a size.
                    </p>
                </div>
                <div className='tf-grid-3'>
                    {SIZES.map(size => (
                        <article className='tf-card' key={size.id}>
                            <span className='tf-eyebrow'>{size.label} tall</span>
                            <div className='tf-price'>
                                <b>{formatMinor(size.priceMinor)}</b>
                                <span>{size.id === 'large' ? 'shipping included' : '+ shipping'}</span>
                            </div>
                            <p style={{ fontSize: 15 }}>{size.blurb}</p>
                        </article>
                    ))}
                </div>
                <div style={{ marginTop: 34 }}>
                    <Link href='/studio' className='tf-btn tf-btn--primary'>
                        Start with a drawing
                    </Link>
                </div>
            </section>

            <section className='tf-section' style={{ paddingTop: 24 }}>
                <div className='tf-section-head'>
                    <h2>Questions parents ask</h2>
                </div>
                <div className='tf-faq'>
                    <h3>Will it still look like my child&rsquo;s drawing?</h3>
                    <p>
                        That is the whole design of the thing. Before any redrawing happens we record the features
                        that make the character itself — how many eyes, which horn is longer, the exact colours — and
                        every version has to keep them. If a design drifts, there is a button that says
                        &ldquo;closer to the drawing&rdquo;.
                    </p>
                </div>
                <div className='tf-faq'>
                    <h3>How big is it, and what is it made of?</h3>
                    <p>
                        Between {HEIGHT_RANGE_MM.min / 10} and {HEIGHT_RANGE_MM.max / 10} centimetres tall, 3D printed
                        in {MATERIAL.name} — the same rigid plastic most desktop-printed toys are made from. Chunky by
                        design: no thin parts to snap off.
                    </p>
                </div>
                <div className='tf-faq'>
                    <h3>What if the toy cannot be printed?</h3>
                    <p>
                        Every model is measured before it is made — wall thickness, whether it stands up on its own,
                        whether it prints as one piece. If something fails, we fix it or tell you, before you are
                        charged for a print.
                    </p>
                </div>
                <div className='tf-faq'>
                    <h3>Who owns the drawing?</h3>
                    <p>
                        Your child does. We use the photo to design and print your toy, and for nothing else.
                    </p>
                </div>
            </section>

            <footer className='tf-foot'>
                <span>ToyFoundry — one drawing, one toy, no inventory.</span>
                <span>
                    <Link href='/studio' style={{ color: 'inherit' }}>
                        Start
                    </Link>
                </span>
            </footer>
        </main>
    )
}

function Step({ n, title, body, art }: { n: string; title: string; body: string; art: React.ReactNode }) {
    return (
        <div className='tf-step'>
            <div className='tf-step-art'>{art}</div>
            <span className='tf-step-n'>{n}</span>
            <h3>{title}</h3>
            <p>{body}</p>
        </div>
    )
}

/* The three illustrations are inline SVG on purpose: the page must sell
   the idea before a single photograph loads, and there are no real
   product photos to use until the first toys are printed. */

function DrawingArt() {
    return (
        <svg viewBox='0 0 100 100' width='78' height='78' fill='none' aria-hidden='true'>
            <path
                d='M32 74c0-22 6-34 14-34 6 0 8 6 4.5 11-3 4.4-8 3-8-2.5C42.5 40 52 33 60 33'
                stroke='#14121F'
                strokeWidth='3'
                strokeLinecap='round'
                opacity='0.75'
            />
            <circle cx='42' cy='30' r='4' fill='#F5476B' />
            <circle cx='56' cy='27' r='4' fill='#6C4CF1' />
            <path d='M36 26l4-9 5 8' stroke='#FFB627' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
    )
}

function DesignArt() {
    return (
        <svg viewBox='0 0 100 100' width='78' height='78' fill='none' aria-hidden='true'>
            <ellipse cx='50' cy='72' rx='22' ry='16' fill='#6C4CF1' opacity='0.85' />
            <circle cx='50' cy='42' r='20' fill='#6C4CF1' />
            <circle cx='43' cy='40' r='4.5' fill='#fff' />
            <circle cx='57' cy='40' r='4.5' fill='#fff' />
            <path d='M38 24l3-11 6 9' stroke='#FFB627' strokeWidth='4' strokeLinecap='round' strokeLinejoin='round' />
            <path d='M62 24l-3-11-6 9' stroke='#FFB627' strokeWidth='4' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
    )
}

function ToyArt() {
    return (
        <svg viewBox='0 0 100 100' width='78' height='78' fill='none' aria-hidden='true'>
            <ellipse cx='50' cy='86' rx='26' ry='5' fill='#14121F' opacity='0.12' />
            <ellipse cx='50' cy='70' rx='21' ry='15' fill='#F5476B' />
            <circle cx='50' cy='41' r='19' fill='#F5476B' />
            <circle cx='43' cy='39' r='4.5' fill='#fff' />
            <circle cx='57' cy='39' r='4.5' fill='#fff' />
            <ellipse cx='44' cy='34' rx='7' ry='4' fill='#fff' opacity='0.35' />
            <path d='M39 24l3-10 6 8' stroke='#FFB627' strokeWidth='4' strokeLinecap='round' strokeLinejoin='round' />
            <rect x='38' y='80' width='10' height='6' rx='3' fill='#F5476B' />
            <rect x='52' y='80' width='10' height='6' rx='3' fill='#F5476B' />
        </svg>
    )
}
