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
