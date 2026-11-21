import { NextRequest } from 'next/server';

import { isAllowed, parseHttpUrl } from './policy';

export const runtime = 'nodejs';

/**
 * Kept only for clients that still ask this route (pages and caches from before the store
 * downloaded packs directly). The file host now serves CORS headers, so the browser can fetch
 * a pack from it cross-origin; this route checks the address and sends the browser there with a
 * 302. It never fetches the file itself, so no pack bytes pass through the site's functions,
 * whose monthly data allowance a streamed ~45 MB pack used up.
 *
 * The checks stay so the route cannot be used as an open redirect: only allowed hosts and paths,
 * never this site's own hosts, never an `/api/` path.
 */
export function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url');
  const target = raw ? parseHttpUrl(raw) : null;
  if (!target) return new Response('Invalid url', { status: 400 });
  if (!isAllowed(target)) return new Response('Host not allowed', { status: 403 });

  return new Response(null, {
    status: 302,
    headers: { location: target.href, 'cache-control': 'public, max-age=3600' },
  });
}
