/**
 * Where store files may be fetched from. Shared multi-tenant hosts (Google Cloud
 * Storage, Firebase Storage) are only allowed under this project's bucket path,
 * otherwise this route would serve anyone's bucket from the unipad.io origin.
 * `host` is exact unless it starts with "*.", `path` is a required prefix.
 */
export type AllowRule = { host: string; path?: string };

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

/** Extra hosts from the environment (comma separated, host only, "*." prefix allowed). */
export function envAllowRules(value: string | undefined): AllowRule[] {
  return (value ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
    .map((host) => ({ host }));
}

const ALLOWED: AllowRule[] = [...DEFAULT_ALLOWED, ...envAllowRules(process.env.STORE_DOWNLOAD_ALLOWED_HOSTS)];

// This route's own origins. Fetching them would let the proxy call itself.
const SELF_HOSTS = new Set(['unipad.io', 'www.unipad.io']);

function hostMatches(host: string, rule: string): boolean {
  const h = host.toLowerCase();
  const r = rule.toLowerCase();
  if (r.startsWith('*.')) return h.endsWith(r.slice(1)); // keeps the dot: "*.a.io" never matches "evila.io"
  return h === r;
}

export function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function isAllowed(url: URL, rules: AllowRule[] = ALLOWED): boolean {
  const host = url.hostname.toLowerCase();
  if (SELF_HOSTS.has(host)) return false;
  if (url.pathname.startsWith('/api/')) return false; // never re-enter an API route anywhere
  return rules.some(
    (rule) => hostMatches(host, rule.host) && (!rule.path || url.pathname.startsWith(rule.path)),
  );
}

/** Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name; header-safe. */
export function contentDisposition(url: URL): string {
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
