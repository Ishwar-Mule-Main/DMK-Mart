import type { NextConfig } from "next";

// `output: "standalone"` powers the self-hosted path (Hostinger/VPS:
// `.next/standalone/server.js` — see the `build`/`start` npm scripts).
// On Vercel the platform provides its own optimized server, so the
// standalone bundle is skipped when the VERCEL env var is present.
const nextConfig: NextConfig = {
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
