#!/usr/bin/env node
// Joins the three platforms' conformance results into one row per case.
//   node meta/unipack-conformance/report.mjs --web web.json [--android android.json] [--ios ios.json]
//     [--android-native results.json] [--ios-native ios-native.json] [--web-native items.json] [--json]
// It also says, per item of the grammar (GRAMMAR.md), whether the item is confirmed on each platform, and
// on what: the common cases, the app's own tests (`--<platform>-native`, see native.mjs), or both.
// The status of a case is worked out here from the result (`actual`) the platform recorded; the status
// the platform wrote is only cross-checked. A platform that was not given, whose file belongs to
// another platform, that ran another corpus or other input, or that claims a status without the result
// behind it, is `unverified` for the affected cases. None of these is ever counted as a pass.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { HARNESS_LIMITS, NATIVE_TESTS, readGrammar } from './grammar.mjs';
import { restsOnAgreement, restsOnDecision } from './lib.mjs';
import { readNative } from './native.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PLATFORMS = ['android', 'ios', 'web'];
export const STATUSES = ['pass', 'fail', 'unsupported', 'intended-difference', 'unverified'];

export function loadCanonical(path = join(here, 'corpus.json')) {
  const bytes = readFileSync(path);
  return { corpus: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') };
}

/**
 * A platform's JSON result file, or the UNIPACK-CONFORMANCE lines of a test log. A log line carries the
 * status the platform claims but not the result behind it, so `judge` reports every case read from a
 * log as unverified; it is parsed so that the table says why instead of the tool failing.
 */
export function parseResults(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return JSON.parse(text);
  const cases = [];
  let corpusSha256;
  let platform;
  for (const line of text.split(/\r?\n/)) {
    const corpusLine = line.indexOf('UNIPACK-CONFORMANCE-CORPUS ');
    if (corpusLine >= 0) {
      const meta = JSON.parse(line.slice(corpusLine + 'UNIPACK-CONFORMANCE-CORPUS '.length));
      corpusSha256 = meta.corpusSha256;
      platform = meta.platform;
      continue;
    }
    const caseLine = line.indexOf('UNIPACK-CONFORMANCE ');
    if (caseLine >= 0) {
      const entry = JSON.parse(line.slice(caseLine + 'UNIPACK-CONFORMANCE '.length));
      platform ??= entry.platform;
      cases.push({ id: entry.id, fingerprint: entry.fingerprint, status: entry.status, detail: '' });
    }
  }
  return { platform, corpusSha256, source: 'log', cases };
}

/** The status `actual` earns on a determined case the platform can observe; the harnesses' classify. */
export function classify(c, actual, platform) {
  const known = c.known?.[platform];
  if (isDeepStrictEqual(actual, c.expected)) return known ? 'unverified' : 'pass';
  if (known && [known.actual, ...(known.otherActuals ?? []).map((o) => o.actual)].some((a) => isDeepStrictEqual(actual, a))) return known.status;
  return 'fail';
}

/** One case of one platform: the status this tool can stand behind, and why when it is unverified. */
function verdict(c, r, platform) {
  const unverified = (detail) => ({ status: 'unverified', detail, actual: r.actual ?? undefined });
  if (c.expectation === 'undetermined') return unverified(`no doc or stated intent decides this: ${c.question}`);
  if (!STATUSES.includes(r.status)) return unverified(`${platform} reported the unknown status ${r.status}`);
  // A harness can come to observe a case the corpus still marks `unobserved`; the reason holds only
  // while the platform records no result for it.
  if (r.actual == null) {
    const unobserved = c.unobserved?.[platform];
    if (unobserved) return unverified(unobserved);
    return unverified(r.status === 'unverified'
      ? r.detail || `${platform} recorded no result for this case`
      : `${platform} reported ${r.status} without the result it is based on`);
  }
  const status = classify(c, r.actual, platform);
  if (status !== r.status) return unverified(`${platform} reported ${r.status} but its result classifies as ${status}`);
  return { status, detail: r.detail ?? '', actual: r.actual };
}

/** One platform's status and note for every case of the canonical corpus. */
export function judge({ corpus, sha256 }, platform, results) {
  const all = (why) => new Map(corpus.cases.map((c) => [c.id, { status: 'unverified', detail: why }]));
  if (!results) return all(`${platform} was not run`);
  if (results.platform !== platform) return all(`the results given as ${platform} are ${results.platform ?? 'of no named platform'}'s`);
  if (results.corpusSha256 !== sha256) return all(`${platform} ran corpus ${String(results.corpusSha256).slice(0, 12)}, not ${sha256.slice(0, 12)}`);
  if (results.source === 'log') return all(`${platform} was given as a test log, which has no results to check; give its ${platform}.json`);

  const byId = new Map(results.cases.map((r) => [r.id, r]));
  const out = new Map();
  for (const c of corpus.cases) {
    const r = byId.get(c.id);
    if (!r) out.set(c.id, { status: 'unverified', detail: `${platform} reported no result for this case` });
    else if (r.fingerprint !== c.fingerprint) out.set(c.id, { status: 'unverified', detail: `${platform} ran other input (fingerprint ${String(r.fingerprint).slice(0, 12)})` });
    else out.set(c.id, verdict(c, r, platform));
  }
  return out;
}

/** What a confirmed item rests on, given only when app test results were given at all. */
export const BASES = { common: 'common', native: 'app tests', both: 'common and app tests' };

/**
 * Whether the app test results of one platform confirm one item: the item is reported as passed, from the
 * run it must come from, and every test NATIVE_TESTS lists for it ran exactly once and passed. Other tests
 * in the file are not counted.
 */
function nativeVerdict(id, platform, native) {
  const reported = native.items[id];
  if (!reported) return { confirmed: false, detail: `the ${platform} app test results do not report it` };
  const problems = [];
  if (!reported.passed) problems.push(`the ${platform} app test results mark it ${reported.status}`);
  if (reported.unfit) problems.push(`the ${platform} app test results ${reported.unfit}`);
  const short = NATIVE_TESTS[platform][id].map((name) => [name, reported.test(name)]).filter(([, status]) => status !== 'passed');
  if (short.length) problems.push(`required ${platform} app tests did not pass exactly once: ${short.map(([name, status]) => `${name} ${status}`).join(', ')}`);
  return { confirmed: problems.length === 0, detail: problems.join('; ') };
}

/**
 * Whether one grammar item is confirmed on one platform. `result` is the platform's result file, for the
 * flag a limit may name; `native` its app test results (native.mjs), if given.
 * - No case checks the item: confirmed only by the app tests NATIVE_TESTS lists for it.
 * - The platform's harness cannot observe it (HARNESS_LIMITS): confirmed only when both its cases and the
 *   listed app tests pass; neither covers the other.
 * - Otherwise: by its cases alone, as without app test results. Every case must pass, and an output item
 *   needs a run or palette case among them.
 */
function itemVerdict(item, linked, platform, rowById, result, native, withBasis) {
  const confirmed = (basis) => ({ confirmed: true, detail: '', ...(withBasis && { basis }) });
  const listed = native && NATIVE_TESTS[platform]?.[item.id];
  if (linked.length === 0) {
    if (!listed) return { confirmed: false, detail: native ? `no case checks this item, and no ${platform} app test is listed for it` : 'no case checks this item' };
    const own = nativeVerdict(item.id, platform, native);
    return own.confirmed ? confirmed(BASES.native) : own;
  }
  const limit = HARNESS_LIMITS[platform]?.[item.id];
  const limited = limit && !(limit.unless && result?.[limit.unless] === true);
  if (limited && !listed) return { confirmed: false, detail: `the ${platform} harness cannot observe it: ${limit.reason}` };
  if (item.kind === 'output' && !linked.some((c) => c.layer === 'run' || c.layer === 'palette')) {
    return { confirmed: false, detail: 'an output item is confirmed by a run or palette case, and none checks it' };
  }
  const short = linked.filter((c) => rowById.get(c.id)[platform].status !== 'pass');
  const cases = short.length ? `not every case passes: ${short.map((c) => `${c.id} ${rowById.get(c.id)[platform].status}`).join(', ')}` : '';
  if (!limited) return cases ? { confirmed: false, detail: cases } : confirmed(BASES.common);
  const own = nativeVerdict(item.id, platform, native);
  if (cases || !own.confirmed) return { confirmed: false, detail: [cases, own.detail].filter(Boolean).join('; ') };
  return confirmed(BASES.both);
}

/**
 * One row per grammar item, and the four numbers: confirmed per platform, on all three, and with a case.
 * `natives` holds the app test results given per platform; with any of them, a confirmed item says what
 * it rests on (`basis`).
 */
export function buildItems(corpus, rows, results, natives = {}, grammar = readGrammar()) {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const withBasis = Object.keys(natives).length > 0;
  const itemRows = grammar.items.map((item) => {
    const linked = corpus.cases.filter((c) => c.items?.includes(item.id));
    const row = { id: item.id, kind: item.kind, cases: linked.map((c) => c.id) };
    for (const p of PLATFORMS) row[p] = itemVerdict(item, linked, p, rowById, results[p], natives[p], withBasis);
    return row;
  });
  return {
    edition: grammar.edition,
    corpusEdition: corpus.grammar ?? null,
    items: itemRows.length,
    confirmed: Object.fromEntries(PLATFORMS.map((p) => [p, itemRows.filter((r) => r[p].confirmed).length])),
    confirmedOnAllThree: itemRows.filter((r) => PLATFORMS.every((p) => r[p].confirmed)).length,
    withCases: itemRows.filter((r) => r.cases.length > 0).length,
    rows: itemRows,
  };
}

/** `natives`: per platform, its app test results as native.mjs reads them; none gives the report as before. */
export function buildReport(canonical, results, natives = {}) {
  const judged = Object.fromEntries(PLATFORMS.map((p) => [p, judge(canonical, p, results[p])]));
  const rows = canonical.corpus.cases.map((c) => {
    const row = { id: c.id, layer: c.layer, area: c.area, title: c.title, expectation: c.expectation, agreed: restsOnAgreement(c), decided: restsOnDecision(c) };
    for (const p of PLATFORMS) row[p] = judged[p].get(c.id);
    const actuals = PLATFORMS.map((p) => row[p].actual).filter((a) => a != null);
    if (c.expectation === 'undetermined' && actuals.length === PLATFORMS.length) {
      row.observed = actuals.every((a) => isDeepStrictEqual(a, actuals[0])) ? 'agree' : 'differ';
    }
    return row;
  });
  const summary = Object.fromEntries(PLATFORMS.map((p) => [p, Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r[p].status === s).length]))]));
  const passOnAllThree = rows.filter((r) => PLATFORMS.every((p) => r[p].status === 'pass'));
  // Cases whose expected result is only what the platforms agreed on, or what the maintainers decided,
  // counted apart from the ones a doc or an intent decides.
  const apart = (key) => {
    const marked = rows.filter((r) => r[key]);
    return {
      cases: marked.length,
      pass: Object.fromEntries(PLATFORMS.map((p) => [p, marked.filter((r) => r[p].status === 'pass').length])),
      passOnAllThree: passOnAllThree.filter((r) => r[key]).length,
    };
  };
  // When each result file was written and whether that run asserted, so a stale or record-only file shows.
  const runs = Object.fromEntries(PLATFORMS.map((p) => [p, results[p] ? { generatedAt: results[p].generatedAt ?? null, assertions: results[p].assertions ?? null } : null]));
  // Which app test results were counted: the file and the commit the tests ran on, beside `runs`, so a
  // reader can see whether they ran on the same commit as the common cases.
  const native = Object.keys(natives).length
    ? { native: Object.fromEntries(PLATFORMS.map((p) => [p, natives[p] ? { sha256: natives[p].sha256, commit: natives[p].commit } : null])) }
    : {};
  return {
    corpusSha256: canonical.sha256,
    cases: rows.length,
    runs,
    ...native,
    summary,
    passOnAllThree: passOnAllThree.length,
    agreed: apart('agreed'),
    decided: apart('decided'),
    rows,
    grammar: buildItems(canonical.corpus, rows, results, natives),
  };
}

export function renderText(report) {
  const out = [];
  out.push(`corpus ${report.corpusSha256.slice(0, 12)}, ${report.cases} cases`);
  for (const p of PLATFORMS) {
    const run = report.runs[p];
    const note = run?.assertions === 'skipped' ? ', a record-only run (UNIPACK_CONFORMANCE_DUMP=1): its cases were not asserted' : '';
    out.push(`${p.padEnd(9)}${run ? `results written ${run.generatedAt ?? 'at an unknown time'}${note}` : 'no results given'}`);
    if (report.native) {
      const native = report.native[p];
      out.push(`${''.padEnd(9)}${native ? `app test results ${native.sha256.slice(0, 12)}, run on commit ${native.commit}` : 'no app test results given'}`);
    }
  }
  out.push('');
  out.push(`${'platform'.padEnd(9)}${STATUSES.map((s) => s.padStart(20)).join('')}`);
  for (const p of PLATFORMS) out.push(`${p.padEnd(9)}${STATUSES.map((s) => String(report.summary[p][s]).padStart(20)).join('')}`);
  out.push('');
  const passes = (counted) => PLATFORMS.map((p) => `${p} ${counted.pass[p]}`).join(', ');
  out.push(`pass on all three platforms: ${report.passOnAllThree} of ${report.cases} cases, ${report.agreed.passOnAllThree} of them on an agreed basis, ${report.decided.passOnAllThree} on a decision basis`);
  out.push(`agreed basis: ${report.agreed.cases} cases hold what Android, iOS and the web all did, mostly where no doc decides (README, "Agreed behaviour", names the one that goes against a doc); pass ${passes(report.agreed)}`);
  out.push(`decision basis: ${report.decided.cases} cases hold what the maintainers chose (KL-024, and the items GRAMMAR.md decides) where the platforms, or the docs and the platforms, differed; pass ${passes(report.decided)}`);
  out.push('This is a result for the cases in this corpus only. It does not show that every UniPack is compatible.');
  out.push('');
  const g = report.grammar;
  if (g.corpusEdition !== g.edition) out.push(`the corpus was built against grammar ${g.corpusEdition}, this tool reads ${g.edition}: item numbers may not match`);
  out.push(`grammar ${g.edition}: confirmed ${PLATFORMS.map((p) => `${p} ${g.confirmed[p]}`).join(', ')} of ${g.items} items; on all three platforms ${g.confirmedOnAllThree} of ${g.items}; ${g.withCases} of ${g.items} have a case`);
  out.push('');
  const short = { pass: 'pass', fail: 'FAIL', unsupported: 'UNSUPP', 'intended-difference': 'INTENDED', unverified: '-' };
  out.push(`${'case'.padEnd(11)}${'android'.padEnd(10)}${'ios'.padEnd(10)}${'web'.padEnd(10)}title`);
  for (const r of report.rows) {
    const cells = PLATFORMS.map((p) => short[r[p].status].padEnd(10)).join('');
    const tail = r.observed ? ` [undetermined: observed results ${r.observed}]` : r.expectation === 'undetermined' ? ' [undetermined]' : r.agreed ? ' [agreed]' : r.decided ? ' [decision]' : '';
    out.push(`${r.id.padEnd(11)}${cells}${r.title}${tail}`);
  }
  out.push('');
  out.push(`${'item'.padEnd(11)}${'android'.padEnd(10)}${'ios'.padEnd(10)}${'web'.padEnd(10)}cases`);
  const mark = { [BASES.common]: 'ok', [BASES.native]: 'ok app', [BASES.both]: 'ok both' };
  for (const r of g.rows) out.push(`${r.id.padEnd(11)}${PLATFORMS.map((p) => (r[p].confirmed ? mark[r[p].basis] ?? 'ok' : '-').padEnd(10)).join('')}${r.cases.join(' ') || '(none)'}`);
  if (report.native) out.push('ok: by the common cases; ok app: by the app tests, no case checks it; ok both: by the cases and the app tests, which the harness cannot observe alone');
  const notes = report.rows.flatMap((r) => PLATFORMS.filter((p) => (r[p].status !== 'pass' || r[p].reportedStatus) && r[p].detail && r.expectation === 'determined').map((p) => `${r.id} ${p}: ${r[p].detail}`));
  if (notes.length) out.push('', 'notes', ...notes);
  const itemNotes = g.rows.flatMap((r) => PLATFORMS.filter((p) => !r[p].confirmed).map((p) => `${r.id} ${p}: ${r[p].detail}`));
  if (itemNotes.length) out.push('', 'items not confirmed', ...itemNotes);
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const results = {};
  const natives = {};
  for (const p of PLATFORMS) {
    const path = arg(`--${p}`);
    if (!path) continue;
    try {
      results[p] = parseResults(readFileSync(path, 'utf8'));
    } catch (error) {
      console.error(`cannot read ${p} results from ${path}: ${error.message}`);
      process.exit(3);
    }
  }
  for (const p of PLATFORMS) {
    const path = arg(`--${p}-native`);
    if (!path) continue;
    try {
      natives[p] = readNative(p, readFileSync(path));
    } catch (error) {
      console.error(`cannot use ${p} app test results from ${path}: ${error.message}`);
      process.exit(3);
    }
  }
  const report = buildReport(loadCanonical(arg('--corpus')), results, natives);
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : renderText(report));
}
