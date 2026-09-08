import { describe, it, expect } from 'vitest'
import {
    centerOfMass,
    groupByOverlap,
    pointInsideGroup,
    estimateFilamentGrams,
    estimateMinThickness,
    heightIsSupported,
    inspect,
    mergeMeshes,
    overhangShare,
    prepareForPrint,
    stability,
} from '@/lib/printability'
import { boundsOf, shells, triangleCount, signedVolume } from '@/lib/mesh/geometry'
import { box, boxPlusSpeck, unweldedBox } from './fixtures'

const check = (report, id) => report.checks.find(c => c.id === id)

describe('prepareForPrint', () => {
    it('takes raw provider soup to a printable, correctly sized toy', () => {
        const { mesh, report } = prepareForPrint(unweldedBox(1, 1, 1), 100)

        expect(report.ok).toBe(true)
        expect(report.heightMm).toBeCloseTo(100, 1)
        expect(check(report, 'watertight').level).toBe('pass')
        expect(check(report, 'single_part').level).toBe('pass')
        expect(check(report, 'wall_thickness').level).toBe('pass')
        expect(report.repairs.join(' ')).toMatch(/welded/)
        expect(signedVolume(mesh)).toBeGreaterThan(0)
    })

    it('deletes floating fragments and reports the deletion', () => {
        const { mesh, report } = prepareForPrint(boxPlusSpeck(), 100, { sourceUp: 'z' })
        expect(shells(mesh)).toHaveLength(1)
        expect(report.repairs.join(' ')).toMatch(/floating fragment/)
        expect(check(report, 'single_part').level).toBe('pass')
    })

    it('fails a model with walls too thin to survive a child', () => {
        // A 100mm-tall plate only 1.25mm thick once scaled.
        const { report } = prepareForPrint(box(0.5, 40, 40), 100, { sourceUp: 'z' })
        const wall = check(report, 'wall_thickness')
        expect(wall.level).toBe('fail')
        expect(wall.value).toBeLessThan(2)
        expect(report.ok).toBe(false)
    })

    it('warns rather than fails on a narrow footing', () => {
        const { report } = prepareForPrint(box(6, 6, 40), 100, { sourceUp: 'z' })
        expect(check(report, 'stability').level).toBe('warn')
        expect(report.ok).toBe(true)
    })

    it('always ends up standing on the plate at the ordered size', () => {
        for (const height of [80, 100, 120]) {
            const { mesh } = prepareForPrint(box(3, 4, 5, [12, -8, 40]), height)
            const b = boundsOf(mesh)
            expect(b.min[2]).toBeCloseTo(0, 6)
            expect(b.size[2]).toBeCloseTo(height, 6)
        }
    })
})

describe('individual checks', () => {
    it('reports an empty model as a failure rather than a perfect one', () => {
        const report = inspect({ positions: new Float64Array(0), indices: new Uint32Array(0) }, 100, 0)
        expect(report.ok).toBe(false)
        expect(report.checks[0].id).toBe('empty')
    })

    it('measures thickness of a known slab', () => {
        const slab = box(3, 60, 60)
        const { minMm } = estimateMinThickness(slab)
        expect(minMm).toBeCloseTo(3, 1)
    })

    it('does not report the ray cap as a real measurement being thin', () => {
        const chunky = box(50, 50, 50)
        const { minMm, thinShare } = estimateMinThickness(chunky)
        expect(minMm).toBeGreaterThanOrEqual(2)
        expect(thinShare).toBe(0)
    })

    it('puts the centre of mass of a box in its middle', () => {
        const com = centerOfMass(box(10, 10, 10))
        expect(com[0]).toBeCloseTo(5, 6)
        expect(com[2]).toBeCloseTo(5, 6)
    })

    it('catches a toy whose weight hangs outside its feet', () => {
        const leaning = mergeMeshes([box(4, 4, 1), box(4, 4, 40, [30, 0, 10])])
        expect(stability(leaning).centerOverBase).toBe(false)
        expect(stability(box(20, 20, 40)).centerOverBase).toBe(true)
    })

    it('counts steep downward surfaces but not the base itself', () => {
        expect(overhangShare(box(20, 20, 20))).toBeCloseTo(0, 6)
        const mushroom = mergeMeshes([box(2, 2, 10), box(20, 20, 2, [-9, -9, 10])])
        expect(overhangShare(mushroom)).toBeGreaterThan(0.25)
    })

    it('estimates filament from volume, not from solid material', () => {
        // 50cm³ of model is nowhere near 50cm³ of plastic — it prints as
        // walls plus infill.
        const grams = estimateFilamentGrams(50)
        expect(grams).toBeGreaterThan(15)
        expect(grams).toBeLessThan(30)
    })

    it('knows which heights this product supports', () => {
        expect(heightIsSupported(100)).toBe(true)
        expect(heightIsSupported(40)).toBe(false)
        expect(heightIsSupported(300)).toBe(false)
    })

    it('treats overlapping solids as one printable part', () => {
        // A slicer unions overlapping bodies, so an eye sunk into a head
        // is one part. Vertex connectivity alone says two.
        const overlapping = [box(10, 10, 10), box(4, 4, 4, [8, 3, 3])]
        expect(groupByOverlap(overlapping)).toHaveLength(1)
        const apart = [box(10, 10, 10), box(4, 4, 4, [40, 0, 0])]
        expect(groupByOverlap(apart)).toHaveLength(2)
    })

    it('knows a point inside two overlapping solids is inside material', () => {
        // The odd/even rule gets this wrong: the point crosses two
        // surfaces on the way out, counts two, and calls itself outside.
        const twoBoxes = mergeMeshes([box(10, 10, 10), box(10, 10, 10, [5, 0, 0])])
        const allTriangles = Array.from({ length: 24 }, (_, i) => i)
        expect(pointInsideGroup(twoBoxes, allTriangles, [7, 5, 5])).toBe(true) // in the overlap
        expect(pointInsideGroup(twoBoxes, allTriangles, [2, 5, 5])).toBe(true) // in one only
        expect(pointInsideGroup(twoBoxes, allTriangles, [-3, 5, 5])).toBe(false)
    })

    it('keeps triangle counts honest through a merge', () => {
        expect(triangleCount(mergeMeshes([box(), box(1, 1, 1, [10, 0, 0])]))).toBe(24)
    })
})

describe('the stand-in sculpt', () => {
    it('builds a toy that passes the same print checks as a real sculpt', async () => {
        const { buildStandInToy } = await import('@/lib/mesh/standIn')
        const { normalizeDna } = await import('@/lib/characterDna')
        const dna = normalizeDna({
            name: 'Bloopy',
            summary: 'a three-eyed purple cat with one horn and small wings',
            bodyPlan: 'biped',
            features: [
                { kind: 'eyes', description: 'three eyes in a row', importance: 5 },
                { kind: 'horn', description: 'one curved horn', importance: 5 },
                { kind: 'wings', description: 'two small wings', importance: 4 },
                { kind: 'tail', description: 'a stubby tail', importance: 3 },
            ],
            palette: ['#8a5cff'],
            proportions: { headToBody: 1.5, limbLength: 'short', stance: 'wide' },
            confidence: 0.9,
        })

        const { mesh, report } = prepareForPrint(buildStandInToy(dna), 100, { sourceUp: 'z' })

        expect(report.heightMm).toBeCloseTo(100, 1)
        // Overlapping solids fuse in the slicer, so a head with eyes
        // sunk into it is one part, not four.
        expect(check(report, 'single_part').level).toBe('pass')
        expect(check(report, 'watertight').level).toBe('pass')
        expect(check(report, 'wall_thickness').level).toBe('pass')
        expect(check(report, 'stability').level).toBe('pass')
        expect(report.ok).toBe(true)
        expect(triangleCount(mesh)).toBeGreaterThan(500)
    })

    it('is deterministic — the same drawing always yields the same toy', async () => {
        const { buildStandInToy, countIn } = await import('@/lib/mesh/standIn')
        const { normalizeDna } = await import('@/lib/characterDna')
        const dna = normalizeDna({ name: 'Zog', summary: 'a blob', features: [{ kind: 'blorp', description: 'a thing', importance: 4 }] })
        const a = buildStandInToy(dna)
        const b = buildStandInToy(dna)
        expect(Array.from(a.positions.slice(-9))).toEqual(Array.from(b.positions.slice(-9)))
        expect(countIn('three eyes')).toBe(3)
        expect(countIn('2 horns')).toBe(2)
        expect(countIn('some eyes')).toBe(0)
    })

    it('stands up whatever body plan the child drew', async () => {
        const { buildStandInToy } = await import('@/lib/mesh/standIn')
        const { normalizeDna } = await import('@/lib/characterDna')
        for (const bodyPlan of ['biped', 'quadruped', 'blob', 'winged', 'other']) {
            const dna = normalizeDna({
                name: bodyPlan,
                bodyPlan,
                features: [{ kind: 'eyes', description: 'two eyes', importance: 5 }],
                proportions: { headToBody: 1.2, limbLength: 'medium', stance: 'wide' },
            })
            const { report } = prepareForPrint(buildStandInToy(dna), 100, { sourceUp: 'z' })
            expect(check(report, 'stability').level, bodyPlan).not.toBe('fail')
            expect(check(report, 'single_part').level, bodyPlan).toBe('pass')
            expect(report.ok, `${bodyPlan}: ${JSON.stringify(report.checks.filter(c => c.level === 'fail'))}`).toBe(true)
        }
    })
})
