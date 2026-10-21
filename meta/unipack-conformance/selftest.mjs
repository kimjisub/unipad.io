// Tests of the conformance tooling itself: the corpus is current and consistent, the fingerprint notices
// changed input, the report never turns a missing or mismatched platform or a claim without a result into
// a pass, and the sync check notices a drifted copy. `pnpm test:unipack` runs this file too (see
// src/lib/unipack/conformance.test.ts). Alone: node --test meta/unipack-conformance/selftest.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCorpus, digestLine, serialize } from './build-corpus.mjs';
import { buildCases } from './cases.mjs';
import { ASSET_GENERATORS, buildAssets, fingerprint, restsOnAgreement, restsOnDecision, sha256, startsWithMpegFrame } from './lib.mjs';
import { checkNativeTests, grammarRecord, HARNESS_LIMITS, NATIVE_TESTS, readGrammar } from './grammar.mjs';
import { readNative } from './native.mjs';
import { BASES, buildReport, classify, judge, loadCanonical, parseResults, PLATFORMS, renderText } from './report.mjs';
import { resolveCommits } from './copies.mjs';
import { COPIED_FILES, COPY_DIRS, differences } from './sync.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const canonical = loadCanonical();
const { corpus } = canonical;

const SOME_RESULT = { loaded: true };

/**
 * What a platform whose every result equals the expected one would write for `cases`, with `over`
 * applied per case id. Undetermined cases and the ones marked `unobserved` for the platform are
 * unverified, as the harnesses report them.
 */
function fullResults(platform, over = {}, cases = corpus.cases) {
  return {
    platform,
    corpusSha256: canonical.sha256,
    cases: cases.map((c) => {
      const base = { id: c.id, fingerprint: c.fingerprint, detail: '' };
      if (c.expectation !== 'determined') return { ...base, status: 'unverified', actual: SOME_RESULT, ...over[c.id] };
      if (c.unobserved?.[platform]) return { ...base, status: 'unverified', actual: null, ...over[c.id] };
      return { ...base, status: c.known?.[platform] ? 'unverified' : 'pass', actual: c.expected, ...over[c.id] };
    }),
  };
}

/** The log a platform that claims a pass on every case would print: status lines only, no results. */
function logOf(platform) {
  return [
    ...corpus.cases.map((c) => `Test case passed. UNIPACK-CONFORMANCE ${JSON.stringify({ platform, id: c.id, fingerprint: c.fingerprint, status: 'pass' })}`),
    `UNIPACK-CONFORMANCE-CORPUS ${JSON.stringify({ platform, corpusSha256: canonical.sha256, cases: corpus.cases.length })}`,
  ].join('\n');
}

const plain = corpus.cases.filter((c) => c.expectation === 'determined' && !c.known && !c.unobserved);
const [determined, another] = plain;
/** `c` as an undetermined case: an open question in place of its expected result and basis. */
function asUndetermined(c) {
  const open = { ...c, expectation: 'undetermined', question: 'still open?' };
  delete open.expected;
  delete open.basis;
  return open;
}
// The corpus may have no undetermined case, so one is made from a determined one.
const undetermined = asUndetermined(determined);
const withUndetermined = { ...canonical, corpus: { ...corpus, cases: corpus.cases.map((c) => (c.id === undetermined.id ? undetermined : c)) } };
const statusesOf = (judged) => [...new Set([...judged.values()].map((v) => v.status))];

test('corpus.json is what the sources build, and corpus.sha256 is its hash', () => {
  const text = serialize(buildCorpus());
  assert.equal(readFileSync(join(here, 'corpus.json'), 'utf8'), text);
  assert.equal(readFileSync(join(here, 'corpus.sha256'), 'utf8'), digestLine(Buffer.from(text)));
});

test('iOS sound-stop and chain-reset cases require observed results', () => {
  const ids = ['RUN-S-008', 'RUN-S-009', 'RUN-S-010', 'RUN-S-012', 'RUN-S-013'];
  const passing = fullResults('ios');
  const judged = judge(canonical, 'ios', passing);
  const missing = judge(canonical, 'ios', { ...passing, cases: [] });
  for (const id of ids) {
    const c = corpus.cases.find((entry) => entry.id === id);
    assert.ok(c, id);
    assert.equal(c.unobserved?.ios, undefined, id);
    assert.equal(judged.get(id).status, 'pass', id);
    assert.equal(missing.get(id).status, 'unverified', id);
    const changed = fullResults('ios', { [id]: { status: 'fail', actual: { checkpoints: [] } } });
    assert.equal(judge(canonical, 'ios', changed).get(id).status, 'fail', id);
  }
});

test('the MP3 asset is MPEG audio, not a renamed WAV', () => {
  const mp3 = ASSET_GENERATORS['tone-440-mp3'].make();
  assert.ok(startsWithMpegFrame(mp3));
  assert.ok(!startsWithMpegFrame(ASSET_GENERATORS['tone-440'].make()));
});

test('a warning no doc asks for is expected only on an agreed basis, and the report counts it apart', () => {
  const agreedIds = corpus.cases.filter(restsOnAgreement).map((c) => c.id);
  for (const id of ['KL-003', 'AP-004', 'KL-M07', 'AP-M10']) {
    const c = corpus.cases.find((entry) => entry.id === id);
    assert.ok(agreedIds.includes(id), id);
    assert.equal(c.expectation, 'determined', id);
    assert.match(c.basis.find((b) => b.type === 'agreed').note, /warn/, id);
  }

  const report = buildReport(canonical, Object.fromEntries(PLATFORMS.map((p) => [p, fullResults(p)])));
  const agreedRows = report.rows.filter((r) => r.agreed).map((r) => r.id);
  assert.deepEqual(agreedRows, agreedIds);
  assert.equal(report.agreed.cases, agreedIds.length);
  assert.equal(report.agreed.passOnAllThree, agreedIds.length);
  assert.ok(report.passOnAllThree > report.agreed.passOnAllThree);
  const text = renderText(report);
  assert.match(text, new RegExp(`, ${agreedIds.length} of them on an agreed basis`));
  assert.match(text, new RegExp(`^${agreedIds[0]} .*\\[agreed\\]$`, 'm'));

  // An agreed expected result is checked like any other: a platform that changes its result fails.
  const changed = fullResults('web', { [agreedIds[0]]: { status: 'fail', actual: SOME_RESULT } });
  assert.equal(judge(canonical, 'web', changed).get(agreedIds[0]).status, 'fail');
});

test('a determined case needs a doc, intent, agreed or decision basis, and an agreed or decided one no open question', () => {
  const editing = (id, edit) => () => buildCorpus((palette) => buildCases(palette).map((c) => (c.id === id ? edit(structuredClone(c)) : c)));
  assert.doesNotThrow(editing('KL-005', (c) => c));
  assert.throws(editing('KL-005', (c) => ({ ...c, basis: [] })), /KL-005: determined without a doc, intent, agreed or decision basis/);
  assert.throws(editing('KL-005', (c) => ({ ...c, question: 'still open?' })), /KL-005: an agreed case keeps its open question in the agreed note/);
  assert.throws(editing('KL-024', (c) => ({ ...c, question: 'still open?' })), /KL-024: a decided case keeps no open question/);
  // A pinned difference needs a determined case to differ from.
  const pinnedId = corpus.cases.find((c) => c.known).id;
  assert.throws(editing(pinnedId, asUndetermined), new RegExp(`${pinnedId}: a divergence is pinned on an undetermined case`));
});

test('a decided case is checked like any other, and the report counts it apart from doc and agreed ones', () => {
  const decided = corpus.cases.filter(restsOnDecision);
  const decidedIds = decided.map((c) => c.id);
  assert.ok(decidedIds.includes('KL-024'));
  assert.equal(decided.filter((c) => c.basis.some((b) => b.type === 'agreed')).length, 0);

  // Pinned differences are unverified, except the two storage forms explicitly allowed by T-09.
  const report = buildReport(canonical, Object.fromEntries(PLATFORMS.map((p) => [p, fullResults(p)])));
  assert.deepEqual(report.rows.filter((r) => r.decided).map((r) => r.id), decidedIds);
  assert.equal(report.decided.cases, decidedIds.length);
  const allowedStorage = (c, p) => p === 'android' && ['KS-B08', 'KL-BE10'].includes(c.id);
  const clean = (p) => decided.filter((c) => (!c.known?.[p] || allowedStorage(c, p)) && !c.unobserved?.[p]);
  const pass = Object.fromEntries(PLATFORMS.map((p) => [p, clean(p).length]));
  assert.deepEqual(report.decided.pass, pass);
  const onAllThree = decided.filter((c) => PLATFORMS.every((p) => (!c.known?.[p] || allowedStorage(c, p)) && !c.unobserved?.[p])).length;
  assert.equal(report.decided.passOnAllThree, onAllThree);
  const text = renderText(report);
  assert.match(text, new RegExp(`, ${onAllThree} on a decision basis$`, 'm'));
  assert.match(text, new RegExp(`^decision basis: ${decidedIds.length} cases .* pass android ${pass.android}, ios ${pass.ios}, web ${pass.web}$`, 'm'));
  assert.match(text, /^KL-024 .*\[decision\]$/m);

  // While a platform's difference is pinned, its pinned result is a fail, any other wrong result is a fail,
  // the pin belongs to that platform alone, and a result equal to the expected one is unverified until
  // the pin is removed.
  const pinned = structuredClone(canonical);
  const kl024 = pinned.corpus.cases.find((c) => c.id === 'KL-024');
  const before = { loaded: false };
  kl024.known = { web: { status: 'fail', actual: before, note: 'test' } };
  const statusOf = (platform, r) => judge(pinned, platform, fullResults(platform, { 'KL-024': r })).get('KL-024').status;
  assert.equal(statusOf('web', { status: 'fail', actual: before }), 'fail');
  assert.equal(statusOf('web', { status: 'fail', actual: SOME_RESULT }), 'fail');
  assert.equal(statusOf('android', { status: 'fail', actual: before }), 'fail');
  assert.equal(classify(kl024, kl024.expected, 'web'), 'unverified');
  assert.equal(statusOf('web', { status: 'unverified', actual: kl024.expected }), 'unverified');
  assert.equal(statusOf('web', { status: 'pass', actual: kl024.expected }), 'unverified');
});

test('GRAMMAR.md lists 104 items of edition G4, each of kind parse or output, and the corpus names its edition', () => {
  const grammar = readGrammar();
  assert.equal(grammar.edition, 'G4');
  assert.equal(corpus.grammar, 'G4');
  assert.equal(grammar.items.length, 104);
  assert.equal(new Set(grammar.items.map((i) => i.id)).size, 104);
  for (const item of grammar.items) assert.ok(['parse', 'output'].includes(item.kind), item.id);
  for (const limits of [...Object.values(HARNESS_LIMITS), ...Object.values(NATIVE_TESTS)]) for (const id of Object.keys(limits)) assert.ok(grammar.items.some((i) => i.id === id), id);
  assert.throws(() => readGrammar('# UniPack grammar\n'), /edition G<n>/);
  const row = '| S-01 | rule | parse | doc | where |';
  assert.throws(() => readGrammar(`# UniPack grammar, edition G1\n${row}\n${row}\n`), /S-01 more than once/);
});

test('every case names the grammar items it checks, and the build refuses one without them or with an unknown one', () => {
  const ids = new Set(readGrammar().items.map((i) => i.id));
  for (const c of corpus.cases) {
    assert.ok(c.items.length > 0, c.id);
    for (const item of c.items) assert.ok(ids.has(item), `${c.id}: ${item}`);
  }
  const editing = (edit) => () => buildCorpus((palette) => buildCases(palette).map((c) => (c.id === 'KS-001' ? edit(structuredClone(c)) : c)));
  assert.throws(editing((c) => { delete c.items; return c; }), /KS-001: names no grammar item/);
  assert.throws(editing((c) => ({ ...c, items: [] })), /KS-001: names no grammar item/);
  assert.throws(editing((c) => ({ ...c, items: ['S-01', 'S-99'] })), /KS-001: item S-99 is not in GRAMMAR.md G4/);
  assert.throws(editing((c) => ({ ...c, items: ['S-01', 'S-01'] })), /KS-001: names an item twice/);
});

describe('an item is confirmed on a platform', () => {
  const allPass = () => Object.fromEntries(PLATFORMS.map((p) => [p, fullResults(p)]));
  const itemRow = (report, id) => report.grammar.rows.find((r) => r.id === id);
  const caseOf = (id) => corpus.cases.find((c) => c.id === id);
  /** A copy of the corpus whose cases name other items: `edit(id, items)` returns the new items of a case. */
  const relinked = (edit) => ({ ...canonical, corpus: { ...corpus, cases: corpus.cases.map((c) => ({ ...c, items: edit(c.id, c.items) })) } });

  test('only when a case checks it', () => {
    const report = buildReport(canonical, allPass());
    for (const id of ['F-05', 'F-06', 'A-03', 'A-04', 'A-05']) {
      const row = itemRow(report, id);
      assert.deepEqual(row.cases, [], id);
      for (const p of PLATFORMS) assert.deepEqual(row[p], { confirmed: false, detail: 'no case checks this item' }, `${id} ${p}`);
    }
  });

  test('only when every case that checks it passes there', () => {
    const results = allPass();
    assert.equal(itemRow(buildReport(canonical, results), 'S-09').web.confirmed, true);
    results.web = fullResults('web', { 'KS-004': { status: 'fail', actual: SOME_RESULT } });
    assert.deepEqual(itemRow(buildReport(canonical, results), 'S-09').web, { confirmed: false, detail: 'not every case passes: KS-004 fail' });
    assert.equal(itemRow(buildReport(canonical, results), 'S-09').android.confirmed, true);
    // A platform that was not run confirms nothing.
    const none = buildReport(canonical, { web: fullResults('web') });
    assert.equal(none.grammar.confirmed.android, 0);
    assert.equal(none.grammar.confirmedOnAllThree, 0);
  });

  test('an output item only by a run or palette case', () => {
    assert.equal(caseOf('RUN-S-004').layer, 'run');
    const parseOnly = relinked((id, items) => (id === 'RUN-S-004' ? items.filter((i) => i !== 'RS-03') : id === 'KS-001' ? [...items, 'RS-03'] : items));
    const row = itemRow(buildReport(parseOnly, allPass()), 'RS-03');
    assert.deepEqual(row.cases, ['KS-001']);
    for (const p of PLATFORMS) assert.match(row[p].detail, /output item .* run or palette case/, p);
    assert.equal(itemRow(buildReport(canonical, allPass()), 'RS-03').web.confirmed, true);
  });

  test('only where its harness can observe it, or the result file says the limit does not hold', () => {
    const report = buildReport(canonical, allPass());
    const a01 = itemRow(report, 'A-01');
    assert.ok(a01.cases.length > 0);
    assert.equal(a01.ios.confirmed, true);
    for (const p of ['android', 'web']) assert.match(a01[p].detail, new RegExp(`^the ${p} harness cannot observe it`), p);
    const f01 = itemRow(report, 'F-01');
    assert.equal(f01.web.confirmed, true);
    for (const p of ['android', 'ios']) assert.equal(f01[p].confirmed, false, p);
    const results = allPass();
    for (const p of ['android', 'ios']) results[p].caseSensitiveFileSystem = true;
    for (const p of ['android', 'ios']) assert.equal(itemRow(buildReport(canonical, results), 'F-01')[p].confirmed, true, p);
    results.android.caseSensitiveFileSystem = 'yes';
    assert.equal(itemRow(buildReport(canonical, results), 'F-01').android.confirmed, false);
  });

  test('and the four numbers count the items', () => {
    const results = allPass();
    const { grammar } = buildReport(canonical, results);
    const rows = grammar.rows;
    assert.equal(grammar.items, 104);
    for (const p of PLATFORMS) assert.equal(grammar.confirmed[p], rows.filter((r) => r[p].confirmed).length, p);
    assert.equal(grammar.confirmedOnAllThree, rows.filter((r) => PLATFORMS.every((p) => r[p].confirmed)).length);
    assert.equal(grammar.withCases, rows.filter((r) => r.cases.length > 0).length);
    assert.ok(grammar.confirmedOnAllThree <= Math.min(...PLATFORMS.map((p) => grammar.confirmed[p])));
    const text = renderText(buildReport(canonical, results));
    assert.match(text, new RegExp(`^grammar G4: confirmed android ${grammar.confirmed.android}, ios ${grammar.confirmed.ios}, web ${grammar.confirmed.web} of 104 items; on all three platforms ${grammar.confirmedOnAllThree} of 104; ${grammar.withCases} of 104 have a case$`, 'm'));
    assert.match(text, /^F-05 {7}- {9}- {9}- {9}\(none\)$/m);
  });
});

test('sound assets regenerate to the same bytes', () => {
  assert.deepEqual(buildAssets(), corpus.assets);
});

test('case ids are unique and every determined case has a doc, intent, agreed or reference basis', () => {
  assert.equal(new Set(corpus.cases.map((c) => c.id)).size, corpus.cases.length);
  for (const c of corpus.cases) {
    if (c.expectation === 'determined') assert.ok(c.basis.length > 0 && c.expected !== undefined, c.id);
    else assert.ok(c.question && c.expected === undefined, c.id);
  }
});

test('the fingerprint changes with any input byte, the file name or an added file', () => {
  const c = corpus.cases.find((x) => x.id === 'KS-001');
  assert.equal(fingerprint(c.files, corpus.assets), c.fingerprint);
  const edit = (fn) => fingerprint(fn(structuredClone(c.files)), corpus.assets);
  assert.notEqual(edit((f) => { f.find((x) => x.path === 'keySound').text += ' '; return f; }), c.fingerprint);
  assert.notEqual(edit((f) => { f.find((x) => x.path === 'keySound').path = 'keysound'; return f; }), c.fingerprint);
  assert.notEqual(edit((f) => [...f, { path: 'autoPlay', text: '' }]), c.fingerprint);
  assert.notEqual(edit((f) => { f.find((x) => x.path === 'sounds/a.wav').asset = 'tone-660'; return f; }), c.fingerprint);
});

test('a platform that was not run is unverified on every case, never a pass', () => {
  const report = buildReport(canonical, { web: fullResults('web') });
  for (const row of report.rows) {
    assert.equal(row.android.status, 'unverified');
    assert.equal(row.ios.status, 'unverified');
  }
  assert.equal(report.passOnAllThree, 0);
  assert.ok(report.summary.web.pass > 0);
});

test('a platform that ran another corpus or other input is unverified', () => {
  const other = { ...fullResults('ios'), corpusSha256: 'f'.repeat(64) };
  assert.deepEqual(statusesOf(judge(canonical, 'ios', other)), ['unverified']);

  const wrongInput = judge(canonical, 'ios', fullResults('ios', { [determined.id]: { fingerprint: '0'.repeat(64) } }));
  assert.equal(wrongInput.get(determined.id).status, 'unverified');
  assert.equal(wrongInput.get(another.id).status, 'pass');

  const missing = fullResults('ios');
  missing.cases = missing.cases.filter((r) => r.id !== determined.id);
  assert.equal(judge(canonical, 'ios', missing).get(determined.id).status, 'unverified');
});

test('an undetermined case is never a pass, whether the claim comes with a result or without one', () => {
  for (const actual of [SOME_RESULT, undefined, null]) {
    const claimed = judge(withUndetermined, 'web', fullResults('web', { [undetermined.id]: { status: 'pass', actual } }));
    assert.equal(claimed.get(undetermined.id).status, 'unverified');
    assert.equal(judge(canonical, 'web', fullResults('web', { [undetermined.id]: { status: 'pass', actual: determined.expected } })).get(undetermined.id).status, 'pass');
  }
});

test('a pass claimed without the result it is based on is unverified', () => {
  for (const actual of [undefined, null]) {
    const claimed = judge(canonical, 'web', fullResults('web', { [determined.id]: { status: 'pass', actual } }));
    assert.equal(claimed.get(determined.id).status, 'unverified');
    assert.match(claimed.get(determined.id).detail, /without the result/);
  }
  const everyCase = fullResults('ios');
  everyCase.cases = everyCase.cases.map((r) => ({ id: r.id, fingerprint: r.fingerprint, status: 'pass', detail: '' }));
  assert.deepEqual(statusesOf(judge(canonical, 'ios', everyCase)), ['unverified']);
});

test('results handed in under another platform\'s name are unverified on every case', () => {
  const web = fullResults('web');
  assert.ok(statusesOf(judge(canonical, 'web', web)).includes('pass'));
  assert.deepEqual(statusesOf(judge(canonical, 'android', web)), ['unverified']);
  assert.deepEqual(statusesOf(judge(canonical, 'android', { ...web, platform: undefined })), ['unverified']);

  const report = buildReport(canonical, { android: web, web });
  assert.equal(report.summary.android.pass, 0);
  assert.equal(report.summary.android.unverified, corpus.cases.length);
  assert.equal(report.passOnAllThree, 0);
});

test('a test log is never a pass: an iOS log given as Android, or as iOS, is unverified on every case', () => {
  const log = parseResults(logOf('ios'));
  assert.equal(log.platform, 'ios');
  assert.equal(log.cases.length, corpus.cases.length);
  assert.deepEqual(statusesOf(judge(canonical, 'android', log)), ['unverified']);
  assert.deepEqual(statusesOf(judge(canonical, 'ios', log)), ['unverified']);
});

test('the command line reports an iOS log given as --android as unverified, with no Android pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unipack-report-'));
  try {
    const iosLog = join(dir, 'ios.log');
    const webJson = join(dir, 'web.json');
    writeFileSync(iosLog, logOf('ios'));
    writeFileSync(webJson, JSON.stringify(fullResults('web')));
    const run = spawnSync(process.execPath, [join(here, 'report.mjs'), '--android', iosLog, '--ios', webJson, '--web', webJson, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.deepEqual(report.summary.android, { pass: 0, fail: 0, unsupported: 0, 'intended-difference': 0, unverified: corpus.cases.length });
    assert.equal(report.summary.ios.pass, 0);
    assert.ok(report.summary.web.pass > 0);
    assert.equal(report.passOnAllThree, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a status the platform reports is checked against its own actual result', () => {
  const lying = fullResults('web', { [determined.id]: { status: 'pass', actual: { loaded: false } } });
  assert.match(judge(canonical, 'web', lying).get(determined.id).detail, /classifies as fail/);
  const honest = fullResults('web', { [determined.id]: { status: 'pass', actual: determined.expected } });
  assert.equal(judge(canonical, 'web', honest).get(determined.id).status, 'pass');
});

describe('T-09 allows only the specified Android storage representations', () => {
  const pathsByCase = {
    'KS-B08': [['sounds', 0, 'queue', 0, 'loop']],
    'KL-BE10': [
      ['leds', 0, 'queue', 0, 'events', 0, 1],
      ['leds', 0, 'queue', 0, 'events', 1, 2],
      ['leds', 0, 'queue', 0, 'events', 2, 1],
    ],
  };
  const set = (object, path, value) => { path.slice(0, -1).reduce((o, key) => o[key], object)[path.at(-1)] = value; };
  const seen = (c, actual, platform = 'android', overrides = {}) => judge(canonical, platform, fullResults(platform, {
    [c.id]: { actual, status: classify(c, actual, platform), detail: 'original harness note', ...overrides },
  })).get(c.id);

  test('both values and every combination pass without changing the actual result or its original status', () => {
    for (const [id, paths] of Object.entries(pathsByCase)) {
      const c = corpus.cases.find((c) => c.id === id);
      for (let mask = 0; mask < 2 ** paths.length; mask++) {
        const actual = structuredClone(c.expected);
        paths.forEach((path, index) => {
          assert.equal(path.reduce((o, key) => o[key], actual), -2147483649);
          if (mask & (1 << index)) set(actual, path, -2147483648);
        });
        const before = structuredClone(actual);
        const result = seen(c, actual);
        assert.equal(result.status, 'pass', `${id} combination ${mask}`);
        assert.equal(result.reportedStatus, classify(c, before, 'android'));
        assert.equal(result.reportedDetail, 'original harness note');
        assert.match(result.detail, /T-09.*representation/);
        assert.deepEqual(result.actual, before);
        assert.deepEqual(actual, before);
      }
    }
  });

  test('positive wraparound, other integers, malformed values and missing fields still fail', () => {
    for (const [id, paths] of Object.entries(pathsByCase)) {
      const c = corpus.cases.find((c) => c.id === id);
      for (const path of paths) {
        for (const wrong of [2147483647, -2147483647, -2147483650, '-2147483648', null, undefined]) {
          const actual = structuredClone(c.known.android.actual);
          set(actual, path, wrong);
          assert.equal(seen(c, actual).status, 'fail', `${id} ${path.join('.')} ${wrong}`);
        }
      }
    }
  });

  test('format and range warnings and every other field are still compared exactly', () => {
    for (const id of Object.keys(pathsByCase)) {
      const c = corpus.cases.find((c) => c.id === id);
      for (const edit of [
        (a) => { a.errors.push('keyLED:format'); },
        (a) => { a.errors.push('keySound:range'); },
        (a) => { a.errors.pop(); if (!c.expected.errors.length) a.errors.push('keyLED:range'); },
        (a) => { a.sounds[0].queue[0].file = 'wrong.wav'; },
        (a) => { a.loaded = false; },
      ]) {
        const actual = structuredClone(c.known.android.actual);
        edit(actual);
        assert.equal(seen(c, actual).status, 'fail', id);
      }
    }
  });

  test('does not accept other platforms, other pins, dishonest statuses or mismatched inputs', () => {
    const c = corpus.cases.find((c) => c.id === 'KS-B08');
    for (const platform of ['web', 'ios']) assert.equal(seen(c, c.known.android.actual, platform).status, 'fail');
    assert.equal(seen(c, c.known.android.actual, 'android', { status: 'pass' }).status, 'unverified');
    assert.equal(seen(c, c.known.android.actual, 'android', { fingerprint: '0'.repeat(64) }).status, 'unverified');
    const pinned = structuredClone(canonical);
    const other = pinned.corpus.cases.find((c) => c.id === 'RUN-A-003');
    const actual = structuredClone(other.expected);
    actual.checkpoints[5].unshift(['autoChain', 1]);
    other.known = { android: { status: 'fail', actual, note: 'Synthetic non-storage divergence' } };
    const result = fullResults('android', { [other.id]: { status: 'fail', actual } });
    assert.equal(judge(pinned, 'android', result).get(other.id).status, 'fail');
  });

  test('confirms T-09 from the allowed representations and keeps their reasons visible in text', () => {
    const android = fullResults('android', Object.fromEntries(Object.keys(pathsByCase).map((id) => {
      const c = corpus.cases.find((c) => c.id === id);
      return [id, { status: 'fail', actual: c.known.android.actual }];
    })));
    const report = buildReport(canonical, { android });
    assert.equal(report.grammar.rows.find((r) => r.id === 'T-09').android.confirmed, true);
    for (const id of Object.keys(pathsByCase)) assert.match(renderText(report), new RegExp(`${id} android: .*T-09`));
  });
});

test('a case the platform could not drive is unverified with its own reason', () => {
  const skipped = fullResults('ios', { [determined.id]: { status: 'unverified', actual: null, detail: 'the audio engine is not usable here' } });
  const seen = judge(canonical, 'ios', skipped).get(determined.id);
  assert.equal(seen.status, 'unverified');
  assert.equal(seen.detail, 'the audio engine is not usable here');
});

// The corpus may mark no case `unobserved`, so a parse case and a run case are marked for iOS here.
const IOS_REASON = 'not observable on iOS here';
const unobservedOnIos = [plain.find((c) => c.layer === 'parse'), plain.find((c) => c.layer === 'run')].map((c) => ({ ...c, unobserved: { ios: IOS_REASON } }));
const withUnobserved = { ...canonical, corpus: { ...corpus, cases: corpus.cases.map((c) => unobservedOnIos.find((u) => u.id === c.id) ?? c) } };
const iosResults = (over) => fullResults('ios', over, withUnobserved.corpus.cases);

test('a case the corpus says a platform cannot observe is unverified there, with that reason, while it records no result', () => {
  for (const c of unobservedOnIos) {
    for (const over of [{}, { status: 'pass', actual: null }, { status: 'pass', actual: undefined }]) {
      const ios = judge(withUnobserved, 'ios', iosResults({ [c.id]: over })).get(c.id);
      assert.equal(ios.status, 'unverified', c.id);
      assert.equal(ios.detail, IOS_REASON, c.id);
    }
    assert.equal(judge(withUnobserved, 'android', fullResults('android', { [c.id]: { status: 'pass', actual: c.expected } })).get(c.id).status, 'pass');
  }
});

test('a result recorded for a case the corpus says a platform cannot observe is judged like any other', () => {
  for (const c of unobservedOnIos) {
    const judged = (over) => judge(withUnobserved, 'ios', iosResults({ [c.id]: over })).get(c.id);
    assert.equal(judged({ status: 'pass', actual: c.expected }).status, 'pass', c.id);
    assert.deepEqual(judged({ status: 'pass', actual: c.expected }).actual, c.expected, c.id);
    assert.equal(judged({ status: 'fail', actual: SOME_RESULT }).status, 'fail', c.id);
    assert.match(judged({ status: 'pass', actual: SOME_RESULT }).detail, /classifies as fail/, c.id);
    assert.equal(judged({ status: 'pass', actual: c.expected, fingerprint: '0'.repeat(64) }).status, 'unverified', c.id);
  }
  const passing = iosResults(Object.fromEntries(unobservedOnIos.map((c) => [c.id, { status: 'pass', actual: c.expected }])));
  const otherCorpus = judge(withUnobserved, 'ios', { ...passing, corpusSha256: 'f'.repeat(64) });
  const missing = judge(withUnobserved, 'ios', { ...passing, cases: passing.cases.filter((r) => !unobservedOnIos.some((c) => c.id === r.id)) });
  for (const c of unobservedOnIos) {
    assert.equal(otherCorpus.get(c.id).status, 'unverified', c.id);
    assert.equal(missing.get(c.id).status, 'unverified', c.id);
  }
});

test('a pinned difference is reported with its pinned status, and stops being one when it disappears', () => {
  const pinned = structuredClone(canonical);
  const c = pinned.corpus.cases.find((x) => x.id === determined.id);
  c.known = { ios: { status: 'unsupported', actual: { loaded: false }, note: 'test' } };
  const seen = judge(pinned, 'ios', fullResults('ios', { [c.id]: { status: 'unsupported', actual: { loaded: false } } }));
  assert.equal(seen.get(c.id).status, 'unsupported');
  const fixed = judge(pinned, 'ios', fullResults('ios', { [c.id]: { status: 'pass', actual: c.expected } }));
  assert.equal(fixed.get(c.id).status, 'unverified');
});

test('the lines of a log are read, marked as coming from a log', () => {
  const lines = [
    'noise before',
    `[xcodebuild] UNIPACK-CONFORMANCE ${JSON.stringify({ platform: 'ios', id: 'KS-001', fingerprint: 'abc', status: 'pass' })}`,
    `UNIPACK-CONFORMANCE-CORPUS ${JSON.stringify({ platform: 'ios', corpusSha256: 'def', cases: 1 })}`,
  ].join('\n');
  assert.deepEqual(parseResults(lines), { platform: 'ios', corpusSha256: 'def', source: 'log', cases: [{ id: 'KS-001', fingerprint: 'abc', status: 'pass', detail: '' }] });
});

test('the table says when a result file was written and whether that run asserted', () => {
  const web = { ...fullResults('web'), generatedAt: '2026-09-30T12:00:00.000Z', assertions: 'checked' };
  const android = { ...fullResults('android'), generatedAt: '2026-09-30T12:01:00.000Z', assertions: 'skipped' };
  const text = renderText(buildReport(canonical, { web, android }));
  assert.match(text, /\nweb\s+results written 2026-09-30T12:00:00.000Z\n/);
  assert.match(text, /\nandroid\s+results written 2026-09-30T12:01:00.000Z, a record-only run/);
  assert.match(text, /\nios\s+no results given\n/);
});

// What each harness checks before it runs a case: the corpus.json it read hashes to its corpus.sha256.
const copyIsSelfConsistent = (dir) => readFileSync(join(dir, 'corpus.sha256'), 'utf8') === digestLine(readFileSync(join(dir, 'corpus.json')));

test('the sync check fails on a drifted, missing or outdated copy and passes once it is restored', () => {
  const root = mkdtempSync(join(tmpdir(), 'unipack-sync-'));
  const dir = join(root, COPY_DIRS.android);
  const sync = (...args) => spawnSync(process.execPath, [join(here, 'sync.mjs'), '--android', root, ...args], { encoding: 'utf8' });
  const restore = () => { for (const name of COPIED_FILES) writeFileSync(join(dir, name), readFileSync(join(here, name))); };
  try {
    assert.equal(differences({ android: root }).length, COPIED_FILES.length);
    assert.equal(sync().status, 0);
    assert.deepEqual(differences({ android: root }), []);

    // 1. one byte of the copy changed: the copy no longer matches its hash, and the sync check fails
    const bytes = readFileSync(join(dir, 'corpus.json'));
    bytes[bytes.indexOf('KS-001')] ^= 1;
    writeFileSync(join(dir, 'corpus.json'), bytes);
    assert.equal(copyIsSelfConsistent(dir), false);
    assert.equal(sync('--check').status, 1);
    restore();

    // 2. corpus.sha256 missing
    rmSync(join(dir, 'corpus.sha256'));
    assert.match(differences({ android: root }).join('\n'), /corpus\.sha256 is missing/);
    assert.equal(sync('--check').status, 1);
    restore();

    // 3. an older corpus.json together with its own hash: the app's check passes, the sync check does not
    const older = serialize({ ...corpus, cases: corpus.cases.slice(0, -1) });
    writeFileSync(join(dir, 'corpus.json'), older);
    writeFileSync(join(dir, 'corpus.sha256'), digestLine(Buffer.from(older)));
    assert.equal(copyIsSelfConsistent(dir), true);
    assert.equal(differences({ android: root }).length, 2);
    assert.equal(sync('--check').status, 1);
    restore();

    // 4. restored
    assert.equal(copyIsSelfConsistent(dir), true);
    assert.deepEqual(differences({ android: root }), []);
    assert.equal(sync('--check').status, 0);
    assert.equal(sha256(readFileSync(join(dir, 'corpus.json'))), canonical.sha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('copies.json pins the app copies CI compares to full commit hashes only', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const pins = JSON.stringify({ android: a, ios: b });
  assert.deepEqual(resolveCommits(readFileSync(join(here, 'copies.json'), 'utf8')), JSON.parse(readFileSync(join(here, 'copies.json'), 'utf8')));
  assert.deepEqual(resolveCommits(pins), { android: a, ios: b });
  assert.deepEqual(resolveCommits(pins, { android: '', ios: 'c'.repeat(40) }), { android: a, ios: 'c'.repeat(40) });
  for (const commit of ['main', a.slice(0, 7), `${a}0`, a.toUpperCase(), `refs/heads/${a}`]) {
    assert.throws(() => resolveCommits(JSON.stringify({ android: commit, ios: b })), /full 40-character commit/, commit);
    assert.throws(() => resolveCommits(pins, { ios: commit }), /full 40-character commit/, commit);
  }
  assert.throws(() => resolveCommits(JSON.stringify({ android: a })), /exactly android and ios/);
  assert.throws(() => resolveCommits(JSON.stringify({ android: a, ios: b, web: a })), /exactly android and ios/);
  assert.throws(() => resolveCommits('[]'), /must be an object/);
  const cli = spawnSync(process.execPath, [join(here, 'copies.mjs'), '--ios', 'main'], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /ios: "main" is not a full 40-character commit hash/);
});

test('report rows cover every platform', () => {
  assert.deepEqual(PLATFORMS, ['android', 'ios', 'web']);
});

 test('the grammar reads the same edition and items with CRLF line endings', () => {
  const lf = readFileSync(join(here, 'GRAMMAR.md'), 'utf8');
  assert.deepEqual(readGrammar(lf.replace(/\r?\n/g, '\r\n')), readGrammar(lf));
});

 test('G3 never takes back an elapsed wait and exercises the later shortened waits', () => {
  const first = corpus.cases.find((c) => c.id === 'RUN-L-009');
  assert.deepEqual(first.expected.checkpoints, [
    [['ledOn', 0, 0, 'ffff0000', 4], ['ledOn', 1, 0, 'ff00ff00', 4]], [],
    [['ledOff', 0, 0], ['ledOff', 1, 0]],
  ]);
  const later = corpus.cases.find((c) => c.id === 'RUN-L-014');
  assert.deepEqual(later.items, ['E-09']);
  assert.deepEqual(later.expected.checkpoints, [
    [['ledOn', 0, 0, 'ffff0000', 4]], [['ledOff', 0, 0]], [['ledOn', 1, 0, 'ff00ff00', 4]],
    [['ledOn', 2, 0, 'ff0000ff', 4], ['ledOn', 3, 0, 'ffff0000', 4]], [],
  ]);
});

describe('app test results', () => {
  const RECORD = grammarRecord();
  const COMMIT = '0123456789abcdef0123456789abcdef01234567';
  const capitalized = (outcome) => outcome[0].toUpperCase() + outcome.slice(1);

  /**
   * An app's own result file, in that app's format, reporting `items` (item → test names, by default the
   * ones NATIVE_TESTS lists): every item `passed` unless `status` says otherwise, and every test run once
   * and passed unless `outcomes` gives its runs (`[]` for none, two for a retry).
   */
  function nativeFile(platform, { items = NATIVE_TESTS[platform], status = {}, outcomes = {}, ...top } = {}) {
    const entries = Object.entries(items).map(([id, names]) => ({ id, status: status[id] ?? 'passed', tests: names.map((name) => [name, outcomes[name] ?? ['passed']]) }));
    if (platform === 'android') {
      return {
        schemaVersion: 1, platform, repositoryCommit: COMMIT, sourceDirty: false, grammar: { ...RECORD },
        items: Object.fromEntries(entries.map((e) => [e.id, { status: e.status, requiredTests: e.tests.map(([name]) => name),
          tests: Object.fromEntries(e.tests.map(([name, runs]) => [name, runs.map((o) => ({ status: o }))])) }])),
        ...top,
      };
    }
    if (platform === 'ios') {
      return {
        schemaVersion: 1, platform, commit: COMMIT, sourceStatus: '', purpose: 'verification', grammarVersion: RECORD.version, grammarRevision: RECORD.revision,
        rules: Object.fromEntries(entries.map((e) => [e.id, { status: e.status,
          tests: e.tests.map(([name, runs]) => ({ name, runs: runs.map((o) => ({ result: capitalized(o) })) })) }])),
        ...top,
      };
    }
    return {
      schemaVersion: 1, grammar: { ...RECORD }, source: { commit: COMMIT, dirty: false },
      items: entries.map((e) => {
        const browser = e.id.startsWith('A-');
        return { item: e.id, status: { passed: 'confirmed', unverified: 'unconfirmed' }[e.status] ?? e.status, tests: e.tests.map(([name]) => name),
          results: e.tests.flatMap(([name, runs]) => runs.map((o) => ({ name, ...(browser && { project: 'chromium' }), status: o === 'passed' ? 'passed' : 'unconfirmed' }))),
          run: browser ? 'browser' : 'parser' };
      }),
      ...top,
    };
  }
  const read = (platform, file) => readNative(platform, Buffer.from(typeof file === 'string' ? file : JSON.stringify(file)));
  const passing = () => Object.fromEntries(PLATFORMS.map((p) => [p, fullResults(p)]));
  /** The item rows of a report on `results` (every case passing by default) with these app test results. */
  function items(natives, results = passing()) {
    return new Map(buildReport(canonical, results, natives).grammar.rows.map((r) => [r.id, r]));
  }
  const all = () => Object.fromEntries(PLATFORMS.map((p) => [p, read(p, nativeFile(p))]));

  test('1. in each app\'s format, an item whose listed tests each ran once and passed is confirmed', () => {
    const without = items({});
    for (const p of PLATFORMS) {
      assert.equal(without.get('F-05')[p].confirmed, false, p);
      const rows = items({ [p]: read(p, nativeFile(p)) });
      for (const id of ['F-05', 'F-06']) assert.deepEqual(rows.get(id)[p], { confirmed: true, detail: '', basis: BASES.native }, `${p} ${id}`);
    }
    assert.equal(without.get('F-01').android.confirmed, false);
    assert.deepEqual(items({ android: read('android', nativeFile('android')) }).get('F-01').android, { confirmed: true, detail: '', basis: BASES.both });
    assert.deepEqual(items({ web: read('web', nativeFile('web')) }).get('A-01').web, { confirmed: true, detail: '', basis: BASES.both });
  });

  test('2. iOS A-04 and A-05, which no case checks and no limit names, are confirmed by the app tests alone', () => {
    for (const id of ['A-04', 'A-05']) {
      assert.equal(corpus.cases.some((c) => c.items?.includes(id)), false, id);
      assert.equal(HARNESS_LIMITS.ios[id], undefined, id);
      assert.deepEqual(items({}).get(id).ios, { confirmed: false, detail: 'no case checks this item' });
      assert.deepEqual(items({ ios: read('ios', nativeFile('ios')) }).get(id).ios, { confirmed: true, detail: '', basis: BASES.native });
    }
  });

  test('3. iOS A-03 stays unconfirmed: unverified without tests, and passed with any test, as no test is listed for it', () => {
    assert.equal(NATIVE_TESTS.ios['A-03'], undefined);
    const unverified = nativeFile('ios', { items: { ...NATIVE_TESTS.ios, 'A-03': [] }, status: { 'A-03': 'unverified' } });
    const claimed = nativeFile('ios', { items: { ...NATIVE_TESTS.ios, 'A-03': ['SoundEngineDecodingTests/anOggSoundPlays()'] } });
    for (const file of [unverified, claimed]) {
      const cell = items({ ios: read('ios', file) }).get('A-03').ios;
      assert.equal(cell.confirmed, false);
      assert.match(cell.detail, /no ios app test is listed for it/);
    }
  });

  test('4. a listed test that is missing, failed, skipped or run twice leaves the item unconfirmed and is named', () => {
    const cases = [['android', 'F-05'], ['ios', 'F-05'], ['web', 'F-06'], ['android', 'F-01'], ['web', 'A-03']];
    const outcomes = { missing: [], failed: ['failed'], skipped: ['skipped'], repeated: ['passed', 'passed'] };
    for (const [p, id] of cases) {
      const name = NATIVE_TESTS[p][id].at(-1);
      for (const [want, runs] of Object.entries(outcomes)) {
        if (p === 'web' && want === 'skipped') continue; // the web file records a skipped test as unconfirmed, read as failed
        const cell = items({ [p]: read(p, nativeFile(p, { outcomes: { [name]: runs } })) }).get(id)[p];
        assert.equal(cell.confirmed, false, `${p} ${id} ${want}`);
        assert.ok(cell.detail.includes(`${name} ${want}`), `${p} ${id} ${want}: ${cell.detail}`);
      }
    }
  });

  test('5. an item the file does not mark passed is unconfirmed even when every listed test passed', () => {
    for (const p of PLATFORMS) {
      const cell = items({ [p]: read(p, nativeFile(p, { status: { 'F-05': 'unverified' } })) }).get('F-05')[p];
      assert.equal(cell.confirmed, false, p);
      assert.match(cell.detail, /app test results mark it un(verified|confirmed)/);
    }
    // Android's file as it is: A-01 to A-05 unverified while the decode and pad tests passed; none is listed.
    const android = nativeFile('android', { items: { ...NATIVE_TESTS.android, 'A-01': ['audio.AudioFormatDecodeDeviceTest#decodesPcmWav'] }, status: { 'A-01': 'unverified' } });
    assert.equal(items({ android: read('android', android) }).get('A-01').android.confirmed, false);
  });

  test('6. a file that cannot count is refused, with the reason', () => {
    const refused = (p, file, why) => assert.throws(() => read(p, file), why);
    refused('android', nativeFile('android', { items: { ...NATIVE_TESTS.android, 'Z-99': ['x'] } }), /the grammar lists no item Z-99/);
    const twice = JSON.stringify(nativeFile('android')).replace('"F-05":', '"F-06":{"status":"passed","tests":{}},"F-05":');
    refused('android', twice, /names "F-06" twice in one object/);
    const web = nativeFile('web');
    refused('web', { ...web, items: [...web.items, web.items[0]] }, /reports F-05 more than once/);
    refused('android', nativeFile('ios'), /the file is ios's, not android's/);
    refused('web', nativeFile('android'), /the file is android's, not web's/);
    refused('ios', nativeFile('ios', { grammarVersion: 'G2' }), /checked against grammar G2, this tool reads G4/);
    refused('android', nativeFile('android', { grammar: { version: 'G2', revision: '7a38cd71-4570-4738-9732-229bbc339eed' } }), /checked against grammar G2, this tool reads G4/);
    refused('web', { ...web, grammar: { version: RECORD.version, revision: '7a38cd71-4570-4738-9732-229bbc339eed' } }, /grammar revision 7a38cd71.* is not the SHA-256/);
    refused('android', nativeFile('android', { sourceDirty: true }), /uncommitted changes/);
    refused('ios', nativeFile('ios', { sourceStatus: ' M unipad/SoundEngine.swift' }), /uncommitted changes/);
    refused('web', { ...web, source: { commit: COMMIT, dirty: true } }, /uncommitted changes/);
    refused('ios', nativeFile('ios', { purpose: 'baseline' }), /a baseline run, not a verification run/);
    refused('android', nativeFile('android', { repositoryCommit: COMMIT.slice(0, 8) }), /is not a full 40-character commit hash/);
    // The command ends with an error instead of a table.
    const dir = mkdtempSync(join(tmpdir(), 'unipack-native-'));
    try {
      const old = join(dir, 'items.json');
      writeFileSync(old, JSON.stringify({ ...web, grammar: { version: 'G2', revision: '7a38cd71-4570-4738-9732-229bbc339eed' } }));
      const run = spawnSync(process.execPath, [join(here, 'report.mjs'), '--web-native', old], { encoding: 'utf8' });
      assert.equal(run.status, 3);
      assert.equal(run.stdout, '');
      assert.match(run.stderr, /cannot use web app test results .*checked against grammar G2, this tool reads G4/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('7. passing app tests never cover a failing case: F-01, A-01 and A-02', () => {
    const failing = (p, id) => ({ ...passing(), [p]: fullResults(p, { [id]: { status: 'fail', actual: SOME_RESULT } }) });
    for (const [p, item, id] of [['android', 'F-01', 'FS-001'], ['ios', 'F-01', 'FS-002'], ['web', 'A-01', 'RUN-S-001'], ['web', 'A-02', 'RUN-RP-002']]) {
      const cell = items(all(), failing(p, id)).get(item)[p];
      assert.equal(cell.confirmed, false, `${p} ${item}`);
      assert.match(cell.detail, new RegExp(`not every case passes: ${id} fail`));
    }
    // Nor do passing cases cover a failing app test.
    const name = NATIVE_TESTS.android['F-01'][0];
    const cell = items({ android: read('android', nativeFile('android', { outcomes: { [name]: ['failed'] } })) }).get('F-01').android;
    assert.equal(cell.confirmed, false);
    assert.ok(cell.detail.includes(`${name} failed`), cell.detail);
  });

  test('8. without app test results the report is what it was: no basis, no native block, the same text', () => {
    const results = passing();
    const before = buildReport(canonical, results);
    assert.deepEqual(buildReport(canonical, results, {}), before);
    assert.equal('native' in before, false);
    for (const row of before.grammar.rows) for (const p of PLATFORMS) assert.deepEqual(Object.keys(row[p]), ['confirmed', 'detail'], `${row.id} ${p}`);
    assert.equal(renderText(buildReport(canonical, results, {})), renderText(before));
    assert.doesNotMatch(renderText(before), /app test/);
    const withNative = buildReport(canonical, results, all());
    assert.deepEqual(withNative.native.web, { sha256: all().web.sha256, commit: COMMIT });
    assert.match(renderText(withNative), new RegExp(`app test results ${all().ios.sha256.slice(0, 12)}, run on commit ${COMMIT}`));
  });

  test('9. an item confirmed on all three counts once, of the same 104', () => {
    const before = buildReport(canonical, passing()).grammar;
    const after = buildReport(canonical, passing(), all()).grammar;
    assert.equal(after.items, 104);
    assert.equal(after.rows.length, 104);
    const onAll = (g) => g.rows.filter((r) => PLATFORMS.every((p) => r[p].confirmed)).map((r) => r.id);
    assert.equal(after.confirmedOnAllThree, onAll(after).length);
    assert.deepEqual(onAll(after).filter((id) => !onAll(before).includes(id)), ['F-01', 'F-05', 'F-06']);
    assert.equal(after.confirmedOnAllThree, before.confirmedOnAllThree + 3);
  });

  test('10. NATIVE_TESTS refuses an item that lists no test', () => {
    assert.throws(() => checkNativeTests({ web: { 'F-05': [] } }), /NATIVE_TESTS.web\["F-05"\] lists no test/);
    assert.throws(() => checkNativeTests({ ios: { 'A-04': ['a', 'a'] } }), /lists a more than once/);
    assert.throws(() => checkNativeTests({ web: { 'F-05': ['a'] } }, {}), /NATIVE_TESTS.web\["F-05"\] has no run in WEB_RUNS/);
    assert.equal(checkNativeTests(NATIVE_TESTS), NATIVE_TESTS);
  });

  test('11. a web item counts only from its registered run and browser, whatever the file says of itself', () => {
    const name = NATIVE_TESTS.web['A-03'][0];
    /** The web file with A-03 changed by `change`, its other items as they pass. */
    const withA03 = (change) => {
      const file = nativeFile('web');
      return { ...file, items: file.items.map((item) => (item.item === 'A-03' ? change(item) : item)) };
    };
    // A field set to undefined is left out of the file, as `read` writes it as JSON.
    const browser = (project) => (item) => ({ ...item, results: item.results.map((r) => ({ ...r, project })) });
    const cell = (file, id = 'A-03') => items({ web: read('web', file) }).get(id).web;
    assert.deepEqual(cell(withA03((item) => item)), { confirmed: true, detail: '', basis: BASES.native });
    const runs = [
      ['no run', (item) => ({ ...item, run: undefined }), /report it from the unnamed run, not the browser run/],
      ['the parser run', (item) => ({ ...item, run: 'parser' }), /report it from the parser run, not the browser run/],
      ['no browser', browser(undefined), new RegExp(`${name} missing`)],
      ['WebKit', browser('webkit'), new RegExp(`${name} missing`)],
      ['WebKit, run named parser', (item) => browser('webkit')({ ...item, run: 'parser' }), /not the browser run.*missing/],
    ];
    for (const [why, change, detail] of runs) {
      const got = cell(withA03(change));
      assert.equal(got.confirmed, false, why);
      assert.match(got.detail, detail, why);
    }
    // The parser items still count from the parser run, whose records name no browser, and only from it.
    for (const id of ['F-05', 'F-06']) assert.deepEqual(cell(nativeFile('web'), id), { confirmed: true, detail: '', basis: BASES.native }, id);
    const parser = (change) => ({ ...nativeFile('web'), items: nativeFile('web').items.map((item) => (item.item === 'F-05' ? change(item) : item)) });
    assert.match(cell(parser((item) => ({ ...item, run: 'browser' })), 'F-05').detail, /not the parser run/);
    assert.match(cell(parser(browser('chromium')), 'F-05').detail, /missing/);
  });

  test('12. an iOS test record counts each repetition nested in it as a run, so a repeated or retried test is not confirmed', () => {
    const name = NATIVE_TESTS.ios['A-04'][0];
    const repetition = (result, i) => ({ nodeType: 'Repetition', name: String(i + 1), result });
    /** The iOS file with A-04's one test record holding `children`, as xcresult nests repetitions and retries. */
    const withRecord = (children) => {
      const file = nativeFile('ios');
      const record = { nodeType: 'Test Case', nodeIdentifier: name, result: 'Passed', children };
      return { ...file, rules: { ...file.rules, 'A-04': { ...file.rules['A-04'], tests: [{ name, runs: [record] }] } } };
    };
    const cell = (children) => items({ ios: read('ios', withRecord(children)) }).get('A-04').ios;
    const confirmed = { confirmed: true, detail: '', basis: BASES.native };
    assert.deepEqual(cell([]), confirmed);
    assert.deepEqual(cell([repetition('Passed', 0)]), confirmed);
    const repeated = {
      'two passed repetitions': ['Passed', 'Passed'].map(repetition),
      'a retry that passed after a failure': ['Failed', 'Passed'].map(repetition),
      'two passed repetitions under a device': [{ nodeType: 'Device', name: 'iPhone', result: 'Passed', children: ['Passed', 'Passed'].map(repetition) }],
    };
    for (const [why, children] of Object.entries(repeated)) {
      const got = cell(children);
      assert.equal(got.confirmed, false, why);
      assert.ok(got.detail.includes(`${name} repeated`), `${why}: ${got.detail}`);
    }
  });
});
