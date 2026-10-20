import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { sourceState, recordBuild } from './build-source.mjs';

// Remove any previous record even when Next fails before clearing its output directory.
rmSync('.next/build-source.json', { force: true });
try {
  const git = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const before = git.status === 0 && git.stdout.trim() === 'true' ? sourceState() : undefined;
  const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (before) recordBuild(before);
  else console.log('Production build completed without Git source metadata; browser tests require a rebuild in a Git checkout.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
