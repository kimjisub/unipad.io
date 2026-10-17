import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { serverCommand, serverReady } from '../e2e/server.ts';
import { candidatePorts, couldNotOpenPort, maxAttempts, portRange, randomPort, startServer } from '../e2e/start-server.mjs';

// Next 16's start output after Playwright strips its colours.
const nextStart = port => `▲ Next.js 16.3.8\n- Local:         http://localhost:${port}\n- Network:       http://localhost:${port}\n✓ Ready in 475ms\n`;

// Stands in for Next: listens on localhost, reports the port it really got the way Next does, and
// on a port it cannot open fails the way Node does (the listen error on stderr, exit code 1).
const fakeNext = port => [process.execPath, '-e', `
  const server = require('node:http').createServer((request, response) => response.end()).listen(${port}, 'localhost', () =>
    console.log(${JSON.stringify(nextStart('PORT'))}.replaceAll('PORT', server.address().port)));
`];

const collect = () => {
  const stream = new PassThrough();
  stream.text = '';
  stream.on('data', chunk => { stream.text += chunk; });
  return stream;
};

const occupy = async () => {
  const server = createServer().listen(0, 'localhost');
  await once(server, 'listening');
  return server;
};

const isRunning = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('the browser test server picks its own port unless E2E_PORT pins one', () => {
  assert.equal(serverCommand(), 'node e2e/start-server.mjs');
  assert.equal(serverCommand('3184'), 'node e2e/start-server.mjs --port 3184');
  assert.throws(() => serverCommand('3184; echo'), /E2E_PORT must be a port number/);
});

test('picked ports stay below the ephemeral ranges of Windows, macOS and Linux', () => {
  assert.deepEqual(portRange, { min: 20000, max: 32767 });
  assert.equal(randomPort(() => 0), 20000);
  assert.equal(randomPort(() => 0.999999999), 32767);
  for (let i = 0; i < 100; i++) {
    const ports = candidatePorts();
    assert.equal(ports.length, maxAttempts);
    assert.equal(new Set(ports).size, maxAttempts);
    for (const port of ports) assert.ok(Number.isInteger(port) && port >= 20000 && port <= 32767, `${port} is outside 20000-32767`);
  }
  assert.deepEqual(candidatePorts(3184), [3184]);
});

test('only a port that could not be opened counts as a reason to try another', () => {
  assert.ok(couldNotOpenPort('⨯ Failed to start server\nError: listen EADDRINUSE: address already in use ::1:24567\n'));
  assert.ok(couldNotOpenPort('Error: listen EACCES: permission denied ::1:24567\n'));
  assert.ok(!couldNotOpenPort('Error: Could not find a production build in the \'.next\' directory.\n'));
  assert.ok(!couldNotOpenPort(''));
});

test('the tests take their address from the started server once it reports ready', () => {
  assert.equal(serverReady.exec(nextStart(24567))?.groups?.e2e_server_url, 'http://localhost:24567');
  assert.equal(serverReady.exec(nextStart(24567).replace(/✓ Ready.*\n/, '')), null);
});

test('the Playwright config uses only the address its own server printed', async () => {
  delete process.env.E2E_PORT;
  process.env.E2E_SERVER_URL = 'http://localhost:24567';
  const { default: config } = await import('../playwright.config.ts');
  assert.equal(config.use?.baseURL, 'http://localhost:24567');
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.equal(config.webServer.url, undefined);
  assert.equal(config.webServer.port, undefined);
  assert.equal(config.webServer.wait?.stdout, serverReady);
  assert.equal(config.webServer.command, serverCommand());
});

test('a taken first port is retried on another, and the address comes from the server that opened', async () => {
  const taken = await occupy();
  const takenPort = taken.address().port;
  const stdout = collect();
  const stderr = collect();
  try {
    // Port 0 stands for a free second pick; the fake server reports the port it really got.
    const server = startServer([takenPort, 0], fakeNext, { stdout, stderr });
    while (!serverReady.test(stdout.text)) await sleep(20);
    const url = serverReady.exec(stdout.text).groups.e2e_server_url;
    assert.notEqual(url, `http://localhost:${takenPort}`);
    assert.match(stderr.text, new RegExp(`Port ${takenPort} could not be opened`));
    assert.equal((await fetch(url)).status, 200);
    server.stop();
    await server.exited;
  } finally {
    taken.close();
  }
});

test('a server that fails for another reason is not started again', async () => {
  let attempts = 0;
  const stderr = collect();
  const server = startServer([20000, 20001], () => {
    attempts++;
    return [process.execPath, '-e', 'console.error("Could not find a production build"); process.exit(3)'];
  }, { stdout: collect(), stderr });
  assert.equal(await server.exited, 3);
  assert.equal(attempts, 1);
});

test('when no port can be opened the run fails and names every port it tried', async () => {
  const first = await occupy();
  const second = await occupy();
  const ports = [first.address().port, second.address().port];
  const stderr = collect();
  try {
    assert.equal(await startServer(ports, fakeNext, { stdout: collect(), stderr }).exited, 1);
    assert.match(stderr.text, new RegExp(`tried ${ports.join(', ')}`));
  } finally {
    first.close();
    second.close();
  }
});

test('the server stops when the test run that started it is killed outright', async () => {
  // Starts the server the way Playwright does (own process group, stdin piped), then is killed with SIGKILL.
  const launcher = `
    import { startServer, stopWhenInputEnds } from './e2e/start-server.mjs';
    const server = startServer([0], () => [process.execPath, '-e', 'console.log(process.pid); setInterval(() => {}, 1000)']);
    stopWhenInputEnds(server);
    server.exited.then(code => process.exit(code));
  `;
  const run = spawn(process.execPath, ['-e', `
    const server = require('node:child_process').spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(launcher)}],
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
