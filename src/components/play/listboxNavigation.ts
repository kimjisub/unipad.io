/**
 * Index of the option a navigation key moves to in a list of `count` options, or null when the
 * key does not navigate. Up and down wrap around the ends; `current` is -1 when no option is active.
 */
export function listboxTargetIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * A key an input method spends on composing text, such as the Enter that finishes a Hangul
 * syllable. Chrome and Firefox flag it; Safari sends that Enter after the composition ends,
 * marked only by the legacy key code 229.
 */
export function isComposingKey(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
  return event.isComposing || event.keyCode === 229;
}

const OWN_KEY_CONTROLS = 'button, a[href], select, summary, [role="button"], [role="link"]';

/**
 * Whether the key's target handles keys such as Enter itself, as a button reached with Tab does,
 * so a list's page-wide keys for its selected option leave it alone. Buttons left out of the Tab
 * order only hold focus after a mouse press, so keys there stay with the selected option.
 */
export function targetHandlesOwnKeys(event: KeyboardEvent): boolean {
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest<HTMLElement>(OWN_KEY_CONTROLS);
  return control !== null && control.tabIndex >= 0;
}
