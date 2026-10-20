// Reads the result files of the apps' own tests (Android `results.json`, iOS `ios-native.json`, web
// `items.json`) into one shape, for the items the common cases cannot confirm (see report.mjs):
//   { platform, commit, sha256, items: { [item]: { status, passed, test(name) } } }
// where `test(name)` is what that test did: `passed` (ran exactly once and passed), `failed`, `skipped`,
// `missing` (not run) or `repeated` (run more than once, a retry included). Only `passed` counts.
// A file that is not fit to count is refused with every reason; one that is fit but reports a failed or
// unverified item is read as it is.
import { createHash } from 'node:crypto';
import { grammarRecord, readGrammar } from './grammar.mjs';

const COMMIT = /^[0-9a-f]{40}$/;

/** A test's status from its runs: it passed only when it ran exactly once, and that run passed. */
function testStatus(runs, outcome) {
  if (runs.length === 0) return 'missing';
  if (runs.length > 1) return 'repeated';
  return outcome(runs[0]);
}

/** The first key that appears twice in one object of `text`, which JSON.parse would silently drop. */
function duplicateKey(text) {
  const open = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') open.push(new Set());
    else if (ch === '[') open.push(null);
    else if (ch === '}' || ch === ']') open.pop();
    else if (ch === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      const raw = text.slice(i, end + 1);
      i = end;
      let next = end + 1;
      while (/\s/.test(text[next])) next++;
      const keys = open.at(-1);
      if (keys && text[next] === ':') {
        const key = JSON.parse(raw);
        if (keys.has(key)) return key;
        keys.add(key);
      }
    }
  }
  return undefined;
}

const FORMATS = {
  android: (file) => ({
    platform: file.platform,
    commit: file.repositoryCommit,
    clean: file.sourceDirty === false,
    purpose: null,
    edition: file.grammar?.version,
    revision: file.grammar?.revision,
    items: Object.entries(file.items ?? {}).map(([id, item]) => ({
      id,
      status: item.status,
      passed: item.status === 'passed',
      tests: (name) => testStatus(item.tests?.[name] ?? [], (run) => (run.status === 'passed' ? 'passed' : run.status === 'skipped' ? 'skipped' : 'failed')),
    })),
  }),
  ios: (file) => ({
    platform: file.platform,
    commit: file.commit,
    clean: file.sourceStatus === '',
    purpose: file.purpose,
    edition: file.grammarVersion,
    revision: file.grammarRevision,
    items: Object.entries(file.rules ?? {}).map(([id, rule]) => ({
      id,
      status: rule.status,
      passed: rule.status === 'passed',
      tests: (name) => testStatus((rule.tests ?? []).filter((t) => t.name === name).flatMap((t) => t.runs ?? []),
        (run) => (run.result === 'Passed' ? 'passed' : run.result === 'Skipped' ? 'skipped' : 'failed')),
    })),
  }),
  // The web file names no platform; it is the web's because it was given as the web's. Only Chromium
  // records of the browser run count.
  web: (file) => ({
    platform: file.platform ?? 'web',
    commit: file.source?.commit,
    clean: file.source?.dirty === false,
    purpose: null,
    edition: file.grammar?.version,
    revision: file.grammar?.revision,
    items: (Array.isArray(file.items) ? file.items : []).map((item) => ({
      id: item.item,
      status: item.status,
      passed: item.status === 'confirmed',
      tests: (name) => testStatus((item.results ?? []).filter((r) => r.name === name && (item.run !== 'browser' || r.project === 'chromium')),
        (record) => (record.status === 'passed' ? 'passed' : 'failed')),
    })),
  }),
};

/**
 * `bytes` read as the app test results of `platform`, or an error naming every reason they cannot count:
 * another platform's file, another grammar edition or revision than the GRAMMAR.md this tool reads, a
 * checkout with uncommitted changes or a commit that is not a full hash, an iOS run that was not for
 * verification, an item number the grammar does not list, or an item reported twice.
 */
export function readNative(platform, bytes, record = grammarRecord(), grammar = readGrammar()) {
  if (!FORMATS[platform]) throw new Error(`no app result format for ${platform}`);
  const text = Buffer.from(bytes).toString('utf8');
  const file = JSON.parse(text);
  const read = FORMATS[platform](file);
  const problems = [];
  if (read.platform !== platform) problems.push(`the file is ${read.platform ?? 'of no named platform'}'s, not ${platform}'s`);
  if (read.edition !== record.version) problems.push(`it was checked against grammar ${read.edition ?? '(none)'}, this tool reads ${record.version}`);
  if (read.revision !== record.revision) problems.push(`its grammar revision ${read.revision ?? '(none)'} is not the SHA-256 of the GRAMMAR.md this tool reads, ${record.revision}`);
  if (typeof read.commit !== 'string' || !COMMIT.test(read.commit)) problems.push(`its commit ${read.commit ?? '(none)'} is not a full 40-character commit hash`);
  if (!read.clean) problems.push('the checkout it ran on had uncommitted changes, or does not say');
  if (platform === 'ios' && read.purpose !== 'verification') problems.push(`it is a ${read.purpose ?? 'purposeless'} run, not a verification run`);
  if (read.items.length === 0) problems.push('it reports no item');
  const known = new Set(grammar.items.map((i) => i.id));
  const unknown = read.items.filter((i) => !known.has(i.id)).map((i) => i.id);
  if (unknown.length) problems.push(`the grammar lists no item ${unknown.join(', ')}`);
  const ids = read.items.map((i) => i.id);
  const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  const key = duplicateKey(text);
  if (twice.length) problems.push(`it reports ${twice.join(', ')} more than once`);
  else if (key !== undefined) problems.push(`it names "${key}" twice in one object`);
  if (problems.length) throw new Error(problems.join('; '));
  return {
    platform,
    commit: read.commit,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    items: Object.fromEntries(read.items.map((i) => [i.id, { status: i.status, passed: i.passed, test: i.tests }])),
  };
}
