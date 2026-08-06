import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is the default bundler in Next.js 16
  // turbopack: {},

  // firebase-admin → jwks-rsa → jose (pure ESM). Turbopack must NOT bundle
  // these packages; they must be loaded from node_modules at runtime.
  // Without this, Vercel's CommonJS wrapper calls require() on an ESM-only
  // module and the lambda crashes with ERR_REQUIRE_ESM.
  serverExternalPackages: ['firebase-admin', 'jwks-rsa', 'jose'],

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
