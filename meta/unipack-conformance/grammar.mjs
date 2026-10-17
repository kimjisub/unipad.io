// The UniPack grammar (GRAMMAR.md) as data: its edition, its items and their kind, and the items a
// platform's harness cannot see at all, whatever the cases.
import { readFileSync } from 'node:fs';

const ITEM_ROW = /^\| ([A-Z]{1,2}-\d{2}) \| (.+?) \| (parse|output) \| (doc|apps agree|G1 decision) \| .* \|$/;

/** `{ edition, items: [{ id, rule, kind, basis }] }` in the order GRAMMAR.md lists them. */
export function readGrammar(text = readFileSync(new URL('./GRAMMAR.md', import.meta.url), 'utf8')) {
  const edition = /^# UniPack grammar, edition (G\d+)$/m.exec(text)?.[1];
  if (!edition) throw new Error('GRAMMAR.md does not start with "# UniPack grammar, edition G<n>"');
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const row = ITEM_ROW.exec(line);
    if (row) items.push({ id: row[1], rule: row[2], kind: row[3], basis: row[4] });
  }
  const ids = items.map((i) => i.id);
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (twice.length) throw new Error(`GRAMMAR.md lists ${twice.join(', ')} more than once`);
  return { edition, items };
}

const NOT_DECODED = 'the harness puts a recorder in place of the audio engine, which decodes no sound: a sound event says the runner asked for the file';
const NO_ARCHIVE = 'a case is a pack as files at its root; importing an archive (folders around the pack, files beside it, the encoding of its names) is for each platform\'s import tests';
const CASE_BLIND = {
  reason: 'the pack is written to the disk of the machine that runs the test; where the file system does not tell `INFO` from `info`, a parser that opens only the exact name passes as well',
  // Counted when the result file says the pack was written where letter case tells files apart.
  unless: 'caseSensitiveFileSystem',
};

/**
 * Per platform, the items its harness cannot observe, with the reason. An item listed here is never
 * confirmed on that platform, unless the result file sets the flag named by `unless` to true.
 */
export const HARNESS_LIMITS = {
  android: {
    'F-01': CASE_BLIND,
    'F-05': { reason: NO_ARCHIVE },
    'F-06': { reason: NO_ARCHIVE },
    ...Object.fromEntries(['A-01', 'A-02', 'A-03', 'A-04', 'A-05'].map((id) => [id, { reason: NOT_DECODED }])),
  },
  ios: {
    'F-01': CASE_BLIND,
    'F-05': { reason: NO_ARCHIVE },
    'F-06': { reason: NO_ARCHIVE },
  },
  web: {
    'F-05': { reason: NO_ARCHIVE },
    'F-06': { reason: NO_ARCHIVE },
    ...Object.fromEntries(['A-01', 'A-02', 'A-03', 'A-04', 'A-05'].map((id) => [id, { reason: NOT_DECODED }])),
  },
};
