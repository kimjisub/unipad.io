import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

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

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url || !isValidHttpUrl(url)) {
    return new Response('Invalid url', { status: 400 });
  }
  if (!isAllowedHost(url)) {
    return new Response('Host not allowed', { status: 403 });
  }

  try {
    const upstream = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(`Upstream download failed: HTTP ${upstream.status}`, {
        status: 502,
      });
    }

    const headers = new Headers();
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    const contentDisposition = upstream.headers.get('content-disposition') ?? 'attachment; filename="pack.zip"';
    headers.set('content-type', contentType);
    headers.set('content-disposition', contentDisposition);
    if (contentLength) {
      headers.set('content-length', contentLength);
    }
    headers.set('cache-control', 'no-store');

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Download proxy error: ${message}`, { status: 502 });
  }
}
