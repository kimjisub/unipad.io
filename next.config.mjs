import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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
  // Pages opened while the store fetched packs from /store-files/ (a CDN rewrite) are sent to the
  // file host instead. It serves CORS headers, so the browser follows this redirect and the pack
  // never passes through the site, whose data allowance a proxied ~45 MB pack used up.
  async redirects() {
    return [
      {
        source: '/store-files/:file([A-Za-z0-9._-]+\\.zip)',
        destination: 'https://unipack.unipad.io/store/:file',
        permanent: false,
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
