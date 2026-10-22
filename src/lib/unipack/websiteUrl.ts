/** The info value stays as written; only the link opened by the player is normalized. */
export function websiteUrl(value: string | null): string | null {
  const text = value?.trim();
  if (!text) return null;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(text)?.[1];
  if (scheme && !/^https?$/i.test(scheme)) return null;
  const absolute = scheme ? text : `https://${text.replace(/^\/\//, '')}`;
  try {
    const url = new URL(absolute);
    if (!url.hostname || !['http:', 'https:'].includes(url.protocol)) return null;
    return absolute;
  } catch {
    return null;
  }
}
