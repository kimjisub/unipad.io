import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { LAUNCHPAD_ARGB } from './colors';
import { LedRunner } from './LedRunner';
import { ManualClock, parseWithLeds, playInWorker, recordingListener } from './testUtils';

const RED = LAUNCHPAD_ARGB[5];

describe('LedRunner', () => {
  let clock: ManualClock;

  beforeEach(() => {
    clock = new ManualClock();
    clock.install();
  });

  afterEach(() => {
    clock.uninstall();
  });

  async function startRunner(leds: Record<string, string>) {
    const pack = await parseWithLeds(leds);
    const { listener, outputs } = recordingListener();
    let chain = 0;
    const chainChanges: number[] = [];
    const runner = new LedRunner(pack, listener, () => chain, (c) => {
      chainChanges.push(c);
      chain = c;
    });
    runner.launch();
    return {
      runner,
      /** eventOn queues the animation; the next tick adopts it and the one after plays it. */
      press: (x: number, y: number) => {
        runner.eventOn(x, y);
        clock.tick(4);
        clock.tick(4);
      },
      outputs,
      chainChanges,
      setChain: (c: number) => { chain = c; },
    };
  }

  test('plays an animation once and outputs nothing after it ends', async () => {
    const { outputs, press } = await startRunner({ '1 1 1': 'o 1 1 a 5\nd 10\nf 1 1' });

    press(0, 0);
    assert.deepEqual(outputs, [['padOn', 0, 0, RED, 5]]);

    clock.tick(10);
    assert.deepEqual(outputs, [['padOn', 0, 0, RED, 5], ['padOff', 0, 0]]);

    for (let i = 0; i < 20; i++) clock.tick(4);
    assert.deepEqual(outputs, [['padOn', 0, 0, RED, 5], ['padOff', 0, 0]]);
  });

  test('turns a looping animation off on release and stays dark', async () => {
    const { runner, outputs, press } = await startRunner({ '1 1 1 0': 'o 1 1 a 5\nd 10\nf 1 1\nd 10' });

    press(0, 0);
    runner.eventOff(0, 0);
    clock.tick(4);
    assert.deepEqual(outputs, [['padOn', 0, 0, RED, 5], ['padOff', 0, 0]]);

    for (let i = 0; i < 20; i++) clock.tick(4);
    assert.equal(outputs.length, 2);
  });

  describe('an endless animation that outruns one tick', () => {
    // Two passes of this strobe fit in one 4 ms tick, more than the per-tick budget allows.
    const STROBE = { '1 1 1 0': 'f 1 1\nd 1\no 1 1 a 5\nd 1' };

    test('keeps playing in order and goes dark on release', async () => {
      const { runner, outputs, press } = await startRunner(STROBE);

      press(0, 0);
      for (let i = 0; i < 50; i++) clock.tick(4);
      runner.eventOff(0, 0);
      clock.tick(4);

      assert.ok(outputs.length > 20, `strobe played ${outputs.length} changes in 200 ms`);
      outputs.forEach((output, i) => assert.equal(output[0], i % 2 === 0 ? 'padOn' : 'padOff', `change ${i}`));
      assert.equal(outputs.at(-1)?.[0], 'padOff');
    });

    test('goes dark on stop', async () => {
      const { runner, outputs, press } = await startRunner(STROBE);

      press(0, 0);
      for (let i = 0; i < 50; i++) clock.tick(4);
      runner.stop();

      assert.equal(outputs.at(-1)?.[0], 'padOff');
    });

    test('keeps playing across a chain switch and goes dark on release back on its chain', async () => {
      const { runner, outputs, press, setChain } = await startRunner(STROBE);

      press(0, 0);
      setChain(1);
      for (let i = 0; i < 50; i++) clock.tick(4);
      const played = outputs.length;
      for (let i = 0; i < 10; i++) clock.tick(4);
      setChain(0);
      runner.eventOff(0, 0);
      clock.tick(4);

      assert.ok(outputs.length > played, 'strobe froze after the chain switch');
      assert.equal(outputs.at(-1)?.[0], 'padOff');
    });
  });

  // A background tab throttles setTimeout to about once a second, so one tick sees a long backlog.
  test('a looping animation survives a late tick without replaying the backlog and goes dark on release', async () => {
    const { runner, outputs, press } = await startRunner({ '1 1 1 0': 'o 1 1 a 5\nd 10\nf 1 1\nd 10' });

    press(0, 0);
    const beforeStall = outputs.length;
    clock.tick(1000);
    assert.ok(outputs.length - beforeStall <= 5, `the late tick replayed ${outputs.length - beforeStall} changes`);

    const afterStall = outputs.length;
    for (let i = 0; i < 20; i++) clock.tick(4);
    assert.ok(outputs.length > afterStall, 'the loop stopped after the late tick');

    runner.eventOff(0, 0);
    clock.tick(4);
    assert.equal(outputs.at(-1)?.[0], 'padOff');
  });

  test('stop turns lit LEDs off and schedules no further tick', async () => {
    const { runner, outputs, press } = await startRunner({ '1 1 1 0': 'o 1 1 a 5\no * 2 a 5\nd 1000' });

    press(0, 0);
    runner.stop();

    assert.deepEqual(outputs, [
      ['padOn', 0, 0, RED, 5],
      ['chainOn', 1, RED, 5],
      ['padOff', 0, 0],
      ['chainOff', 1],
    ]);
    assert.equal(clock.scheduled, false);
  });

  test('a press while stopped is dropped, and a press after launch plays again', async () => {
    const { runner, outputs, press } = await startRunner({ '1 1 1': 'o 1 1 a 5\nd 10\nf 1 1' });

    runner.stop();
    runner.eventOn(0, 0);
    runner.launch();
    for (let i = 0; i < 5; i++) clock.tick(4);
    assert.deepEqual(outputs, []);

    press(0, 0);
    assert.deepEqual(outputs, [['padOn', 0, 0, RED, 5]]);
  });

  test('an empty keyLed file outputs nothing and does not stall the loop', async () => {
    const { outputs, press } = await startRunner({ '1 1 1': '' });

    press(0, 0);
    clock.tick(4);

    assert.deepEqual(outputs, []);
    assert.equal(clock.scheduled, true);
  });

  // A tick that never returns freezes the page and this process with it, so these run in a worker
  // that is terminated after a deadline.
  describe('endless animations that never push time forward', () => {
    test('an empty endless keyLed file does not hang a tick', async () => {
      assert.deepEqual(await playInWorker({ '1 1 1 0': '' }), []);
    });

    test('an endless keyLed file without delays does not hang a tick', async () => {
      const outputs = await playInWorker({ '1 1 1 0': 'o 1 1 a 5\nf 1 1' });
      assert.ok(outputs.length > 0);
    });
  });

  describe('chain switching', () => {
    test('a chain event in an animation switches the chain', async () => {
      const { press, chainChanges } = await startRunner({ '1 1 1': 'c 2' });

      press(0, 0);

      assert.deepEqual(chainChanges, [1]);
    });

    test('a pad plays the animation of the current chain', async () => {
      const { press, outputs, setChain } = await startRunner({
        '1 1 1': 'o 1 1 a 5',
        '2 1 1': 'o 2 2 a 5',
      });

      setChain(1);
      press(0, 0);

      assert.deepEqual(outputs, [['padOn', 1, 1, RED, 5]]);
    });
  });
});
