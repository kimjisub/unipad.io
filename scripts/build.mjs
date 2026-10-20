import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { sourceState, recordBuild } from './build-source.mjs';

// Remove any previous record even when Next fails before clearing its output directory.
rmSync('.next/build-source.json', { force: true });
try {
  const before = sourceState();
  const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  recordBuild(before);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
