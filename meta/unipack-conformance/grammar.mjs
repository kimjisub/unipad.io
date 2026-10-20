// The UniPack grammar (GRAMMAR.md) as data: its edition, its items and their kind, the items a
// platform's harness cannot see at all, whatever the cases, and the app tests that confirm an item instead.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const GRAMMAR_FILE = new URL('./GRAMMAR.md', import.meta.url);

const ITEM_ROW = /^\| ([A-Z]{1,2}-\d{2}) \| (.+?) \| (parse|output) \| (doc|apps agree|G[1-3] decision) \| .* \|$/;

/** `{ edition, items: [{ id, rule, kind, basis }] }` in the order GRAMMAR.md lists them. */
export function readGrammar(text = readFileSync(GRAMMAR_FILE, 'utf8')) {
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

/**
 * The grammar a result file states it was checked against: the edition GRAMMAR.md names and the SHA-256
 * of the file itself, which anyone can recompute from the public repository.
 */
export function grammarRecord(bytes = readFileSync(GRAMMAR_FILE)) {
  const buffer = Buffer.from(bytes);
  return { version: readGrammar(buffer.toString('utf8')).edition, revision: createHash('sha256').update(buffer).digest('hex') };
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

const inAndroidApp = (...names) => names.map((name) => `com.kimjisub.launchpad.${name}`);

/**
 * Per platform and item, the app's own tests that must each have run once and passed, in that app's
 * result file, for the item to count where no case checks it or the harness cannot observe it (see
 * report.mjs). The list is reviewed and fixed here; it is never taken from what a result file names or
 * passed. An output item lists only tests that measure what is played. An item the app's tests cannot yet
 * confirm (Android A-01 to A-05, iOS A-03) is not listed.
 */
export const NATIVE_TESTS = {
  android: {
    'F-01': inAndroidApp('unipack.PackRootNamesDeviceTest#uppercaseRootNamesLoadOnCaseSensitiveStorage',
      'unipack.PackRootNamesDeviceTest#infoWithAnExtensionIsNotInfo',
      'unipack.PackRootNamesDeviceTest#pluralKeySoundsIsNotKeySound'),
    'F-05': inAndroidApp('manager.FileManagerTest#removeDoubleFolder_opensThePackFolderBesideAReadme',
      'manager.FileManagerTest#removeDoubleFolder_opensAPackWrappedTwiceBesideAReadme',
      'manager.FileManagerTest#removeDoubleFolder_opensThePackFolderBesideFilesAFolderWithoutInfoAndMacosx',
      'manager.FileManagerTest#removeDoubleFolder_keepsPackWrappedInTwoFoldersOfTheSameNameBesideMacosx',
      'manager.FileManagerTest#removeDoubleFolder_ignoresHiddenFilesWhenDetecting',
      'UniPackLegacyArchiveDeviceTest#aKoreanWindowsArchiveWithAReadmeBesideThePackImports'),
    'F-06': inAndroidApp('manager.PackArchiveTest#utf8NamesWithTheUtf8Flag_areReadAsUtf8',
      'manager.PackArchiveTest#utf8NamesWithoutTheUtf8Flag_areReadAsUtf8',
      'manager.PackArchiveTest#cp949NamesWithoutTheUtf8Flag_areReadAsCp949',
      'UniPackLegacyArchiveDeviceTest#theDeviceReadsCp949',
      'UniPackLegacyArchiveDeviceTest#aKoreanWindowsArchiveWithAReadmeBesideThePackImports'),
  },
  ios: {
    'F-01': ['UniPackRootNameTests/executionDirectoryDistinguishesLetterCase()',
      'UniPackRootNameTests/uppercaseRootNamesLoadTheActualPack()',
      'UniPackRootNameTests/infoWithAnExtensionDoesNotReplaceInfo()',
      'UniPackRootNameTests/pluralKeySoundsDoesNotReplaceKeySound()'],
    'F-05': ['UniPackArchiveLayoutTests/aFileBesideThePackFolderIsIgnored()',
      'UniPackArchiveLayoutTests/filesBesideEveryWrapperAreIgnored()',
      'UniPackArchiveLayoutTests/finderMetadataBesideThePackIsIgnored()',
      'UniPackArchiveLayoutTests/aFolderWithoutInfoBesideThePackIsIgnored()',
      'UniPackArchiveLayoutTests/aPackAtTheTopKeepsItsOwnFolders()',
      'UniPackArchiveLayoutTests/twoPacksInOneArchiveAreNotGuessed()',
      'ExternalFileImportTests/testPackFolderBesideAReadmeImports()'],
    'F-06': ['UniPackArchiveNameTests/flaggedUTF8NamesResolveTheSound()',
      'UniPackArchiveNameTests/unflaggedUTF8NamesResolveTheSound()',
      'UniPackArchiveNameTests/unflaggedCP949NamesResolveTheSound()'],
    'A-04': ['SoundEngineDecodingTests/anM4ASoundPlays()'],
    'A-05': ['SoundEngineDecodingTests/mp3DataInAFileNamedWavPlays()'],
  },
  web: {
    'F-05': ['F-05 opens a complete pack wrapped in a top folder',
      'F-05 opens a unique pack through nested folders and ignores archive sidecars'],
    'F-06': ['F-06 reads a CP949 file name inside the archive that has no UTF-8 mark',
      'F-06 reads an unmarked file name that is valid UTF-8 as UTF-8',
      'F-06 reads a file name explicitly marked as UTF-8'],
    ...Object.fromEntries([
      ['A-01', 'WAV PCM'], ['A-02', 'MP3'], ['A-03', 'OGG Vorbis'], ['A-04', 'M4A AAC'], ['A-05', 'MP3 named .wav'],
    ].map(([id, format]) => [id, [`${id} ${format} decodes and plays its own buffer with an output signal`]])),
  },
};

/** Refuses a table in which an item lists no test or one test twice: such an entry would confirm nothing. */
export function checkNativeTests(table) {
  for (const [platform, items] of Object.entries(table)) {
    for (const [id, names] of Object.entries(items)) {
      if (!Array.isArray(names) || names.length === 0) throw new Error(`NATIVE_TESTS.${platform}["${id}"] lists no test`);
      const twice = names.filter((name, i) => names.indexOf(name) !== i);
      if (twice.length) throw new Error(`NATIVE_TESTS.${platform}["${id}"] lists ${twice.join(', ')} more than once`);
    }
  }
  return table;
}
checkNativeTests(NATIVE_TESTS);
