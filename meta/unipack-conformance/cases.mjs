import { g6Cases } from './g6-cases.mjs';
// The case list. Each case is one small pack (input files) with the result every platform is expected
// to produce. Expected results come from the format docs (content/docs/en/unipack) and from intent
// stated in the platforms' own commit history and tests. Where neither says what should happen the
// case is `undetermined`: the platforms still run it and the observed results are printed, but it can
// only ever be reported as unverified. An undetermined case on which Android, iOS and the web all gave
// the same result holds that result as expected on an `agreed` basis (AGREED below), which the report
// counts apart from the cases a doc or an intent decides; a later doc or intent replaces it. Where the
// platforms differed and no doc decides, the maintainers' choice is held on a `decision` basis, also
// counted apart.
import { agreed, ap, anim, cell, decision, doc, ev, intent, ledCell, lines, loaded, pack, q, reference, refused, STD_INFO } from './lib.mjs';

const ANDROID_PARITY = intent('unipad-android 2298d635 (#63), unipad-ios 17b1ecc (#6), unipad.io 5721b4c', 'parsers were aligned to Android\'s strictness on purpose: a line Android rejects is rejected everywhere');
const WHITESPACE = intent('unipad-android 22a45925', 'parser whitespace and line-break tolerance for packs written by other tools (Unitor)');
const VEL4 = intent('unipad.io src/lib/unipack/logoLed.test.ts, unipad-android UniPackFolderLogoLedTest', 'a hex-only `on` line carries velocity 4; the docs do not state the default');
const LOGO = doc('key-led.mdx', 'Special Coordinates: `l` is the logo LED; `y` can be left out (`on l FF0000`, `on l auto 72`, `off l`) or a placeholder such as `0` can stand in its place, but not `a` or `auto`');
const AGREED = (note) => agreed('android, ios and web results of corpus c30e75b9 (2026-10-10)', note);
const SOUND_CASE = [
  doc('sounds.mdx', 'If no file has exactly that path, the player uses a file whose path differs only in upper and lower case. A folder is never a sound.'),
  intent('unipad.io src/lib/unipack/parser.ts findSoundFile (5721b4c)', 'the whole path under sounds/ is compared without case, so official store packs that list End.wav for a file stored as END.wav play'),
];
const ROUND = intent('unipad-android UniPackFolderLogoLedTest, unipad.io logoLed.test.ts', '`mc`/`*` numbers outside 1..32 are dropped so that index 32 never lights the logo');
/** An expected result an item of the grammar decides where the docs and the apps, or the apps, differed. */
const G1 = (item, note) => decision(`meta/unipack-conformance/GRAMMAR.md ${item}, edition G1 (2026-10-16)`, note);

/** Text as UTF-16 with a byte order mark, little or big endian, as a file's base64. */
const utf16 = (text, endian = 'le') => {
  const bytes = Buffer.from(`\uFEFF${text}`, 'utf16le');
  if (endian === 'be') bytes.swap16();
  return bytes.toString('base64');
};
/** ASCII with Korean words in CP949, as Windows Notepad saves "ANSI" on a Korean system. */
const CP949 = { 한글: 'c7d1b1db', 소리: 'bcd2b8ae' };
const cp949 = (...parts) => Buffer.concat(parts.map((p) => (CP949[p] ? Buffer.from(CP949[p], 'hex') : Buffer.from(p, 'ascii')))).toString('base64');

// A keySound that leaves the pad pressed in LED scenarios silent.
const OTHER_PAD_SOUND = '1 4 3 c.wav';

export function buildCases(palette) {
  const P = (v) => palette.argb[v];
  const auto = (x, y, v) => ev.on(x, y, P(v), v);
  const cases = [];
  const add = (c) => cases.push({ layer: 'parse', expectation: 'determined', ...c });

  // ---------------------------------------------------------------------------------------------
  // info
  // ---------------------------------------------------------------------------------------------
  add({
    id: 'INF-001', items: ['I-01', 'I-10', 'F-04'], area: 'info', title: 'every key of a complete info file',
    files: pack({ info: lines('title=Conformance Pack', 'producerName=UniPad Conformance', 'buttonX=4', 'buttonY=3', 'chain=2', 'squareButton=true', 'website=https://unipad.io') }),
    expected: loaded({ info: { title: 'Conformance Pack', website: 'https://unipad.io' }, sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [doc('info.mdx', 'Properties table')],
  });
  add({
    id: 'INF-002', items: ['I-07', 'S-01'], area: 'info', title: 'chain 24 is the largest accepted chain count',
    files: pack({ info: STD_INFO.replace('chain=2', 'chain=24'), keySound: '24 1 1 a.wav' }),
    expected: loaded({ info: { chain: 24 }, sounds: [cell(23, 0, 0, [q('a.wav')])] }),
    basis: [doc('info.mdx', 'chain 1~24')],
  });
  add({
    id: 'INF-003', items: ['I-07'], area: 'info', title: 'chain 25 aborts loading',
    files: pack({ info: STD_INFO.replace('chain=2', 'chain=25') }),
    expected: refused(),
    basis: [doc('info.mdx', 'Loading is aborted if chain is outside the 1~24 range')],
  });
  add({
    id: 'INF-004', items: ['I-07'], area: 'info', title: 'chain 0 aborts loading',
    files: pack({ info: STD_INFO.replace('chain=2', 'chain=0') }),
    expected: refused(),
    basis: [doc('info.mdx', 'Loading is aborted if chain is outside the 1~24 range')],
  });
  add({
    id: 'INF-005', items: ['I-07'], area: 'info', title: 'a chain that is not a number aborts loading',
    files: pack({ info: STD_INFO.replace('chain=2', 'chain=abc') }),
    expected: refused(),
    basis: [doc('info.mdx', 'chain must be within 1~24; "abc" is not, and the chain count stays 0')],
  });
  add({
    id: 'INF-006', items: ['I-01', 'T-07'], area: 'info', title: 'blank lines, spaces around = and unknown keys are ignored',
    files: pack({ info: lines('', '  title = Spaced Title  ', 'producerName=UniPad Conformance', '', 'buttonX = 4', 'buttonY=3 ', ' chain=2', 'squareButton=true', 'PackTool=SomeEditor 1.0', '   ') }),
    expected: loaded({ info: { title: 'Spaced Title' }, sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [doc('info.mdx', 'leading/trailing whitespace is ignored'), intent('unipad-android UniPackFolderMissingFileTest createStorePack', 'store packs carry extra info keys such as PackTool and must open')],
  });
  add({
    id: 'INF-007', items: ['I-02'], area: 'info', title: 'a line without = in info is ignored',
    files: pack({ info: lines('title=Conformance', 'producerName=UniPad Conformance', 'this line has no equals sign', 'buttonX=4', 'buttonY=3', 'chain=2', 'squareButton=true') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [doc('info.mdx', 'A line without = is ignored, without a warning')],
  });
  add({
    id: 'INF-008', items: ['I-03'], area: 'info', title: 'title and producerName missing only warn',
    files: pack({ info: lines('buttonX=4', 'buttonY=3', 'chain=2', 'squareButton=true') }),
    expected: loaded({ info: { title: '', producerName: '' }, sounds: [cell(0, 0, 0, [q('a.wav')])], errors: ['info:missing-field', 'info:missing-field'] }),
    basis: [doc('info.mdx', 'A warning is raised if title or producerName is empty')],
  });
  add({
    id: 'INF-009', items: ['I-05', 'S-02'], area: 'info', title: 'buttonX 0 warns and leaves every keySound x out of range',
    files: pack({ info: STD_INFO.replace('buttonX=4', 'buttonX=0') }),
    expected: loaded({ info: { buttonX: 0 }, errors: ['info:missing-field', 'keySound:range'] }),
    basis: [doc('info.mdx', 'A warning is raised if buttonX, buttonY, or chain is 0'), doc('key-sound.mdx', 'Lines with out-of-range coordinates are skipped with a warning')],
  });
  add({
    id: 'INF-010', items: ['I-04'], area: 'info', title: 'buttonX that is not a number aborts loading',
    files: pack({ info: STD_INFO.replace('buttonX=4', 'buttonX=abc') }),
    expected: refused(),
    basis: [doc('info.mdx', 'Loading is aborted if buttonX or buttonY is not an integer')],
  });
  add({
    id: 'INF-011', items: ['I-06'], area: 'info', title: 'a 65 x 65 grid is refused',
    files: pack({ info: STD_INFO.replace('buttonX=4', 'buttonX=65').replace('buttonY=3', 'buttonY=65') }),
    expected: refused(),
    basis: [doc('info.mdx', 'Loading is aborted if buttonX or buttonY is negative or greater than 64')],
  });
  add({
    id: 'INF-012', items: ['I-08'], area: 'info', title: 'squareButton left out reads as true',
    files: pack({ info: lines('title=Conformance', 'producerName=UniPad Conformance', 'buttonX=4', 'buttonY=3', 'chain=2') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [doc('info.mdx', 'Properties table: squareButton boolean, default: true')],
  });
  add({
    id: 'INF-013', items: ['F-02'], area: 'info', title: 'no info file refuses the pack',
    files: pack({ info: null }),
    expected: refused(),
    basis: [doc('info.mdx', 'every key is required except squareButton and website'), intent('UniPackFolder.kt / UniPackFolder.swift / parser.ts', 'a pack without info is a critical error on every platform')],
  });
  add({
    id: 'INF-014', items: ['F-02'], area: 'info', title: 'no keySound file refuses the pack',
    files: pack({ keySound: null }),
    expected: refused(),
    basis: [doc('key-sound.mdx', 'The keySound file maps sound files to each button'), intent('UniPackFolder.kt / UniPackFolder.swift / parser.ts', 'a pack without keySound is a critical error on every platform')],
  });
  add({
    id: 'INF-015', items: ['F-03'], area: 'info', title: 'info.json instead of info refuses the pack',
    files: pack({ info: null, extra: [{ path: 'info.json', text: '{"title":"Conformance","producerName":"UniPad Conformance","buttonX":4,"buttonY":3,"chain":2,"squareButton":true}' }] }),
    expected: refused(),
    basis: [doc('info.mdx', 'the metadata is the key=value `info` file; there is no other info format, so the pack has no info, as in INF-013')],
  });
  add({
    id: 'INF-016', items: ['I-04'], area: 'info', title: 'buttonY that is not a number aborts loading',
    files: pack({ info: STD_INFO.replace('buttonY=3', 'buttonY=abc') }),
    expected: refused(),
    basis: [doc('info.mdx', 'Loading is aborted if buttonX or buttonY is not an integer')],
  });
  add({
    id: 'INF-017', items: ['I-09'], area: 'info', title: 'squareButton=True is not true',
    files: pack({ info: STD_INFO.replace('squareButton=true', 'squareButton=True') }),
    expected: loaded({ info: { squareButton: false }, sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [intent('unipad-android UniPackFolder.kt, unipad-ios UniPackFolder.swift, unipad.io parser.ts parseInfo', 'squareButton is true only when the value is exactly `true`')],
  });
  add({
    id: 'INF-018', items: ['I-09'], area: 'info', title: 'squareButton=1 is not true',
    files: pack({ info: STD_INFO.replace('squareButton=true', 'squareButton=1') }),
    expected: loaded({ info: { squareButton: false }, sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [intent('unipad-android UniPackFolder.kt, unipad-ios UniPackFolder.swift, unipad.io parser.ts parseInfo', 'squareButton is true only when the value is exactly `true`')],
  });
  add({
    id: 'INF-019', items: ['I-11'], area: 'info', title: 'a key written twice keeps its last value',
    files: pack({ info: lines('title=First', 'producerName=UniPad Conformance', 'buttonX=4', 'buttonY=3', 'chain=1', 'chain=2', 'squareButton=true', 'title=Second') }),
    expected: loaded({ info: { title: 'Second' }, sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [intent('unipad-android UniPackFolder.kt, unipad-ios UniPackFolder.swift, unipad.io parser.ts parseInfo', 'each line overwrites the value of its key')],
  });

  // ---------------------------------------------------------------------------------------------
  // keySound
  // ---------------------------------------------------------------------------------------------
  add({
    id: 'KS-001', items: ['S-01'], area: 'keySound', title: 'first and last chain, x and y are accepted',
    files: pack({ keySound: lines('1 1 1 a.wav', '2 4 3 b.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(1, 3, 2, [q('b.wav')])] }),
    basis: [doc('key-sound.mdx', 'chain 1 ~ chain, x 1 ~ buttonX, y 1 ~ buttonY')],
  });
  add({
    id: 'KS-002', items: ['S-02'], area: 'keySound', title: 'one past each end of chain, x and y is skipped with a warning',
    files: pack({ keySound: lines('0 1 1 a.wav', '3 1 1 a.wav', '1 0 1 a.wav', '1 5 1 a.wav', '1 1 0 a.wav', '1 1 4 a.wav') }),
    expected: loaded({ errors: Array(6).fill('keySound:range') }),
    basis: [doc('key-sound.mdx', 'Lines with out-of-range coordinates are skipped with a warning')],
  });
  add({
    id: 'KS-003', items: ['S-05', 'S-06'], area: 'keySound', title: 'loop and wormhole are stored minus one',
    files: pack({ keySound: lines('1 1 1 a.wav 0', '1 1 2 a.wav 1 2', '1 1 3 a.wav 3', '1 2 1 a.wav 2 1') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav', -1)]), cell(0, 0, 1, [q('a.wav', 0, 1)]), cell(0, 0, 2, [q('a.wav', 2)]), cell(0, 1, 0, [q('a.wav', 1, 0)])] }),
    basis: [doc('key-sound.mdx', 'Loop Values: the loop value is internally stored with 1 subtracted; wormhole is a chain number')],
  });
  add({
    id: 'KS-004', items: ['S-09'], area: 'keySound', title: 'sounds on one pad form a queue in file order',
    files: pack({ keySound: lines('1 1 1 a.wav', '1 1 1 b.wav', '1 1 1 c.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav'), q('b.wav'), q('c.wav')])] }),
    basis: [doc('key-sound.mdx', 'Circular Queue (Multi-mapping)')],
  });
  add({
    id: 'KS-005', items: ['S-03', 'T-07'], area: 'keySound', title: 'blank lines and lines with fewer than 3 columns are ignored',
    files: pack({ keySound: ['', '   ', '1 1', '1', '1 1 1 a.wav', ''].join('\n') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [doc('key-sound.mdx', 'Empty lines and lines with fewer than 3 columns are ignored')],
  });
  add({
    id: 'KS-006', items: ['S-03'], area: 'keySound', title: 'three columns without a sound file is an error, not an ignored line',
    files: pack({ keySound: lines('1 1 1', '1 1 2 b.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 1, [q('b.wav')])], errors: ['keySound:format'] }),
    basis: [doc('key-sound.mdx', 'soundFile is required; only lines with fewer than 3 columns are ignored')],
  });
  const badKeySound = [
    ['M01', 'chain is not a number', 'x 1 1 a.wav'],
    ['M02', 'x is not a number', '1 y 1 a.wav'],
    ['M03', 'y is not a number', '1 1 z a.wav'],
    ['M04', 'loop is not a number', '1 1 1 a.wav q'],
    ['M05', 'wormhole is not a number', '1 1 1 a.wav 1 w'],
    ['M06', 'chain has a decimal point', '1.5 1 1 a.wav'],
    ['M07', 'loop has a decimal point', '1 1 1 a.wav 2.5'],
    ['M08', 'x has trailing letters', '1 1abc 1 a.wav'],
  ];
  for (const [n, what, bad] of badKeySound) {
    add({
      id: `KS-${n}`, items: ['S-04'], area: 'keySound', title: `malformed number: ${what}`,
      files: pack({ keySound: lines(bad, '1 1 2 b.wav') }),
      expected: loaded({ sounds: [cell(0, 0, 1, [q('b.wav')])], errors: ['keySound:format'] }),
      basis: [ANDROID_PARITY],
    });
  }
  add({
    id: 'KS-009', items: ['S-10'], area: 'keySound', title: 'a sound file that is not in the pack is a warning',
    files: pack({ keySound: lines('1 1 1 nope.wav', '1 1 2 a.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 1, [q('a.wav')])], errors: ['keySound:missing-file'] }),
    basis: [doc('key-sound.mdx', 'A warning is logged if the referenced sound file is not found in the sounds/ folder')],
  });
  add({
    id: 'KS-010', items: ['S-10', 'F-04'], area: 'keySound', title: 'a pack without a sounds folder warns for every line',
    files: pack({ sounds: [] }),
    expected: loaded({ errors: ['keySound:missing-file'] }),
    basis: [doc('key-sound.mdx', 'A warning is logged if the referenced sound file is not found')],
  });
  add({
    id: 'KS-011', items: ['S-11'], area: 'keySound', title: 'a sound in a sub folder of sounds',
    files: pack({ keySound: '1 1 1 fx/s.wav', sounds: ['fx/s.wav'] }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('fx/s.wav')])] }),
    basis: [doc('sounds.mdx', 'Subdirectories are supported (e.g., fx/sweep.wav)')],
  });
  add({
    id: 'KS-012', items: ['T-06'], area: 'keySound', title: 'runs of spaces and leading or trailing spaces',
    files: pack({ keySound: lines('1   1   1   a.wav   ', '   1 2 1 b.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(0, 1, 0, [q('b.wav')])] }),
    basis: [WHITESPACE],
  });
  add({
    id: 'KS-013', items: ['T-06'], area: 'keySound', title: 'tab separated columns',
    files: pack({ keySound: '1\t1\t1\ta.wav' }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [WHITESPACE],
  });
  add({
    id: 'KS-014', items: ['T-05'], area: 'keySound', title: 'CRLF line endings and no final newline',
    files: pack({ keySound: '1 1 1 a.wav\r\n1 1 2 b.wav' }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(0, 0, 1, [q('b.wav')])] }),
    basis: [WHITESPACE],
  });
  add({
    id: 'KS-015', items: ['T-08', 'S-03'], area: 'keySound', title: 'lines that look like comments',
    files: pack({ keySound: lines('# note', '// note', '; one two three', '1 1 1 a.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])], errors: ['keySound:format'] }),
    basis: [AGREED('The format has no comment syntax. Two-token lines fall under "fewer than 3 columns are ignored"; a longer one is a format error.')],
  });
  add({
    id: 'KS-016', items: ['T-01'], area: 'keySound', title: 'UTF-8 byte order mark before the first line',
    files: pack({ keySound: '﻿1 1 1 a.wav\n1 1 2 b.wav' }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(0, 0, 1, [q('b.wav')])] }),
    basis: [intent('unipad-ios UniPackFolder.swift readTextFile, unipad-android UniPackFolder.kt bomAwareReader', 'a BOM from Windows Notepad must not cost the first line')],
  });
  add({
    id: 'KS-017', items: ['T-05'], area: 'keySound', title: 'a lone carriage return between lines',
    files: pack({ keySound: '1 1 1 a.wav\r1 1 2 b.wav' }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(0, 0, 1, [q('b.wav')])] }),
    basis: [AGREED('The docs say nothing about classic-Mac line ends; the web parser splits on them explicitly, the apps rely on their line readers.')],
  });
  add({
    id: 'KS-018', items: ['T-02'], area: 'keySound', title: 'a UTF-16 little-endian keySound with a byte order mark',
    files: pack({ keySound: { base64: Buffer.from('﻿1 1 1 a.wav\n', 'utf16le').toString('base64') } }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [doc('key-sound.mdx', 'Text Encoding: UTF-16 (little or big endian) that starts with a byte order mark is read')],
  });
  add({
    id: 'KS-022', items: ['S-08'], area: 'keySound', title: 'columns after the sixth are ignored',
    files: pack({ keySound: '1 1 1 a.wav 1 2 7 more' }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav', 0, 1)])] }),
    basis: [intent('unipad-android UniPackFolder.kt, unipad-ios UniPackFolder.swift, unipad.io parser.ts parseKeySound', 'a keySound line reads six columns and no more')],
  });
  add({
    id: 'KS-023', items: ['S-07'], area: 'keySound', title: 'a wormhole to a chain the pack does not have keeps the sound, moved to the nearest chain, with a range warning',
    files: pack({ keySound: lines('1 1 1 a.wav 1 3', '1 1 2 a.wav 1 40', '1 1 3 a.wav 1 -2') }),
    expected: loaded({
      sounds: [cell(0, 0, 0, [q('a.wav', 0, 1)]), cell(0, 0, 1, [q('a.wav', 0, 1)]), cell(0, 0, 2, [q('a.wav', 0, 0)])],
      errors: Array(3).fill('keySound:range'),
    }),
    basis: [
      intent('unipad-android UniPackFolderWormholeTest, unipad-ios WormholeRangeTests, unipad.io parser.test.ts', 'a wormhole outside 1..chain keeps its sound, moves to the first or the last chain and records "wormhole is incorrect"'),
      intent('unipad.io src/lib/unipack/conformance.test.ts', '"wormhole is incorrect" is a range warning, like a chain, x or y outside the pack'),
    ],
  });
  const WORMHOLE_FIRST = intent('unipad-android UniPackFolder.kt, unipad-ios UniPackFolder.swift, unipad.io parser.ts parseKeySound', 'the wormhole is checked right after the numbers are read, before chain, x, y and the sound file, so a line skipped for another field still reports it');
  add({
    id: 'KS-024', items: ['S-07', 'S-02'], area: 'keySound', title: 'a line with both its wormhole and its chain, x or y outside the pack warns for each',
    files: pack({ keySound: lines('3 1 1 a.wav 1 9', '1 5 1 a.wav 1 9', '1 1 4 a.wav 1 9', '1 1 2 a.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 1, [q('a.wav')])], errors: Array(6).fill('keySound:range') }),
    basis: [WORMHOLE_FIRST],
  });
  add({
    id: 'KS-025', items: ['S-07', 'S-10'], area: 'keySound', title: 'a line with its wormhole outside the pack and a missing sound warns for both, wormhole first',
    files: pack({ keySound: lines('1 1 1 none.wav 1 9', '1 1 2 a.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 1, [q('a.wav')])], errors: ['keySound:range', 'keySound:missing-file'] }),
    basis: [WORMHOLE_FIRST],
  });
  add({
    id: 'KS-019', items: ['S-12'], area: 'keySound', title: 'a sound name that differs from its file only in case plays the stored file',
    files: pack({ keySound: lines('1 1 1 A.wav', '1 1 2 End.wav'), sounds: ['a.wav', 'END.wav'] }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(0, 0, 1, [q('END.wav')])] }),
    basis: SOUND_CASE,
  });
  add({
    id: 'KS-020', items: ['S-12'], area: 'keySound', title: 'the sub folder name may differ in case too',
    files: pack({ keySound: '1 1 1 FX/S.wav', sounds: ['fx/s.wav'] }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('fx/s.wav')])] }),
    basis: SOUND_CASE,
  });
  add({
    id: 'KS-021', items: ['S-12'], area: 'keySound', title: 'a name that matches only a file name in another folder, or a folder, is still missing',
    files: pack({ keySound: lines('1 1 1 fx/A.wav', '1 1 2 FX', '1 1 3 S.wav', '1 2 1 A.wav'), sounds: ['a.wav', 'fx/s.wav'] }),
    expected: loaded({ sounds: [cell(0, 1, 0, [q('a.wav')])], errors: Array(3).fill('keySound:missing-file') }),
    basis: [...SOUND_CASE, doc('key-sound.mdx', 'A warning is logged if the referenced sound file is not found in the sounds/ folder')],
  });

  // ---------------------------------------------------------------------------------------------
  // keyLed: file names
  // ---------------------------------------------------------------------------------------------
  const led = (files, over) => ({ files: pack({ keySound: OTHER_PAD_SOUND, keyLed: files }), ...over });
  add({
    id: 'KL-001', items: ['L-01', 'E-01', 'E-03'], area: 'keyLed', title: 'every event, long and short spelling',
    ...led({ '1 1 1': lines('on 1 1 FF0000', 'o 2 1 00FF00', 'delay 100', 'd 50', 'off 1 1', 'f 2 1', 'chain 2', 'c 1') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000'), ev.on(1, 0, 'ff00ff00'), ev.delay(100), ev.delay(50), ev.off(0, 0), ev.off(1, 0), ev.chain(1), ev.chain(0)])])] }),
    basis: [doc('key-led.mdx', 'Event Syntax: on/o, off/f, delay/d, chain/c'), VEL4],
  });
  add({
    id: 'KL-002', items: ['L-02'], area: 'keyLed', title: 'the loop count in the file name',
    ...led({ '1 1 1 0': 'f 1 1', '1 1 2 2': 'f 1 1', '1 1 3': 'f 1 1' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(0, [ev.off(0, 0)])]), ledCell(0, 0, 1, [anim(2, [ev.off(0, 0)])]), ledCell(0, 0, 2, [anim(1, [ev.off(0, 0)])])] }),
    basis: [doc('key-led.mdx', 'File Naming Convention: loop default 1, 0 = infinite loop')],
  });
  add({
    id: 'KL-003', items: ['L-03'], area: 'keyLed', title: 'file names one past each end of chain, x and y are ignored',
    ...led({ '0 1 1': 'f 1 1', '3 1 1': 'f 1 1', '1 5 1': 'f 1 1', '1 1 4': 'f 1 1' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, errors: Array(4).fill('keyLed:range') }),
    basis: [
      doc('key-led.mdx', 'Files with out-of-range coordinates in the file name are ignored'),
      AGREED('Whether each ignored file records a warning is not stated; all three record one range warning per file.'),
    ],
  });
  add({
    id: 'KL-004', items: ['L-07'], area: 'keyLed', title: 'files for one pad queue in file name order',
    ...led({ '1 1 1': 'o 1 1 FF0000', '1 1 1 0': 'o 1 1 00FF00' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000')]), anim(0, [ev.on(0, 0, 'ff00ff00')])])] }),
    basis: [doc('key-led.mdx', 'Mapping multiple files to the same coordinate creates a circular queue'), intent('unipad.io parser.ts (sort comment), unipad-android UniPackFolder.kt', 'the queue follows file name order, lower-cased')],
  });
  for (const [id, title, first, second] of [
    ['KL-026', 'decomposed Latin accent', 'o', 'n\u0303'],
    ['KL-027', 'composed Latin accent', 'o', '\u00f1'],
    ['KL-028', 'decomposed Hangul', '\u3131', '\u1100\u1161'],
    ['KL-029', 'composed Hangul', '\u3131', '\uac00'],
    ['KL-030', 'UTF-16 code units rather than Unicode scalar order', '\ud83d\ude00', '\ufffd'],
  ]) {
    add({
      id, items: ['L-06', 'L-07'], area: 'keyLed', title: `file name queue: ${title}`,
      ...led({ [`1 1 1 1 ${second}`]: 'd 20', [`1 1 1 1 ${first}`]: 'd 10' }),
      expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true,
        leds: [ledCell(0, 0, 0, [anim(1, [ev.delay(10)]), anim(1, [ev.delay(20)])])] }),
      basis: [decision('meta/unipack-conformance/GRAMMAR.md L-07, edition G4',
        'NFC then lower-case UTF-16 comparison gives the same queue for composed and decomposed names; the original paths still identify the files')],
    });
  }
  add({
    id: 'KL-005', items: ['L-04'], area: 'keyLed', title: 'a negative loop count in the file name',
    ...led({ '1 1 1 -1': 'f 1 1' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, errors: ['keyLed:range'] }),
    basis: [AGREED('The docs say a warning is logged; whether the file is dropped is not stated. All three drop it with a range warning.')],
  });
  const badLedNames = [
    ['N01', 'chain is not a number', 'a 1 1'],
    ['N02', 'x is not a number', '1 b 1'],
    ['N03', 'y is not a number', '1 1 c'],
    ['N04', 'loop is not a number', '1 1 1 d'],
    ['N05', 'loop has a decimal point', '1 1 1 1.5'],
  ];
  for (const [n, what, name] of badLedNames) {
    add({
      id: `KL-${n}`, items: ['L-05'], area: 'keyLed', title: `file name with a malformed number: ${what}`,
      ...led({ [name]: 'f 1 1' }),
      expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, errors: ['keyLed:format'] }),
      basis: [ANDROID_PARITY],
    });
  }
  add({
    id: 'KL-006', items: ['L-08'], area: 'keyLed', title: 'a stray file whose name has fewer than 3 columns',
    ...led({ '1 1': 'f 1 1', 'readme.txt': 'hello' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true }),
    basis: [AGREED('The keyLED docs describe the name as "chain x y [loop]" but not what a file that is not a mapping means; the parsers skip it silently.')],
  });
  add({
    id: 'KL-007', items: ['L-09'], area: 'keyLed', title: 'the keyLed folder is empty of mappings but present',
    ...led({ '1 1': 'f 1 1' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true }),
    basis: [AGREED('Whether an existing keyLED folder with no valid file counts as "has LED animations" is not stated; all three say it exists.')],
  });

  // ---------------------------------------------------------------------------------------------
  // keyLed: events
  // ---------------------------------------------------------------------------------------------
  add({
    id: 'KL-010', items: ['E-02', 'E-03', 'E-04'], area: 'keyLed', title: 'colours: hex, hex with velocity, auto and its short form',
    ...led({ '1 1 1': lines('o 1 1 FF0000', 'o 1 2 00B8D4 5', 'o 1 3 auto 72', 'on 2 1 a 5', 'o 2 2 abcdef', 'o 2 3 000000') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000'), ev.on(0, 1, 'ff00b8d4', 5), auto(0, 2, 72), auto(1, 0, 5), ev.on(1, 1, 'ffabcdef'), ev.on(1, 2, 'ff000000')])])] }),
    basis: [doc('key-led.mdx', 'Color Specification table'), VEL4, reference('meta/unipack-conformance/palette.json', 'the colour an auto line resolves to')],
  });
  add({
    id: 'KL-011', items: ['E-05'], area: 'keyLed', title: 'round LEDs with * and mc, numbered 1..32',
    ...led({ '1 1 1': lines('o * 1 FF0000', 'o mc 32 a 3', 'on mc 5 00FF00 7', 'f * 1', 'off mc 32') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(-1, 0, 'ffff0000'), auto(-1, 31, 3), ev.on(-1, 4, 'ff00ff00', 7), ev.off(-1, 0), ev.off(-1, 31)])])] }),
    basis: [doc('key-led.mdx', 'Special Coordinates: * or mc are the round LEDs'), ROUND],
  });
  add({
    id: 'KL-012', items: ['E-05'], area: 'keyLed', title: 'round LED numbers 0 and 33 are dropped without a warning',
    ...led({ '1 1 1': lines('o mc 33 a 3', 'o * 0 a 3', 'f mc 33', 'f mc 0', 'o mc 32 a 3') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [auto(-1, 31, 3)])])] }),
    basis: [ROUND],
  });
  add({
    id: 'KL-013', items: ['E-06'], area: 'keyLed', title: 'logo LED in every accepted spelling',
    ...led({ '1 1 1': lines('o l FF0000', 'o l a 5', 'on l auto 9', 'o l 0 00FF00', 'o l 0 a 13', 'o l 0 0000FF 21', 'f l', 'off l') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(-1, 32, 'ffff0000'), auto(-1, 32, 5), auto(-1, 32, 9), ev.on(-1, 32, 'ff00ff00'), auto(-1, 32, 13), ev.on(-1, 32, 'ff0000ff', 21), ev.off(-1, 32), ev.off(-1, 32)])])] }),
    basis: [LOGO],
  });
  add({
    id: 'KL-014', items: ['E-06'], area: 'keyLed', title: 'malformed logo lines are reported and skipped',
    ...led({ '1 1 1': lines('o l', 'o l ZZZZZZ', 'o l a 200', 'o l 0 a 5 9', 'o l a 5') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [auto(-1, 32, 5)])])], errors: Array(4).fill('keyLed:format') }),
    basis: [LOGO],
  });
  const badEvents = [
    ['M01', ['E-11'], 'on with only a pad column', 'on 1', [doc('key-led.mdx', 'The on command requires either color (4 tokens) or auto + velocity (5 tokens)')]],
    ['M02', ['E-11'], 'on without a colour', 'on 1 1', [doc('key-led.mdx', 'The on command requires either color (4 tokens) or auto + velocity (5 tokens)')]],
    ['M03', ['E-02'], 'a colour that is not hex', 'o 1 1 ZZZZZZ', [doc('key-led.mdx', '6-digit HEX color')]],
    ['M04', ['E-13'], 'x is not a number', 'o a 1 FF0000', [ANDROID_PARITY]],
    ['M05', ['E-13'], 'x has trailing letters', 'o 1b 1 FF0000', [ANDROID_PARITY]],
    ['M06', ['E-13'], 'y has trailing letters', 'o 1 1b FF0000', [ANDROID_PARITY]],
    ['M08', ['E-07'], 'off with only a pad column', 'f 1', [ANDROID_PARITY]],
    ['M09', ['E-07'], 'off with letters', 'f a b', [ANDROID_PARITY]],
    ['M10', ['E-07'], 'off with no coordinates', 'off', [ANDROID_PARITY]],
    ['M11', ['E-11'], 'a velocity that is not a number', 'o 1 1 FF0000 x', [ANDROID_PARITY]],
    ['M12', ['E-11'], 'six tokens on an on line', 'o 1 1 FF0000 5 6', [doc('key-led.mdx', 'The on command requires either color (4 tokens) or auto + velocity (5 tokens)')]],
    ['M13', ['E-02'], 'a 7 digit colour', 'o 1 1 1234567', [doc('key-led.mdx', '6-digit HEX color')]],
    ['M14', ['E-02'], 'a colour with a #', 'o 1 1 #FF0000', [doc('key-led.mdx', '6-digit HEX color')]],
    ['M15', ['E-02'], 'an 8 digit colour', 'o 1 1 FFFFFFFF', [doc('key-led.mdx', '6-digit HEX color')]],
    ['M16', ['E-04'], 'auto with velocity 128', 'o 1 1 auto 128', [doc('key-led.mdx', 'velocity: MIDI velocity (0~127)')]],
    ['M17', ['E-04'], 'short auto with velocity 200', 'o 1 1 a 200', [doc('key-led.mdx', 'velocity: MIDI velocity (0~127)')]],
    ['M18', ['E-04'], 'short auto with velocity -1', 'o 1 1 a -1', [doc('key-led.mdx', 'velocity: MIDI velocity (0~127)')]],
    ['M19', ['E-04'], 'auto without a velocity', 'o 1 1 auto', [doc('key-led.mdx', 'auto requires a velocity')]],
    ['M20', ['E-08'], 'a delay that is not a number', 'd abc', [ANDROID_PARITY]],
    ['M21', ['E-08'], 'a delay without a value', 'd', [ANDROID_PARITY]],
    ['M22', ['E-08'], 'a delay with a decimal point', 'd 1.5', [ANDROID_PARITY]],
    ['M23', ['E-10'], 'a chain that is not a number', 'c x', [ANDROID_PARITY]],
    ['M24', ['E-10'], 'a chain without a value', 'c', [ANDROID_PARITY]],
    ['M25', ['E-05'], 'a round LED number that is not a number', 'o * x FF0000', [ANDROID_PARITY]],
    ['M26', ['E-05'], 'an mc line without a number', 'o mc', [ANDROID_PARITY]],
    ['M27', ['E-05'], 'an off round LED number that is not a number', 'f * x', [ANDROID_PARITY]],
  ];
  for (const [n, items, what, bad, basis] of badEvents) {
    add({
      id: `KL-${n}`, items, area: 'keyLed', title: `malformed event: ${what}`,
      ...led({ '1 1 1': lines(bad, 'f 1 1') }),
      expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.off(0, 0)])])], errors: ['keyLed:format'] }),
      basis,
    });
  }
  add({
    id: 'KL-M07', items: ['E-12'], area: 'keyLed', title: 'malformed event: an unknown command',
    ...led({ '1 1 1': lines('bogus 1 1', 'f 1 1') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.off(0, 0)])])], errors: ['keyLed:format'] }),
    basis: [
      doc('key-led.mdx', 'Unrecognized commands are skipped'),
      AGREED('Whether the skip is recorded as a warning is not stated; all three record a format warning. The same as KL-025.'),
    ],
  });
  add({
    id: 'KL-020', items: ['E-03'], area: 'keyLed', title: 'velocity above 127 next to a hex colour',
    ...led({ '1 1 1': 'o 1 1 FF0000 200' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000', 200)])])] }),
    basis: [AGREED('The docs give 0~127 for velocity; no parser rejects a hex line with a larger one (the drivers clamp it later).')],
  });
  add({
    id: 'KL-021', items: ['E-15'], area: 'keyLed', title: 'an empty keyLED file still registers an animation',
    ...led({ '1 1 1': '' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [])])] }),
    basis: [intent('unipad-android LedRunner.kt (Crashlytics a1376611 comment), UniPackFolder.kt', 'an empty file is a legal animation with no events')],
  });
  add({
    id: 'KL-022', items: ['T-05', 'T-06', 'T-07'], area: 'keyLed', title: 'CRLF, blank lines and runs of spaces inside a keyLED file',
    ...led({ '1 1 1': 'o  1  1  FF0000\r\n\r\n   \r\nd   100\r\nf 1 1' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000'), ev.delay(100), ev.off(0, 0)])])] }),
    basis: [WHITESPACE],
  });
  add({
    id: 'KL-023', items: ['E-10'], area: 'keyLed', title: 'a chain event that names a chain the pack does not have',
    ...led({ '1 1 1': 'c 9' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.chain(8)])])] }),
    basis: [AGREED('The docs do not say whether a keyLED `chain` beyond the pack\'s chain count is a warning or kept as written; all three keep it as written.')],
  });
  add({
    id: 'KL-024', items: ['E-14'], area: 'keyLed', title: 'an LED event outside the pad grid is kept as written',
    ...led({ '1 1 1': 'o 9 9 FF0000' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(8, 8, 'ffff0000')])])] }),
    basis: [decision('maintainers, 2026-10-12', 'The docs do not say whether coordinates inside a keyLED file are range-checked when parsing. Packs do light positions outside their grid, and a warning per line gives the user nothing to act on: the line is kept as written, without a warning, and skipped when it is lit.')],
  });
  add({
    id: 'KL-031', items: ['E-05', 'E-14'], area: 'keyLed', title: 'numeric zero columns address circular lights but zero rows remain pad events',
    ...led({ '1 1 1': lines('on 0 1 ffa726 61', 'o 0 32 FF0000', 'off 0 1', 'f 0 32', 'on 8 0 ffa726 61', 'off 8 0', 'o 0 0 FF0000', 'f 0 0', 'o 0 37 FF0000', 'f 0 37') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(-1, 0, 'ffffa726', 61), ev.on(-1, 31, 'ffff0000'), ev.off(-1, 0), ev.off(-1, 31), ev.on(7, -1, 'ffffa726', 61), ev.off(7, -1), ev.on(-1, -1, 'ffff0000'), ev.off(-1, -1), ev.on(-1, 36, 'ffff0000'), ev.off(-1, 36)])])] }),
    basis: [intent('Android UniPackFolder.zeroBased and LedRunner; iOS UniPackFolder and LedRunner', 'Both parsers subtract one from each numeric coordinate; only first coordinate -1 selects circular lights. Invalid coordinates are retained without warnings and skipped when lit.'), VEL4],
  });
  add({
    id: 'KL-025', items: ['T-08', 'E-12'], area: 'keyLed', title: 'a comment-like line inside a keyLED file',
    ...led({ '1 1 1': lines('# note', 'f 1 1') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.off(0, 0)])])], errors: ['keyLed:format'] }),
    basis: [
      doc('key-led.mdx', 'Unrecognized commands are skipped'),
      AGREED('There is no comment syntax in the format, and whether the skip warns is not stated; all three record a format warning. The same as KL-M07.'),
    ],
  });

  // ---------------------------------------------------------------------------------------------
  // autoPlay
  // ---------------------------------------------------------------------------------------------
  const play = (autoPlay, keySound = lines('1 1 1 a.wav', '2 1 1 b.wav'), sounds) => ({ files: pack({ keySound, autoPlay, ...(sounds ? { sounds } : {}) }) });
  const withSounds = (over) => ({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(1, 0, 0, [q('b.wav')])], ...over });
  add({
    id: 'AP-001', items: ['P-01'], area: 'autoPlay', title: 'the docs example: on, off, touch, chain and delay',
    ...play(lines('chain 1', 'on 1 1', 'on 1 2', 'delay 100', 'off 1 1', 'off 1 2', 'delay 200', 'touch 2 1', 'touch 2 2', 'delay 100', 'chain 2', 'on 1 1', 'delay 500', 'off 1 1')),
    expected: loaded(withSounds({ autoPlay: [ap.chain(0), ap.on(0, 0, 0, 0), ap.on(0, 1, 0, 0), ap.delay(100), ap.off(0, 0, 0), ap.off(0, 1, 0), ap.delay(200), ap.on(1, 0, 0, 0), ap.off(1, 0, 0), ap.on(1, 1, 0, 0), ap.off(1, 1, 0), ap.delay(100), ap.chain(1), ap.on(0, 0, 1, 0), ap.delay(500), ap.off(0, 0, 1)] })),
    basis: [doc('auto-play.mdx', 'Commands and Example')],
  });
  add({
    id: 'AP-002', items: ['P-02'], area: 'autoPlay', title: 'every on and touch advances the pad\'s queue number, a chain resets it',
    ...play(lines('on 1 1', 'on 1 1', 'touch 1 1', 'chain 1', 'on 1 1')),
    expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0), ap.on(0, 0, 0, 1), ap.on(0, 0, 0, 2), ap.off(0, 0, 0), ap.chain(0), ap.on(0, 0, 0, 0)] })),
    basis: [doc('auto-play.mdx', 'The on event advances to the next sound in the circular queue; whenever the chain changes, every button of that chain starts its circular queue from the first sound and LED again')],
  });
  add({
    id: 'AP-003', items: ['P-03'], area: 'autoPlay', title: 'a sound with a wormhole switches the chain after its on',
    ...play(lines('on 1 1', 'on 1 1'), lines('1 1 1 a.wav 1 2', '2 1 1 b.wav')),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav', 0, 1)]), cell(1, 0, 0, [q('b.wav')])], autoPlay: [ap.on(0, 0, 0, 0), ap.chain(1), ap.on(0, 0, 1, 0)] }),
    basis: [doc('auto-play.mdx', 'If a sound has a wormhole set, executing on will automatically switch to that chain')],
  });
  add({
    id: 'AP-004', items: ['P-05'], area: 'autoPlay', title: 'coordinates and chains outside the pack are skipped',
    ...play(lines('on 5 1', 'on 1 4', 'on 0 1', 'chain 3', 'chain 0', 'off 5 5', 'touch 9 9')),
    expected: loaded(withSounds({ autoPlay: [], errors: Array(7).fill('autoPlay:range') })),
    basis: [
      doc('auto-play.mdx', 'Lines with out-of-range coordinates are skipped'),
      AGREED('Whether each skipped line records a warning is not stated; all three record one range warning per line.'),
    ],
  });
  add({
    id: 'AP-005', items: ['P-01'], area: 'autoPlay', title: 'every command in its short spelling: o, f, t, c and d',
    ...play(lines('c 1', 'o 1 1', 'd 100', 'f 1 1', 't 2 1', 'c 2', 'o 1 1', 'd 50', 'f 1 1')),
    expected: loaded(withSounds({ autoPlay: [ap.chain(0), ap.on(0, 0, 0, 0), ap.delay(100), ap.off(0, 0, 0), ap.on(1, 0, 0, 0), ap.off(1, 0, 0), ap.chain(1), ap.on(0, 0, 1, 0), ap.delay(50), ap.off(0, 0, 1)] })),
    basis: [doc('auto-play.mdx', 'Commands table, Shorthand column: o, f, t, c, d')],
  });
  add({
    id: 'AP-006', items: ['P-04'], area: 'autoPlay', title: 'a touch of a pad whose sound has a wormhole switches the chain',
    ...play(lines('touch 1 1', 'touch 1 1'), lines('1 1 1 a.wav 1 2', '2 1 1 b.wav')),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav', 0, 1)]), cell(1, 0, 0, [q('b.wav')])], autoPlay: [ap.on(0, 0, 0, 0), ap.off(0, 0, 0), ap.chain(1), ap.on(0, 0, 1, 0), ap.off(0, 0, 1)] }),
    basis: [doc('auto-play.mdx', 'touch is on + off in one line, and an on of a sound with a wormhole switches to that chain; the pad is released on the chain it was pressed on')],
  });
  const badAuto = [
    ['M01', 'x is not a number', 'on a 1'],
    ['M02', 'on without y', 'on 1'],
    ['M03', 'off with letters', 'off x y'],
    ['M04', 'touch without y', 'touch 1'],
    ['M05', 'a chain that is not a number', 'chain z'],
    ['M06', 'a chain without a value', 'chain'],
    ['M07', 'a delay that is not a number', 'delay x'],
    ['M08', 'a delay without a value', 'delay'],
    ['M09', 'a delay with a decimal point', 'delay 1.5'],
    ['M11', 'y has trailing letters', 'on 1 1b'],
  ];
  for (const [n, what, bad] of badAuto) {
    add({
      id: `AP-${n}`, items: ['P-06'], area: 'autoPlay', title: `malformed line: ${what}`,
      ...play(lines(bad, 'on 1 1')),
      expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0)], errors: ['autoPlay:format'] })),
      basis: [ANDROID_PARITY],
    });
  }
  add({
    id: 'AP-M10', items: ['P-07'], area: 'autoPlay', title: 'malformed line: an unknown command',
    ...play(lines('bogus 1 1', 'on 1 1')),
    expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0)], errors: ['autoPlay:format'] })),
    basis: [AGREED('auto-play.mdx lists the commands but does not say what a line starting with another word does (key-led.mdx says "skipped", for keyLED files only); all three skip it with a format warning. The same as AP-022.')],
  });

  // ---------------------------------------------------------------------------------------------
  // numbers that do not fit in 32 bits, and the two 32-bit ends
  // ---------------------------------------------------------------------------------------------
  // Each pack puts every numeric field of one file kind at the same value, then a line or file that is
  // fine and must still be read. A number past 32 bits is a format error; one that fits is range-checked
  // where the field has a range, and otherwise kept, 1 less where the field is stored 0-based.
  const INT32 = decision('maintainers, 2026-10-17', 'A number in a pack is a signed decimal integer from -2147483648 to 2147483647, as Android always read it. A larger one is a format error and only its line or file is skipped; one that fits but is outside the pack is a range error. The platforms differed: iOS read numbers up to 64 bits and the web any number, so the same value was a range error there, and the web rounded numbers past 2^53.');
  const tooLarge = [
    ['01', '2147483648', 'one past the largest 32-bit number'],
    ['02', '-2147483649', 'one below the smallest 32-bit number'],
    ['03', '99999999999', 'eleven digits'],
    ['04', '9007199254740993', 'past 2^53, where the web rounded'],
    ['05', '9223372036854775808', 'one past the largest 64-bit number'],
    ['06', '9'.repeat(400), '400 digits'],
  ];
  const repeat = (n, item) => Array.from({ length: n }, () => item);
  for (const [n, value, what] of tooLarge) {
    add({
      id: `KS-B${n}`, items: ['T-09'], area: 'keySound', title: `a number past 32 bits is a format error in every field: ${what}`,
      files: pack({ keySound: lines(`${value} 1 1 a.wav`, `1 ${value} 1 a.wav`, `1 1 ${value} a.wav`, `1 1 1 a.wav ${value}`, `1 1 1 a.wav 1 ${value}`, '1 1 2 b.wav') }),
      expected: loaded({ sounds: [cell(0, 0, 1, [q('b.wav')])], errors: repeat(5, 'keySound:format') }),
      basis: [INT32],
    });
    // A file name is at most 255 bytes, so the 400-digit number is cut to 240 digits there.
    const name = value.length > 240 ? value.slice(0, 240) : value;
    add({
      id: `KL-BN${n}`, items: ['T-09'], area: 'keyLed', title: `a file name number past 32 bits is a format error: ${value.length > 240 ? '240 digits' : what}`,
      ...led({ [`${name} 1 1`]: 'f 1 1', [`1 ${name} 1`]: 'f 1 1', [`1 1 ${name}`]: 'f 1 1', [`1 1 1 ${name}`]: 'f 1 1', '1 1 1': 'f 1 1' }),
      expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.off(0, 0)])])], errors: repeat(4, 'keyLed:format') }),
      basis: [INT32],
    });
    add({
      id: `KL-BE${n}`, items: ['T-09'], area: 'keyLed', title: `an event number past 32 bits is a format error: ${what}`,
      ...led({ '1 1 1': lines(`o ${value} 1 a 5`, `o 1 ${value} a 5`, `f ${value} 1`, `f 1 ${value}`, `o mc ${value} a 5`, `f mc ${value}`, `o 1 1 FF0000 ${value}`, `o 1 1 a ${value}`, `d ${value}`, `c ${value}`, 'f 1 1') }),
      expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.off(0, 0)])])], errors: repeat(10, 'keyLed:format') }),
      basis: [INT32],
    });
    add({
      id: `AP-B${n}`, items: ['T-09'], area: 'autoPlay', title: `a number past 32 bits is a format error: ${what}`,
      ...play(lines(`on ${value} 1`, `off 1 ${value}`, `touch ${value} 1`, `chain ${value}`, `delay ${value}`, 'on 1 1')),
      expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0)], errors: repeat(5, 'autoPlay:format') })),
      basis: [INT32],
    });
  }
  // At the two ends a field with a range is a range error. A field without one keeps the number as the
  // cases without big numbers do (a negative keyLED loop drops its file as in KL-005, a hex colour keeps any
  // velocity as in KL-020, an event outside the grid or a chain the pack lacks is kept as in KL-024 and
  // KL-023), and a field stored 0-based keeps 1 less for the smallest number too: -2147483649.
  const ends = [['07', 2147483647, 'the largest 32-bit number'], ['08', -2147483648, 'the smallest 32-bit number']];
  for (const [n, value, what] of ends) {
    add({
      id: `KS-B${n}`, items: ['T-09'], area: 'keySound', title: `${what} is a number: outside the pack, or a loop`,
      files: pack({ keySound: lines(`${value} 1 1 a.wav`, `1 ${value} 1 a.wav`, `1 1 ${value} a.wav`, `1 1 1 a.wav ${value}`, '1 1 2 b.wav') }),
      expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav', value - 1)]), cell(0, 0, 1, [q('b.wav')])], errors: repeat(3, 'keySound:range') }),
      basis: [INT32, doc('key-sound.mdx', 'Loop Values: the loop value is internally stored with 1 subtracted')],
    });
    add({
      id: `KL-BN${n}`, items: ['T-09'], area: 'keyLed', title: `${what} in a file name is a number: outside the pack, or a loop`,
      ...led({ [`${value} 1 1`]: 'f 1 1', [`1 ${value} 1`]: 'f 1 1', [`1 1 ${value}`]: 'f 1 1', [`1 1 1 ${value}`]: 'f 1 1', '1 1 2': 'f 1 1' }),
      expected: loaded({
        sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true,
        leds: value > 0 ? [ledCell(0, 0, 0, [anim(value, [ev.off(0, 0)])]), ledCell(0, 0, 1, [anim(1, [ev.off(0, 0)])])] : [ledCell(0, 0, 1, [anim(1, [ev.off(0, 0)])])],
        errors: repeat(value > 0 ? 3 : 4, 'keyLed:range'),
      }),
      basis: [INT32],
    });
    add({
      id: `KL-BE${n}`, items: ['T-09'], area: 'keyLed', title: `${what} in an event: kept as a velocity and a delay, a round LED of it dropped`,
      ...led({ '1 1 1': lines(`o mc ${value} a 5`, `f mc ${value}`, `o 1 1 FF0000 ${value}`, `o 1 1 a ${value}`, `d ${value}`, 'f 1 1') }),
      expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000', value), ev.delay(value), ev.off(0, 0)])])], errors: ['keyLed:format'] }),
      basis: [INT32, ROUND, doc('key-led.mdx', 'velocity: MIDI velocity (0~127)')],
    });
    add({
      id: `KL-BE${n === '07' ? '09' : '10'}`, items: ['T-09'], area: 'keyLed', title: `${what} as an event coordinate or chain is kept 1 less`,
      ...led({ '1 1 1': lines(`o ${value} 1 a 5`, `f 1 ${value}`, `c ${value}`, 'f 1 1') }),
      expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [auto(value - 1, 0, 5), ev.off(0, value - 1), ev.chain(value - 1), ev.off(0, 0)])])] }),
      basis: [INT32],
    });
    add({
      id: `AP-B${n}`, items: ['T-09'], area: 'autoPlay', title: `${what} is a number: outside the pack, or a delay`,
      ...play(lines(`on ${value} 1`, `off 1 ${value}`, `touch ${value} 1`, `chain ${value}`, `delay ${value}`, 'on 1 1')),
      expected: loaded(withSounds({ autoPlay: [ap.delay(value), ap.on(0, 0, 0, 0)], errors: repeat(4, 'autoPlay:range') })),
      basis: [INT32],
    });
  }
  add({
    id: 'AP-020', items: ['P-08'], area: 'autoPlay', title: 'an empty autoPlay file exists with no elements',
    ...play(''),
    expected: loaded(withSounds({ autoPlay: [] })),
    basis: [doc('auto-play.mdx', 'The autoPlay file defines the auto-play sequence')],
  });
  add({
    id: 'AP-021', items: ['T-05', 'T-06', 'T-07'], area: 'autoPlay', title: 'CRLF, blank lines and runs of spaces in autoPlay',
    ...play('on  1  1\r\n\r\n   \r\ndelay   100\r\noff 1 1'),
    expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0), ap.delay(100), ap.off(0, 0, 0)] })),
    basis: [WHITESPACE],
  });
  add({
    id: 'AP-022', items: ['T-08', 'P-07'], area: 'autoPlay', title: 'a comment-like line in autoPlay',
    ...play(lines('# start', 'on 1 1')),
    expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0)], errors: ['autoPlay:format'] })),
    basis: [AGREED('There is no comment syntax in the format, and auto-play.mdx does not say what a line starting with an unknown word does; all three skip it with a format warning. The same as AP-M10.')],
  });

  // ---------------------------------------------------------------------------------------------
  // file names, folders and text encodings of every file
  // ---------------------------------------------------------------------------------------------
  const ROOT_LOOKUP = intent('unipad-android UniPackFolder.kt, unipad-ios UniPackFolder.swift, unipad.io parser.ts getFile/getDir', 'the files and folders at the pack root are looked up without regard to letter case, by their exact name otherwise');
  add({
    id: 'FS-001', items: ['F-01'], area: 'files', title: 'root files and folders in other letter case',
    files: [
      { path: 'INFO', text: STD_INFO },
      { path: 'KEYSOUND', text: '1 1 1 a.wav' },
      { path: 'SOUNDS/a.wav', asset: 'tone-440' },
      { path: 'KeyLED/1 1 1', text: 'o 1 1 FF0000' },
      { path: 'AUTOPLAY', text: 'on 1 1' },
    ],
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000')])])], autoPlay: [ap.on(0, 0, 0, 0)] }),
    basis: [ROOT_LOOKUP, VEL4],
  });
  add({
    id: 'FS-002', items: ['F-01', 'F-02'], area: 'files', title: 'a keySounds file is not the keySound file',
    files: pack({ keySound: null, extra: [{ path: 'keySounds', text: '1 1 1 a.wav' }] }),
    expected: refused(),
    basis: [ROOT_LOOKUP, intent('UniPackFolder.kt / UniPackFolder.swift / parser.ts', 'a pack without keySound is a critical error on every platform')],
  });
  add({
    id: 'FS-003', items: ['F-01', 'F-03'], area: 'files', title: 'an info.txt file is not the info file',
    files: pack({ info: null, extra: [{ path: 'info.txt', text: STD_INFO }] }),
    expected: refused(),
    basis: [ROOT_LOOKUP, doc('info.mdx', 'the metadata is the key=value `info` file')],
  });
  add({
    id: 'FS-004', items: ['F-07'], area: 'files', title: 'a file in a sub folder of keyLED is no LED file',
    ...led({ '1 1 1': 'o 1 1 FF0000', 'sub/1 1 2': 'o 1 1 00FF00' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000')])])] }),
    basis: [intent('unipad.io parser.ts parseKeyLed, unipad-android UniPackFolder.kt, unipad-ios UniPackFolder.swift', 'only the files directly inside keyLED are read; the folder `sub` has a name of one column and is skipped'), VEL4],
  });
  const textOf = (path, base64) => ({ path, base64 });
  const T03 = G1('T-03', 'The files of one pack follow one encoding rule: the UTF-8 byte order mark is dropped and UTF-16 with a byte order mark is read, in info, keyLED and autoPlay as in keySound.');
  add({
    id: 'TX-001', items: ['T-03', 'T-01'], area: 'text', title: 'an info file with a UTF-8 byte order mark',
    files: pack({ info: `\uFEFF${STD_INFO}` }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [T03],
  });
  add({
    id: 'TX-002', items: ['T-03', 'T-01'], area: 'text', title: 'a keyLED file with a UTF-8 byte order mark',
    ...led({ '1 1 1': lines('\uFEFFo 1 1 FF0000', 'f 1 1') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000'), ev.off(0, 0)])])] }),
    basis: [T03, VEL4],
  });
  add({
    id: 'TX-003', items: ['T-03', 'T-01'], area: 'text', title: 'an autoPlay file with a UTF-8 byte order mark',
    ...play(lines('\uFEFFon 1 1', 'off 1 1')),
    expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0), ap.off(0, 0, 0)] })),
    basis: [T03],
  });
  add({
    id: 'TX-004', items: ['T-03'], area: 'text', title: 'a UTF-16 little-endian info file with a byte order mark',
    files: pack({ info: { base64: utf16(STD_INFO) } }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [T03],
  });
  add({
    id: 'TX-005', items: ['T-03'], area: 'text', title: 'a UTF-16 little-endian keyLED file with a byte order mark',
    files: pack({ keySound: OTHER_PAD_SOUND, extra: [textOf('keyLed/1 1 1', utf16(lines('o 1 1 FF0000', 'f 1 1')))] }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000'), ev.off(0, 0)])])] }),
    basis: [T03, VEL4],
  });
  add({
    id: 'TX-006', items: ['T-03'], area: 'text', title: 'a UTF-16 big-endian autoPlay file with a byte order mark',
    files: pack({ keySound: lines('1 1 1 a.wav', '2 1 1 b.wav'), extra: [textOf('autoPlay', utf16(lines('on 1 1', 'off 1 1'), 'be'))] }),
    expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0), ap.off(0, 0, 0)] })),
    basis: [T03],
  });
  const T04 = G1('T-04', 'A text file that is neither UTF-8 nor UTF-16 with a byte order mark is read as CP949: what Windows Notepad saved as "ANSI" on a Korean system.');
  add({
    id: 'TX-007', items: ['T-04'], area: 'text', title: 'an info file in CP949 with a Korean title',
    files: pack({ info: { base64: cp949('title=', '한글', '\nproducerName=UniPad Conformance\nbuttonX=4\nbuttonY=3\nchain=2\nsquareButton=true') } }),
    expected: loaded({ info: { title: '한글' }, sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [T04],
  });
  add({
    id: 'TX-008', items: ['T-04', 'S-11'], area: 'text', title: 'a keySound in CP949 naming a sound with a Korean name',
    files: pack({ keySound: { base64: cp949('1 1 1 ', '소리', '.wav') }, sounds: ['소리.wav'] }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('소리.wav')])] }),
    basis: [T04],
  });

  // ---------------------------------------------------------------------------------------------
  // colour palette
  // ---------------------------------------------------------------------------------------------
  cases.push({
    id: 'PAL-001', items: ['C-01'], layer: 'palette', area: 'palette', title: 'the 128 colours an `auto` velocity resolves to',
    files: [], expectation: 'determined', expected: { argb: palette.argb },
    basis: [reference('meta/unipack-conformance/palette.json', 'Android LaunchpadColor.ARGB, the oldest implementation; not compared with a Launchpad')],
  });

  // ---------------------------------------------------------------------------------------------
  // runners: press, release, time, exit
  // ---------------------------------------------------------------------------------------------
  /** `extra`: more fields of the case, such as `unobserved`. */
  const run = (id, items, area, title, files, scenario, checkpoints, basis, extra = {}) => cases.push({
    id, items, layer: 'run', area, title, files, scenario, expectation: 'determined', expected: { checkpoints }, basis, ...extra,
  });
  const press = (x, y) => ({ do: 'press', x, y });
  const release = (x, y) => ({ do: 'release', x, y });
  const advance = (ms) => ({ do: 'advance', ms });
  const observe = { do: 'observe' };
  const looping = { do: 'looping' };
  const snd = (c, x, y, file, loop = 0) => ['sound', c, x, y, file, loop];
  const RED = 'ffff0000';
  const GREEN = 'ff00ff00';

  run('RUN-S-001', ['RS-01', 'A-01'], 'sound', 'pressing one pad cycles through its queue',
    pack({ keySound: lines('1 1 1 a.wav', '1 1 1 b.wav') }),
    [press(0, 0), release(0, 0), press(0, 0), release(0, 0), press(0, 0), release(0, 0), observe],
    [[snd(0, 0, 0, 'a.wav'), snd(0, 0, 0, 'b.wav'), snd(0, 0, 0, 'a.wav')]],
    [doc('key-sound.mdx', 'Circular Queue: sound_a -> sound_b -> sound_c -> sound_a')]);
  run('RUN-S-002', ['RS-08'], 'sound', 'a wormhole switches the chain, the next press plays that chain',
    pack({ keySound: lines('1 1 1 a.wav 1 2', '2 1 1 b.wav') }),
    [press(0, 0), release(0, 0), advance(200), observe, press(0, 0), release(0, 0), advance(50), observe],
    [[snd(0, 0, 0, 'a.wav'), ['chain', 1]], [snd(1, 0, 0, 'b.wav')]],
    [doc('key-sound.mdx', 'wormhole: chain number to switch to, 100 ms after the button is pressed')]);
  run('RUN-S-003', ['RS-02'], 'sound', 'the sound follows the selected chain',
    pack({ keySound: lines('1 1 1 a.wav', '2 1 1 b.wav') }),
    [{ do: 'chain', c: 1 }, press(0, 0), release(0, 0), observe],
    [[snd(1, 0, 0, 'b.wav')]],
    [doc('key-sound.mdx', 'chain x y soundFile')]);
  run('RUN-S-004', ['RS-03'], 'sound', 'a pad without a sound makes none',
    pack({ keySound: '1 1 1 a.wav' }),
    [press(1, 1), release(1, 1), observe],
    [[]],
    [doc('key-sound.mdx', 'each line maps one sound to one button')]);
  run('RUN-S-005', ['RS-04'], 'sound', 'loop 0 in the file starts an endless sound, loop 3 repeats twice',
    pack({ keySound: lines('1 1 1 a.wav 0', '1 1 2 a.wav 3') }),
    [press(0, 0), release(0, 0), press(0, 1), release(0, 1), observe],
    [[snd(0, 0, 0, 'a.wav', -1), snd(0, 0, 1, 'a.wav', 2)]],
    [doc('key-sound.mdx', 'Loop Values: 0 loops indefinitely, N (2 or more) plays N times in total')]);

  const watchStops = { do: 'watchStops' };
  const pickChain = (c) => ({ do: 'chain', c });
  const stopped = (c, x, y, file) => ['soundStop', c, x, y, file];
  run('RUN-S-014', ['S-07'], 'sound', 'a wormhole to a chain the pack does not have moves to its last chain',
    pack({ keySound: lines('1 1 1 a.wav 1 9', '2 1 1 b.wav') }),
    [press(0, 0), release(0, 0), advance(200), observe, press(0, 0), release(0, 0), observe],
    [[snd(0, 0, 0, 'a.wav'), ['chain', 1]], [snd(1, 0, 0, 'b.wav')]],
    [intent('unipad-android ChainObserver.kt, unipad-ios ChainObserver.swift, unipad.io useUniPadEngine.ts setChain', 'the chain is clamped to 0..chain-1 instead of being ignored')]);
  run('RUN-S-007', ['A-06'], 'sound', 'a sound that cannot be decoded is silent, and its queue and wormhole go on',
    pack({ keySound: lines('1 1 1 bad.wav', '1 1 1 a.wav', '1 2 1 bad.wav 1 2', '2 1 1 b.wav'), sounds: ['a.wav', 'b.wav', 'bad.wav'] }),
    [press(0, 0), release(0, 0), observe, press(0, 0), release(0, 0), observe, press(1, 0), release(1, 0), advance(200), observe, press(0, 0), release(0, 0), observe],
    [[], [snd(0, 0, 0, 'a.wav')], [['chain', 1]], [snd(1, 0, 0, 'b.wav')]],
    [G1('A-06', 'Only the slot of the sound that cannot be decoded is silent: the pad\'s queue moves on to the next sound (S-09) and the sound\'s wormhole still applies (S-06), as the author wrote them.')]);
  run('RUN-S-008', ['RS-05'], 'sound', 'a release stops only the endless sound its own press started',
    pack({ keySound: lines('1 1 1 a.wav 0', '1 1 1 b.wav', '1 2 1 c.wav', '1 2 1 a.wav 0') }),
    [watchStops, press(0, 0), observe, release(0, 0), observe, press(0, 0), release(0, 0), observe, press(1, 0), release(1, 0), observe],
    [[snd(0, 0, 0, 'a.wav', -1)], [stopped(0, 0, 0, 'a.wav')], [snd(0, 0, 0, 'b.wav')], [snd(0, 1, 0, 'c.wav')]],
    [intent('unipad-android SoundRunner.kt soundOff, unipad-ios SoundEngine.swift soundOff, unipad.io SoundEngine.ts heldNodes', 'a release stops the endless sound its press started; a sound played once or N times plays to its end')]);
  run('RUN-S-009', ['RS-06'], 'sound', 'a release after the chain changed still stops the endless sound its press started',
    pack({ keySound: lines('1 1 1 a.wav 0', '2 1 1 b.wav') }),
    [watchStops, press(0, 0), observe, pickChain(1), release(0, 0), observe],
    [[snd(0, 0, 0, 'a.wav', -1)], [stopped(0, 0, 0, 'a.wav')]],
    [intent('unipad-ios SoundEngine.swift soundOff, unipad.io SoundEngine.ts heldNodes', 'the press owns the voice it started, whatever the chain is at the release')]);
  run('RUN-S-010', ['RS-07'], 'sound', 'pressing a pad again stops its previous sound, another pad\'s sound plays on',
    pack({ keySound: lines('1 1 1 a.wav', '1 1 1 b.wav', '1 2 1 c.wav') }),
    [watchStops, press(0, 0), release(0, 0), press(1, 0), release(1, 0), observe, press(0, 0), release(0, 0), observe],
    [[snd(0, 0, 0, 'a.wav'), snd(0, 1, 0, 'c.wav')], [stopped(0, 0, 0, 'a.wav'), snd(0, 0, 0, 'b.wav')]],
    [intent('unipad-android SoundRunner.kt soundOn, unipad-ios SoundEngine.swift soundOn, unipad.io SoundEngine.ts soundOn', 'a press first stops the voice the pad started last')]);
  run('RUN-S-011', ['RS-09'], 'sound', 'a wormhole switches the chain 100 ms after the press, not when the sound ends',
    pack({ keySound: lines('1 1 1 a.wav 1 2', '2 1 1 b.wav') }),
    [press(0, 0), release(0, 0), advance(50), observe, advance(100), observe],
    [[snd(0, 0, 0, 'a.wav')], [['chain', 1]]],
    [G1('RS-09', 'The three apps switch 100 ms after the press; the docs\' "after playback" is corrected. The 10 ms sound has ended long before.')]);
  const RESET = G1('RS-10', 'Every change of chain, even to the same chain, sets the queues of every pad of that chain back to their first sound and light, as the three play screens do.');
  run('RUN-S-012', ['RS-10'], 'sound', 'picking the same chain again sets the pad back to its first sound and light',
    pack({ keySound: lines('1 1 1 a.wav', '1 1 1 b.wav'), keyLed: { '1 1 1': lines('o 1 1 FF0000', 'd 20', 'f 1 1'), '1 1 1 1': lines('o 1 1 00FF00', 'd 20', 'f 1 1') } }),
    [press(0, 0), release(0, 0), advance(40), observe, pickChain(0), press(0, 0), release(0, 0), advance(40), observe],
    [[snd(0, 0, 0, 'a.wav'), ['ledOn', 0, 0, RED, 4], ['ledOff', 0, 0]], [snd(0, 0, 0, 'a.wav'), ['ledOn', 0, 0, RED, 4], ['ledOff', 0, 0]]],
    [RESET, VEL4]);
  run('RUN-S-013', ['RS-10'], 'sound', 'a wormhole into a chain sets its pads back to their first sound',
    pack({ keySound: lines('1 1 1 a.wav 1 2', '2 1 1 b.wav', '2 1 1 c.wav') }),
    [pickChain(1), press(0, 0), release(0, 0), observe, pickChain(0), press(0, 0), release(0, 0), advance(200), observe, press(0, 0), release(0, 0), observe],
    [[snd(1, 0, 0, 'b.wav')], [snd(0, 0, 0, 'a.wav'), ['chain', 1]], [snd(1, 0, 0, 'b.wav')]],
    [RESET]);
  run('RUN-S-006', ['S-12'], 'sound', 'a pad whose sound name differs from its file only in case plays that file',
    pack({ keySound: lines('1 1 1 End.wav', '1 1 2 FX/S.wav'), sounds: ['END.wav', 'fx/s.wav'] }),
    [press(0, 0), release(0, 0), press(0, 1), release(0, 1), observe],
    [[snd(0, 0, 0, 'END.wav'), snd(0, 0, 1, 'fx/s.wav')]],
    SOUND_CASE);

  const ledPack = (name, content, keySound = OTHER_PAD_SOUND) => pack({ keySound, keyLed: { [name]: content } });
  run('RUN-L-001', ['RL-01'], 'led', 'a one-shot animation lights, waits and turns off',
    ledPack('1 1 1', lines('o 1 1 FF0000', 'd 100', 'f 1 1')),
    [press(0, 0), advance(50), observe, advance(100), observe, advance(200), observe],
    [[['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], []],
    [doc('key-led.mdx', 'Full Example: on, delay, off'), VEL4]);
  run('RUN-L-002', ['RL-02'], 'led', 'loop 2 plays the animation twice and then stays dark',
    ledPack('1 1 1 2', lines('o 1 1 FF0000', 'd 40', 'f 1 1', 'd 40')),
    [press(0, 0), advance(20), observe, advance(40), observe, advance(40), observe, advance(40), observe, advance(400), observe],
    [[['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], [['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], []],
    [doc('key-led.mdx', 'loop: repeat count (default: 1, 0 = infinite loop); "1 2 3 2" repeats 2 times')]);
  run('RUN-L-003', ['RL-03'], 'led', 'releasing the pad turns an endless animation off at once',
    ledPack('1 1 1 0', lines('o 1 1 FF0000', 'd 40', 'f 1 1', 'd 40')),
    [press(0, 0), advance(20), observe, release(0, 0), advance(12), observe, advance(400), observe],
    [[['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], []],
    [doc('key-led.mdx', 'loop 0 = infinite loop'), intent('unipad.io LedRunner.test.ts "turns a looping animation off on release and stays dark", unipad-android LedRunnerToggleTest', 'an endless animation ends when the pad is released')]);
  run('RUN-L-004', ['RL-05'], 'led', 'a chain event inside an animation switches the chain between the lights',
    ledPack('1 1 1', lines('o 1 1 FF0000', 'd 40', 'c 2', 'd 40', 'f 1 1')),
    [press(0, 0), advance(20), observe, advance(40), observe, advance(60), observe],
    [[['ledOn', 0, 0, RED, 4]], [['chain', 1]], [['ledOff', 0, 0]]],
    [doc('key-led.mdx', 'chain: switches chains during LED sequence execution')]);
  run('RUN-L-005', ['RL-06'], 'led', 'the logo LED lights and turns off on time',
    ledPack('1 1 1', lines('o l FF0000', 'd 40', 'f l')),
    [press(0, 0), advance(20), observe, advance(60), observe],
    [[['ledOn', -1, 32, RED, 4]], [['ledOff', -1, 32]]],
    [LOGO]);
  run('RUN-L-006', ['RL-08'], 'led', 'leaving the screen turns lit pad LEDs off and nothing follows',
    ledPack('1 1 1 0', lines('o 1 1 FF0000', 'd 40', 'f 1 1', 'd 40')),
    [press(0, 0), advance(20), observe, { do: 'stop' }, observe, advance(400), observe],
    [[['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], []],
    [intent('unipad-android 3e5a2fd6 (#101), unipad.io 8019666 (#32)', 'LEDs still lit are cleared on exit and no stale light is sent afterwards')]);
  run('RUN-L-007', ['RL-07', 'RL-08'], 'led', 'leaving the screen turns a lit round LED off and nothing follows',
    ledPack('1 1 1 0', lines('o * 1 00FF00', 'd 40', 'f * 1', 'd 40')),
    [press(0, 0), advance(20), observe, { do: 'stop' }, observe, advance(400), observe],
    [[['ledOn', -1, 0, GREEN, 4]], [['ledOff', -1, 0]], []],
    [intent('unipad-android 3e5a2fd6 (#101), unipad.io 8019666 (#32)', 'LEDs still lit are cleared on exit and no stale light is sent afterwards')]);
  run('RUN-L-008', ['RL-09'], 'led', 'pressing a pad again while its animation plays restarts it after an off',
    ledPack('1 1 1 0', lines('o 1 1 FF0000', 'd 40', 'f 1 1', 'd 40')),
    [press(0, 0), advance(20), observe, release(0, 0), press(0, 0), advance(20), observe],
    [[['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0], ['ledOn', 0, 0, RED, 4]]],
    [AGREED('Whether a re-press restarts the lights with an off in between, or without, is not stated; all three runners send the off first.')]);
  run('RUN-L-009', ['E-09'], 'led', 'delay 0 does not wait and a negative delay never brings an event before the one above it',
    ledPack('1 1 1', lines('o 1 1 FF0000', 'd 0', 'o 2 1 00FF00', 'd 100', 'd -60', 'f 1 1', 'f 2 1')),
    [press(0, 0), advance(20), observe, advance(40), observe, advance(100), observe],
    [[['ledOn', 0, 0, RED, 4], ['ledOn', 1, 0, GREEN, 4]], [], [['ledOff', 0, 0], ['ledOff', 1, 0]]],
    [doc('key-led.mdx', 'Waits the specified milliseconds before the next event'), VEL4]);
  run('RUN-L-014', ['E-09'], 'led', 'negative delays shorten later waits without moving an event before the one above it',
    ledPack('1 1 1', lines('o 1 1 FF0000', 'd 100', 'd -60', 'f 1 1', 'd 100', 'o 2 1 00FF00', 'd 100', 'd -150', 'o 3 1 0000FF', 'd 100', 'o 4 1 FF0000')),
    [press(0, 0), advance(20), observe, advance(100), observe, advance(40), observe, advance(100), observe, advance(140), observe],
    [[['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], [['ledOn', 1, 0, GREEN, 4]], [['ledOn', 2, 0, 'ff0000ff', 4], ['ledOn', 3, 0, RED, 4]], []],
    [doc('key-led.mdx', 'Waits the specified milliseconds before the next event'), VEL4]);
  run('RUN-L-010', ['RL-04'], 'led', 'an animation played once or twice plays to its end after the pad is released',
    pack({ keySound: OTHER_PAD_SOUND, keyLed: { '1 1 1': lines('o 1 1 FF0000', 'd 40', 'f 1 1'), '1 1 2 2': lines('o 1 2 00FF00', 'd 40', 'f 1 2', 'd 40') } }),
    [press(0, 0), release(0, 0), press(0, 1), release(0, 1), advance(20), observe, advance(40), observe, advance(40), observe, advance(40), observe, advance(400), observe],
    [[['ledOn', 0, 0, RED, 4], ['ledOn', 0, 1, GREEN, 4]], [['ledOff', 0, 0], ['ledOff', 0, 1]], [['ledOn', 0, 1, GREEN, 4]], [['ledOff', 0, 1]], []],
    [intent('unipad-android LedRunner.kt, unipad-ios LedRunner.swift, unipad.io LedRunner.ts eventOff', 'a release ends an endless animation only'), VEL4]);
  run('RUN-L-011', ['RL-10'], 'led', 'two animations on one pad play in turn, one per press',
    pack({ keySound: OTHER_PAD_SOUND, keyLed: { '1 1 1': lines('o 1 1 FF0000', 'd 20', 'f 1 1'), '1 1 1 1': lines('o 1 1 00FF00', 'd 20', 'f 1 1') } }),
    [press(0, 0), release(0, 0), advance(40), observe, press(0, 0), release(0, 0), advance(40), observe, press(0, 0), release(0, 0), advance(40), observe],
    [[['ledOn', 0, 0, RED, 4], ['ledOff', 0, 0]], [['ledOn', 0, 0, GREEN, 4], ['ledOff', 0, 0]], [['ledOn', 0, 0, RED, 4], ['ledOff', 0, 0]]],
    [doc('key-led.mdx', 'Mapping multiple files to the same coordinate creates a circular queue, just like keySound'), VEL4]);
  run('RUN-L-012', ['RL-11'], 'led', 'the later of two animations owns a light, and the other one\'s off leaves it lit',
    pack({ keySound: OTHER_PAD_SOUND, keyLed: { '1 1 1': lines('o 3 3 FF0000', 'd 100', 'f 3 3'), '1 1 2': lines('o 3 3 00FF00', 'd 200', 'f 3 3') } }),
    [press(0, 0), release(0, 0), advance(20), observe, advance(20), press(0, 1), release(0, 1), advance(20), observe, advance(80), observe, advance(140), observe],
    [[['ledOn', 2, 2, RED, 4]], [['ledOn', 2, 2, GREEN, 4]], [], [['ledOff', 2, 2]]],
    [intent('unipad-android LedRunner.kt, unipad-ios LedRunner.swift, unipad.io LedRunner.ts', 'each light remembers the animation that lit it last, and an off of another animation leaves it'), VEL4]);
  run('RUN-L-013', ['RL-12'], 'led', 'an event outside the pad grid is skipped and the rest of the file plays',
    ledPack('1 1 1', lines('o 9 9 FF0000', 'o 1 1 00FF00', 'd 40', 'f 9 9', 'f 1 1')),
    [press(0, 0), advance(20), observe, advance(40), observe],
    [[['ledOn', 0, 0, GREEN, 4]], [['ledOff', 0, 0]]],
    [G1('RL-12', 'A light event outside the pad grid is kept when the file is read (E-14) and skipped when it is lit; the other events of the file come out as written.'), VEL4]);

  run('RUN-L-015', ['E-05', 'RL-12'], 'led', 'zero columns light the first and last round buttons while invalid zero coordinates stay dark',
    ledPack('1 1 1', lines('on 0 1 FF0000', 'o 0 32 00FF00', 'o 8 0 FF0000', 'o 0 0 FF0000', 'o 0 37 FF0000', 'd 40', 'off 0 1', 'f 0 32', 'f 8 0', 'f 0 0', 'f 0 37')),
    [press(0, 0), advance(20), observe, advance(40), observe],
    [[['ledOn', -1, 0, RED, 4], ['ledOn', -1, 31, GREEN, 4]], [['ledOff', -1, 0], ['ledOff', -1, 31]]],
    [intent('Android LedRunner and iOS LedRunner', 'A numeric zero column uses the circular light table; a zero row alone stays outside the pad table. Both reject indices outside their 36 circular slots.'), VEL4]);

  const autoFiles = pack({ keySound: lines('1 1 1 a.wav', '2 1 1 b.wav'), autoPlay: lines('on 1 1', 'delay 100', 'off 1 1', 'delay 100', 'touch 2 1') });
  run('RUN-A-001', ['RA-01'], 'autoPlay', 'autoPlay presses and releases on its delays',
    autoFiles,
    [{ do: 'autoplay' }, advance(50), observe, advance(100), observe, advance(100), observe, advance(400), observe],
    [[['autoOn', 0, 0]], [['autoOff', 0, 0]], [['autoOn', 1, 0], ['autoOff', 1, 0]], []],
    [doc('auto-play.mdx', 'Events are executed sequentially from top to bottom; delay waits in milliseconds')]);
  run('RUN-A-002', ['RA-03'], 'autoPlay', 'leaving the screen stops autoPlay and nothing follows',
    autoFiles,
    [{ do: 'autoplay' }, advance(50), observe, { do: 'stop' }, advance(400), observe],
    [[['autoOn', 0, 0]], []],
    [intent('unipad-android ce6af172 (#86), unipad.io AutoPlayRunner.stop', 'a stopped runner sends no more presses')]);
  run('RUN-A-003', ['RA-04', 'RA-02'], 'autoPlay', 'autoPlay plays the queue number it read, after a hand press and after its chain',
    pack({ keySound: lines('1 1 1 a.wav', '1 1 1 b.wav', '1 1 1 c.wav', '2 1 1 b.wav'), autoPlay: lines('on 1 1', 'd 40', 'off 1 1', 'd 60', 'on 1 1', 'd 40', 'off 1 1', 'd 60', 'chain 2', 'on 1 1', 'd 40', 'off 1 1') }),
    [{ do: 'autoplay', toPads: true }, advance(20), observe, press(0, 0), release(0, 0), observe, advance(40), observe, advance(60), observe, advance(40), observe, advance(60), observe, advance(40), observe, advance(400), observe],
    [[['autoOn', 0, 0], snd(0, 0, 0, 'a.wav')], [snd(0, 0, 0, 'b.wav')], [['autoOff', 0, 0]], [['autoOn', 0, 0], snd(0, 0, 0, 'b.wav')], [['autoOff', 0, 0]], [['autoChain', 1], ['autoOn', 0, 0], snd(1, 0, 0, 'b.wav')], [['autoOff', 0, 0]], []],
    [doc('auto-play.mdx', 'each on plays the sound its queue number names, counted when the file is read; chain switches the chain and resets the counters')]);

  // ---------------------------------------------------------------------------------------------
  // shapes common in real packs: an 8 x 8 grid, five-part keyLED names, MP3 sounds, looping lights
  // under autoPlay, and a pack that is not square
  // ---------------------------------------------------------------------------------------------
  const GRID_8 = lines('title=Conformance', 'producerName=UniPad Conformance', 'buttonX=8', 'buttonY=8', 'chain=1', 'squareButton=true');
  add({
    id: 'RP-001', items: ['S-01', 'L-01', 'P-01'], area: 'realPack', title: 'an 8 x 8 pack maps sounds, lights and autoPlay to its first and last pad',
    files: pack({
      info: GRID_8,
      keySound: lines('1 1 1 a.wav', '1 8 8 b.wav'),
      sounds: ['a.wav', 'b.wav'],
      keyLed: { '1 1 1': 'o 1 1 FF0000', '1 8 8': 'o 8 8 00FF00' },
      autoPlay: lines('on 1 1', 'on 8 8', 'delay 10', 'off 8 8'),
    }),
    expected: loaded({
      info: { buttonX: 8, buttonY: 8, chain: 1 },
      sounds: [cell(0, 0, 0, [q('a.wav')]), cell(0, 7, 7, [q('b.wav')])],
      keyLedExist: true,
      leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000')])]), ledCell(0, 7, 7, [anim(1, [ev.on(7, 7, 'ff00ff00')])])],
      autoPlay: [ap.on(0, 0, 0, 0), ap.on(7, 7, 0, 0), ap.delay(10), ap.off(7, 7, 0)],
    }),
    basis: [
      doc('info.mdx', 'Example: buttonX=8, buttonY=8'),
      doc('key-sound.mdx', 'x 1 ~ buttonX, y 1 ~ buttonY'),
      doc('key-led.mdx', 'x 1 ~ buttonX, y 1 ~ buttonY; loop default 1'),
      doc('auto-play.mdx', 'Commands: on, off, delay'),
      VEL4,
    ],
  });
  add({
    id: 'RP-002', items: ['L-06'], area: 'realPack', title: 'two keyLED files for one pad whose names have a fifth part',
    ...led({ '1 1 1 1 a': 'o 1 1 FF0000', '1 1 1 1 b': 'o 1 1 00FF00' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000')]), anim(1, [ev.on(0, 0, 'ff00ff00')])])] }),
    basis: [AGREED('key-led.mdx names a file "chain x y [loop]" and gives a fifth part no meaning, yet packs made by other tools name several files for one pad this way. All three read both files and queue them in name order (KL-004 states the order only for names that are mappings).'), VEL4],
  });
  add({
    id: 'RP-003', items: ['S-01', 'S-05', 'S-06'], area: 'realPack', title: 'an MP3 sound keeps its file, coordinate, loop and wormhole',
    files: pack({ keySound: '1 2 3 a.mp3 2 2', sounds: ['a.mp3'] }),
    expected: loaded({ sounds: [cell(0, 1, 2, [q('a.mp3', 1, 1)])] }),
    basis: [doc('sounds.mdx', 'Supported Formats: MP3 Supported'), doc('key-sound.mdx', 'chain x y soundFile [loop] [wormhole]; Loop Values')],
  });
  add({
    id: 'RP-004', items: ['I-09'], area: 'realPack', title: 'squareButton=false on a 4 x 3 pack',
    files: pack({ info: STD_INFO.replace('squareButton=true', 'squareButton=false') }),
    expected: loaded({ info: { squareButton: false }, sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [doc('info.mdx', 'Properties table: squareButton is on only for the exact value `true`; `false`, `True` or `1` turns it off')],
  });

  run('RUN-RP-001', ['RS-01', 'RL-01'], 'realPack', 'on an 8 x 8 pack the last pad plays its sound and lights',
    pack({ info: GRID_8, keySound: '1 8 8 a.wav', sounds: ['a.wav'], keyLed: { '1 8 8': lines('o 8 8 FF0000', 'd 100', 'f 8 8') } }),
    [press(7, 7), advance(50), observe, release(7, 7), advance(100), observe, advance(200), observe],
    [[snd(0, 7, 7, 'a.wav'), ['ledOn', 7, 7, RED, 4]], [['ledOff', 7, 7]], []],
    [doc('key-sound.mdx', 'x 1 ~ buttonX, y 1 ~ buttonY'), doc('key-led.mdx', 'x 1 ~ buttonX, y 1 ~ buttonY; Full Example: on, delay, off'), VEL4]);
  run('RUN-RP-002', ['A-02'], 'realPack', 'pressing a pad mapped to an MP3 starts that sound',
    pack({ keySound: '1 1 1 a.mp3', sounds: ['a.mp3'] }),
    [press(0, 0), release(0, 0), observe],
    [[snd(0, 0, 0, 'a.mp3')]],
    [doc('sounds.mdx', 'Supported Formats: MP3 Supported'), doc('key-sound.mdx', 'chain x y soundFile')]);

  // autoPlay with `toPads`: its presses and releases reach the sound engine and the LED runner the way
  // the play screens forward them (Android PlayActivityViewModel, web useUniPadEngine).
  const autoToPads = { do: 'autoplay', toPads: true };
  run('RUN-RP-003', ['RA-02', 'RL-02'], 'realPack', 'autoPlay pressing a pad whose light repeats twice',
    pack({ keySound: '1 1 1 a.wav', sounds: ['a.wav'], keyLed: { '1 1 1 2': lines('o 1 1 FF0000', 'd 40', 'f 1 1', 'd 40') }, autoPlay: lines('on 1 1', 'delay 300', 'off 1 1') }),
    [autoToPads, advance(20), observe, advance(40), observe, advance(40), observe, advance(40), observe, advance(240), observe, advance(400), observe],
    [[['autoOn', 0, 0], snd(0, 0, 0, 'a.wav'), ['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], [['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], [['autoOff', 0, 0]], []],
    [doc('key-led.mdx', 'loop: repeat count; "1 2 3 2" repeats 2 times'), doc('auto-play.mdx', 'Events are executed sequentially from top to bottom; delay waits in milliseconds'), VEL4]);
  run('RUN-RP-004', ['RA-02', 'RL-03', 'RL-08', 'RA-03'], 'realPack', 'autoPlay releasing a pad whose light loops endlessly, then leaving the screen',
    pack({ keySound: '1 1 1 a.wav', sounds: ['a.wav'], keyLed: { '1 1 1 0': lines('o 1 1 FF0000', 'd 80', 'f 1 1', 'd 80') }, autoPlay: lines('on 1 1', 'delay 200', 'off 1 1') }),
    [autoToPads, advance(20), observe, advance(90), observe, advance(75), observe, advance(40), observe, { do: 'stop' }, observe, advance(400), observe],
    [[['autoOn', 0, 0], snd(0, 0, 0, 'a.wav'), ['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], [['ledOn', 0, 0, RED, 4]], [['autoOff', 0, 0], ['ledOff', 0, 0]], [], []],
    [
      doc('key-led.mdx', 'loop 0 = infinite loop'),
      doc('auto-play.mdx', 'Events are executed sequentially from top to bottom; delay waits in milliseconds'),
      intent('unipad.io LedRunner.test.ts "turns a looping animation off on release and stays dark", unipad-android LedRunnerToggleTest', 'an endless animation ends when the pad is released (RUN-L-003)'),
      intent('unipad-android 3e5a2fd6 (#101), ce6af172 (#86), unipad.io 8019666 (#32), AutoPlayRunner.stop', 'after leaving the screen no light and no press follows (RUN-L-006, RUN-A-002)'),
      VEL4,
    ]);
  run('RUN-RP-005', ['RS-05', 'RA-02'], 'realPack', 'turning autoPlay off releases the endless sound it held, not the one the user holds',
    pack({ keySound: lines('1 1 1 a.wav 0', '1 2 1 a.wav 0'), sounds: ['a.wav'], autoPlay: lines('on 1 1', 'delay 300', 'off 1 1') }),
    [press(1, 0), autoToPads, advance(20), looping, observe, { do: 'autoplayOff' }, looping, observe, advance(400), observe, release(1, 0), looping, observe],
    [[snd(0, 1, 0, 'a.wav', -1), ['autoOn', 0, 0], snd(0, 0, 0, 'a.wav', -1), ['looping', 0, 0], ['looping', 1, 0]], [['looping', 1, 0]], [], []],
    [
      doc('key-sound.mdx', 'Loop Values: 0 loops indefinitely'),
      intent('unipad.io LedRunner.test.ts "turns a looping animation off on release and stays dark", unipad-android LedRunnerToggleTest', 'an endless loop lasts while its pad is held and ends when the pad is released (RUN-L-003)'),
      intent('unipad.io src/lib/unipack/PlayerHolds.test.ts', 'a pad autoPlay holds counts as released when autoPlay is turned off, as any input that goes away counts as a release, so its endless sound stops; a pad the user still holds keeps sounding until the user lets go'),
    ]);

  return [...cases, ...g6Cases()];
}
