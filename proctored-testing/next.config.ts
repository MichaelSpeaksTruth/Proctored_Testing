import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is the default bundler in Next.js 16
  turbopack: {},

  // firebase-admin uses Node.js built-ins (fs, net, tls) that must not be
  // bundled by the client-side webpack. Declaring it here keeps it server-only.
  serverExternalPackages: ['firebase-admin'],

  async headers() {
    return [
      {
        // Apply cache headers to the edge-cached question delivery route.
        // Vercel reads these headers and stores the response at the edge.
        source: '/api/get-test-questions',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=3600, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
