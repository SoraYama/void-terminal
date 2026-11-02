import type { NextConfig } from "next";
import path from "node:path";
import runtimePackage from "../../package.json";
const config: NextConfig = {
  output: "standalone",
  // DSH/Cordis load ESM provider plugins dynamically; keep their native module boundaries.
  serverExternalPackages: [
    "@deepseek-ai/cordis",
    ...Object.keys(runtimePackage.dependencies).filter((name) =>
      name.startsWith("@deepseek-ai/dsh-"),
    ),
  ],
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
