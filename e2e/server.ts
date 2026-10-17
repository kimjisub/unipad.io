// The browser tests' own production server. Port 0 lets the operating system hand each run a free
// port at listen time, so runs on one machine never contend for a port, and the tests take the
// address from this server's own output instead of trusting whatever answers on a fixed port.
// The host stays localhost: with 127.0.0.1, Next's internal locale rewrites to localhost redirect in a loop.
export function serverCommand(port = '0') {
  if (!/^\d+$/.test(port)) throw new Error(`E2E_PORT must be a port number, got ${JSON.stringify(port)}`);
  return `node e2e/stop-on-stdin-close.mjs node node_modules/next/dist/bin/next start --hostname localhost --port ${port}`;
}

// Playwright stores the named group as process.env.E2E_SERVER_URL once Next has reported it is ready.
// Built from a string: the ES2015 type-check target rejects named groups in regex literals.
export const serverReady = new RegExp(String.raw`- Local:\s+(?<e2e_server_url>http://localhost:\d+)\r?\n[\s\S]*Ready in`);
