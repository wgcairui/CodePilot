import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', 'discord.js', '@discordjs/ws', 'zlib-sync'],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  experimental: {
    // Limit static page generation workers to prevent OOM during `next build`
    // Default is number of CPU cores (7+), which exhausts memory on constrained machines
    cpus: 4,
  },
};

export default nextConfig;
