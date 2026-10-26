// Starts the browser tests' production server on a port it opens itself, and stops it once this
// process's stdin closes.
//
// Ports come from 20000-32767, below the ephemeral ranges of Windows and macOS (49152-65535) and
// Linux (32768-60999), so the server never sits on a port the operating system also hands out to
// outgoing connections. Next opens the port itself, so no other process can take it in between.
// A port Next cannot open (taken, or reserved on Windows) is tried again with another number, only
// after that Next has exited; any other exit ends the run. `--port <n>` pins one port, never retried.
//
// Playwright stops its web server only when a run ends normally or on Ctrl+C; a run ended by
// SIGTERM, SIGHUP or SIGKILL leaves the server running. Playwright holds the server's stdin open,
// so the run's end, however it happens, closes stdin and this stops the server it started.
import { assertCurrentBuild } from '../scripts/build-source.mjs';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { createConnection, createServer } from 'node:net';
import { stripVTControlCharacters } from 'node:util';

export const portRange = { min: 20000, max: 32767 };
export const maxAttempts = 10;

export const randomPort = (random = Math.random) =>
  portRange.min + Math.floor(random() * (portRange.max - portRange.min + 1));

export function candidatePorts(pinned) {
  if (pinned !== undefined) return [pinned];
  const ports = new Set();
  while (ports.size < maxAttempts) ports.add(randomPort());
  return [...ports];
}

// Next reports a port it could not open on stderr, e.g. "Error: listen EADDRINUSE: address already in use ::1:20000".
export const couldNotOpenPort = stderr => /\blisten (EADDRINUSE|EACCES)\b/.test(stderr);

// Enough to hold Next's start-up failure; a running server's later stderr is only passed through.
const keptStderr = 16_384;

/**
 * Runs `command(port)` for each candidate port in turn until a server starts.
 * `exited` resolves with the exit code of the server that ran, or 1 when no port could be opened.
 */
export function startServer(ports, command, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let child;
  let stopped = false;
  let closeRelay = () => {};

  const run = async ([file, ...args]) => {
    // Use Node's localhost lookup, as Next's listen(hostname) does. If the two disagree,
    // binding the opposite address collides with Next and the attempt fails closed.
    const { address: target, family } = await lookup('localhost');
    if (stopped) return { code: 1, output: '' };
    const relayHost = family === 6 ? '127.0.0.1' : '::1';
    let output = '';
    let pendingLine = '';
    let held = '';
    let holding = false;
    let ready;
    let closed = false;
    let relay;
    const sockets = new Set();
    let relayClosed;
    closeRelay = () => {
      for (const socket of sockets) socket.destroy();
      if (!relayClosed && relay?.listening) relayClosed = new Promise(resolve => relay.close(resolve));
    };
    child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const attempt = child;
    const track = socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      return socket;
    };
    const openRelay = async port => {
      relay = createServer(incoming => {
        track(incoming);
        const outgoing = track(createConnection({ host: target, port }));
        incoming.on('error', () => outgoing.destroy());
        outgoing.on('error', () => incoming.destroy());
        incoming.once('close', () => outgoing.destroy());
        outgoing.once('close', () => incoming.destroy());
        incoming.pipe(outgoing).pipe(incoming);
      });
      try {
        await new Promise((resolve, reject) => {
          relay.once('error', reject);
          relay.listen({ host: relayHost, port, ipv6Only: true }, resolve);
        });
        if (stopped || closed) closeRelay();
        stderr.write(`Browser test loopback: Next ${target}:${port}; relay ${relayHost}:${port}.\n`);
      } catch (error) {
        if (['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error.code)) {
          stderr.write(`Browser test loopback: Next ${target}:${port}; ${relayHost} unavailable (${error.code}), skipped.\n`);
        } else {
          throw error;
        }
      }
    };
    const reportReady = async port => {
      try {
        await openRelay(port);
        if (!stopped && !closed) {
          stdout.write(held);
          held = '';
          holding = false;
        }
      } catch (error) {
        const message = `Error: listen ${error.code ?? 'FAILED'}: loopback relay ${relayHost}:${port}: ${error.message}\n`;
        output += message;
        stderr.write(message);
        attempt.kill();
      }
    };
    attempt.stdout.on('data', chunk => {
      pendingLine += chunk;
      let end;
      while ((end = pendingLine.indexOf('\n')) !== -1) {
        const line = pendingLine.slice(0, end + 1);
        pendingLine = pendingLine.slice(end + 1);
        const plain = stripVTControlCharacters(line);
        if (/\bLocal:/.test(plain)) holding = true;
        if (holding) held += line;
        else stdout.write(line);
        if (!ready && /Ready in/.test(plain)) {
          const port = Number(stripVTControlCharacters(held).match(/http:\/\/localhost:(\d+)/)?.[1]);
          if (!port) {
            output += 'Missing localhost port in server output';
            stderr.write(`${output}\n`);
            attempt.kill();
          } else {
            ready = reportReady(port);
          }
        }
      }
    });
    attempt.stderr.on('data', chunk => {
      if (output.length < keptStderr) output += chunk;
      stderr.write(chunk);
    });
    const result = await new Promise(resolve => {
      attempt.on('error', error => { output += String(error); });
      // 'close' comes after the process has exited and its output is drained.
      attempt.on('close', (code, signal) => {
        closed = true;
        resolve({ code: code ?? (signal ? 1 : 0) });
      });
    });
    await ready;
    closeRelay();
    await relayClosed;
    if (!holding && pendingLine) stdout.write(pendingLine);
    return { ...result, output };
  };

  const exited = (async () => {
    const tried = [];
    for (const port of ports) {
      tried.push(port);
      const { code, output } = await run(command(port));
      if (stopped || !couldNotOpenPort(output)) return code;
      stderr.write(`Port ${port} could not be opened for the browser test server.\n`);
    }
    stderr.write(`No port could be opened for the browser test server; tried ${tried.join(', ')}.\n`);
    return 1;
  })();

  const stop = () => {
    stopped = true;
    // Next waits for open connections on SIGTERM; close the relay before waiting for Next.
    closeRelay();
    child?.kill();
  };
  return { exited, stop };
}

export function stopWhenInputEnds(server, input = process.stdin) {
  input.on('end', server.stop).on('error', server.stop).resume();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, server.stop);
}

if (import.meta.main) {
  const [flag, value] = process.argv.slice(2);
  const nextStart = port => [process.execPath, 'node_modules/next/dist/bin/next', 'start', '--hostname', 'localhost', '--port', String(port)];
  if (flag !== undefined && (flag !== '--port' || !/^\d+$/.test(value ?? '') || Number(value) < 1 || Number(value) > 65535)) {
    console.error('port must be an integer between 1 and 65535');
    process.exit(1);
  }
  try {
    assertCurrentBuild();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const server = startServer(candidatePorts(flag === '--port' ? Number(value) : undefined), nextStart);
  stopWhenInputEnds(server);
  server.exited.then(code => process.exit(code));
}
