import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { firefox, type LaunchOptions, type TestInfo } from '@playwright/test';

/**
 * Firefox's own storage diagnostics, written to the test result folder:
 * - `firefox.moz_log` (main process) and `firefox.child-N.moz_log` (content processes) from MOZ_LOG.
 *   Quota manager failures (`QM_TRY failure ... resultName ...`) reach the browser console, which the
 *   PageMessages module copies to the log; IndexedDB:2 lists every database request, QuotaManager:3
 *   each origin's storage initialization. `sync` writes each line at once, so a failing test can read it.
 * - `stderr.log`: the browser's standard error, through `firefox-stderr.sh` (not on Windows).
 * Set E2E_FIREFOX_LOGS=0 to launch Firefox without them.
 */
export const firefoxLogModules = 'timestamp,sync,PageMessages:5,QuotaManager:3,IndexedDB:2';

export const firefoxLogsEnabled = (browserName: string) =>
  browserName === 'firefox' && process.platform !== 'win32' && process.env.E2E_FIREFOX_LOGS !== '0';

export function withFirefoxLogs(options: LaunchOptions, dir: string): LaunchOptions {
  mkdirSync(dir, { recursive: true });
  return {
    ...options,
    executablePath: path.resolve('e2e/firefox-stderr.sh'),
    env: {
      ...process.env,
      ...options.env,
      E2E_FIREFOX_EXECUTABLE: options.executablePath ?? firefox.executablePath(),
      E2E_FIREFOX_STDERR: path.join(dir, 'stderr.log'),
      MOZ_LOG: firefoxLogModules,
      MOZ_LOG_FILE: path.join(dir, 'firefox'),
    },
  };
}

export type LogOffsets = Map<string, number>;

export function logOffsets(dir: string): LogOffsets {
  return new Map(readdirSync(dir).map(name => [name, statSync(path.join(dir, name)).size]));
}

// A test's share of a log is small; the cap only keeps a runaway log from filling the report.
const maxAttachedBytes = 4 * 1024 * 1024;

/** Attaches what each log in `dir` gained since `since`, so the result keeps the browser's reasons next to the failure. */
export async function attachLogsSince(info: TestInfo, dir: string, since: LogOffsets) {
  for (const [name, size] of logOffsets(dir)) {
    const start = Math.max(since.get(name) ?? 0, size - maxAttachedBytes);
    if (size <= start) continue;
    const file = await open(path.join(dir, name));
    try {
      const body = Buffer.alloc(size - start);
      await file.read(body, 0, body.length, start);
      await info.attach(`firefox-log-${name}`, { body, contentType: 'text/plain' });
    } finally {
      await file.close();
    }
  }
}
