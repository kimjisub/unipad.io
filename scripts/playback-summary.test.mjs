import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('playback summary retains nested skip counts and reasons and fails on failed or flaky results', () => {
  const script = resolve('scripts/playback-summary.mjs');
  const cache = resolve('.next/cache');
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, 'playback-summary-'));
  try {
    mkdirSync(join(directory, 'test-results'));
    const report = {
      stats: { expected: 8, unexpected: 0, skipped: 1, flaky: 0 }, errors: [],
      suites: [{ suites: [{ specs: [{ title: 'Web MIDI', tests: [{
        projectName: 'webkit', status: 'skipped', expectedStatus: 'skipped', results: [{ status: 'skipped' }],
        annotations: [{ type: 'skip', description: 'Not applicable: no native Web MIDI API' }],
      }] }] }] }],
    };
    const run = () => {
      writeFileSync(join(directory, 'test-results/results.json'), JSON.stringify(report));
      return spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
    };
    const passing = run();
    assert.equal(passing.status, 0, passing.stderr);
    assert.match(passing.stdout, /Passed: 8; failed: 0; skipped: 1; not run: 0; interrupted: 0; flaky: 0/);
    assert.match(passing.stdout, /webkit: Web MIDI: Not applicable: no native Web MIDI API/);
    assert.match(passing.stdout, /No person listened/);
    report.stats.unexpected = 1;
    assert.equal(run().status, 1);
    report.stats.unexpected = 0;
    report.stats.flaky = 1;
    assert.equal(run().status, 1);
    report.stats.flaky = 0;
    report.errors.push({ message: 'The web server failed to start' });
    assert.equal(run().status, 1);
    report.errors = [];
    const skipped = report.suites[0].suites[0].specs[0].tests[0];
    skipped.expectedStatus = 'passed';
    skipped.annotations = [];
    skipped.results = [];
    const notRun = run();
    assert.equal(notRun.status, 1);
    assert.match(notRun.stdout, /skipped: 0; not run: 1; interrupted: 0/);
    skipped.results = [{ status: 'interrupted' }];
    const interrupted = run();
    assert.equal(interrupted.status, 1);
    assert.match(interrupted.stdout, /skipped: 0; not run: 0; interrupted: 1/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
