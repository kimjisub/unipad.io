import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('test-results/results.json', 'utf8'));
const counts = { skipped: 0, notRun: 0, interrupted: 0 };
const skips = [];
function summarize(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (test.expectedStatus === 'skipped') {
          counts.skipped++;
          const reasons = test.annotations.filter(annotation => annotation.type === 'skip').map(annotation => annotation.description);
          skips.push(`- ${test.projectName}: ${spec.title}: ${reasons.join('; ')}`);
        } else if (test.results.some(result => result.status === 'interrupted')) counts.interrupted++;
        else if (!test.results.length || test.results.every(result => result.status === 'skipped')) counts.notRun++;
      }
    }
    summarize(suite.suites ?? []);
  }
}
summarize(report.suites);
console.log('Playback result counts (skips and incomplete execution remain visible):');
console.log(`Passed: ${report.stats.expected}; failed: ${report.stats.unexpected}; skipped: ${counts.skipped}; not run: ${counts.notRun}; interrupted: ${counts.interrupted}; flaky: ${report.stats.flaky}.`);
for (const skip of skips) console.log(skip);
console.log('Audio evidence measures post-volume Web Audio RMS before the native destination. No person listened; speakers, perceived quality and latency are unverified.');
if (report.stats.unexpected || report.stats.flaky || report.errors.length || counts.notRun || counts.interrupted) process.exitCode = 1;
