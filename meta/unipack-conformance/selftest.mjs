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
import { resolveCommits, resolvePins } from './copies.mjs';
import { COPIED_FILES, COPY_DIRS, differences, checkCopies } from './sync.mjs';

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

test('G6 cases cannot count a missing result, a claimed pass or an injected wrong output', () => {
  const added = corpus.cases.filter((c) => /-G6/.test(c.id));
  assert.equal(added.length, 55);
  for (const c of added) for (const platform of PLATFORMS) {
    const only = { corpus: { ...corpus, cases: [c] }, sha256: canonical.sha256 };
    const result = (cases) => ({ platform, corpusSha256: canonical.sha256, cases });
    const record = { id: c.id, fingerprint: c.fingerprint };
    assert.equal(judge(only, platform, result([])).get(c.id).status, 'unverified', `${c.id} missing`);
    assert.equal(judge(only, platform, result([{ ...record, status: 'pass' }])).get(c.id).status, 'unverified', `${c.id} claim`);
    const wrong = c.expected.loaded === false ? { loaded: true } : c.layer === 'run' ? { checkpoints: [] } : { loaded: false };
    assert.equal(judge(only, platform, result([{ ...record, status: 'fail', actual: wrong }])).get(c.id).status, 'fail', `${c.id} mutation`);
    assert.equal(judge(only, platform, result([{ ...record, status: 'pass', actual: wrong }])).get(c.id).status, 'unverified', `${c.id} dishonest mutation`);
  }
});

test('a later manual chain choice cancels the pending wormhole and must be observed', () => {
  const c = corpus.cases.find((entry) => entry.id === 'RUN-G606');
  const cancelled = { checkpoints: [[['sound', 0, 0, 0, 'a.wav', 0]], [], []] };
  const pending = { checkpoints: [[['sound', 0, 0, 0, 'a.wav', 0]], [], [['chain', 1]]] };
  const only = { corpus: { ...corpus, cases: [c] }, sha256: canonical.sha256 };
  for (const platform of PLATFORMS) {
    const record = { id: c.id, fingerprint: c.fingerprint };
    const result = (entry) => ({ platform, corpusSha256: canonical.sha256, cases: [entry] });
    assert.equal(judge(only, platform, result({ ...record, status: 'pass', actual: cancelled })).get(c.id).status, 'pass', platform);
    assert.equal(judge(only, platform, result({ ...record, status: 'fail', actual: pending })).get(c.id).status, 'fail', platform);
    assert.equal(judge(only, platform, result({ ...record, status: 'pass', actual: pending })).get(c.id).status, 'unverified', platform);
    assert.equal(judge(only, platform, result({ ...record, status: 'pass' })).get(c.id).status, 'unverified', platform);
  }
});

test('archive identity cases distinguish canonically equivalent entries and overwritten contents', () => {
  const ids = ['KS-G601', 'KS-G602', 'KS-G603', 'KS-G604', 'KS-G620', 'KS-G621', 'KS-G622', 'KS-G623', 'KS-G624', 'KS-G625'];
  for (const id of ids) {
    const c = corpus.cases.find(entry => entry.id === id);
    assert.ok(c?.soundIdentity, id);
    const q = c.expected.sounds[0].queue[0];
    assert.match(q.archiveEntry, /^sounds\//);
    assert.match(q.sha256, /^[0-9a-f]{64}$/);
    assert.equal(q.file, undefined);
    if (Number(id.slice(-3)) >= 620) {
      const files = c.files.filter(f => f.path.startsWith('sounds/') && f.asset);
      assert.equal(files.length, 2, id);
      assert.notEqual(files[0].path, files[1].path);
      assert.equal(files[0].path.normalize('NFC'), files[1].path.normalize('NFC'));
      assert.notEqual(corpus.assets[files[0].asset].sha256, corpus.assets[files[1].asset].sha256);
    }
    const only = { corpus: { ...corpus, cases: [c] }, sha256: canonical.sha256 };
    for (const field of ['archiveEntry', 'sha256']) {
      const wrong = structuredClone(c.expected);
      wrong.sounds[0].queue[0][field] = field === 'sha256' ? '0'.repeat(64) : q.archiveEntry.normalize('NFD') === q.archiveEntry ? q.archiveEntry.normalize('NFC') : q.archiveEntry.normalize('NFD');
      for (const platform of PLATFORMS) {
        const result = status => ({ platform, corpusSha256: canonical.sha256, cases: [{ id, fingerprint: c.fingerprint, status, actual: wrong }] });
        assert.equal(judge(only, platform, result('fail')).get(id).status, 'fail');
        assert.equal(judge(only, platform, result('pass')).get(id).status, 'unverified');
      }
    }
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

  // Pinned differences are never confirmed.
  const report = buildReport(canonical, Object.fromEntries(PLATFORMS.map((p) => [p, fullResults(p)])));
  assert.deepEqual(report.rows.filter((r) => r.decided).map((r) => r.id), decidedIds);
  assert.equal(report.decided.cases, decidedIds.length);
  const clean = (p) => decided.filter((c) => !c.known?.[p] && !c.unobserved?.[p]);
  const pass = Object.fromEntries(PLATFORMS.map((p) => [p, clean(p).length]));
  assert.deepEqual(report.decided.pass, pass);
  const onAllThree = decided.filter((c) => PLATFORMS.every((p) => !c.known?.[p] && !c.unobserved?.[p])).length;
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

test('GRAMMAR.md lists 114 items of edition G6, each of kind parse or output, and the corpus names its edition', () => {
  const grammar = readGrammar();
  assert.equal(grammar.edition, 'G6');
  assert.equal(corpus.grammar, 'G6');
  assert.equal(grammar.items.length, 114);
  assert.equal(new Set(grammar.items.map((i) => i.id)).size, 114);
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
  assert.throws(editing((c) => ({ ...c, items: ['S-01', 'S-99'] })), /KS-001: item S-99 is not in GRAMMAR.md G6/);
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
    assert.equal(grammar.items, 114);
    for (const p of PLATFORMS) assert.equal(grammar.confirmed[p], rows.filter((r) => r[p].confirmed).length, p);
    assert.equal(grammar.confirmedOnAllThree, rows.filter((r) => PLATFORMS.every((p) => r[p].confirmed)).length);
    assert.equal(grammar.withCases, rows.filter((r) => r.cases.length > 0).length);
    assert.ok(grammar.confirmedOnAllThree <= Math.min(...PLATFORMS.map((p) => grammar.confirmed[p])));
    const text = renderText(buildReport(canonical, results));
    assert.match(text, new RegExp(`^grammar G6: confirmed android ${grammar.confirmed.android}, ios ${grammar.confirmed.ios}, web ${grammar.confirmed.web} of 114 items; on all three platforms ${grammar.confirmedOnAllThree} of 114; ${grammar.withCases} of 114 have a case$`, 'm'));
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

describe('T-09 requires exact storage after subtracting one', () => {
  const pathsByCase = {
    'KS-B08': [['sounds', 0, 'queue', 0, 'loop']],
    'KL-BE10': [['leds', 0, 'queue', 0, 'events', 0, 1], ['leds', 0, 'queue', 0, 'events', 1, 2], ['leds', 0, 'queue', 0, 'events', 2, 1]],
  };
  for (const [id, paths] of Object.entries(pathsByCase)) test(`${id} rejects saturation on every platform`, () => {
    const c = corpus.cases.find((c) => c.id === id);
    assert.equal(c.known?.android, undefined, 'no fixed difference exempts Android');
    for (const p of PLATFORMS) {
      assert.equal(classify(c, c.expected, p), 'pass');
      for (const path of paths) {
        const actual = structuredClone(c.expected);
        assert.equal(path.reduce((o, k) => o[k], actual), -2147483649);
        path.slice(0, -1).reduce((o, k) => o[k], actual)[path.at(-1)] = -2147483648;
        const r = fullResults(p, { [id]: { actual, status: 'fail' } });
        assert.equal(judge(canonical, p, r).get(id).status, 'fail');
        assert.equal(buildReport(canonical, { [p]: r }).grammar.rows.find((r) => r.id === 'T-09')[p].confirmed, false);
        r.cases.find((r) => r.id === id).status = 'pass';
        assert.equal(judge(canonical, p, r).get(id).status, 'unverified');
      }
    }
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
  const pinsPath = join(root, 'pins.json');
  writeFileSync(pinsPath, JSON.stringify({ android: 'a'.repeat(40), ios: 'b'.repeat(40) }));
  const sync = (...args) => spawnSync(process.execPath, [join(here, 'sync.mjs'), '--android', root, '--pins', pinsPath, ...args], { encoding: 'utf8' });
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
  assert.ok(Object.values(resolveCommits(readFileSync(join(here, 'copies.json'), 'utf8'))).every((value) => /^[a-f0-9]{40}$/.test(value)));
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

  test('3. iOS A-03 is confirmed by the listed test that measures the OGG sound played, and by no other test', () => {
    const listed = 'SoundEngineDecodingTests/anOggVorbisSoundPlays()';
    assert.deepEqual(NATIVE_TESTS.ios['A-03'], [listed]);
    assert.deepEqual(items({ ios: read('ios', nativeFile('ios')) }).get('A-03').ios, { confirmed: true, detail: '', basis: BASES.native });
    const unverified = nativeFile('ios', { status: { 'A-03': 'unverified' } });
    const decoderOnly = nativeFile('ios', { items: { ...NATIVE_TESTS.ios, 'A-03': ['OggVorbisDecoderTests/decodesTheWholeToneInTheFilesLayout()'] } });
    for (const file of [unverified, decoderOnly]) assert.equal(items({ ios: read('ios', file) }).get('A-03').ios.confirmed, false);
    assert.match(items({ ios: read('ios', decoderOnly) }).get('A-03').ios.detail, /anOggVorbisSoundPlays\(\) missing/);
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
    // Decoder and pad tests alone do not verify Android's rendered output.
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
    refused('ios', nativeFile('ios', { grammarVersion: 'G2' }), /checked against grammar G2, this tool reads G6/);
    refused('android', nativeFile('android', { grammar: { version: 'G2', revision: '7a38cd71-4570-4738-9732-229bbc339eed' } }), /checked against grammar G2, this tool reads G6/);
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
      assert.match(run.stderr, /cannot use web app test results .*checked against grammar G2, this tool reads G6/);
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

  test('9. an item confirmed on all three counts once, of the same 114', () => {
    const before = buildReport(canonical, passing()).grammar;
    const after = buildReport(canonical, passing(), all()).grammar;
    assert.equal(after.items, 114);
    assert.equal(after.rows.length, 114);
    const onAll = (g) => g.rows.filter((r) => PLATFORMS.every((p) => r[p].confirmed)).map((r) => r.id);
    assert.equal(after.confirmedOnAllThree, onAll(after).length);
    assert.deepEqual(onAll(after).filter((id) => !onAll(before).includes(id)), ['F-01', 'F-05', 'F-06', 'A-01', 'A-02', 'A-03', 'A-04', 'A-05']);
    assert.equal(after.confirmedOnAllThree, before.confirmedOnAllThree + 8);
  });

  test('Android sound formats require their external output tests, including both MP3 filename variants', () => {
    const output = 'com.kimjisub.launchpad.audio.EmulatorOutput#';
    const required = {
      'A-01': [output + 'wavIsHeardAtTheEmulatorOutput'],
      'A-02': [output + 'mp3IsHeardAtTheEmulatorOutput'],
      'A-03': [output + 'oggIsHeardAtTheEmulatorOutput'],
      'A-04': [output + 'm4aIsHeardAtTheEmulatorOutput'],
      'A-05': [output + 'bareMp3NamedWavIsHeardAtTheEmulatorOutput', output + 'taggedMp3NamedWavIsHeardAtTheEmulatorOutput'],
    };
    for (const [id, names] of Object.entries(required)) {
      const file = nativeFile('android', { items: required });
      const cell = (value) => items({ android: read('android', value) }).get(id).android;
      assert.equal(cell(file).confirmed, true, id);
      for (const name of names) {
        for (const outcomes of [[], ['failed'], ['unverified'], ['passed', 'passed']]) {
          const incomplete = nativeFile('android', { items: required, outcomes: { [name]: outcomes } });
          assert.equal(cell(incomplete).confirmed, false, `${id}: ${name}: ${outcomes}`);
        }
      }
      const decodeOnly = nativeFile('android', { items: { [id]: ['com.kimjisub.launchpad.audio.AudioFormatDecodeDeviceTest#decodesPcmWav'] } });
      assert.equal(cell(decodeOnly).confirmed, false, `${id}: decoding alone is not output`);
    }
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

  test('G6 Opus cannot be confirmed by an unregistered app test on any platform', () => {
    for (const p of PLATFORMS) {
      assert.equal(NATIVE_TESTS[p]['A-07'], undefined, p);
      const file = nativeFile(p, { items: { ...NATIVE_TESTS[p], 'A-07': ['unregisteredOpusOutputTest'] } });
      const cell = items({ [p]: read(p, file) }).get('A-07')[p];
      assert.equal(cell.confirmed, false, p);
      assert.match(cell.detail, /no .* app test is listed/);
    }
  });

  test('13. Android A-03 stays unconfirmed when the file marks it passed on a test NATIVE_TESTS does not list', () => {
    const unlisted = 'com.kimjisub.launchpad.audio.AudioFormatDecodeDeviceTest#decodesOggVorbis';
    const standIn = 'com.kimjisub.launchpad.audio.SoundOutputDeviceTest#anOggVorbisSoundPlays';
    /**
     * A-03 checked with `registered` as its NATIVE_TESTS entry (none for undefined): the file leaves the
     * registered tests out and reports only the unlisted one, run once and passed, with A-03 passed.
     */
    const check = (registered) => {
      const saved = NATIVE_TESTS.android['A-03'];
      if (registered) NATIVE_TESTS.android['A-03'] = registered;
      else delete NATIVE_TESTS.android['A-03'];
      try {
        assert.equal(registered?.includes(unlisted) ?? false, false);
        const file = nativeFile('android', { items: { ...NATIVE_TESTS.android, 'A-03': [unlisted] } });
        assert.equal(file.items['A-03'].status, 'passed');
        const cell = items({ android: read('android', file) }).get('A-03').android;
        assert.equal(cell.confirmed, false, `registered: ${registered}`);
        if (!registered) assert.equal(cell.detail, 'no case checks this item, and no android app test is listed for it');
        else for (const name of registered) assert.ok(cell.detail.includes(`${name} missing`), cell.detail);
      } finally {
        if (saved) NATIVE_TESTS.android['A-03'] = saved;
        else delete NATIVE_TESTS.android['A-03'];
      }
    };
    // As NATIVE_TESTS stands, and with a registration in place of none or none in place of one, so the
    // check keeps its meaning once Android A-03 lists the tests that measure what is played.
    const actual = NATIVE_TESTS.android['A-03'];
    check(actual);
    check(actual ? undefined : [standIn]);
  });
});


test('explicit historical copy pins verify bytes, warn, and fail strict checks without verifying old results', () => {
  const root = mkdtempSync(join(tmpdir(), 'unipack-pinned-copy-'));
  const dir = join(root, COPY_DIRS.android);
  const commit = 'a'.repeat(40);
  const oldCorpus = { ...corpus, grammar: 'G5', cases: corpus.cases.slice(0, -1) };
  const older = Buffer.from(serialize(oldCorpus));
  const olderHash = sha256(older);
  const pins = { android: { commit, corpusSha256: olderHash }, ios: 'b'.repeat(40) };
  const inspect = (extra = {}) => checkCopies({ android: root }, { pins, commits: { android: commit }, ...extra });
  try {
    const copied = spawnSync(process.execPath, [join(here, 'sync.mjs'), '--android', root], { encoding: 'utf8' });
    assert.equal(copied.status, 0, copied.stderr);
    writeFileSync(join(dir, 'corpus.json'), older);
    writeFileSync(join(dir, 'corpus.sha256'), digestLine(older));
    const seen = inspect();
    assert.deepEqual(seen.errors, []);
    assert.equal(seen.warnings.length, 1);
    assert.match(seen.warnings[0], /android: behind canonical/);
    assert.ok(seen.warnings[0].includes(olderHash));
    assert.ok(seen.warnings[0].includes(canonical.sha256));
    assert.ok(inspect({ requireCurrent: true }).errors.some((e) => /behind canonical/.test(e)));
    assert.ok(inspect({ commits: { android: 'c'.repeat(40) } }).errors.length > 0, 'an override cannot inherit an unrelated pin');
    const reported = { ...fullResults('android'), corpusSha256: olderHash };
    assert.deepEqual(statusesOf(judge(canonical, 'android', reported)), ['unverified']);
    assert.equal(buildReport(canonical, { android: reported }).summary.android.pass, 0);
    const cliPins = join(root, 'pins.json');
    writeFileSync(cliPins, JSON.stringify(pins));
    const cli = (...args) => spawnSync(process.execPath, [join(here, 'sync.mjs'), '--check', '--android', root, '--pins', cliPins, '--android-commit', commit, ...args], { encoding: 'utf8' });
    assert.equal(cli().status, 0, cli().stderr);
    assert.match(cli().stdout, /::warning::android: behind canonical/);
    assert.equal(cli('--require-current').status, 1);
    writeFileSync(join(dir, 'corpus.json'), Buffer.concat([older, Buffer.from(' ')]));
    assert.ok(inspect().errors.length > 0, 'one changed byte fails even if JSON still parses');
    writeFileSync(join(dir, 'corpus.json'), older);
    writeFileSync(join(dir, 'corpus.sha256'), digestLine(readFileSync(join(here, 'corpus.json'))));
    assert.ok(inspect().errors.length > 0, 'a forged sidecar hash fails');
    rmSync(join(dir, 'corpus.sha256'));
    assert.ok(inspect().errors.length > 0, 'a missing hash fails');
    assert.ok(checkCopies({ android: root }, { sourceDir: root, pins }).errors.length > 0, 'missing canonical data fails closed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('historical pins require exact keys, lowercase hashes and immutable commits', () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40), hash = 'c'.repeat(64);
  const text = JSON.stringify({ android: { commit: a, corpusSha256: hash }, ios: b });
  assert.deepEqual(resolvePins(text).android, { commit: a, corpusSha256: hash });
  assert.deepEqual(resolveCommits(text), { android: a, ios: b });
  for (const pin of [{ commit: a }, { corpusSha256: hash }, { commit: 'main', corpusSha256: hash }, { commit: a, corpusSha256: 'short' }, { commit: a, corpusSha256: hash.toUpperCase() }, { commit: a, corpusSha256: hash, extra: true }, null, []]) {
    assert.throws(() => resolvePins(JSON.stringify({ android: pin, ios: b })));
  }
});


test('adopted product cases share the pinned audio inputs and reject fabricated observations', () => {
  const audio = JSON.parse(readFileSync(new URL('../../src/lib/unipack/__fixtures__/audio-safety/cases.json', import.meta.url), 'utf8'));
  const added = corpus.cases.filter(c => c.productBehavior);
  assert.equal(added.filter(c => c.observation === 'audio-cost').length, audio.costs.length);
  assert.equal(added.filter(c => c.observation === 'audio-file').length, audio.files.length);
  assert.equal(added.filter(c => c.observation === 'audio-wave').length, audio.wavRecipes.length);
  assert.equal(added.filter(c => c.observation === 'audio-selection').length, audio.selections.length);
  assert.ok(added.some(c => c.observation === 'auto-map'));
  assert.ok(added.some(c => c.id === 'RUN-P001'));
  for (const c of added) for (const platform of PLATFORMS) {
    const only = { corpus: { ...corpus, cases: [c] }, sha256: canonical.sha256 };
    const result = cases => ({ platform, corpusSha256: canonical.sha256, cases });
    assert.equal(judge(only, platform, result([])).get(c.id).status, 'unverified', c.id);
    assert.equal(judge(only, platform, result([{ id: c.id, fingerprint: c.fingerprint, status: 'pass' }])).get(c.id).status, 'unverified', c.id);
    const actual = { injectedWrongResult: true };
    assert.equal(judge(only, platform, result([{ id: c.id, fingerprint: c.fingerprint, status: 'pass', actual }])).get(c.id).status, 'unverified', c.id);
    assert.equal(judge(only, platform, result([{ id: c.id, fingerprint: c.fingerprint, status: 'fail', actual }])).get(c.id).status, 'fail', c.id);
  }
});


test('pure product operations cannot certify complete app behavior or consume expected inputs', () => {
  for (const c of corpus.cases.filter(c => c.productBehavior)) {
    const input = c.files.find(f => f.path === 'operation.json');
    if (input) {
      const data = JSON.parse(input.text);
      for (const key of ['expected', 'expectedCost', 'exclusion', 'selected', 'reservedCost', 'events']) assert.equal(key in data, false, `${c.id}/${key}`);
    }
  }
  const report = buildReport(canonical, Object.fromEntries(PLATFORMS.map(p => [p, fullResults(p)])));
  for (let i = 1; i <= 9; i++) for (const platform of PLATFORMS) {
    const item = report.grammar.rows.find(row => row.id === `PB-${String(i).padStart(2, '0')}`);
    assert.ok(item);
    assert.equal(item[platform].confirmed, false, `${item.id}/${platform}`);
  }
});


test('local copy verification uses current bytes unless an explicit commit selects a historical pin', () => {
  const root = mkdtempSync(join(tmpdir(), 'unipack-local-copy-'));
  const dir = join(root, COPY_DIRS.android);
  const commit = 'a'.repeat(40);
  const older = Buffer.from(serialize({ ...corpus, grammar: 'G5', cases: corpus.cases.slice(0, -1) }));
  const pins = join(root, 'pins.json');
  writeFileSync(pins, JSON.stringify({ android: { commit, corpusSha256: sha256(older) }, ios: 'b'.repeat(40) }));
  const cli = (...args) => spawnSync(process.execPath, [join(here, 'sync.mjs'), '--android', root, '--pins', pins, ...args], { encoding: 'utf8' });
  try {
    assert.equal(cli().status, 0);
    const local = cli('--check');
    assert.equal(local.status, 0, local.stderr);
    assert.doesNotMatch(local.stdout, /behind canonical/);
    assert.equal(cli('--check', '--require-current').status, 0);
    writeFileSync(join(dir, 'corpus.json'), older);
    writeFileSync(join(dir, 'corpus.sha256'), digestLine(older));
    assert.equal(cli('--check').status, 1, 'an unspecified commit cannot authorize historical bytes');
    const selected = cli('--check', '--android-commit', commit);
    assert.equal(selected.status, 0, selected.stderr);
    assert.match(selected.stdout, /behind canonical/);
    assert.equal(cli('--check', '--android-commit', commit, '--require-current').status, 1);
    assert.equal(cli('--check', '--android-commit', 'c'.repeat(40)).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('later input release stops its replacement sound and light before the remaining input releases', () => {
  for (const id of ['RUN-G617', 'RUN-G618']) {
    const c = buildCorpus().cases.find(c => c.id === id);
    assert.deepEqual(c.expected.checkpoints, [
      [['sound', 0, 0, 0, 'a.wav', -1], ['ledOn', 0, 0, 'ffff0000', 4]],
      [['soundStop', 0, 0, 0, 'a.wav'], ['sound', 0, 0, 0, 'a.wav', -1], ['ledOff', 0, 0], ['ledOn', 0, 0, 'ffff0000', 4]],
      [['soundStop', 0, 0, 0, 'a.wav'], ['ledOff', 0, 0]],
      [],
    ], id);
  }
});
