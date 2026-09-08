/** @type {import('next').NextConfig} */
const nextConfig = {
    // The print pipeline reads and writes model files inside a request:
    // a GLB in, an STL and a 3MF out. The default body limit is fine for
    // the JSON routes, but the drawing upload is multipart and needs
    // room for a phone photo.
    experimental: {
        serverActions: { bodySizeLimit: '12mb' },
    },
}

export default nextConfig
