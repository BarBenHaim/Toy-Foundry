// The printability report, written for a parent rather than for a
// slicer. Failures first — if something is wrong, that is the only line
// worth reading — then the measurements, which are the quiet proof that
// somebody actually checked.

import type { PrintabilityReport } from '@/lib/types'

const MARK = { pass: '✓', warn: '!', fail: '×' } as const

export function PrintChecks({ report }: { report: PrintabilityReport }) {
    const ordered = [...report.checks].sort((a, b) => rank(a.level) - rank(b.level))
    return (
        <div className='tf-card'>
            <div className='tf-spread' style={{ marginBottom: 14 }}>
                <h3>Print check</h3>
                <span className={`tf-badge ${report.ok ? 'tf-badge--live' : 'tf-badge--demo'}`}>
                    {report.ok ? 'Ready to print' : 'Needs a fix'}
                </span>
            </div>
            <div className='tf-checks'>
                {ordered.map(check => (
                    <div className={`tf-check tf-check--${check.level}`} key={check.id}>
                        <span className='tf-check-dot'>{MARK[check.level]}</span>
                        <span>{check.message}</span>
                    </div>
                ))}
            </div>
            <div className='tf-specs'>
                <span>
                    <b>
                        {Math.round(report.widthMm)} × {Math.round(report.depthMm)} × {Math.round(report.heightMm)} mm
                    </b>
                    size
                </span>
                <span>
                    <b>{report.volumeCm3} cm³</b>
                    material
                </span>
                <span>
                    <b>{report.triangleCount.toLocaleString('en-US')}</b>
                    triangles
                </span>
            </div>
        </div>
    )
}

function rank(level: 'pass' | 'warn' | 'fail'): number {
    return level === 'fail' ? 0 : level === 'warn' ? 1 : 2
}
