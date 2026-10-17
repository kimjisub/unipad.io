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
import { spawn } from 'node:child_process';

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

  const run = ([file, ...args]) => new Promise(resolve => {
    let output = '';
    child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(stdout, { end: false });
    child.stderr.on('data', chunk => {
      if (output.length < keptStderr) output += chunk;
      stderr.write(chunk);
    });
    child.on('error', error => resolve({ code: 1, output: String(error) }));
    // 'close' comes after the process has exited and its output is drained.
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), output }));
  });

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
  const server = startServer(candidatePorts(flag === '--port' ? Number(value) : undefined), nextStart);
  stopWhenInputEnds(server);
  server.exited.then(code => process.exit(code));
}
