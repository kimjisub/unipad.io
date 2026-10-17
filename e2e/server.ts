// The browser tests' own production server (e2e/start-server.mjs). It opens a port of its own for
// each run, so runs on one machine never contend for a port, and the tests take the address from
// this server's own output instead of trusting whatever answers on a fixed port.
// The host stays localhost: with an IP address as Next's hostname, its internal locale rewrites redirect in a loop.
export function serverCommand(port?: string) {
  if (port === undefined) return 'node e2e/start-server.mjs';
  if (!/^\d+$/.test(port)) throw new Error(`E2E_PORT must be a port number, got ${JSON.stringify(port)}`);
  return `node e2e/start-server.mjs --port ${port}`;
}

// Playwright stores the named group as process.env.E2E_SERVER_URL once Next has reported it is ready.
// Built from a string: the ES2015 type-check target rejects named groups in regex literals.
export const serverReady = new RegExp(String.raw`- Local:\s+(?<e2e_server_url>http://localhost:\d+)\r?\n[\s\S]*Ready in`);
