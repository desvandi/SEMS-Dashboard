import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  // Fix #13: Enable TypeScript errors at build time instead of ignoring them
  typescript: {
    ignoreBuildErrors: false,
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
            value: "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'; manifest-src 'self'",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
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
