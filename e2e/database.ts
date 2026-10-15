import { type BrowserContext } from '@playwright/test';
import { expect } from './browser';

// Keep the real SDK and browser storage; replace only its network peer.
export async function connectStore(
  context: BrowserContext,
  initialCount: number | null = 42,
  storeItems: Record<string, unknown> = {},
) {
  await context.route('**/firebaseremoteconfig.googleapis.com/**', route => route.fulfill({ json: { entries: {}, state: 'NO_CHANGE' } }));
  let publishCount: ((count: number) => void) | undefined;
  await context.routeWebSocket(/firebaseio\.com|firebasedatabase\.app/, socket => {
    let sendCount: ((count: number) => void) | undefined;
    socket.onClose(() => { if (publishCount === sendCount) publishCount = undefined; });
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.t !== 'd') return;
      const { r, a, b } = message.d;
      if (a === 'q' && b.p === '/storeCount') {
        let acknowledged = false;
        sendCount = count => {
          socket.send(JSON.stringify({ t: 'd', d: { a: 'd', b: { p: '/storeCount', d: count } } }));
          if (!acknowledged) {
            socket.send(JSON.stringify({ t: 'd', d: { r, b: { s: 'ok', d: '' } } }));
            acknowledged = true;
          }
        };
        publishCount = sendCount;
        if (initialCount !== null) publishCount(initialCount);
        return;
      }
      if (a === 'q' && b.p === '/store') {
        socket.send(JSON.stringify({ t: 'd', d: { a: 'd', b: { p: '/store', d: storeItems } } }));
        socket.send(JSON.stringify({ t: 'd', d: { r, b: { s: 'ok', d: '' } } }));
        return;
      }
      const value = b.p === '/storeCount' ? initialCount : b.p === '/store' ? storeItems : {};
      socket.send(JSON.stringify({ t: 'd', d: { r, b: { s: 'ok', d: a === 'g' ? value : '' } } }));
    });
    socket.send(JSON.stringify({ t: 'c', d: { t: 'h', d: { ts: Date.now(), v: '5', h: new URL(socket.url()).hostname, s: 'browser-test-session' } } }));
  });
  return {
    async publish(count: number) {
      await expect.poll(() => Boolean(publishCount), {
        message: 'Firebase database did not connect. Rebuild with NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://unipad-browser-test.firebaseio.com (see README).',
        timeout: 15000,
      }).toBe(true);
      publishCount!(count);
    },
  };
}
