import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_START_LIMIT_MS, AUDIO_START_NOTICE_DELAY_MS, AudioStartRequests, type AudioStartIntent, type AudioStartNotice } from './audioStart';

interface Reply { resolve: (ready: boolean) => void; reject: (error: unknown) => void }

/** A manual clock and audio replies the test settles itself. */
function harness() {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const replies: Reply[] = [];
  const log: string[] = [];
  const commits: AudioStartIntent[] = [];
  let notice: AudioStartNotice | null = null;
  const requests = new AudioStartRequests({
    now: () => now,
    setTimer: (run, ms) => { timers.set(++nextTimer, { at: now + ms, run }); return nextTimer; },
    clearTimer: timer => { timers.delete(timer as number); },
    activate: () => new Promise<boolean>((resolve, reject) => { replies.push({ resolve, reject }); }),
    commit: intent => { commits.push(intent); log.push('commit'); },
    shown: () => log.push('shown'),
    halt: () => log.push('halt'),
    update: next => { notice = next; },
  });
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = until;
  };
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  return { requests, replies, log, commits, advance, flush, timers, notice: () => notice, setNow: (ms: number) => { now = ms; } };
}

const auto: AudioStartIntent = { kind: 'mode', mode: 'autoPlay' };
const guide: AudioStartIntent = { kind: 'mode', mode: 'guidePlay' };

test('a preparation finished before the delay starts once without a notice', async () => {
  const h = harness();
  h.requests.request(auto);
  assert.deepEqual(h.notice(), { phase: 'preparing', retry: false, visible: false, intent: auto });
  h.advance(AUDIO_START_NOTICE_DELAY_MS - 1);
  h.replies[0].resolve(true);
  await h.flush();
  assert.deepEqual(h.commits, [auto]);
  assert.equal(h.notice(), null);
  assert.deepEqual(h.log, ['commit']);
  assert.equal(h.timers.size, 0);
});

test('the notice appears at the delay and closes when the preparation finishes', async () => {
  const h = harness();
  h.requests.request(auto);
  h.advance(AUDIO_START_NOTICE_DELAY_MS);
  assert.equal(h.notice()?.visible, true);
  assert.equal(h.requests.blocking, true);
  assert.deepEqual(h.log, ['shown']);
  h.replies[0].resolve(true);
  await h.flush();
  assert.deepEqual(h.log, ['shown', 'commit']);
  assert.equal(h.notice(), null);
});

test('a refused or not running output fails at once, even before the delay', async () => {
  for (const settle of [(r: Reply) => r.reject(new Error('refused')), (r: Reply) => r.resolve(false)]) {
    const h = harness();
    h.requests.request(auto);
    h.advance(10);
    settle(h.replies[0]);
    await h.flush();
    assert.deepEqual(h.notice(), { phase: 'failed', retry: false, visible: true, intent: auto });
    assert.deepEqual(h.log, ['shown', 'halt']);
    assert.equal(h.commits.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('the limit expires the request at 5 s, and its late reply starts nothing', async () => {
  const h = harness();
  h.requests.request(auto);
  h.advance(AUDIO_START_LIMIT_MS - 1);
  assert.equal(h.notice()?.phase, 'preparing');
  h.advance(1);
  assert.equal(h.notice()?.phase, 'delayed');
  assert.deepEqual(h.log, ['shown', 'halt']);
  h.replies[0].resolve(true);
  await h.flush();
  assert.equal(h.commits.length, 0);
  assert.equal(h.notice()?.phase, 'delayed');
});

test('a reply at or after the limit is late even when its timer has not run (stalled tab)', async () => {
  const h = harness();
  h.requests.request(auto);
  h.setNow(AUDIO_START_LIMIT_MS);
  h.replies[0].resolve(true);
  await h.flush();
  assert.equal(h.commits.length, 0);
  assert.equal(h.notice()?.phase, 'delayed');
});

test('Try again makes one new request with its own limit and keeps the intent', async () => {
  const h = harness();
  h.requests.request(guide);
  h.replies[0].reject(new Error('refused'));
  await h.flush();
  h.advance(4000);
  h.requests.retry();
  h.requests.retry();
  assert.equal(h.replies.length, 2);
  assert.deepEqual(h.notice(), { phase: 'preparing', retry: true, visible: true, intent: guide });
  h.advance(AUDIO_START_LIMIT_MS - 1);
  h.replies[1].resolve(true);
  await h.flush();
  assert.deepEqual(h.commits, [guide]);
});

test('repeated starts neither add requests nor extend the wait', () => {
  const h = harness();
  h.requests.request(auto);
  h.advance(200);
  h.requests.request(auto);
  h.requests.request(auto);
  assert.equal(h.replies.length, 1);
  h.advance(AUDIO_START_LIMIT_MS - 200);
  assert.equal(h.notice()?.phase, 'delayed');
});

test('another mode before the notice replaces the request; only the newest reply counts', async () => {
  const h = harness();
  h.requests.request(auto);
  h.advance(100);
  h.requests.request(guide);
  assert.equal(h.replies.length, 2);
  h.replies[1].resolve(true);
  h.replies[0].resolve(true);
  await h.flush();
  assert.deepEqual(h.commits, [guide]);
  const reversed = harness();
  reversed.requests.request(auto);
  reversed.requests.request(guide);
  reversed.replies[1].reject(new Error('refused'));
  reversed.replies[0].resolve(true);
  await reversed.flush();
  assert.equal(reversed.commits.length, 0);
  assert.equal(reversed.notice()?.phase, 'failed');
  assert.deepEqual(reversed.notice()?.intent, guide);
});

test('a shown notice ignores starts from behind it', () => {
  const h = harness();
  h.requests.request(auto);
  h.advance(AUDIO_START_NOTICE_DELAY_MS);
  h.requests.request(guide);
  assert.equal(h.replies.length, 1);
  assert.deepEqual(h.notice()?.intent, auto);
});

test('cancel and abandon end the request; late replies start nothing', async () => {
  for (const end of ['cancel', 'abandon'] as const) {
    for (const reply of [true, false]) {
      const h = harness();
      h.requests.request(auto);
      h.advance(AUDIO_START_NOTICE_DELAY_MS);
      h.requests[end]();
      assert.equal(h.notice(), null);
      assert.deepEqual(h.log, end === 'cancel' ? ['shown', 'halt'] : ['shown']);
      h.replies[0].resolve(reply);
      await h.flush();
      h.advance(AUDIO_START_LIMIT_MS);
      assert.equal(h.commits.length, 0, `${end} then ${reply}`);
      assert.equal(h.notice(), null);
      assert.equal(h.timers.size, 0);
    }
  }
});

test('dismissing a failure forgets its intent; a cancelled retry starts nothing', async () => {
  const h = harness();
  h.requests.request(auto);
  h.replies[0].resolve(false);
  await h.flush();
  h.requests.retry();
  h.requests.cancel();
  h.replies[1].resolve(true);
  await h.flush();
  h.requests.retry();
  assert.equal(h.replies.length, 2);
  assert.equal(h.commits.length, 0);
});

test('retries leave no timers behind', async () => {
  const h = harness();
  h.requests.request(auto);
  for (let attempt = 0; attempt < 5; attempt++) {
    h.replies.at(-1)!.resolve(false);
    await h.flush();
    h.requests.retry();
  }
  assert.equal(h.timers.size, 1);
});
