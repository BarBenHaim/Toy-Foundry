'use client'

// The moment the toy stops being a picture.
//
// react-three-fiber over a decimated STL served by our own API. Kept
// deliberately plain: one soft key light, one fill, a contact shadow and
// slow auto-rotation. A parent is judging whether this is their child's
// character, and a scene with a studio HDRI and bloom is a scene that
// judges itself.
//
// Everything three.js is imported inside this file, and the file is only
// ever loaded through next/dynamic with ssr:false — three has no server
// story and pulling it into the studio bundle would cost every parent
// who never gets this far.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

export interface ModelViewerProps {
    /** Our own preview route, not a storage URL. */
    url: string
    /** The toy's dominant colour, so the model reads as the thing that
     *  was approved rather than as engineering grey. */
    color?: string
    heightMm?: number
}

export default function ModelViewer({ url, color = '#6c4cf1', heightMm = 100 }: ModelViewerProps) {
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setGeometry(null)
        setError(null)
        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`preview ${res.status}`)
                return res.arrayBuffer()
            })
            .then(buffer => {
                if (cancelled) return
                const geo = new STLLoader().parse(buffer)
                // The STL is Z-up millimetres sitting on the plate; three
                // is Y-up and happier around the origin. Rotate, then
                // centre on X/Z and drop the feet to y=0.
                geo.rotateX(-Math.PI / 2)
                geo.computeBoundingBox()
                const box = geo.boundingBox as THREE.Box3
                geo.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
                geo.computeVertexNormals()
                setGeometry(geo)
            })
            .catch(err => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'failed')
            })
        return () => {
            cancelled = true
        }
    }, [url])

    // Frame the camera on the toy's own height so an 8cm and a 12cm toy
    // fill the viewport the same way.
    const distance = useMemo(() => heightMm * 1.9, [heightMm])

    if (error) {
        return (
            <div className='tf-viewer' style={{ display: 'grid', placeItems: 'center' }}>
                <p className='tf-muted'>The 3D preview did not load. Your toy is fine — try refreshing.</p>
            </div>
        )
    }

    return (
        <div className='tf-viewer'>
            <Canvas
                camera={{ position: [distance * 0.55, heightMm * 0.75, distance], fov: 32, near: 1, far: distance * 8 }}
                dpr={[1, 2]}
                gl={{ antialias: true }}
            >
                <color attach='background' args={['#f4f1ff']} />
                <ambientLight intensity={0.75} />
                <directionalLight position={[120, 200, 140]} intensity={1.5} castShadow={false} />
                <directionalLight position={[-160, 80, -120]} intensity={0.5} color='#c9b8ff' />
                <Suspense fallback={null}>{geometry && <Toy geometry={geometry} color={color} />}</Suspense>
                <Plate radius={heightMm * 0.62} />
                <OrbitControls
                    enablePan={false}
                    minDistance={heightMm * 0.9}
                    maxDistance={distance * 2.4}
                    target={[0, heightMm * 0.45, 0]}
                    // Stop the camera going under the floor: from below,
                    // every model looks broken.
                    maxPolarAngle={Math.PI * 0.52}
                />
            </Canvas>
            <span className='tf-viewer-hint'>Drag to turn it around</span>
        </div>
    )
}

function Toy({ geometry, color }: { geometry: THREE.BufferGeometry; color: string }) {
    const ref = useRef<THREE.Mesh>(null)
    useFrame((_, delta) => {
        // Slow enough to read as "presented", not as "spinning".
        if (ref.current) ref.current.rotation.y += delta * 0.28
    })
    return (
        <mesh ref={ref} geometry={geometry}>
            <meshStandardMaterial color={color} roughness={0.55} metalness={0.04} />
        </mesh>
    )
}

/** A soft disc under the toy. Without a ground plane the model floats in
 *  space and its size stops being readable. */
function Plate({ radius }: { radius: number }) {
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]}>
            <circleGeometry args={[radius, 64]} />
            <meshStandardMaterial color='#e4dcff' roughness={1} />
        </mesh>
    )
}
