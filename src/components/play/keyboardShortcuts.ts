type ShortcutKey = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>;

/**
 * `/` or Cmd/Ctrl+K, which move focus to a search field. Browsers' autofill sends `keydown`
 * events without a `key`; those are never a shortcut.
 */
export function isSearchShortcut(event: ShortcutKey): boolean {
  const key = typeof event.key === 'string' ? event.key : '';
  return key === '/' || (key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey));
}

/** Whether the key was typed into a text field, which keeps typed characters for itself. */
export function isTextEntryTarget(event: Pick<KeyboardEvent, 'target'>): boolean {
  const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea';
}
