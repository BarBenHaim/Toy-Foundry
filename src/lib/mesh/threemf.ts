// src/lib/mesh/threemf.ts
//
// 3MF is a ZIP with three XML files in it. We emit it alongside the STL
// because it carries two things STL cannot, and both of them cost money
// when they are missing:
//
//   • Units. A 3MF says "millimetre" in the file. An STL says nothing,
//     and a shop that guesses inches ships a toy 25x too big.
//   • Colour. The toy is designed around the child's palette; a 3MF can
//     name a base material colour so a multi-material shop, or the
//     preview in the shop's own portal, shows it the way the parent
//     approved it. Single-extruder FDM still prints it in one colour —
//     the field is a hint, not a promise, and the UI says so.
//
// Written by hand against the Core Specification rather than with a
// library, because the whole document is ~30 lines of XML and every 3MF
// library in npm is a browser bundle with a mesh editor attached.

import JSZip from 'jszip'
import { Mesh, triangleCount } from './geometry'

export interface ThreeMfOptions {
    /** '#RRGGBB'. Written as a base material so viewers show the toy in
     *  something other than grey. */
    color?: string
    title?: string
}

export async function writeThreeMf(mesh: Mesh, options: ThreeMfOptions = {}): Promise<Uint8Array> {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', CONTENT_TYPES)
    zip.file('_rels/.rels', RELS)
    zip.file('3D/3dmodel.model', modelXml(mesh, options))
    // STORE for the tiny relationship files and DEFLATE for the model is
    // what the spec's producers do; JSZip's default deflate is fine for
    // all three and every consumer accepts it.
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

function modelXml(mesh: Mesh, options: ThreeMfOptions): string {
    const vertices: string[] = []
    for (let i = 0; i < mesh.positions.length; i += 3) {
        vertices.push(
            `      <vertex x="${fmt(mesh.positions[i])}" y="${fmt(mesh.positions[i + 1])}" z="${fmt(
                mesh.positions[i + 2],
            )}" />`,
        )
    }
    const triangles: string[] = []
    for (let t = 0; t < triangleCount(mesh) * 3; t += 3) {
        triangles.push(
            `      <triangle v1="${mesh.indices[t]}" v2="${mesh.indices[t + 1]}" v3="${mesh.indices[t + 2]}" />`,
        )
    }
    const color = normalizeHex(options.color)
    const materials = color
        ? `  <resources>\n    <basematerials id="1">\n      <base name="ToyFoundry" displaycolor="${color}FF" />\n    </basematerials>`
        : '  <resources>'
    const objectAttrs = color ? ' pid="1" pindex="0"' : ''

    return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">ToyFoundry</metadata>
  <metadata name="Title">${escapeXml(options.title || 'ToyFoundry toy')}</metadata>
${materials}
    <object id="2" type="model"${objectAttrs}>
      <mesh>
        <vertices>
${vertices.join('\n')}
        </vertices>
        <triangles>
${triangles.join('\n')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2" />
  </build>
</model>
`
}

/** Six significant digits. Micron precision on a 100mm toy, and it keeps
 *  the XML from tripling in size over float noise. */
function fmt(n: number): string {
    return Number(n.toFixed(4)).toString()
}

function normalizeHex(color?: string): string | null {
    if (!color) return null
    const hex = color.trim().replace(/^#/, '')
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        return `#${hex
            .toUpperCase()
            .split('')
            .map(c => c + c)
            .join('')}`
    }
    return null
}

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>
`
