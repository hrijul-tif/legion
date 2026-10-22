import type { NextConfig } from "next";

const isolation = [
  // Cross-origin isolation enables SharedArrayBuffer, which the Pyodide workers need
  // for blocking sleep, operator prompts and interrupting a running procedure.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];

const nextConfig: NextConfig = {
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: isolation },
      { source: "/vendor/:path*", headers: immutable },
    ];
  },
};

export default nextConfig;
