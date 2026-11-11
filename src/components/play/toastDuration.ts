const MIN_MS = 2000;
const MAX_MS = 6000;
const BASE_MS = 500;
const MS_PER_UNIT = 60;

/** Hangul, kana and CJK ideographs carry about a word's worth of meaning in one character. */
const DENSE_CHARACTER = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯]/u;

/**
 * How long a bottom notice stays on screen. Short notices keep the original 2 s; longer ones
 * get roughly the time needed to read them at about 16 Latin characters per second, so a
 * two-sentence notice is not gone before its second sentence is read.
 */
export function toastDurationMs(message: string): number {
  let units = 0;
  for (const character of message.trim()) {
    units += DENSE_CHARACTER.test(character) ? 2 : 1;
  }
  return Math.min(MAX_MS, Math.max(MIN_MS, BASE_MS + units * MS_PER_UNIT));
}
