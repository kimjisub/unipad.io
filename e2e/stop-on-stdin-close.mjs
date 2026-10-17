// Runs the given command and stops it once this process's stdin closes.
// Playwright stops its web server only when a run ends normally or on Ctrl+C; a run ended by
// SIGTERM, SIGHUP or SIGKILL leaves the server running. Playwright holds the server's stdin
// open, so the run's end, however it happens, closes stdin and this stops the server it started.
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
const stop = () => child.kill();
process.stdin.on('end', stop).on('error', stop).resume();
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
