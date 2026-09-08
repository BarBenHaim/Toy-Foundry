// src/types/assets.d.ts
//
// Stylesheets, as far as TypeScript is concerned.
//
// Next.js does not ship a `*.css` declaration, and TypeScript 6 rejects
// side-effect imports of modules it has no declaration for (TS2882).
// One line here means `import './globals.css'` from a .tsx keeps
// compiling across TypeScript versions.

declare module '*.css'
declare module '*.scss'
