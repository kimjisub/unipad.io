import { readFileSync } from 'node:fs';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const storeFiles = JSON.parse(readFileSync(new URL('./src/lib/storeFiles.json', import.meta.url), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    localPatterns: [
      {
        pathname: '/**',
      },
    ],
  },
  compress: true,
  poweredByHeader: false,
  // Store packs are served from the file host through the CDN, so their bodies never pass
  // through a site function (function traffic has a small monthly allowance; packs are up to ~45 MB).
  async rewrites() {
    return [
      {
        source: `${storeFiles.sitePath}:file(${storeFiles.fileName})`,
        destination: `${storeFiles.origin}${storeFiles.originPath}:file`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
