import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const recordPath = cwd => join(cwd, '.next', 'build-source.json');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Hash file contents, not timestamps or status: a second edit to an already dirty file must
// invalidate the build too. Git supplies portable, unquoted paths, including untracked inputs.
export function sourceState(cwd = process.cwd()) {
  const commit = git(cwd, 'rev-parse', 'HEAD');
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const path of [...new Set(paths)].sort()) {
    hash.update(`${Buffer.byteLength(path)}:${path}\0`);
    try {
      const contents = readFileSync(join(cwd, path));
      hash.update(`file:${contents.length}:`);
      hash.update(contents);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('missing');
    }
    hash.update('\0');
  }
  return { version: 1, commit, files: hash.digest('hex') };
}

export function recordBuild(before, cwd = process.cwd()) {
  const after = sourceState(cwd);
  if (before.commit !== after.commit || before.files !== after.files) {
    throw new Error('Source changed during the build. Run `pnpm build` first, then retry the browser tests.');
  }
  writeFileSync(recordPath(cwd), `${JSON.stringify(after)}\n`);
}

export function assertCurrentBuild(cwd = process.cwd()) {
  let built;
  let current;
  let reason;
  try {
    built = JSON.parse(readFileSync(recordPath(cwd), 'utf8'));
  } catch {
    reason = 'Build source record is missing or unreadable.';
  }
  try {
    current = sourceState(cwd);
  } catch {
    reason = 'Cannot read the current Git source state.';
  }
  if (!reason && (built?.version !== 1 || built.commit !== current.commit || built.files !== current.files)) {
    reason = 'Build source does not match the current commit or working files.';
  }
  if (reason) {
    throw new Error(`${reason}\nBuilt commit: ${built?.commit ?? 'missing'}\nCurrent commit: ${current?.commit ?? 'unavailable'}\nRun \`pnpm build\` first, then retry the browser tests.`);
  }
}
