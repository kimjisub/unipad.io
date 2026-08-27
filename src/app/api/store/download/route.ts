import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
// Store items are large (some UniPacks are ~45 MB), and the body is streamed
// through this function, so the default limit is not enough.
export const maxDuration = 300;

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const DEFAULT_ALLOWED_HOSTS = [
  'us-central1-unipad-e41ab.cloudfunctions.net',
  'api.unipad.io',
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
  'firebasestorage.app',
  'unipad-e41ab.appspot.com',
  'unipad-e41ab.web.app',
  'unipad.io',
  'www.unipad.io',
  '*.unipad.io',
];

const ENV_ALLOWED_HOSTS = (process.env.STORE_DOWNLOAD_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const ALLOWED_HOSTS = new Set([
  ...DEFAULT_ALLOWED_HOSTS,
  ...ENV_ALLOWED_HOSTS,
]);

function hostMatchesRule(host: string, rule: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedRule = rule.toLowerCase();
  if (normalizedRule.startsWith('*.')) {
    const suffix = normalizedRule.slice(1); // ".example.com"
    return normalizedHost.endsWith(suffix);
  }
  if (normalizedRule.startsWith('.')) {
    return normalizedHost.endsWith(normalizedRule);
  }
  return normalizedHost === normalizedRule;
}

function isAllowedHost(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    for (const rule of ALLOWED_HOSTS) {
      if (hostMatchesRule(host, rule)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function filenameFor(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').pop();
    if (last && /\.zip$/i.test(last)) return decodeURIComponent(last);
  } catch {
    /* fall through */
  }
  return 'unipack.zip';
}

/**
 * Streams the upstream file back through this origin.
 *
 * This used to `Response.redirect(url)`, which broke the browser download:
 * the client fetches this route from https://unipad.io, the 302 sends it to
 * another origin (e.g. unipack.unipad.io), and CORS is then evaluated against
 * that origin. The file host serves no Access-Control-Allow-Origin, so the
 * fetch failed with "No 'Access-Control-Allow-Origin' header is present".
 * Proxying keeps the whole exchange same-origin, so no CORS is involved.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url || !isValidHttpUrl(url)) {
    return new Response('Invalid url', { status: 400 });
  }
  if (!isAllowedHost(url)) {
    return new Response('Host not allowed', { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      // Forward Range so the client can resume; the file hosts advertise
      // accept-ranges: bytes.
      headers: (() => {
        const h = new Headers();
        const range = request.headers.get('range');
        if (range) h.set('range', range);
        return h;
      })(),
      cache: 'no-store',
      redirect: 'follow',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Upstream fetch failed: ${message}`, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream responded ${upstream.status}`, {
      status: upstream.status === 404 ? 404 : 502,
    });
  }

  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/zip');
  headers.set('content-disposition', `attachment; filename="${filenameFor(url)}"`);
  headers.set('cache-control', 'public, max-age=3600');

  return new Response(upstream.body, { status: upstream.status, headers });
}
