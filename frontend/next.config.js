const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  // Monorepo demo: páginas El Niño ainda referenciam stubs do TechDengue completo.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Evita Next inferir workspace root errado (lockfile em pasta acima).
  outputFileTracingRoot: path.join(__dirname),
};

module.exports = nextConfig;
