import storeFiles from './storeFiles.json';

const STORE_FILE_NAME = new RegExp(`^${storeFiles.fileName}$`);

/**
 * The same-origin path the CDN forwards to the store file host (see `rewrites` in next.config.mjs),
 * or null when the URL is not a plain pack file on that host. That path keeps the pack body out of
 * the site's functions; anything else still goes through the download route.
 */
export function storeFileSitePath(upstream: string): string | null {
  let url: URL;
  try {
    url = new URL(upstream);
  } catch {
    return null;
  }
  if (url.origin !== storeFiles.origin || url.search || url.hash) return null;
  if (!url.pathname.startsWith(storeFiles.originPath)) return null;
  const name = url.pathname.slice(storeFiles.originPath.length);
  return STORE_FILE_NAME.test(name) ? `${storeFiles.sitePath}${name}` : null;
}
