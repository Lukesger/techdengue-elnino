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
  // Cache runtime El Niño fora do watcher (evita Fast Refresh full reload).
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.next/**',
        '**/.cache/**',
        '**/src/utils/el-nino/data/visao_gerencial/**',
        '**/src/utils/el-nino/data/painel_nao_mapeados/**',
        '**/src/utils/el-nino/data/infodengue_mensal/**',
        '**/src/utils/el-nino/data/clima_nao_mapeados/**',
      ],
    };
    return config;
  },
};

module.exports = nextConfig;
