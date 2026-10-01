#!/usr/bin/env node
// Joins the three platforms' conformance results into one row per case.
//   node meta/unipack-conformance/report.mjs --web web.json [--android android.json] [--ios ios.json] [--json]
// The status of a case is worked out here from the result (`actual`) the platform recorded; the status
// the platform wrote is only cross-checked. A platform that was not given, whose file belongs to
// another platform, that ran another corpus or other input, or that claims a status without the result
// behind it, is `unverified` for the affected cases. None of these is ever counted as a pass.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

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
  if (known && isDeepStrictEqual(actual, known.actual)) return known.status;
  return 'fail';
}

/** One case of one platform: the status this tool can stand behind, and why when it is unverified. */
function verdict(c, r, platform) {
  const unverified = (detail) => ({ status: 'unverified', detail, actual: r.actual ?? undefined });
  if (c.expectation === 'undetermined') return unverified(`no doc or stated intent decides this: ${c.question}`);
  const unobserved = c.unobserved?.[platform];
  if (unobserved) return unverified(unobserved);
  if (!STATUSES.includes(r.status)) return unverified(`${platform} reported the unknown status ${r.status}`);
  if (r.actual == null) {
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

export function buildReport(canonical, results) {
  const judged = Object.fromEntries(PLATFORMS.map((p) => [p, judge(canonical, p, results[p])]));
  const rows = canonical.corpus.cases.map((c) => {
    const row = { id: c.id, layer: c.layer, area: c.area, title: c.title, expectation: c.expectation };
    for (const p of PLATFORMS) row[p] = judged[p].get(c.id);
    const actuals = PLATFORMS.map((p) => row[p].actual).filter((a) => a != null);
    if (c.expectation === 'undetermined' && actuals.length === PLATFORMS.length) {
      row.observed = actuals.every((a) => isDeepStrictEqual(a, actuals[0])) ? 'agree' : 'differ';
    }
    return row;
  });
  const summary = Object.fromEntries(PLATFORMS.map((p) => [p, Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r[p].status === s).length]))]));
  // When each result file was written and whether that run asserted, so a stale or record-only file shows.
  const runs = Object.fromEntries(PLATFORMS.map((p) => [p, results[p] ? { generatedAt: results[p].generatedAt ?? null, assertions: results[p].assertions ?? null } : null]));
  return {
    corpusSha256: canonical.sha256,
    cases: rows.length,
    runs,
    summary,
    passOnAllThree: rows.filter((r) => PLATFORMS.every((p) => r[p].status === 'pass')).length,
    rows,
  };
}

export function renderText(report) {
  const out = [];
  out.push(`corpus ${report.corpusSha256.slice(0, 12)}, ${report.cases} cases`);
  for (const p of PLATFORMS) {
    const run = report.runs[p];
    const note = run?.assertions === 'skipped' ? ', a record-only run (UNIPACK_CONFORMANCE_DUMP=1): its cases were not asserted' : '';
    out.push(`${p.padEnd(9)}${run ? `results written ${run.generatedAt ?? 'at an unknown time'}${note}` : 'no results given'}`);
  }
  out.push('');
  out.push(`${'platform'.padEnd(9)}${STATUSES.map((s) => s.padStart(20)).join('')}`);
  for (const p of PLATFORMS) out.push(`${p.padEnd(9)}${STATUSES.map((s) => String(report.summary[p][s]).padStart(20)).join('')}`);
  out.push('');
  out.push(`pass on all three platforms: ${report.passOnAllThree} of ${report.cases} cases`);
  out.push('This is a result for the cases in this corpus only. It does not show that every UniPack is compatible.');
  out.push('');
  const short = { pass: 'pass', fail: 'FAIL', unsupported: 'UNSUPP', 'intended-difference': 'INTENDED', unverified: '-' };
  out.push(`${'case'.padEnd(11)}${'android'.padEnd(10)}${'ios'.padEnd(10)}${'web'.padEnd(10)}title`);
  for (const r of report.rows) {
    const cells = PLATFORMS.map((p) => short[r[p].status].padEnd(10)).join('');
    const tail = r.observed ? ` [undetermined: observed results ${r.observed}]` : r.expectation === 'undetermined' ? ' [undetermined]' : '';
    out.push(`${r.id.padEnd(11)}${cells}${r.title}${tail}`);
  }
  const notes = report.rows.flatMap((r) => PLATFORMS.filter((p) => r[p].status !== 'pass' && r[p].detail && r.expectation === 'determined').map((p) => `${r.id} ${p}: ${r[p].detail}`));
  if (notes.length) out.push('', 'notes', ...notes);
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const results = {};
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
  const report = buildReport(loadCanonical(arg('--corpus')), results);
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : renderText(report));
}
