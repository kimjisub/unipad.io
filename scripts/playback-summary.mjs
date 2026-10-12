import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('test-results/results.json', 'utf8'));
console.log('Playback result counts (skips remain visible):');
console.log(`Passed: ${report.stats.expected}; failed: ${report.stats.unexpected}; skipped: ${report.stats.skipped}; flaky: ${report.stats.flaky}.`);
function summarize(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (test.status === 'skipped') {
          const reasons = test.annotations.filter(annotation => annotation.type === 'skip').map(annotation => annotation.description);
          console.log(`- ${test.projectName}: ${spec.title}: ${reasons.join('; ')}`);
        }
      }
    }
    summarize(suite.suites ?? []);
  }
}
summarize(report.suites);
console.log('Audio evidence measures post-volume Web Audio RMS before the native destination. No person listened; speakers, perceived quality and latency are unverified.');
if (report.stats.unexpected || report.stats.flaky || report.errors.length) process.exitCode = 1;
