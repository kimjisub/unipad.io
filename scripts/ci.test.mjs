import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const setupAction = './.github/actions/setup-web';
const playbackFiles = ['play.spec.ts', 'multi-touch.spec.ts', 'pad-layout.spec.ts', 'rectangular-pad-layout.spec.ts', 'large-text.spec.ts', 'home.spec.ts'];

// The text of one job in the workflow, up to the next job at the same indentation.
function job(workflow, id) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.ok(start >= 0, `job ${id} must exist`);
  const end = workflow.slice(start + 1).search(/\n {2}[\w-]+:\n/);
  return end < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + end);
}

test('pull requests run the same complete verification sequence documented for local use', () => {
  const workflow = read('.github/workflows/ci.yml');
  const readme = read('README.md');
  const checks = job(workflow, 'checks');
  const commands = ['pnpm exec tsc --noEmit', 'pnpm lint', 'pnpm test', 'pnpm build'];
  assert.match(workflow, /pull_request:/);
  assert.match(checks, /name: Web checks/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /secrets\.|continue-on-error|pull_request_target/);
  assert.match(read(`${setupAction}/action.yml`), /run: pnpm install --frozen-lockfile/);
  assert.ok(readme.includes('pnpm install --frozen-lockfile'), 'pnpm install --frozen-lockfile must be documented');
  let position = checks.indexOf(`uses: ${setupAction}`);
  assert.ok(position >= 0, 'dependencies must be installed first');
  for (const command of commands) {
    const next = checks.indexOf(`run: ${command}`);
    assert.ok(next > position, `${command} must run in order`);
    assert.ok(readme.includes(command), `${command} must be documented`);
    position = next;
  }
});

test('the aggregate test command includes all existing test formats and tooling checks', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.ok(scripts.test, 'pnpm test must be available');
  assert.ok(scripts.test.includes('tsc -p tsconfig.test.json'));
  const config = JSON.parse(readFileSync(new URL('tsconfig.test.json', root), 'utf8'));
  assert.deepEqual(config.include, ['src/**/*.test.ts', 'src/**/*.test.tsx']);
  for (const pattern of ['.next/cache/unit-test/**/*.test.js', 'src/**/*.test.mjs', 'scripts/*.test.mjs']) {
    assert.ok(scripts.test.includes(pattern), `missing ${pattern}`);
  }
});

test('CI runs the playback and offline saved-pack browser tests in Chromium, apart from Web checks', () => {
  const workflow = read('.github/workflows/ci.yml');
  const readme = read('README.md');
  const browser = job(workflow, 'browser-playback');
  assert.doesNotMatch(job(workflow, 'checks'), /playwright|test:e2e/);
  assert.match(browser, /NEXT_PUBLIC_FIREBASE_DATABASE_URL: 'https:\/\/unipad-browser-test\.firebaseio\.com'/);
  const steps = [
    `uses: ${setupAction}`,
    'run: pnpm exec playwright install --with-deps chromium',
    'run: pnpm build',
    'run: pnpm test:e2e --project=chromium e2e/play.spec.ts e2e/offline-play.spec.ts',
    'uses: actions/upload-artifact@',
  ];
  let position = -1;
  for (const step of steps) {
    const next = browser.indexOf(step);
    assert.ok(next > position, `${step} must run in order`);
    position = next;
  }
  assert.match(browser, /if: failure\(\)\n\s+uses: actions\/upload-artifact@/);
  for (const folder of ['playwright-report/', 'test-results/']) assert.ok(browser.includes(folder), `${folder} must be uploaded`);
  for (const spec of ['e2e/play.spec.ts', 'e2e/offline-play.spec.ts']) assert.ok(read(spec), `${spec} must exist`);
  assert.ok(readme.indexOf('pnpm test:e2e') > readme.indexOf('pnpm build'));
});

test('Windows runs the shared playback tests with the shared setup', async () => {
  const windows = read('.github/workflows/playback-windows.yml');
  assert.match(windows, /runs-on: windows-2025/);
  assert.ok(windows.includes(`uses: ${setupAction}`), 'Windows must use the shared setup');
  assert.doesNotMatch(windows, /pnpm install/);
  const command = windows.split('\n').find(line => line.includes('run: pnpm exec playwright test'));
  assert.ok(command, 'Windows playback test command must exist');
  for (const file of playbackFiles) assert.ok(command.includes(`e2e/${file}`), `Windows must run ${file}`);
  const { windowsPlaybackTests } = await import('../playwright.config.ts');
  assert.deepEqual(windowsPlaybackTests, playbackFiles);
  assert.doesNotMatch(windows, /continue-on-error|secrets\.|pull_request_target/);
});

test('Windows gives the browsers a verified audio output before the playback tests', () => {
  const windows = read('.github/workflows/playback-windows.yml');
  const audio = windows.indexOf('name: Add a virtual audio output');
  assert.ok(audio >= 0, 'Windows must add an audio output: hosted runners have none and Firefox then never starts Web Audio');
  assert.ok(audio < windows.indexOf('run: pnpm exec playwright test'), 'the audio output must exist before the tests start');
  const step = windows.slice(audio, windows.indexOf('\n      - ', audio));
  assert.match(step, /Get-FileHash .* -Algorithm SHA256\)\.Hash -ne '[0-9A-F]{64}'/, 'the downloaded driver must match a recorded SHA-256');
  assert.match(step, /Start-Service audiosrv/);
  assert.match(step, /throw 'No audio output device is available'/);
});

test('WebKit and Firefox include the shared playback tests', async () => {
  const { default: config } = await import('../playwright.config.ts');
  for (const engine of ['webkit', 'firefox']) {
    const project = config.projects.find(project => project.name === engine);
    assert.ok(project, `${engine} must be tested`);
    for (const file of playbackFiles) assert.ok(project.testMatch.includes(file), `${engine} must report ${file}`);
  }
});

test('lint skips the browser failure evidence that a local browser test run leaves behind', async () => {
  const eslint = new ESLint({ cwd: fileURLToPath(root) });
  for (const folder of ['test-results/', 'playwright-report/']) {
    assert.ok(await eslint.isPathIgnored(`${folder}trace/assets/index.js`), `pnpm lint must skip ${folder}`);
  }
});
