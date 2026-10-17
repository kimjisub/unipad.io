import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { serverCommand, serverReady } from '../e2e/server.ts';

// Next 16's start output after Playwright strips its colours.
const nextStart = port => `▲ Next.js 16.3.8\n- Local:         http://localhost:${port}\n- Network:       http://localhost:${port}\n✓ Ready in 475ms\n`;

test('the browser test server asks the operating system for a free port unless E2E_PORT pins one', () => {
  assert.match(serverCommand(), /^node e2e\/stop-on-stdin-close\.mjs node node_modules\/next\/dist\/bin\/next start /);
  assert.match(serverCommand(), / --port 0$/);
  assert.match(serverCommand('3184'), / --port 3184$/);
  assert.throws(() => serverCommand('3184; echo'), /E2E_PORT must be a port number/);
});

test('the tests take their address from the started server once it reports ready', () => {
  assert.equal(serverReady.exec(nextStart(59666))?.groups?.e2e_server_url, 'http://localhost:59666');
  assert.equal(serverReady.exec(nextStart(59666).replace(/✓ Ready.*\n/, '')), null);
});

test('the Playwright config uses only the address its own server printed', async () => {
  delete process.env.E2E_PORT;
  process.env.E2E_SERVER_URL = 'http://localhost:59666';
  const { default: config } = await import('../playwright.config.ts');
  assert.equal(config.use?.baseURL, 'http://localhost:59666');
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.equal(config.webServer.url, undefined);
  assert.equal(config.webServer.port, undefined);
  assert.equal(config.webServer.wait?.stdout, serverReady);
  assert.equal(config.webServer.command, serverCommand());
});

const isRunning = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('the server stops when the test run that started it is killed outright', async () => {
  // Starts the server the way Playwright does (own process group, stdin piped), then is killed with SIGKILL.
  const run = spawn(process.execPath, ['-e', `
    const server = require('node:child_process').spawn(process.execPath,
      ['e2e/stop-on-stdin-close.mjs', process.execPath, '-e', 'console.log(process.pid); setInterval(() => {}, 1000)'],
      { detached: true, stdio: ['pipe', 'pipe', 'inherit'] });
    server.stdout.pipe(process.stdout);
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  const [line] = await once(run.stdout, 'data');
  const server = Number(String(line).trim());
  try {
    assert.ok(isRunning(server));
    run.kill('SIGKILL');
    for (let i = 0; i < 100 && isRunning(server); i++) await sleep(100);
    assert.equal(isRunning(server), false, 'the server outlived the run that started it');
  } finally {
    if (isRunning(server)) process.kill(server, 'SIGKILL');
  }
});
