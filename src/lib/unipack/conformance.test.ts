// Runs the shared conformance corpus (meta/unipack-conformance/corpus.json) through the web parser
// and runners, prints one result per case and writes web.json for meta/unipack-conformance/report.mjs.
// It also runs the corpus tooling's own tests, so `pnpm test:unipack` notices a corpus.json that was
// not rebuilt from its sources.
//
// Compiled by tsc before running, like the other unipack *.test.ts (see parser.test.ts).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LedRunner } from './LedRunner';
import { AutoPlayRunner } from './AutoPlayRunner';
import { AUTO_PLAY_INPUT, SoundEngine } from './SoundEngine';
import {
  actualFor, capturedCase, classify, corpusPath, CorpusCase, CorpusFile, Deps, fingerprintOf, Json, loadCorpus, normalizeError, observe, PLATFORM, REAL,
  resultFor, verifyCorpusDigest, verifyFingerprint, warningCaptureFile,
} from './conformanceHarness';

const { corpus, sha256 } = loadCorpus();

// UNIPACK_CONFORMANCE_DUMP=1, and only that value, makes this a record-only run: every result is written
// but no case is asserted, to look at a platform's differences before they are pinned in
// divergences.json. Such a run is never a pass: it ends with one failing test that says so.
const RECORD_ONLY = process.env.UNIPACK_CONFORMANCE_DUMP === '1';
const RECORD_ONLY_NOTICE = 'UNIPACK_CONFORMANCE_DUMP=1: record-only run, no case was asserted';
const results: { id: string; fingerprint: string; status: string; detail: string; actual: Json }[] = [];
const captured: Json[] = [];

function byId(id: string): CorpusCase {
  const found = corpus.cases.find((c) => c.id === id);
  assert.ok(found, `case ${id} is in the corpus`);
  return found;
}

describe('corpus integrity', () => {
  test('has unique case ids and every case declares the fingerprint of its input files', () => {
    const ids = corpus.cases.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of corpus.cases) verifyFingerprint(c, corpus);
  });

  test('a determined case states its expected result, an undetermined one states the open question', () => {
    for (const c of corpus.cases) {
      if (c.expectation === 'determined') assert.notEqual(c.expected, undefined, c.id);
      else assert.ok(c.question, c.id);
    }
  });
});

describe('cases', () => {
  for (const c of corpus.cases) {
    test(`${c.id} ${c.title}`, async () => {
      verifyFingerprint(c, corpus);
      const { actual, capture, outcome } = await resultFor(c, corpus);
      results.push({ id: c.id, fingerprint: c.fingerprint, status: outcome.status, detail: outcome.detail, actual });
      if (capture) captured.push(capturedCase(c, corpus, capture));
      if (RECORD_ONLY) return;
      assert.equal(outcome.unexpected, false, `${c.id}: ${outcome.detail}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(c.expected)}`);
    });
  }
});

// A check that cannot fail proves nothing: each of these breaks one thing the cases above rely on and
// requires the comparison to notice.
describe('the checks can fail', () => {
  test('a copy of corpus.json that does not hash to its corpus.sha256, or has none, is refused', () => {
    const bytes = readFileSync(corpusPath());
    const digest = readFileSync(join(dirname(corpusPath()), 'corpus.sha256'), 'utf8');
    assert.equal(verifyCorpusDigest(bytes, digest), sha256);
    const changed = Buffer.from(bytes);
    changed[changed.indexOf('KS-001')] ^= 1;
    assert.throws(() => verifyCorpusDigest(changed, digest), /hashes to/);
    assert.throws(() => verifyCorpusDigest(bytes, null), /corpus\.sha256 is missing/);
    assert.throws(() => verifyCorpusDigest(bytes, digest.trim()), /not one/);
  });

  test('a changed input file no longer matches the case fingerprint', () => {
    const c = byId('KS-001');
    const altered: CorpusCase = { ...c, files: c.files.map((f) => (f.path === 'keySound' ? { ...f, text: `${f.text}\n1 2 2 c.wav` } : f)) };
    assert.notEqual(fingerprintOf(altered.files, corpus), c.fingerprint);
    assert.throws(() => verifyFingerprint(altered, corpus), /hash to/);
  });

  test('a changed expected coordinate makes a passing case fail', async () => {
    const c = byId('KS-001');
    const actual = await actualFor(c, corpus);
    assert.equal(classify(c, actual).status, 'pass');
    const shifted: CorpusCase = JSON.parse(JSON.stringify(c));
    (shifted.expected as { sounds: { x: number }[] }).sounds[0].x += 1;
    assert.equal(classify(shifted, actual).status, 'fail');
  });

  test('a changed input makes the same expected result fail', async () => {
    const c = byId('KS-001');
    const altered: CorpusCase = { ...c, files: c.files.map((f) => (f.path === 'keySound' ? { ...f, text: '1 2 1 a.wav\n2 4 3 b.wav' } : f)) };
    assert.equal(classify(c, await actualFor(altered, corpus)).status, 'fail');
  });

  test('leaving the parser call out fails a parse case', async () => {
    const c = byId('KS-001');
    const noParse: Deps = { ...REAL, parse: async () => ({ ...(await REAL.parse(await emptyPack())), errors: [] }) };
    assert.equal(classify(c, await actualFor(c, corpus, noParse)).status, 'fail');
  });

  test('leaving the LED runner call out fails a run case', async () => {
    const c = byId('RUN-L-001');
    assert.equal(classify(c, await actualFor(c, corpus)).status, 'pass');
    class SilentLedRunner extends LedRunner {
      eventOn(): void {}
    }
    const noLed: Deps = { ...REAL, LedRunner: SilentLedRunner };
    assert.equal(classify(c, await actualFor(c, corpus, noLed)).status, 'fail');
  });

  test('autoPlay presses that do not reach the pads fail a toPads case', async () => {
    const c = byId('RUN-RP-003');
    assert.equal(classify(c, await actualFor(c, corpus)).status, 'pass');
    const notForwarded: CorpusCase = { ...c, scenario: c.scenario!.map((s) => (s.do === 'autoplay' ? { do: 'autoplay' } : s)) };
    assert.equal(classify(c, await actualFor(notForwarded, corpus)).status, 'fail');
  });

  test('RUN-RP-005 fails when endless sounds ignore release', async () => {
    const c = byId('RUN-RP-005');
    assert.equal(classify(c, await actualFor(c, corpus)).status, 'pass');
    class UnreleasedSoundEngine extends SoundEngine {
      soundOff(): void {}
    }
    assert.equal(classify(c, await actualFor(c, corpus, { ...REAL, SoundEngine: UnreleasedSoundEngine })).status, 'fail');
  });

  test('RUN-RP-005 fails when autoPlay continues after it is turned off', async () => {
    const c = byId('RUN-RP-005');
    class UnstoppedAutoPlayRunner extends AutoPlayRunner {
      stop(): void {}
    }
    assert.equal(classify(c, await actualFor(c, corpus, { ...REAL, AutoPlayRunner: UnstoppedAutoPlayRunner })).status, 'fail');
  });

  test('autoPlay and the player hold pads under different inputs, as on the play screen', async () => {
    const c = byId('RUN-RP-003');
    const withPlayer: CorpusCase = { ...c, scenario: [{ do: 'press', x: 1, y: 1 }, { do: 'release', x: 1, y: 1 }, ...c.scenario!] };
    const calls: [string, string | undefined][] = [];
    class RecordingSoundEngine extends SoundEngine {
      soundOn(x: number, y: number, input?: string): void { calls.push(['on', input]); super.soundOn(x, y, input); }
      soundOff(x: number, y: number, input?: string): void { calls.push(['off', input]); super.soundOff(x, y, input); }
    }
    await actualFor(withPlayer, corpus, { ...REAL, SoundEngine: RecordingSoundEngine });
    const [playerOn, playerOff, autoOn, autoOff] = calls;
    assert.equal(calls.length, 4);
    assert.equal(typeof playerOn[1], 'string');
    assert.notEqual(playerOn[1], AUTO_PLAY_INPUT);
    assert.deepEqual([playerOff, autoOn, autoOff], [['off', playerOn[1]], ['on', AUTO_PLAY_INPUT], ['off', AUTO_PLAY_INPUT]]);
  });

  test('a pinned difference that no longer happens, or changed, is reported as unexpected', () => {
    const c = { ...byId('KS-001'), known: { [PLATFORM]: { status: 'fail' as const, actual: { loaded: false }, note: 'pinned' } } };
    assert.equal(classify(c, c.expected as Json).unexpected, true);
    assert.equal(classify(c, { loaded: true }).unexpected, true);
    assert.deepEqual(classify(c, { loaded: false }), { status: 'fail', unexpected: false, detail: 'pinned' });
  });

  test('an undetermined case is never counted as a pass', async () => {
    const { expected, ...open } = byId('KS-001');
    const c: CorpusCase = { ...open, expectation: 'undetermined', question: 'still open?' };
    const actual = await actualFor(c, corpus);
    assert.deepEqual(actual, expected);
    assert.equal(classify(c, actual).status, 'unverified');
  });

  test('a case the corpus says this platform cannot observe is unverified and is not run', async () => {
    const c: CorpusCase = { ...byId('KS-001'), unobserved: { [PLATFORM]: 'not observable here' } };
    const neverRun: Deps = { ...REAL, parse: async () => { throw new Error('the case was run'); } };
    assert.deepEqual(await resultFor(c, corpus, neverRun), { actual: null, capture: null, outcome: { status: 'unverified', unexpected: false, detail: 'not observable here' } });
  });
});

// The warnings the parser writes, kept as written, and the number cause the diagnostics tool reads from
// them (meta/unipack-conformance/diagnostics). The tool sees each warning and the pack size only; these
// checks run it on warnings this parser wrote, for corpus cases and for inputs changed under new ids.
describe('raw warnings and their number cause', () => {
  // Non-numeric autoPlay values and keyLed file names, which every platform reports as `format`.
  const NON_NUMERIC = ['AP-M01', 'AP-M02', 'AP-M03', 'AP-M04', 'AP-M05', 'AP-M06', 'AP-M07', 'AP-M08', 'AP-M09', 'AP-M11', 'KL-N01', 'KL-N02', 'KL-N03', 'KL-N04', 'KL-N05'];
  // Non-numeric keySound chain, x, y, loop and wormhole values.
  const KEY_SOUND_NON_NUMERIC = ['KS-M01', 'KS-M02', 'KS-M03', 'KS-M04', 'KS-M05', 'KS-M06', 'KS-M07', 'KS-M08'];
  const SECTION_OF: Record<string, string> = { AP: 'autoPlay', KL: 'keyLed', KS: 'keySound' };
  /** The bracketed input of the case's warning: the first line of its autoPlay or keySound, or its keyLed file name. */
  const inputOf = (c: CorpusCase) => (c.id.startsWith('KL')
    ? c.files.find((f) => f.path.startsWith('keyLed/'))!.path.slice('keyLed/'.length)
    : c.files.find((f) => f.path === SECTION_OF[c.id.slice(0, 2)])!.text!.split('\n')[0]);

  const variant = (id: string, from: string, change: (f: CorpusFile) => CorpusFile): CorpusCase => ({ ...byId(from), id, files: byId(from).files.map(change) });
  const autoPlayLine = (id: string, line: string) => variant(id, 'AP-M01', (f) => (f.path === 'autoPlay' ? { ...f, text: `${line}\non 1 1` } : f));
  const keyLedName = (id: string, name: string) => variant(id, 'KL-N01', (f) => (f.path.startsWith('keyLed/') ? { ...f, path: `keyLed/${name}` } : f));
  const keySoundLine = (id: string, line: string) => variant(id, 'KS-M01', (f) => (f.path === 'keySound' ? { ...f, text: `${line}\n1 1 2 b.wav` } : f));

  interface Cause { id: string; raw: string; cause: string }
  /** Runs the parser on each case and hands what it wrote to the diagnostics tool, as a file, like a user would. */
  async function causesOf(cases: CorpusCase[], edit: (record: { pack: Json }) => void = () => {}): Promise<Cause[]> {
    const records: Json[] = [];
    for (const c of cases) {
      const { capture } = await observe(c, corpus);
      assert.ok(capture?.warnings, `${c.id}: the parser read the pack`);
      const record = capturedCase(c, corpus, capture) as { pack: Json };
      edit(record);
      records.push(record as Json);
    }
    const dir = mkdtempSync(join(tmpdir(), 'unipack-warnings-'));
    try {
      const file = join(dir, 'web-warnings.json');
      writeFileSync(file, JSON.stringify(warningCaptureFile(records, sha256)));
      const run = spawnSync(process.execPath, ['meta/unipack-conformance/diagnostics/number-warnings.mjs', file], { cwd: process.cwd(), encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      return (JSON.parse(run.stdout) as { warnings: Cause[] }).warnings;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  for (const [name, ids] of [['each non-numeric case', NON_NUMERIC], ['each non-numeric keySound case', KEY_SOUND_NON_NUMERIC]] as const) {
    test(`${name} keeps the warning as written and its result, and is explained as a format failure`, async () => {
      const causes = await causesOf(ids.map(byId));
      assert.deepEqual(causes.map((w) => w.id), ids);
      for (const id of ids) {
        const c = byId(id);
        const { actual, capture, outcome } = await resultFor(c, corpus);
        assert.equal(capture?.warnings?.length, 1, id);
        assert.equal(capture!.warnings![0], `${SECTION_OF[id.slice(0, 2)]}: [${inputOf(c)}] format is incorrect`, id);
        assert.equal(causes.find((w) => w.id === id)?.raw, capture!.warnings![0], `${id}: the tool got the warning as written`);
        assert.equal(causes.find((w) => w.id === id)?.cause, 'format', id);
        assert.deepEqual((actual as { errors: Json }).errors, [`${SECTION_OF[id.slice(0, 2)]}:format`], `${id}: the normalized result is unchanged`);
        assert.equal(outcome.status, 'pass', `${id}: ${outcome.detail}`);
      }
    });
  }

  test('the same inputs under other ids, and other non-numeric values, are a format failure too', async () => {
    const changed = [
      autoPlayLine('ALT-1', 'touch 2 q'), autoPlayLine('ALT-2', 'o 2'), autoPlayLine('ALT-3', 'd 2.5'), autoPlayLine('ALT-4', 'c 1x'),
      keyLedName('ALT-5', '2 x 1'), keyLedName('ALT-6', '1 1 z'), keyLedName('ALT-7', '1 1 1 0.5'), { ...byId('AP-M01'), id: 'ALT-8' },
      keySoundLine('ALT-9', 'q 2 1 a.wav'), keySoundLine('ALT-10', '2 1 1.0 a.wav'), keySoundLine('ALT-11', '1 2 1 a.wav x'),
      keySoundLine('ALT-12', '1 1 1 a.wav 1 2z'), keySoundLine('ALT-13', '1 2e 1 b.wav'), { ...byId('KS-M06'), id: 'ALT-14' },
    ];
    assert.deepEqual((await causesOf(changed)).map((w) => [w.id, w.cause]), changed.map((c) => [c.id, 'format']));
  });

  test('a valid integer outside the pack stays a range failure', async () => {
    const outside = [
      autoPlayLine('RANGE-1', 'on 5 1'), autoPlayLine('RANGE-2', 'chain 3'), keyLedName('RANGE-3', '3 1 1'), keyLedName('RANGE-4', '1 5 1'), keyLedName('RANGE-5', '1 1 1 -1'),
      keySoundLine('RANGE-6', '3 1 1 a.wav'), keySoundLine('RANGE-7', '1 5 1 a.wav'),
    ];
    assert.deepEqual((await causesOf(outside)).map((w) => [w.id, w.cause]), outside.map((c) => [c.id, 'range']));
  });

  test('a bracket in the input, an integer past 32 bits or an unknown pack size is insufficient information', async () => {
    const unclear = [keyLedName('UNCLEAR-1', '1 [2] 1'), autoPlayLine('UNCLEAR-2', 'on 99999999999 1'), keySoundLine('UNCLEAR-3', '1 [2] 1 a.wav')];
    assert.deepEqual((await causesOf(unclear)).map((w) => [w.id, w.cause]), unclear.map((c) => [c.id, 'insufficient-information']));
    const withoutPack = (record: { pack: Json }) => { record.pack = null; };
    const causes = await causesOf([autoPlayLine('NOPACK-1', 'on 5 1'), autoPlayLine('NOPACK-2', 'on a 1'), keySoundLine('NOPACK-3', '1 1 1 a.wav q')], withoutPack);
    assert.deepEqual(causes.map((w) => [w.id, w.cause]), [['NOPACK-1', 'insufficient-information'], ['NOPACK-2', 'format'], ['NOPACK-3', 'format']]);
  });

  test('a keySound line with no sound name is not a number warning, whatever the case id', async () => {
    const short = [byId('KS-006'), keySoundLine('SHORT-1', '1 2 1'), keySoundLine('SHORT-2', '2 1 3')];
    assert.deepEqual((await causesOf(short)).map((w) => [w.id, w.cause]), short.map((c) => [c.id, 'not-a-number-warning']));
  });
});

describe('tooling', () => {
  // The test runner marks its children through NODE_TEST_CONTEXT; a nested runner must not inherit it.
  const nested = (file: string) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', file], { cwd: process.cwd(), env, encoding: 'utf8' });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  };

  test('corpus.json is current and the report tool passes its own tests (meta/unipack-conformance/selftest.mjs)', () => {
    nested('meta/unipack-conformance/selftest.mjs');
  });

  test('the warning diagnostics tool passes its own tests (meta/unipack-conformance/diagnostics/selftest.mjs)', () => {
    nested('meta/unipack-conformance/diagnostics/selftest.mjs');
  });
});

describe('this run', () => {
  test('asserted every case (a record-only run is never a pass)', () => {
    assert.equal(RECORD_ONLY, false, RECORD_ONLY_NOTICE);
  });
});

/** The smallest pack that parses, standing in for "the parser ran but saw nothing of the case". */
async function emptyPack(): Promise<ArrayBuffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('info', 'title=x\nproducerName=x\nbuttonX=1\nbuttonY=1\nchain=1');
  zip.file('keySound', '');
  return zip.generateAsync({ type: 'arraybuffer' });
}

after(() => {
  const dir = process.env.UNIPACK_CONFORMANCE_OUT ?? join(process.cwd(), '.next/cache/unipack-conformance');
  mkdirSync(dir, { recursive: true });
  const report = {
    platform: PLATFORM, corpusSha256: sha256, generatedAt: new Date().toISOString(), assertions: RECORD_ONLY ? 'skipped' : 'checked',
    cases: results.sort((a, b) => a.id.localeCompare(b.id)),
  };
  writeFileSync(join(dir, `${PLATFORM}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(dir, `${PLATFORM}-warnings.json`), `${JSON.stringify(warningCaptureFile(captured, sha256), null, 2)}\n`);
  if (RECORD_ONLY) console.log(`UNIPACK-CONFORMANCE-RECORD-ONLY ${RECORD_ONLY_NOTICE}`);
  for (const r of report.cases) console.log(`UNIPACK-CONFORMANCE ${JSON.stringify({ platform: PLATFORM, id: r.id, fingerprint: r.fingerprint, status: r.status })}`);
  console.log(`UNIPACK-CONFORMANCE-CORPUS ${JSON.stringify({ platform: PLATFORM, corpusSha256: sha256, cases: report.cases.length })}`);
});

describe('chain move warning normalization', () => {
  for (const section of ['keySound:', 'keySound :']) {
    test(`classifies ${section} wormhole warnings as range errors`, () => {
      assert.equal(normalizeError(`${section} [1 1 1 a.wav 1 40] wormhole is incorrect`), 'keySound:range');
    });
  }
});
