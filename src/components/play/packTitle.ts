/** Title shown for a pack in the play menu. Matches the Android app, which shows a fixed,
 *  untranslated "Untitled" when the pack's info file has no title. */
export function playMenuTitle(title: string): string {
  return title === '' ? 'Untitled' : title;
}
