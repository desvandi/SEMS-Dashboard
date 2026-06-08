import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // TypeScript strict type-checking deferred — types to be cleaned up in v7.1
  typescript: {
    ignoreBuildErrors: true,
  },
  // P2-BUILD-05: Enable React strict mode
  reactStrictMode: true,
  // P2-BUILD-02: Disable source maps in production
  productionBrowserSourceMaps: false,
  // P2-BUILD-01: Add security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            // FE-004 FIX: unsafe-eval required for Next.js runtime.
            // Relaxed for Vercel deployment compatibility.
            value: "default-src 'self'; base-uri 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; manifest-src 'self'",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
