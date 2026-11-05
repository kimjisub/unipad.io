import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './browser';
import { attachLogsSince, logOffsets, withFirefoxLogs } from './firefox-logs';
import { SeedError, seedDatabase, type SeedReport, type SeedStore } from './storage-seed';

const store = (name: string, ids: string[]): SeedStore => ({ name, keyPath: 'id', records: ids.map(id => ({ id })) });

async function seedFailure(seed: Promise<void>) {
  const error = await seed.then(() => undefined, (cause: unknown) => cause);
  expect(error).toBeInstanceOf(SeedError);
  const attached = test.info().attachments.find(item => item.name === 'storage-seed-failure');
  const report = JSON.parse(String(attached?.body)) as SeedReport;
  expect(report).toEqual((error as SeedError).report);
  return report;
}

test('a seed that cannot open the database records the open request before any upgrade', async ({ page }) => {
  await seedDatabase(page, 'seed-test', 2, [store('items', ['a'])]);
  const report = await seedFailure(seedDatabase(page, 'seed-test', 1, [store('items', ['b'])]));
  expect(report).toMatchObject({ ok: false, upgradeEntered: false, failure: { request: 'open', name: 'VersionError' } });
});

test('a seed whose upgrade throws records the upgrade request', async ({ page }) => {
  const report = await seedFailure(seedDatabase(page, 'seed-test', 1, [store('items', ['a']), store('items', ['b'])]));
  expect(report).toMatchObject({ ok: false, upgradeEntered: true, failure: { request: 'upgrade', name: 'ConstraintError' } });
  // The seed aborts the upgrade itself, so the transaction carries no error of its own.
  expect(report.events.some(event => event.endsWith('upgrade aborted: no error'))).toBe(true);
});

test('a seed whose write fails records the record it was writing', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'broken') throw new DOMException('Injected write failure.', 'DataError');
      return put.apply(this, args);
    };
  });
  const report = await seedFailure(seedDatabase(page, 'seed-test', 1, [store('items', ['a']), store('broken', ['x'])]));
  expect(report).toMatchObject({ ok: false, upgradeEntered: true, failure: { request: 'write', target: 'broken/x', name: 'DataError' } });
});

// The browser can abort the upgrade without the seed seeing a request fail (a quota error at commit). The open
// request then only says AbortError, so the cause has to come from the transaction's own error.
test('a seed whose upgrade the browser aborts records the abort cause, not AbortError', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name !== 'aborted') return put.apply(this, args);
      put.apply(this, args);
      const duplicate = this.add(...args);
      duplicate.addEventListener('error', event => event.stopImmediatePropagation());
      return duplicate;
    };
  });
  const report = await seedFailure(seedDatabase(page, 'seed-test', 1, [store('aborted', ['x'])]));
  expect(report).toMatchObject({ ok: false, upgradeEntered: true, failure: { request: 'upgrade', name: 'ConstraintError' } });
  expect(report.events.some(event => event.endsWith('upgrade aborted: ConstraintError'))).toBe(true);
});

// Firefox's quota manager cannot set up an origin whose storage folder is a file. The open then fails with the
// same UnknownError that seeding once hit; the attached logs must carry Firefox's reason, not just the DOM name.
test('Firefox storage failures leave the browser reason next to the seed failure', async ({ browserName, playwright, baseURL }, info) => {
  test.skip(browserName !== 'firefox', 'Firefox quota manager and MOZ_LOG output.');
  test.skip(process.platform === 'win32', 'The standard error wrapper is a shell script.');
  const profile = info.outputPath('profile');
  const logs = info.outputPath('firefox-logs');
  const origins = path.join(profile, 'storage', 'default');
  const origin = new URL(baseURL!);
  await mkdir(origins, { recursive: true });
  await writeFile(path.join(origins, `${origin.protocol.slice(0, -1)}+++${origin.hostname}+${origin.port}`), '');
  const context = await playwright.firefox.launchPersistentContext(profile, { ...withFirefoxLogs({ headless: true }, logs), baseURL });
  try {
    const since = logOffsets(logs);
    const page = context.pages()[0] ?? await context.newPage();
    const report = await seedFailure(seedDatabase(page, 'unipad', 1, [store('items', ['a'])]));
    expect(report).toMatchObject({ ok: false, upgradeEntered: false, failure: { request: 'open', name: 'UnknownError' } });
    await attachLogsSince(info, logs, since);
  } finally {
    await context.close();
  }
  const attachedLog = (name: RegExp) => info.attachments.filter(item => name.test(item.name)).map(item => String(item.body)).join('\n');
  expect(attachedLog(/^firefox-log-firefox\.moz_log$/)).toMatch(/QM_TRY failure \(ERROR\): .*resultName NS_ERROR_\w+/);
  expect(attachedLog(/^firefox-log-firefox\.child-\d+\.moz_log$/)).toContain('indexedDB.open("unipad", 1)');
  expect((await stat(path.join(logs, 'stderr.log'))).isFile()).toBe(true);
});
