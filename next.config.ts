import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Exclui pastas geradas do file-watcher para evitar loop de rebuild
  watchOptions: {
    ignored: ["**/.next/**", "**/node_modules/**", "**/.claude/**"],
  },
};

export default nextConfig;
