'use client'

// src/app/studio/page.tsx
//
// The whole product, as one screen that moves.
//
// The flow is upload → preview → approve → 3D →
// order, and the thing that makes it feel like magic rather than like a
// form is that the parent is only asked to DO something twice: approve a
// design, and pay. Everything between those two — reading the drawing,
// rendering it, sculpting it, checking it can be printed — runs on its
// own and narrates itself while it does.
//
// So this component is a small state machine driven by the project's
// server-side status, not by local flags. A refresh, a closed laptop, a
// checkout that was cancelled — all of them resume exactly where they
// were, because the truth is the project document and the browser only
// holds the id and the owner token.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { Mark } from '@/components/Mark'
import { PrintChecks } from '@/components/PrintChecks'
import { SHIPPING_MINOR, SIZES, formatMinor } from '@/lib/pricing'
import { CONFIDENCE_FLOOR } from '@/lib/characterDna'
import { MAX_REVISIONS, describeRevision } from '@/lib/toyBrief'
import type { CharacterDna, PrintabilityReport, RevisionRequest, ToyPreview, ToySizeId } from '@/lib/types'

// three.js has no server story, and most parents never reach the 3D
// step. Load it on demand.
const ModelViewer = dynamicImport(() => import('@/components/ModelViewer'), {
    ssr: false,
    loading: () => <div className='tf-viewer' />,
})

const STORAGE_KEY = 'toyfoundry.project'

interface ProjectView {
    id: string
    status: string
    drawingUrl: string
    dna: CharacterDna | null
    previews: ToyPreview[]
    selectedPreviewId: string | null
    approvedPreviewId: string | null
    revisions: RevisionRequest[]
    model: { stlUrl: string | null; report: PrintabilityReport | null; provider: string } | null
    demo: boolean
    error: string | null
}

type Stage = 'upload' | 'reading' | 'designing' | 'design' | 'sculpting' | 'checkout'

export default function Studio() {
    const [token, setToken] = useState<string>('')
    const [project, setProject] = useState<ProjectView | null>(null)
    const [stage, setStage] = useState<Stage>('upload')
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [sculptProgress, setSculptProgress] = useState(0)
    const started = useRef(false)

    // ── Resume ──────────────────────────────────────────────────────
    // Read from window.location rather than useSearchParams: this page
    // is a client component and useSearchParams would drag a Suspense
    // boundary requirement into a page that has no other reason for one.
    useEffect(() => {
        if (started.current) return
        started.current = true
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
            const fromUrl = new URLSearchParams(window.location.search).get('project')
            const id = fromUrl || saved?.id
            if (!id || !saved?.token || (fromUrl && fromUrl !== saved?.id)) return
            setToken(saved.token)
            fetch(`/api/projects/${id}?token=${encodeURIComponent(saved.token)}`)
                .then(res => (res.ok ? res.json() : null))
                .then(data => {
                    if (data?.project) {
                        setProject(data.project)
                        setStage(stageFor(data.project))
                    }
                })
                .catch(() => {})
        } catch {
            /* a browser with storage disabled just starts fresh */
        }
    }, [])

    const call = useCallback(
        async (path: string, init: RequestInit = {}, authToken?: string) => {
            const res = await fetch(path, {
                ...init,
                headers: {
                    ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
                    'x-toyfoundry-token': authToken || token,
                    ...(init.headers || {}),
                },
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data?.error || 'Something went wrong.')
            return data
        },
        [token],
    )

    // ── Steps 1–3: upload, read, draw ───────────────────────────────
    const startWithFile = useCallback(
        async (file: File) => {
            setError(null)
            setStage('reading')
            setBusy('Uploading the drawing…')
            try {
                const form = new FormData()
                form.append('drawing', file)
                const created = await fetch('/api/projects', { method: 'POST', body: form })
                const data = await created.json().catch(() => ({}))
                if (!created.ok) throw new Error(data?.error || 'That upload did not work.')

                const newToken: string = data.ownerToken
                setToken(newToken)
                setProject(data.project)
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: data.project.id, token: newToken }))
                } catch {
                    /* private mode: the flow still works, it just cannot resume */
                }

                setBusy('Reading the drawing…')
                const analysis = await call(
                    `/api/projects/${data.project.id}/analyze`,
                    { method: 'POST' },
                    newToken,
                )
                setProject(p => (p ? { ...p, dna: analysis.dna, demo: analysis.demo } : p))

                setStage('designing')
                setBusy('Designing your toy…')
                const preview = await call(
                    `/api/projects/${data.project.id}/preview`,
                    { method: 'POST' },
                    newToken,
                )
                setProject(p =>
                    p
                        ? {
                              ...p,
                              previews: [...(p.previews || []), preview.preview],
                              selectedPreviewId: preview.preview.id,
                              revisions: preview.revisions,
                              demo: preview.demo,
                          }
                        : p,
                )
                setStage('design')
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Something went wrong.')
                setStage(prev => (prev === 'upload' ? 'upload' : 'design'))
            } finally {
                setBusy(null)
            }
        },
        [call],
    )

    // ── Step 5: revise ──────────────────────────────────────────────
    const revise = useCallback(
        async (revision: RevisionRequest) => {
            if (!project) return
            setError(null)
            setBusy('Redrawing…')
            try {
                const data = await call(`/api/projects/${project.id}/preview`, {
                    method: 'POST',
                    body: JSON.stringify({ revision }),
                })
                setProject(p =>
                    p
                        ? {
                              ...p,
                              previews: [...p.previews, data.preview],
                              selectedPreviewId: data.preview.id,
                              revisions: data.revisions,
                          }
                        : p,
                )
            } catch (err) {
                setError(err instanceof Error ? err.message : 'That change did not work.')
            } finally {
                setBusy(null)
            }
        },
        [call, project],
    )

    // ── Steps 6–7: approve, sculpt, check ───────────────────────────
    const approve = useCallback(async () => {
        if (!project) return
        setError(null)
        setStage('sculpting')
        setSculptProgress(4)
        try {
            await call(`/api/projects/${project.id}/approve`, {
                method: 'POST',
                body: JSON.stringify({ previewId: project.selectedPreviewId }),
            })
            const start = await call(`/api/projects/${project.id}/model`, { method: 'POST' })
            if (start.status === 'ready') {
                setProject(p => (p ? { ...p, model: start.model, approvedPreviewId: p.selectedPreviewId } : p))
                setStage('checkout')
                return
            }
            setSculptProgress(start.progress || 5)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'We could not start the 3D model.')
            setStage('design')
        }
    }, [call, project])

    // Poll the sculpt every four seconds: often enough that the bar
    // moves, rarely enough that a five-minute sculpt costs 75 requests
    // rather than 750.
    useEffect(() => {
        if (stage !== 'sculpting' || !project || !token) return
        let stop = false
        let timer = 0
        const tick = async () => {
            try {
                const data = await call(`/api/projects/${project.id}/model`)
                if (stop) return
                setSculptProgress(Math.max(4, data.progress || 0))
                if (data.status === 'ready') {
                    setProject(p => (p ? { ...p, model: data.model } : p))
                    setStage('checkout')
                    return
                }
                if (data.status === 'failed') {
                    setError('The 3D model did not come out. Try approving again.')
                    setStage('design')
                    return
                }
            } catch (err) {
                if (stop) return
                setError(err instanceof Error ? err.message : 'Lost contact while sculpting.')
                setStage('design')
                return
            }
            if (!stop) timer = window.setTimeout(tick, 4000)
        }
        timer = window.setTimeout(tick, 2500)
        return () => {
            stop = true
            window.clearTimeout(timer)
        }
    }, [stage, project, token, call])

    const preview = project?.previews.find(p => p.id === project.selectedPreviewId) || null
    const stageIndex = ['upload', 'reading', 'designing', 'design', 'sculpting', 'checkout'].indexOf(stage)

    return (
        <main className='tf-shell tf-studio'>
            <div className='tf-progress-rail' aria-hidden='true'>
                {['Drawing', 'Design', '3D model', 'Order'].map((label, i) => {
                    const at = [0, 3, 4, 5][i]
                    const done = stageIndex > at
                    const active = stageIndex >= at && !done
                    return (
                        <span key={label} className={`tf-progress-pip${done ? ' is-done' : active ? ' is-active' : ''}`} />
                    )
                })}
            </div>

            {error && (
                <div className='tf-note tf-note--error' role='alert'>
                    {error}
                </div>
            )}

            {stage === 'upload' && <UploadStage onFile={startWithFile} />}

            {(stage === 'reading' || stage === 'designing') && project && (
                <WorkingStage project={project} busy={busy} stage={stage} />
            )}

            {stage === 'design' && project && preview && (
                <DesignStage
                    project={project}
                    preview={preview}
                    busy={busy}
                    onRevise={revise}
                    onApprove={approve}
                    onRestart={() => {
                        try {
                            localStorage.removeItem(STORAGE_KEY)
                        } catch {
                            /* nothing to clear */
                        }
                        setProject(null)
                        setToken('')
                        setStage('upload')
                    }}
                />
            )}

            {stage === 'sculpting' && project && <SculptStage project={project} progress={sculptProgress} />}

            {stage === 'checkout' && project && token && <CheckoutStage project={project} token={token} />}
        </main>
    )
}

/** Where a resumed project picks up. Reads the server's status rather
 *  than remembering what the browser was doing. */
function stageFor(project: ProjectView): Stage {
    if (project.model?.stlUrl) return 'checkout'
    if (project.status === 'modeling') return 'sculpting'
    if (project.previews?.length > 0) return 'design'
    if (project.dna) return 'designing'
    return 'reading'
}

// ── Upload ──────────────────────────────────────────────────────────

function UploadStage({ onFile }: { onFile: (file: File) => void }) {
    const [over, setOver] = useState(false)

    return (
        <div className='tf-shell--narrow' style={{ margin: '0 auto', paddingTop: 12 }}>
            <div style={{ textAlign: 'center', marginBottom: 30 }}>
                <h1 style={{ fontSize: 'clamp(32px, 5vw, 46px)' }}>Show us the drawing</h1>
                <p className='tf-lead' style={{ margin: '14px auto 0' }}>
                    A photo from your phone is perfect. Flat on a table, decent light, the whole page in frame.
                </p>
            </div>

            <label
                className={`tf-drop${over ? ' is-over' : ''}`}
                onDragOver={e => {
                    e.preventDefault()
                    setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={e => {
                    e.preventDefault()
                    setOver(false)
                    const file = e.dataTransfer.files?.[0]
                    if (file) onFile(file)
                }}
            >
                <Mark size={52} />
                <h3>Drop the photo here</h3>
                <p>or tap to choose one — JPEG, PNG, HEIC, up to 12MB</p>
                <input
                    type='file'
                    accept='image/*'
                    onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) onFile(file)
                    }}
                />
            </label>

            <div className='tf-note tf-note--info' style={{ marginTop: 26 }}>
                Nothing is charged until you have seen your toy and said yes.
            </div>
        </div>
    )
}

// ── Reading / drawing ───────────────────────────────────────────────

function WorkingStage({ project, busy, stage }: { project: ProjectView; busy: string | null; stage: Stage }) {
    return (
        <div className='tf-two'>
            <div className='tf-canvas tf-canvas--busy'>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={project.drawingUrl} alt='The drawing being read' />
                <span className='tf-scan' />
                <span className='tf-busy-note'>{busy || 'Working…'}</span>
            </div>
            <div className='tf-stack'>
                <h2>{stage === 'reading' ? 'Reading the drawing' : 'Designing the toy'}</h2>
                <p>
                    {stage === 'reading'
                        ? 'Counting the eyes, the horns, the legs — everything that makes this character itself, before anything gets redrawn.'
                        : 'Redrawing it as a collectible toy: thick enough to print, and still unmistakably the same creature.'}
                </p>
                {project.dna && <DnaTags dna={project.dna} />}
            </div>
        </div>
    )
}

/** The reveal that makes the AI feel like it is paying attention: the
 *  parent sees their child's own features listed back at them. */
function DnaTags({ dna }: { dna: CharacterDna }) {
    return (
        <div className='tf-reveal'>
            <h3 style={{ marginBottom: 4 }}>{dna.name}</h3>
            <p style={{ fontSize: 15 }}>{dna.summary}</p>
            <div className='tf-dna'>
                {dna.features.slice(0, 6).map((f, i) => (
                    <span className='tf-tag' key={`${f.kind}-${i}`}>
                        {f.color && <span className='tf-swatch' style={{ background: f.color }} />}
                        {f.description}
                    </span>
                ))}
                {dna.palette.map(color => (
                    <span className='tf-tag' key={color}>
                        <span className='tf-swatch' style={{ background: color }} />
                        {color}
                    </span>
                ))}
            </div>
        </div>
    )
}

// ── Design ──────────────────────────────────────────────────────────

function DesignStage({
    project,
    preview,
    busy,
    onRevise,
    onApprove,
    onRestart,
}: {
    project: ProjectView
    preview: ToyPreview
    busy: string | null
    onRevise: (revision: RevisionRequest) => void
    onApprove: () => void
    onRestart: () => void
}) {
    const [custom, setCustom] = useState('')
    const used = project.revisions?.length || 0
    const left = MAX_REVISIONS - used
    const feature = project.dna?.features[0]?.kind || 'horns'

    return (
        <div className='tf-two'>
            <div>
                <div className={`tf-canvas${busy ? ' tf-canvas--busy' : ''}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img key={preview.id} src={preview.imageUrl} alt='Your toy design' className='tf-reveal' />
                    {busy && (
                        <>
                            <span className='tf-scan' />
                            <span className='tf-busy-note'>{busy}</span>
                        </>
                    )}
                </div>
                {project.previews.length > 1 && (
                    <p className='tf-muted' style={{ marginTop: 12 }}>
                        Version {project.previews.findIndex(p => p.id === preview.id) + 1} of {project.previews.length}
                        {project.revisions.length > 0 && ` · ${project.revisions.map(describeRevision).join(' → ')}`}
                    </p>
                )}
            </div>

            <div className='tf-stack'>
                <div>
                    <span className='tf-eyebrow'>Your toy</span>
                    <h2 style={{ marginTop: 12 }}>{project.dna?.name || 'Your character'}</h2>
                    <p style={{ marginTop: 10 }}>
                        Designed to be printed: chunky, standing on its own, nothing thin enough to snap.
                    </p>
                </div>

                {/* A bad photo is the most common reason a toy comes out
                    wrong, and it is the one thing the parent can fix in
                    ten seconds. Say so before they spend revisions
                    chasing a design that was misread, not misdrawn. */}
                {project.dna && project.dna.confidence < CONFIDENCE_FLOOR + 0.15 && !project.demo && (
                    <div className='tf-note tf-note--warn'>
                        This photo was hard to read. If the design has missed something, a brighter picture of the
                        drawing lying flat will do more than any of the changes below.
                    </div>
                )}

                {project.demo && (
                    <div className='tf-note tf-note--warn'>
                        <b>Demo mode.</b> The AI design step is switched off in this environment, so this preview is
                        your drawing restaged rather than a new render. Everything after it — the 3D model, the print
                        checks, the files — is real.
                    </div>
                )}

                <div>
                    <h3 style={{ marginBottom: 10 }}>Want a change?</h3>
                    <div className='tf-chips'>
                        <button
                            className='tf-chip'
                            disabled={!!busy || left <= 0}
                            onClick={() => onRevise({ kind: 'bigger_feature', detail: feature })}
                        >
                            Bigger {feature}
                        </button>
                        <button className='tf-chip' disabled={!!busy || left <= 0} onClick={() => onRevise({ kind: 'cuter' })}>
                            Make it cuter
                        </button>
                        <button
                            className='tf-chip'
                            disabled={!!busy || left <= 0}
                            onClick={() => onRevise({ kind: 'closer_to_drawing' })}
                        >
                            Closer to the drawing
                        </button>
                        <button
                            className='tf-chip'
                            disabled={!!busy || left <= 0}
                            onClick={() => {
                                const colour = window.prompt('Which colour should it mostly be?')
                                if (colour) onRevise({ kind: 'change_color', detail: colour })
                            }}
                        >
                            Change the colour
                        </button>
                    </div>

                    <form
                        style={{ marginTop: 14 }}
                        onSubmit={e => {
                            e.preventDefault()
                            if (custom.trim().length < 3) return
                            onRevise({ kind: 'custom', detail: custom.trim() })
                            setCustom('')
                        }}
                    >
                        <label className='tf-field'>
                            <span>Or say it in your own words</span>
                            <input
                                value={custom}
                                onChange={e => setCustom(e.target.value)}
                                placeholder='give it a longer tail'
                                maxLength={120}
                                disabled={!!busy || left <= 0}
                            />
                        </label>
                    </form>
                    <p className='tf-muted'>
                        {left > 0
                            ? `${left} change${left === 1 ? '' : 's'} left before you approve.`
                            : 'That is all the changes for this design — approve the version you like best.'}
                    </p>
                </div>

                <button className='tf-btn tf-btn--primary tf-btn--block' disabled={!!busy} onClick={onApprove}>
                    Make this one real
                </button>
                <button className='tf-btn tf-btn--quiet tf-btn--block' onClick={onRestart}>
                    Start over with a different drawing
                </button>
            </div>
        </div>
    )
}

// ── Sculpting ───────────────────────────────────────────────────────

function SculptStage({ project, progress }: { project: ProjectView; progress: number }) {
    const preview = project.previews.find(p => p.id === (project.approvedPreviewId || project.selectedPreviewId))
    return (
        <div className='tf-two'>
            <div className='tf-canvas tf-canvas--busy'>
                {preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview.imageUrl} alt='The design being sculpted' />
                )}
                <span className='tf-scan' />
                <span className='tf-busy-note'>Sculpting in 3D — {Math.round(progress)}%</span>
            </div>
            <div className='tf-stack'>
                <h2>Turning it into a real object</h2>
                <p>
                    The picture is becoming geometry: a shape with a back, a base, and a thickness. This is the slow
                    step — a couple of minutes is normal.
                </p>
                <p>
                    Then we check it the way a printer would: is anything too thin to survive a child, does it stand up
                    on its own, does it print as one piece.
                </p>
            </div>
        </div>
    )
}

// ── Checkout ────────────────────────────────────────────────────────

function CheckoutStage({ project, token }: { project: ProjectView; token: string }) {
    const [sizeId, setSizeId] = useState<ToySizeId>('medium')
    const [submitting, setSubmitting] = useState(false)
    const [problem, setProblem] = useState<string | null>(null)
    const size = SIZES.find(s => s.id === sizeId) as (typeof SIZES)[number]
    // The server prices the order from its own table regardless; this is
    // only what the parent is shown, and it reads the same constant so
    // the two cannot drift.
    const shipping = sizeId === 'large' ? 0 : SHIPPING_MINOR
    const report = project.model?.report || null

    const submit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setProblem(null)
        setSubmitting(true)
        const form = new FormData(e.currentTarget)
        try {
            const res = await fetch('/api/orders', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-toyfoundry-token': token },
                body: JSON.stringify({
                    projectId: project.id,
                    sizeId,
                    address: Object.fromEntries(form.entries()),
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data?.error || 'Could not start checkout.')
            try {
                const orders = JSON.parse(localStorage.getItem('toyfoundry.orders') || '[]')
                localStorage.setItem(
                    'toyfoundry.orders',
                    JSON.stringify([...orders, { id: data.order.id, token }].slice(-20)),
                )
            } catch {
                /* the tracking link still works, it just is not remembered here */
            }
            window.location.href = data.checkoutUrl
        } catch (err) {
            setProblem(err instanceof Error ? err.message : 'Could not start checkout.')
            setSubmitting(false)
        }
    }

    return (
        <div className='tf-two'>
            <div className='tf-stack'>
                <ModelViewer
                    url={`/api/projects/${project.id}/model/preview?token=${encodeURIComponent(token)}`}
                    color={project.dna?.palette?.[0] || '#6c4cf1'}
                    heightMm={size.heightMm}
                />
                {report && <PrintChecks report={report} />}
            </div>

            <form className='tf-stack' onSubmit={submit}>
                <div>
                    <span className='tf-eyebrow'>Ready to print</span>
                    <h2 style={{ marginTop: 12 }}>Pick a size</h2>
                </div>

                <div className='tf-sizes'>
                    {SIZES.map(option => (
                        <label key={option.id} className={`tf-size${option.id === sizeId ? ' is-on' : ''}`}>
                            <input
                                type='radio'
                                name='size'
                                value={option.id}
                                checked={option.id === sizeId}
                                onChange={() => setSizeId(option.id)}
                                style={{ accentColor: '#6c4cf1' }}
                            />
                            <span className='tf-size-h'>{option.label}</span>
                            <span className='tf-size-b'>{option.blurb}</span>
                            <span className='tf-size-p'>{formatMinor(option.priceMinor)}</span>
                        </label>
                    ))}
                </div>

                <div className='tf-card'>
                    <h3 style={{ marginBottom: 14 }}>Where should it go?</h3>
                    <label className='tf-field'>
                        <span>Full name</span>
                        <input name='name' required autoComplete='name' />
                    </label>
                    <label className='tf-field'>
                        <span>Email</span>
                        <input name='email' type='email' required autoComplete='email' />
                    </label>
                    <label className='tf-field'>
                        <span>Street address</span>
                        <input name='street1' required autoComplete='address-line1' />
                    </label>
                    <label className='tf-field'>
                        <span>Apartment, floor (optional)</span>
                        <input name='street2' autoComplete='address-line2' />
                    </label>
                    <div className='tf-field-row'>
                        <label className='tf-field'>
                            <span>City</span>
                            <input name='city' required autoComplete='address-level2' />
                        </label>
                        <label className='tf-field'>
                            <span>Postcode</span>
                            <input name='postcode' required autoComplete='postal-code' />
                        </label>
                    </div>
                    <div className='tf-field-row'>
                        <label className='tf-field'>
                            <span>Country code</span>
                            <input name='countryCode' required maxLength={2} placeholder='IL' autoComplete='country' />
                        </label>
                        <label className='tf-field'>
                            <span>Phone (for the courier)</span>
                            <input name='phone' autoComplete='tel' />
                        </label>
                    </div>

                    <div className='tf-total'>
                        <span>{size.label} toy</span>
                        <span>{formatMinor(size.priceMinor)}</span>
                    </div>
                    <div className='tf-total'>
                        <span>Shipping</span>
                        <span>{shipping === 0 ? 'Included' : formatMinor(shipping)}</span>
                    </div>
                    <div className='tf-total tf-total--grand'>
                        <span>Total</span>
                        <span>{formatMinor(size.priceMinor + shipping)}</span>
                    </div>
                </div>

                {problem && <div className='tf-note tf-note--error'>{problem}</div>}

                <button className='tf-btn tf-btn--primary tf-btn--block' type='submit' disabled={submitting}>
                    {submitting ? 'Opening checkout…' : `Make it real — ${formatMinor(size.priceMinor + shipping)}`}
                </button>
                <p className='tf-muted' style={{ textAlign: 'center' }}>
                    Printed to order and posted to you.{' '}
                    <Link href='/' style={{ color: 'inherit' }}>
                        How it works
                    </Link>
                </p>
            </form>
        </div>
    )
}
