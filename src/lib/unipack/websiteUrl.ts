/**
 * The info value stays as written; only the link opened by the player is normalized.
 * The parsed absolute form is returned because a browser resolves `https:host` against the current page.
 */
export function websiteUrl(value: string | null): string | null {
  const text = value?.trim();
  if (!text) return null;
  // `host:port` without a scheme only when the host looks like one, so `tel:911` stays a scheme.
  const hostWithPort = /^(?:localhost|[^/?#:.]*\.[^/?#:]*):\d+(?:[/?#]|$)/i.test(text);
  const scheme = hostWithPort ? undefined : /^([a-z][a-z\d+.-]*):/i.exec(text)?.[1];
  if (scheme && !/^https?$/i.test(scheme)) return null;
  const absolute = scheme ? text : `https://${text.replace(/^\/\//, '')}`;
  try {
    const url = new URL(absolute);
    if (!url.hostname || !['http:', 'https:'].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}
