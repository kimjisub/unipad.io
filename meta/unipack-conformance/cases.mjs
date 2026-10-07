// The case list. Each case is one small pack (input files) with the result every platform is expected
// to produce. Expected results come from the format docs (content/docs/en/unipack) and from intent
// stated in the platforms' own commit history and tests, never from what the three parsers happen to
// return. Where neither says what should happen the case is `undetermined`: the platforms still run it
// and the observed results are printed, but it can only ever be reported as unverified.
import { ap, anim, cell, doc, ev, intent, ledCell, lines, loaded, pack, q, reference, refused, STD_INFO } from './lib.mjs';

const ANDROID_PARITY = intent('unipad-android 2298d635 (#63), unipad-ios 17b1ecc (#6), unipad.io 5721b4c', 'parsers were aligned to Android\'s strictness on purpose: a line Android rejects is rejected everywhere');
const WHITESPACE = intent('unipad-android 22a45925', 'parser whitespace and line-break tolerance for packs written by other tools (Unitor)');
const VEL4 = intent('unipad.io src/lib/unipack/logoLed.test.ts, unipad-android UniPackFolderLogoLedTest', 'a hex-only `on` line carries velocity 4; the docs do not state the default');
const LOGO = intent('unipad-ios #10, unipad-android #114, unipad.io #32', 'keyLED `l` lines address the logo as circle index 32 in every platform (the docs still say "not supported, ignored")');
const ROUND = intent('unipad-android UniPackFolderLogoLedTest, unipad.io logoLed.test.ts', '`mc`/`*` numbers outside 1..32 are dropped so that index 32 never lights the logo');

// Why the iOS harness reports a case as unverified instead of a result (`unobserved`).
const IOS_EXIT = 'Leaving the play screen is a screen-level step on iOS: the main screen clears the Launchpad when it takes the MIDI controller back (MainView onChange -> MainViewModel.setupMidiController -> MainMidiControllerAdapter.onAttach -> sendClearLed) and the on-screen pads go away with the play view. The iOS harness drives the runners alone, where LedRunner.stop() only cancels the loop, so what a user sees after leaving is not measured. Not checked on a real Launchpad either.';
const IOS_WALL_CLOCK = 'The iOS AutoPlayRunner reads the wall clock and sleeps in real time (currentTimeMillis, Task.sleep), so a scenario cannot be driven on a virtual clock without a product change.';

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
    id: 'INF-001', area: 'info', title: 'every key of a complete info file',
    files: pack({ info: lines('title=Conformance Pack', 'producerName=UniPad Conformance', 'buttonX=4', 'buttonY=3', 'chain=2', 'squareButton=true', 'website=https://unipad.io') }),
    expected: loaded({ info: { title: 'Conformance Pack', website: 'https://unipad.io' }, sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [doc('info.mdx', 'Properties table')],
  });
  add({
    id: 'INF-002', area: 'info', title: 'chain 24 is the largest accepted chain count',
    files: pack({ info: STD_INFO.replace('chain=2', 'chain=24'), keySound: '24 1 1 a.wav' }),
    expected: loaded({ info: { chain: 24 }, sounds: [cell(23, 0, 0, [q('a.wav')])] }),
    basis: [doc('info.mdx', 'chain 1~24')],
  });
  add({
    id: 'INF-003', area: 'info', title: 'chain 25 aborts loading',
    files: pack({ info: STD_INFO.replace('chain=2', 'chain=25') }),
    expected: refused(),
    basis: [doc('info.mdx', 'Loading is aborted if chain is outside the 1~24 range')],
  });
  add({
    id: 'INF-004', area: 'info', title: 'chain 0 aborts loading',
    files: pack({ info: STD_INFO.replace('chain=2', 'chain=0') }),
    expected: refused(),
    basis: [doc('info.mdx', 'Loading is aborted if chain is outside the 1~24 range')],
  });
  add({
    id: 'INF-005', area: 'info', title: 'a chain that is not a number aborts loading',
    files: pack({ info: STD_INFO.replace('chain=2', 'chain=abc') }),
    expected: refused(),
    basis: [doc('info.mdx', 'chain must be within 1~24; "abc" is not, and the chain count stays 0')],
  });
  add({
    id: 'INF-006', area: 'info', title: 'blank lines, spaces around = and unknown keys are ignored',
    files: pack({ info: lines('', '  title = Spaced Title  ', 'producerName=UniPad Conformance', '', 'buttonX = 4', 'buttonY=3 ', ' chain=2', 'squareButton=true', 'PackTool=SomeEditor 1.0', '   ') }),
    expected: loaded({ info: { title: 'Spaced Title' }, sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [doc('info.mdx', 'leading/trailing whitespace is ignored'), intent('unipad-android UniPackFolderMissingFileTest createStorePack', 'store packs carry extra info keys such as PackTool and must open')],
  });
  add({
    id: 'INF-007', area: 'info', title: 'a line without = in info', expectation: 'undetermined',
    files: pack({ info: lines('title=Conformance', 'producerName=UniPad Conformance', 'this line has no equals sign', 'buttonX=4', 'buttonY=3', 'chain=2', 'squareButton=true') }),
    question: 'The docs say lines are key=value but not what a line without = does. Android and iOS record a warning, the web parser ignores it silently.',
  });
  add({
    id: 'INF-008', area: 'info', title: 'title and producerName missing only warn',
    files: pack({ info: lines('buttonX=4', 'buttonY=3', 'chain=2', 'squareButton=true') }),
    expected: loaded({ info: { title: '', producerName: '' }, sounds: [cell(0, 0, 0, [q('a.wav')])], errors: ['info:missing-field', 'info:missing-field'] }),
    basis: [doc('info.mdx', 'A warning is raised if title or producerName is empty')],
  });
  add({
    id: 'INF-009', area: 'info', title: 'buttonX 0 warns and leaves every keySound x out of range',
    files: pack({ info: STD_INFO.replace('buttonX=4', 'buttonX=0') }),
    expected: loaded({ info: { buttonX: 0 }, errors: ['info:missing-field', 'keySound:range'] }),
    basis: [doc('info.mdx', 'A warning is raised if buttonX, buttonY, or chain is 0'), doc('key-sound.mdx', 'Lines with out-of-range coordinates are skipped with a warning')],
  });
  add({
    id: 'INF-010', area: 'info', title: 'buttonX that is not a number', expectation: 'undetermined',
    files: pack({ info: STD_INFO.replace('buttonX=4', 'buttonX=abc') }),
    question: 'The docs say only "1 or more". Whether "abc" is a warning (treated as 0) or a refusal is not stated.',
  });
  add({
    id: 'INF-011', area: 'info', title: 'a 65 x 65 grid', expectation: 'undetermined',
    files: pack({ info: STD_INFO.replace('buttonX=4', 'buttonX=65').replace('buttonY=3', 'buttonY=65') }),
    question: 'All three parsers refuse a grid above 64, an allocation guard that is not in the docs ("1 or more").',
  });
  add({
    id: 'INF-012', area: 'info', title: 'squareButton left out', expectation: 'undetermined',
    files: pack({ info: lines('title=Conformance', 'producerName=UniPad Conformance', 'buttonX=4', 'buttonY=3', 'chain=2') }),
    question: 'The docs say the default is false; Android, iOS and the web parser all start from true.',
  });
  add({
    id: 'INF-013', area: 'info', title: 'no info file refuses the pack',
    files: pack({ info: null }),
    expected: refused(),
    basis: [doc('info.mdx', 'every key is required except squareButton and website'), intent('UniPackFolder.kt / UniPackFolder.swift / parser.ts', 'a pack without info is a critical error on every platform')],
  });
  add({
    id: 'INF-014', area: 'info', title: 'no keySound file refuses the pack',
    files: pack({ keySound: null }),
    expected: refused(),
    basis: [doc('key-sound.mdx', 'The keySound file maps sound files to each button'), intent('UniPackFolder.kt / UniPackFolder.swift / parser.ts', 'a pack without keySound is a critical error on every platform')],
  });
  add({
    id: 'INF-015', area: 'info', title: 'info.json instead of info', expectation: 'undetermined',
    files: pack({ info: null, extra: [{ path: 'info.json', text: '{"title":"Conformance","producerName":"UniPad Conformance","buttonX":4,"buttonY":3,"chain":2,"squareButton":true}' }] }),
    question: 'Only iOS reads info.json; the format docs describe the key=value `info` file only.',
  });

  // ---------------------------------------------------------------------------------------------
  // keySound
  // ---------------------------------------------------------------------------------------------
  add({
    id: 'KS-001', area: 'keySound', title: 'first and last chain, x and y are accepted',
    files: pack({ keySound: lines('1 1 1 a.wav', '2 4 3 b.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(1, 3, 2, [q('b.wav')])] }),
    basis: [doc('key-sound.mdx', 'chain 1 ~ chain, x 1 ~ buttonX, y 1 ~ buttonY')],
  });
  add({
    id: 'KS-002', area: 'keySound', title: 'one past each end of chain, x and y is skipped with a warning',
    files: pack({ keySound: lines('0 1 1 a.wav', '3 1 1 a.wav', '1 0 1 a.wav', '1 5 1 a.wav', '1 1 0 a.wav', '1 1 4 a.wav') }),
    expected: loaded({ errors: Array(6).fill('keySound:range') }),
    basis: [doc('key-sound.mdx', 'Lines with out-of-range coordinates are skipped with a warning')],
  });
  add({
    id: 'KS-003', area: 'keySound', title: 'loop and wormhole are stored minus one',
    files: pack({ keySound: lines('1 1 1 a.wav 0', '1 1 2 a.wav 1 2', '1 1 3 a.wav 3', '1 2 1 a.wav 2 1') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav', -1)]), cell(0, 0, 1, [q('a.wav', 0, 1)]), cell(0, 0, 2, [q('a.wav', 2)]), cell(0, 1, 0, [q('a.wav', 1, 0)])] }),
    basis: [doc('key-sound.mdx', 'Loop Values: the loop value is internally stored with 1 subtracted; wormhole is a chain number')],
  });
  add({
    id: 'KS-004', area: 'keySound', title: 'sounds on one pad form a queue in file order',
    files: pack({ keySound: lines('1 1 1 a.wav', '1 1 1 b.wav', '1 1 1 c.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav'), q('b.wav'), q('c.wav')])] }),
    basis: [doc('key-sound.mdx', 'Circular Queue (Multi-mapping)')],
  });
  add({
    id: 'KS-005', area: 'keySound', title: 'blank lines and lines with fewer than 3 columns are ignored',
    files: pack({ keySound: ['', '   ', '1 1', '1', '1 1 1 a.wav', ''].join('\n') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [doc('key-sound.mdx', 'Empty lines and lines with fewer than 3 columns are ignored')],
  });
  add({
    id: 'KS-006', area: 'keySound', title: 'three columns without a sound file is an error, not an ignored line',
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
      id: `KS-${n}`, area: 'keySound', title: `malformed number: ${what}`,
      files: pack({ keySound: lines(bad, '1 1 2 b.wav') }),
      expected: loaded({ sounds: [cell(0, 0, 1, [q('b.wav')])], errors: ['keySound:format'] }),
      basis: [ANDROID_PARITY],
    });
  }
  add({
    id: 'KS-009', area: 'keySound', title: 'a sound file that is not in the pack is a warning',
    files: pack({ keySound: lines('1 1 1 nope.wav', '1 1 2 a.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 1, [q('a.wav')])], errors: ['keySound:missing-file'] }),
    basis: [doc('key-sound.mdx', 'A warning is logged if the referenced sound file is not found in the sounds/ folder')],
  });
  add({
    id: 'KS-010', area: 'keySound', title: 'a pack without a sounds folder warns for every line',
    files: pack({ sounds: [] }),
    expected: loaded({ errors: ['keySound:missing-file'] }),
    basis: [doc('key-sound.mdx', 'A warning is logged if the referenced sound file is not found')],
  });
  add({
    id: 'KS-011', area: 'keySound', title: 'a sound in a sub folder of sounds',
    files: pack({ keySound: '1 1 1 fx/s.wav', sounds: ['fx/s.wav'] }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('fx/s.wav')])] }),
    basis: [doc('sounds.mdx', 'Subdirectories are supported (e.g., fx/sweep.wav)')],
  });
  add({
    id: 'KS-012', area: 'keySound', title: 'runs of spaces and leading or trailing spaces',
    files: pack({ keySound: lines('1   1   1   a.wav   ', '   1 2 1 b.wav') }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(0, 1, 0, [q('b.wav')])] }),
    basis: [WHITESPACE],
  });
  add({
    id: 'KS-013', area: 'keySound', title: 'tab separated columns',
    files: pack({ keySound: '1\t1\t1\ta.wav' }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')])] }),
    basis: [WHITESPACE],
  });
  add({
    id: 'KS-014', area: 'keySound', title: 'CRLF line endings and no final newline',
    files: pack({ keySound: '1 1 1 a.wav\r\n1 1 2 b.wav' }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(0, 0, 1, [q('b.wav')])] }),
    basis: [WHITESPACE],
  });
  add({
    id: 'KS-015', area: 'keySound', title: 'lines that look like comments', expectation: 'undetermined',
    files: pack({ keySound: lines('# note', '// note', '; one two three', '1 1 1 a.wav') }),
    question: 'The format has no comment syntax. Two-token lines fall under "fewer than 3 columns are ignored"; a longer one is a format error.',
  });
  add({
    id: 'KS-016', area: 'keySound', title: 'UTF-8 byte order mark before the first line',
    files: pack({ keySound: '﻿1 1 1 a.wav\n1 1 2 b.wav' }),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(0, 0, 1, [q('b.wav')])] }),
    basis: [intent('unipad-ios UniPackFolder.swift readTextFile, unipad-android UniPackFolder.kt bomAwareReader', 'a BOM from Windows Notepad must not cost the first line')],
  });
  add({
    id: 'KS-017', area: 'keySound', title: 'a lone carriage return between lines', expectation: 'undetermined',
    files: pack({ keySound: '1 1 1 a.wav\r1 1 2 b.wav' }),
    question: 'The docs say nothing about classic-Mac line ends; the web parser splits on them explicitly, the apps rely on their line readers.',
  });
  add({
    id: 'KS-018', area: 'keySound', title: 'a UTF-16 little-endian keySound with a byte order mark', expectation: 'undetermined',
    files: pack({ keySound: { base64: Buffer.from('﻿1 1 1 a.wav\n', 'utf16le').toString('base64') } }),
    question: 'Android and iOS decode UTF-16 by its BOM; the docs and the web parser do not mention it.',
  });

  // ---------------------------------------------------------------------------------------------
  // keyLed: file names
  // ---------------------------------------------------------------------------------------------
  const led = (files, over) => ({ files: pack({ keySound: OTHER_PAD_SOUND, keyLed: files }), ...over });
  add({
    id: 'KL-001', area: 'keyLed', title: 'every event, long and short spelling',
    ...led({ '1 1 1': lines('on 1 1 FF0000', 'o 2 1 00FF00', 'delay 100', 'd 50', 'off 1 1', 'f 2 1', 'chain 2', 'c 1') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000'), ev.on(1, 0, 'ff00ff00'), ev.delay(100), ev.delay(50), ev.off(0, 0), ev.off(1, 0), ev.chain(1), ev.chain(0)])])] }),
    basis: [doc('key-led.mdx', 'Event Syntax: on/o, off/f, delay/d, chain/c'), VEL4],
  });
  add({
    id: 'KL-002', area: 'keyLed', title: 'the loop count in the file name',
    ...led({ '1 1 1 0': 'f 1 1', '1 1 2 2': 'f 1 1', '1 1 3': 'f 1 1' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(0, [ev.off(0, 0)])]), ledCell(0, 0, 1, [anim(2, [ev.off(0, 0)])]), ledCell(0, 0, 2, [anim(1, [ev.off(0, 0)])])] }),
    basis: [doc('key-led.mdx', 'File Naming Convention: loop default 1, 0 = infinite loop')],
  });
  add({
    id: 'KL-003', area: 'keyLed', title: 'file names one past each end of chain, x and y are ignored', expectation: 'undetermined',
    ...led({ '0 1 1': 'f 1 1', '3 1 1': 'f 1 1', '1 5 1': 'f 1 1', '1 1 4': 'f 1 1' }),
    question: 'key-led.mdx says files with out-of-range coordinates in the file name are ignored; whether each ignored file records a warning is not stated. The same warning-evidence rule as KL-M07.',
    basis: [doc('key-led.mdx', 'Files with out-of-range coordinates in the file name are ignored')],
  });
  add({
    id: 'KL-004', area: 'keyLed', title: 'files for one pad queue in file name order',
    ...led({ '1 1 1': 'o 1 1 FF0000', '1 1 1 0': 'o 1 1 00FF00' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000')]), anim(0, [ev.on(0, 0, 'ff00ff00')])])] }),
    basis: [doc('key-led.mdx', 'Mapping multiple files to the same coordinate creates a circular queue'), intent('unipad.io parser.ts (sort comment), unipad-android UniPackFolder.kt', 'the queue follows file name order, lower-cased')],
  });
  add({
    id: 'KL-005', area: 'keyLed', title: 'a negative loop count in the file name', expectation: 'undetermined',
    ...led({ '1 1 1 -1': 'f 1 1' }),
    question: 'The docs say a warning is logged; whether the file is dropped is not stated.',
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
      id: `KL-${n}`, area: 'keyLed', title: `file name with a malformed number: ${what}`,
      ...led({ [name]: 'f 1 1' }),
      expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, errors: ['keyLed:format'] }),
      basis: [ANDROID_PARITY],
    });
  }
  add({
    id: 'KL-006', area: 'keyLed', title: 'a stray file whose name has fewer than 3 columns', expectation: 'undetermined',
    ...led({ '1 1': 'f 1 1', 'readme.txt': 'hello' }),
    question: 'The keyLED docs describe the name as "chain x y [loop]" but not what a file that is not a mapping means; the parsers skip it silently.',
  });
  add({
    id: 'KL-007', area: 'keyLed', title: 'the keyLed folder is empty of mappings but present',
    ...led({ '1 1': 'f 1 1' }),
    expectation: 'undetermined',
    question: 'Whether an existing keyLED folder with no valid file counts as "has LED animations" is not stated.',
  });

  // ---------------------------------------------------------------------------------------------
  // keyLed: events
  // ---------------------------------------------------------------------------------------------
  add({
    id: 'KL-010', area: 'keyLed', title: 'colours: hex, hex with velocity, auto and its short form',
    ...led({ '1 1 1': lines('o 1 1 FF0000', 'o 1 2 00B8D4 5', 'o 1 3 auto 72', 'on 2 1 a 5', 'o 2 2 abcdef', 'o 2 3 000000') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000'), ev.on(0, 1, 'ff00b8d4', 5), auto(0, 2, 72), auto(1, 0, 5), ev.on(1, 1, 'ffabcdef'), ev.on(1, 2, 'ff000000')])])] }),
    basis: [doc('key-led.mdx', 'Color Specification table'), VEL4, reference('meta/unipack-conformance/palette.json', 'the colour an auto line resolves to')],
  });
  add({
    id: 'KL-011', area: 'keyLed', title: 'round LEDs with * and mc, numbered 1..32',
    ...led({ '1 1 1': lines('o * 1 FF0000', 'o mc 32 a 3', 'on mc 5 00FF00 7', 'f * 1', 'off mc 32') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(-1, 0, 'ffff0000'), auto(-1, 31, 3), ev.on(-1, 4, 'ff00ff00', 7), ev.off(-1, 0), ev.off(-1, 31)])])] }),
    basis: [doc('key-led.mdx', 'Special Coordinates: * or mc are the round LEDs'), ROUND],
  });
  add({
    id: 'KL-012', area: 'keyLed', title: 'round LED numbers 0 and 33 are dropped without a warning',
    ...led({ '1 1 1': lines('o mc 33 a 3', 'o * 0 a 3', 'f mc 33', 'f mc 0', 'o mc 32 a 3') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [auto(-1, 31, 3)])])] }),
    basis: [ROUND],
  });
  add({
    id: 'KL-013', area: 'keyLed', title: 'logo LED in every accepted spelling',
    ...led({ '1 1 1': lines('o l FF0000', 'o l a 5', 'on l auto 9', 'o l 0 00FF00', 'o l 0 a 13', 'o l 0 0000FF 21', 'f l', 'off l') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(-1, 32, 'ffff0000'), auto(-1, 32, 5), auto(-1, 32, 9), ev.on(-1, 32, 'ff00ff00'), auto(-1, 32, 13), ev.on(-1, 32, 'ff0000ff', 21), ev.off(-1, 32), ev.off(-1, 32)])])] }),
    basis: [LOGO],
  });
  add({
    id: 'KL-014', area: 'keyLed', title: 'malformed logo lines are reported and skipped',
    ...led({ '1 1 1': lines('o l', 'o l ZZZZZZ', 'o l a 200', 'o l 0 a 5 9', 'o l a 5') }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [auto(-1, 32, 5)])])], errors: Array(4).fill('keyLed:format') }),
    basis: [LOGO],
  });
  const badEvents = [
    ['M01', 'on with only a pad column', 'on 1', [doc('key-led.mdx', 'The on command requires either color (4 tokens) or auto + velocity (5 tokens)')]],
    ['M02', 'on without a colour', 'on 1 1', [doc('key-led.mdx', 'The on command requires either color (4 tokens) or auto + velocity (5 tokens)')]],
    ['M03', 'a colour that is not hex', 'o 1 1 ZZZZZZ', [doc('key-led.mdx', '6-digit HEX color')]],
    ['M04', 'x is not a number', 'o a 1 FF0000', [ANDROID_PARITY]],
    ['M05', 'x has trailing letters', 'o 1b 1 FF0000', [ANDROID_PARITY]],
    ['M06', 'y has trailing letters', 'o 1 1b FF0000', [ANDROID_PARITY]],
    ['M08', 'off with only a pad column', 'f 1', [ANDROID_PARITY]],
    ['M09', 'off with letters', 'f a b', [ANDROID_PARITY]],
    ['M10', 'off with no coordinates', 'off', [ANDROID_PARITY]],
    ['M11', 'a velocity that is not a number', 'o 1 1 FF0000 x', [ANDROID_PARITY]],
    ['M12', 'six tokens on an on line', 'o 1 1 FF0000 5 6', [doc('key-led.mdx', 'The on command requires either color (4 tokens) or auto + velocity (5 tokens)')]],
    ['M13', 'a 7 digit colour', 'o 1 1 1234567', [doc('key-led.mdx', '6-digit HEX color')]],
    ['M14', 'a colour with a #', 'o 1 1 #FF0000', [doc('key-led.mdx', '6-digit HEX color')]],
    ['M15', 'an 8 digit colour', 'o 1 1 FFFFFFFF', [doc('key-led.mdx', '6-digit HEX color')]],
    ['M16', 'auto with velocity 128', 'o 1 1 auto 128', [doc('key-led.mdx', 'velocity: MIDI velocity (0~127)')]],
    ['M17', 'short auto with velocity 200', 'o 1 1 a 200', [doc('key-led.mdx', 'velocity: MIDI velocity (0~127)')]],
    ['M18', 'short auto with velocity -1', 'o 1 1 a -1', [doc('key-led.mdx', 'velocity: MIDI velocity (0~127)')]],
    ['M19', 'auto without a velocity', 'o 1 1 auto', [doc('key-led.mdx', 'auto requires a velocity')]],
    ['M20', 'a delay that is not a number', 'd abc', [ANDROID_PARITY]],
    ['M21', 'a delay without a value', 'd', [ANDROID_PARITY]],
    ['M22', 'a delay with a decimal point', 'd 1.5', [ANDROID_PARITY]],
    ['M23', 'a chain that is not a number', 'c x', [ANDROID_PARITY]],
    ['M24', 'a chain without a value', 'c', [ANDROID_PARITY]],
    ['M25', 'a round LED number that is not a number', 'o * x FF0000', [ANDROID_PARITY]],
    ['M26', 'an mc line without a number', 'o mc', [ANDROID_PARITY]],
    ['M27', 'an off round LED number that is not a number', 'f * x', [ANDROID_PARITY]],
  ];
  for (const [n, what, bad, basis] of badEvents) {
    add({
      id: `KL-${n}`, area: 'keyLed', title: `malformed event: ${what}`,
      ...led({ '1 1 1': lines(bad, 'f 1 1') }),
      expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.off(0, 0)])])], errors: ['keyLed:format'] }),
      basis,
    });
  }
  add({
    id: 'KL-M07', area: 'keyLed', title: 'malformed event: an unknown command', expectation: 'undetermined',
    ...led({ '1 1 1': lines('bogus 1 1', 'f 1 1') }),
    question: 'key-led.mdx says unrecognized commands are skipped; whether the skip is recorded as a warning is not stated. The same open question as KL-025.',
  });
  add({
    id: 'KL-020', area: 'keyLed', title: 'velocity above 127 next to a hex colour', expectation: 'undetermined',
    ...led({ '1 1 1': 'o 1 1 FF0000 200' }),
    question: 'The docs give 0~127 for velocity; no parser rejects a hex line with a larger one (the drivers clamp it later).',
  });
  add({
    id: 'KL-021', area: 'keyLed', title: 'an empty keyLED file still registers an animation',
    ...led({ '1 1 1': '' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [])])] }),
    basis: [intent('unipad-android LedRunner.kt (Crashlytics a1376611 comment), UniPackFolder.kt', 'an empty file is a legal animation with no events')],
  });
  add({
    id: 'KL-022', area: 'keyLed', title: 'CRLF, blank lines and runs of spaces inside a keyLED file',
    ...led({ '1 1 1': 'o  1  1  FF0000\r\n\r\n   \r\nd   100\r\nf 1 1' }),
    expected: loaded({ sounds: [cell(0, 3, 2, [q('c.wav')])], keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ffff0000'), ev.delay(100), ev.off(0, 0)])])] }),
    basis: [WHITESPACE],
  });
  add({
    id: 'KL-023', area: 'keyLed', title: 'a chain event that names a chain the pack does not have', expectation: 'undetermined',
    ...led({ '1 1 1': 'c 9' }),
    question: 'The docs do not say whether a keyLED `chain` beyond the pack\'s chain count is a warning or kept as written.',
  });
  add({
    id: 'KL-024', area: 'keyLed', title: 'an LED event outside the pad grid', expectation: 'undetermined',
    ...led({ '1 1 1': 'o 9 9 FF0000' }),
    question: 'The docs do not say whether coordinates inside a keyLED file are range-checked when parsing.',
  });
  add({
    id: 'KL-025', area: 'keyLed', title: 'a comment-like line inside a keyLED file', expectation: 'undetermined',
    ...led({ '1 1 1': lines('# note', 'f 1 1') }),
    question: 'There is no comment syntax in the format; key-led.mdx says unrecognized commands are skipped, whether with a warning is not stated. The same open question as KL-M07.',
  });

  // ---------------------------------------------------------------------------------------------
  // autoPlay
  // ---------------------------------------------------------------------------------------------
  const play = (autoPlay, keySound = lines('1 1 1 a.wav', '2 1 1 b.wav'), sounds) => ({ files: pack({ keySound, autoPlay, ...(sounds ? { sounds } : {}) }) });
  const withSounds = (over) => ({ sounds: [cell(0, 0, 0, [q('a.wav')]), cell(1, 0, 0, [q('b.wav')])], ...over });
  add({
    id: 'AP-001', area: 'autoPlay', title: 'the docs example: on, off, touch, chain and delay',
    ...play(lines('chain 1', 'on 1 1', 'on 1 2', 'delay 100', 'off 1 1', 'off 1 2', 'delay 200', 'touch 2 1', 'touch 2 2', 'delay 100', 'chain 2', 'on 1 1', 'delay 500', 'off 1 1')),
    expected: loaded(withSounds({ autoPlay: [ap.chain(0), ap.on(0, 0, 0, 0), ap.on(0, 1, 0, 0), ap.delay(100), ap.off(0, 0, 0), ap.off(0, 1, 0), ap.delay(200), ap.on(1, 0, 0, 0), ap.off(1, 0, 0), ap.on(1, 1, 0, 0), ap.off(1, 1, 0), ap.delay(100), ap.chain(1), ap.on(0, 0, 1, 0), ap.delay(500), ap.off(0, 0, 1)] })),
    basis: [doc('auto-play.mdx', 'Commands and Example')],
  });
  add({
    id: 'AP-002', area: 'autoPlay', title: 'every on and touch advances the pad\'s queue number, a chain resets it',
    ...play(lines('on 1 1', 'on 1 1', 'touch 1 1', 'chain 1', 'on 1 1')),
    expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0), ap.on(0, 0, 0, 1), ap.on(0, 0, 0, 2), ap.off(0, 0, 0), ap.chain(0), ap.on(0, 0, 0, 0)] })),
    basis: [doc('auto-play.mdx', 'The on event advances to the next sound in the circular queue; chain switching resets all counters')],
  });
  add({
    id: 'AP-003', area: 'autoPlay', title: 'a sound with a wormhole switches the chain after its on',
    ...play(lines('on 1 1', 'on 1 1'), lines('1 1 1 a.wav 1 2', '2 1 1 b.wav')),
    expected: loaded({ sounds: [cell(0, 0, 0, [q('a.wav', 0, 1)]), cell(1, 0, 0, [q('b.wav')])], autoPlay: [ap.on(0, 0, 0, 0), ap.chain(1), ap.on(0, 0, 1, 0)] }),
    basis: [doc('auto-play.mdx', 'If a sound has a wormhole set, executing on will automatically switch to that chain')],
  });
  add({
    id: 'AP-004', area: 'autoPlay', title: 'coordinates and chains outside the pack are skipped', expectation: 'undetermined',
    ...play(lines('on 5 1', 'on 1 4', 'on 0 1', 'chain 3', 'chain 0', 'off 5 5', 'touch 9 9')),
    question: 'auto-play.mdx says lines with out-of-range coordinates are skipped; whether each skipped line records a warning is not stated. The same warning-evidence rule as AP-M10.',
    basis: [doc('auto-play.mdx', 'Lines with out-of-range coordinates are skipped')],
  });
  add({
    id: 'AP-005', area: 'autoPlay', title: 'every command in its short spelling: o, f, t, c and d',
    ...play(lines('c 1', 'o 1 1', 'd 100', 'f 1 1', 't 2 1', 'c 2', 'o 1 1', 'd 50', 'f 1 1')),
    expected: loaded(withSounds({ autoPlay: [ap.chain(0), ap.on(0, 0, 0, 0), ap.delay(100), ap.off(0, 0, 0), ap.on(1, 0, 0, 0), ap.off(1, 0, 0), ap.chain(1), ap.on(0, 0, 1, 0), ap.delay(50), ap.off(0, 0, 1)] })),
    basis: [doc('auto-play.mdx', 'Commands table, Shorthand column: o, f, t, c, d')],
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
      id: `AP-${n}`, area: 'autoPlay', title: `malformed line: ${what}`,
      ...play(lines(bad, 'on 1 1')),
      expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0)], errors: ['autoPlay:format'] })),
      basis: [ANDROID_PARITY],
    });
  }
  add({
    id: 'AP-M10', area: 'autoPlay', title: 'malformed line: an unknown command', expectation: 'undetermined',
    ...play(lines('bogus 1 1', 'on 1 1')),
    question: 'auto-play.mdx lists the commands but does not say what a line starting with another word does, neither that it is skipped nor whether it warns (key-led.mdx says "skipped", for keyLED files only). The same open question as AP-022.',
  });
  add({
    id: 'AP-020', area: 'autoPlay', title: 'an empty autoPlay file exists with no elements',
    ...play(''),
    expected: loaded(withSounds({ autoPlay: [] })),
    basis: [doc('auto-play.mdx', 'The autoPlay file defines the auto-play sequence')],
  });
  add({
    id: 'AP-021', area: 'autoPlay', title: 'CRLF, blank lines and runs of spaces in autoPlay',
    ...play('on  1  1\r\n\r\n   \r\ndelay   100\r\noff 1 1'),
    expected: loaded(withSounds({ autoPlay: [ap.on(0, 0, 0, 0), ap.delay(100), ap.off(0, 0, 0)] })),
    basis: [WHITESPACE],
  });
  add({
    id: 'AP-022', area: 'autoPlay', title: 'a comment-like line in autoPlay', expectation: 'undetermined',
    ...play(lines('# start', 'on 1 1')),
    question: 'There is no comment syntax in the format, and auto-play.mdx does not say what a line starting with an unknown word does (key-led.mdx says "skipped", for keyLED files only). The same open question as AP-M10.',
  });

  // ---------------------------------------------------------------------------------------------
  // colour palette
  // ---------------------------------------------------------------------------------------------
  cases.push({
    id: 'PAL-001', layer: 'palette', area: 'palette', title: 'the 128 colours an `auto` velocity resolves to',
    files: [], expectation: 'determined', expected: { argb: palette.argb },
    basis: [reference('meta/unipack-conformance/palette.json', 'Android LaunchpadColor.ARGB, the oldest implementation; not compared with a Launchpad')],
  });

  // ---------------------------------------------------------------------------------------------
  // runners: press, release, time, exit
  // ---------------------------------------------------------------------------------------------
  const run = (id, area, title, files, scenario, checkpoints, basis, over = {}) => cases.push({
    id, layer: 'run', area, title, files, scenario, expectation: 'determined', expected: { checkpoints }, basis, ...over,
  });
  const press = (x, y) => ({ do: 'press', x, y });
  const release = (x, y) => ({ do: 'release', x, y });
  const advance = (ms) => ({ do: 'advance', ms });
  const observe = { do: 'observe' };
  const snd = (c, x, y, file, loop = 0) => ['sound', c, x, y, file, loop];
  const RED = 'ffff0000';
  const GREEN = 'ff00ff00';

  run('RUN-S-001', 'sound', 'pressing one pad cycles through its queue',
    pack({ keySound: lines('1 1 1 a.wav', '1 1 1 b.wav') }),
    [press(0, 0), release(0, 0), press(0, 0), release(0, 0), press(0, 0), release(0, 0), observe],
    [[snd(0, 0, 0, 'a.wav'), snd(0, 0, 0, 'b.wav'), snd(0, 0, 0, 'a.wav')]],
    [doc('key-sound.mdx', 'Circular Queue: sound_a -> sound_b -> sound_c -> sound_a')]);
  run('RUN-S-002', 'sound', 'a wormhole switches the chain, the next press plays that chain',
    pack({ keySound: lines('1 1 1 a.wav 1 2', '2 1 1 b.wav') }),
    [press(0, 0), release(0, 0), advance(200), observe, press(0, 0), release(0, 0), advance(50), observe],
    [[snd(0, 0, 0, 'a.wav'), ['chain', 1]], [snd(1, 0, 0, 'b.wav')]],
    [doc('key-sound.mdx', 'wormhole: chain number to jump to after playback')]);
  run('RUN-S-003', 'sound', 'the sound follows the selected chain',
    pack({ keySound: lines('1 1 1 a.wav', '2 1 1 b.wav') }),
    [{ do: 'chain', c: 1 }, press(0, 0), release(0, 0), observe],
    [[snd(1, 0, 0, 'b.wav')]],
    [doc('key-sound.mdx', 'chain x y soundFile')]);
  run('RUN-S-004', 'sound', 'a pad without a sound makes none',
    pack({ keySound: '1 1 1 a.wav' }),
    [press(1, 1), release(1, 1), observe],
    [[]],
    [doc('key-sound.mdx', 'each line maps one sound to one button')]);
  run('RUN-S-005', 'sound', 'loop 0 in the file starts an endless sound, loop 3 repeats twice',
    pack({ keySound: lines('1 1 1 a.wav 0', '1 1 2 a.wav 3') }),
    [press(0, 0), release(0, 0), press(0, 1), release(0, 1), observe],
    [[snd(0, 0, 0, 'a.wav', -1), snd(0, 0, 1, 'a.wav', 2)]],
    [doc('key-sound.mdx', 'Loop Values: 0 loops indefinitely, N (2 or more) repeats N-1 times')]);

  const ledPack = (name, content, keySound = OTHER_PAD_SOUND) => pack({ keySound, keyLed: { [name]: content } });
  run('RUN-L-001', 'led', 'a one-shot animation lights, waits and turns off',
    ledPack('1 1 1', lines('o 1 1 FF0000', 'd 100', 'f 1 1')),
    [press(0, 0), advance(50), observe, advance(100), observe, advance(200), observe],
    [[['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], []],
    [doc('key-led.mdx', 'Full Example: on, delay, off'), VEL4]);
  run('RUN-L-002', 'led', 'loop 2 plays the animation twice and then stays dark',
    ledPack('1 1 1 2', lines('o 1 1 FF0000', 'd 40', 'f 1 1', 'd 40')),
    [press(0, 0), advance(20), observe, advance(40), observe, advance(40), observe, advance(40), observe, advance(400), observe],
    [[['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], [['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], []],
    [doc('key-led.mdx', 'loop: repeat count (default: 1, 0 = infinite loop); "1 2 3 2" repeats 2 times')]);
  run('RUN-L-003', 'led', 'releasing the pad turns an endless animation off at once',
    ledPack('1 1 1 0', lines('o 1 1 FF0000', 'd 40', 'f 1 1', 'd 40')),
    [press(0, 0), advance(20), observe, release(0, 0), advance(12), observe, advance(400), observe],
    [[['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], []],
    [doc('key-led.mdx', 'loop 0 = infinite loop'), intent('unipad.io LedRunner.test.ts "turns a looping animation off on release and stays dark", unipad-android LedRunnerToggleTest', 'an endless animation ends when the pad is released')]);
  run('RUN-L-004', 'led', 'a chain event inside an animation switches the chain between the lights',
    ledPack('1 1 1', lines('o 1 1 FF0000', 'd 40', 'c 2', 'd 40', 'f 1 1')),
    [press(0, 0), advance(20), observe, advance(40), observe, advance(60), observe],
    [[['ledOn', 0, 0, RED, 4]], [['chain', 1]], [['ledOff', 0, 0]]],
    [doc('key-led.mdx', 'chain: switches chains during LED sequence execution')]);
  run('RUN-L-005', 'led', 'the logo LED lights and turns off on time',
    ledPack('1 1 1', lines('o l FF0000', 'd 40', 'f l')),
    [press(0, 0), advance(20), observe, advance(60), observe],
    [[['ledOn', -1, 32, RED, 4]], [['ledOff', -1, 32]]],
    [LOGO]);
  run('RUN-L-006', 'led', 'leaving the screen turns lit pad LEDs off and nothing follows',
    ledPack('1 1 1 0', lines('o 1 1 FF0000', 'd 40', 'f 1 1', 'd 40')),
    [press(0, 0), advance(20), observe, { do: 'stop' }, observe, advance(400), observe],
    [[['ledOn', 0, 0, RED, 4]], [['ledOff', 0, 0]], []],
    [intent('unipad-android 3e5a2fd6 (#101), unipad.io 8019666 (#32)', 'LEDs still lit are cleared on exit and no stale light is sent afterwards')],
    { unobserved: { ios: IOS_EXIT } });
  run('RUN-L-007', 'led', 'leaving the screen turns a lit round LED off and nothing follows',
    ledPack('1 1 1 0', lines('o * 1 00FF00', 'd 40', 'f * 1', 'd 40')),
    [press(0, 0), advance(20), observe, { do: 'stop' }, observe, advance(400), observe],
    [[['ledOn', -1, 0, GREEN, 4]], [['ledOff', -1, 0]], []],
    [intent('unipad-android 3e5a2fd6 (#101), unipad.io 8019666 (#32)', 'LEDs still lit are cleared on exit and no stale light is sent afterwards')],
    { unobserved: { ios: IOS_EXIT } });
  run('RUN-L-008', 'led', 'pressing a pad again while its animation plays', [
    ...ledPack('1 1 1 0', lines('o 1 1 FF0000', 'd 40', 'f 1 1', 'd 40')),
  ],
  [press(0, 0), advance(20), observe, release(0, 0), press(0, 0), advance(20), observe],
  [],
  [], { expectation: 'undetermined', question: 'Whether a re-press restarts the lights with an off in between, or without, is not stated; the runners are expected to agree but no doc or note says so.' });

  const autoFiles = pack({ keySound: lines('1 1 1 a.wav', '2 1 1 b.wav'), autoPlay: lines('on 1 1', 'delay 100', 'off 1 1', 'delay 100', 'touch 2 1') });
  run('RUN-A-001', 'autoPlay', 'autoPlay presses and releases on its delays',
    autoFiles,
    [{ do: 'autoplay' }, advance(50), observe, advance(100), observe, advance(100), observe, advance(400), observe],
    [[['autoOn', 0, 0]], [['autoOff', 0, 0]], [['autoOn', 1, 0], ['autoOff', 1, 0]], []],
    [doc('auto-play.mdx', 'Events are executed sequentially from top to bottom; delay waits in milliseconds')],
    { unobserved: { ios: IOS_WALL_CLOCK } });
  run('RUN-A-002', 'autoPlay', 'leaving the screen stops autoPlay and nothing follows',
    autoFiles,
    [{ do: 'autoplay' }, advance(50), observe, { do: 'stop' }, advance(400), observe],
    [[['autoOn', 0, 0]], []],
    [intent('unipad-android ce6af172 (#86), unipad.io AutoPlayRunner.stop', 'a stopped runner sends no more presses')],
    { unobserved: { ios: IOS_WALL_CLOCK } });

  return cases;
}
