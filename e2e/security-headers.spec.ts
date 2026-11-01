import { test, expect } from '@playwright/test';

for (const path of ['/', '/ko/play', '/api/store/download', '/fonts/inter-latin-c9407645.woff2']) {
  test(`security headers are sent for ${path}`, async ({ request }) => {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    if (path.startsWith('/fonts/')) {
      expect(headers['cache-control']).toBe('public, max-age=31536000, immutable');
    }
  });
}
