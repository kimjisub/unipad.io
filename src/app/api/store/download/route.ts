import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
// Store items are large (some UniPacks are ~45 MB), and the body is streamed
// through this function, so the default limit is not enough.
export const maxDuration = 300;

const UPSTREAM_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 3;
const MAX_CONTENT_LENGTH = 200 * 1024 * 1024; // no UniPack is anywhere near this

/**
 * Where store files may be fetched from. Shared multi-tenant hosts (Google Cloud
 * Storage, Firebase Storage) are only allowed under this project's bucket path,
 * otherwise this route would serve anyone's bucket from the unipad.io origin.
 * `host` is exact unless it starts with "*.", `path` is a required prefix.
 */
type AllowRule = { host: string; path?: string };

const DEFAULT_ALLOWED: AllowRule[] = [
  { host: 'us-central1-unipad-e41ab.cloudfunctions.net' },
  { host: 'api.unipad.io' },
  { host: 'unipack.unipad.io' },
  { host: 'storage.googleapis.com', path: '/unipad-e41ab.appspot.com/' },
  { host: 'firebasestorage.googleapis.com', path: '/v0/b/unipad-e41ab.appspot.com/' },
  { host: 'unipad-e41ab.firebasestorage.app' },
  { host: 'unipad-e41ab.appspot.com' },
  { host: 'unipad-e41ab.web.app' },
];

// Extra hosts from the environment (comma separated, host only, "*." prefix allowed).
const ENV_ALLOWED: AllowRule[] = (process.env.STORE_DOWNLOAD_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)
  .map((host) => ({ host }));

const ALLOWED: AllowRule[] = [...DEFAULT_ALLOWED, ...ENV_ALLOWED];

// This route's own origins. Fetching them would let the proxy call itself.
const SELF_HOSTS = new Set(['unipad.io', 'www.unipad.io']);

function hostMatches(host: string, rule: string): boolean {
  const h = host.toLowerCase();
  const r = rule.toLowerCase();
  if (r.startsWith('*.')) return h.endsWith(r.slice(1)); // keeps the dot: "*.a.io" never matches "evila.io"
  return h === r;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isAllowed(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (SELF_HOSTS.has(host)) return false;
  if (url.pathname.startsWith('/api/')) return false; // never re-enter an API route anywhere
  return ALLOWED.some(
    (rule) => hostMatches(host, rule.host) && (!rule.path || url.pathname.startsWith(rule.path)),
  );
}

/** Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name; header-safe. */
function contentDisposition(url: URL): string {
  let name = 'unipack.zip';
  const last = url.pathname.split('/').pop();
  if (last && /\.zip$/i.test(last)) {
    try {
      name = decodeURIComponent(last);
    } catch {
      name = last;
    }
  }
  const clean = name.replace(/[\r\n"\\]/g, '_').slice(0, 200);
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
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
 *
 * Redirects are followed by hand so every hop is checked against the allow
 * list; a redirect to an internal address would otherwise be fetched and its
 * body returned to the caller.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url');
  const first = raw ? parseHttpUrl(raw) : null;
  if (!first) return new Response('Invalid url', { status: 400 });
  if (!isAllowed(first)) return new Response('Host not allowed', { status: 403 });

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);
  const headers = new Headers({ 'accept-encoding': 'identity' }); // keep content-length truthful
  const range = request.headers.get('range');
  if (range) headers.set('range', range); // the file hosts advertise accept-ranges: bytes

  let current = first;
  let upstream: Response;
  try {
    for (let hop = 0; ; hop++) {
      upstream = await fetch(current, { headers, cache: 'no-store', redirect: 'manual', signal });
      const location = upstream.headers.get('location');
      if (upstream.status < 300 || upstream.status >= 400 || !location) break;
      if (hop >= MAX_REDIRECTS) return new Response('Too many redirects', { status: 502 });
      const next = parseHttpUrl(new URL(location, current).toString());
      if (!next || !isAllowed(next)) return new Response('Redirect target not allowed', { status: 403 });
      current = next;
    }
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error('[store/download] upstream fetch failed', current.hostname, error);
    return new Response('Upstream fetch failed', { status: 502 }); // no upstream error text to the client
  }

  if (!upstream.ok || !upstream.body) {
    const passthrough = new Set([403, 404, 410, 416]);
    return new Response(`Upstream responded ${upstream.status}`, {
      status: passthrough.has(upstream.status) ? upstream.status : 502,
    });
  }

  const length = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_CONTENT_LENGTH) {
    return new Response('File too large', { status: 413 });
  }

  const out = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  if (!out.has('content-type')) out.set('content-type', 'application/zip');
  out.set('content-disposition', contentDisposition(current));
  out.set('x-content-type-options', 'nosniff');
  out.set('vary', 'range');
  // Only a complete body may be shared from a cache; a cached 206 would be served for full requests.
  out.set('cache-control', upstream.status === 200 ? 'public, max-age=3600' : 'no-store');

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
