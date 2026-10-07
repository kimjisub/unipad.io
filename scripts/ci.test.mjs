import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = new URL('../', import.meta.url);

test('pull requests run the same complete verification sequence documented for local use', () => {
  const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const commands = ['pnpm install --frozen-lockfile', 'pnpm exec tsc --noEmit', 'pnpm lint', 'pnpm test', 'pnpm build'];
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /name: Web checks/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /secrets\.|continue-on-error|pull_request_target/);
  let position = -1;
  for (const command of commands) {
    const next = workflow.indexOf(`run: ${command}`);
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

test('browser checks run locally, not in CI', () => {
  const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  assert.doesNotMatch(workflow, /playwright|test:e2e/);
  assert.ok(readme.indexOf('pnpm test:e2e') > readme.indexOf('pnpm build'));
});

test('lint skips the browser failure evidence that a local browser test run leaves behind', async () => {
  const eslint = new ESLint({ cwd: fileURLToPath(root) });
  for (const folder of ['test-results/', 'playwright-report/']) {
    assert.ok(await eslint.isPathIgnored(`${folder}trace/assets/index.js`), `pnpm lint must skip ${folder}`);
  }
});
