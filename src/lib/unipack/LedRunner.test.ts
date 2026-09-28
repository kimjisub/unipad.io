import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { LAUNCHPAD_ARGB } from './colors';
import { LedRunner } from './LedRunner';
import { ManualClock, parseWithLeds, recordingListener } from './testUtils';

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

  // Android resets state.delay when the per-tick budget runs out and keeps the loop playing; here
  // the budget ends the animation, so a strobe faster than one tick stops and can stay lit.
  test('a looping strobe faster than one tick goes dark on release', {
    todo: 'LedRunner stops a loop-0 animation once the per-tick budget runs out',
  }, async () => {
    const { runner, outputs, press } = await startRunner({ '1 1 1 0': 'f 1 1\nd 1\no 1 1 a 5\nd 1' });

    press(0, 0);
    for (let i = 0; i < 50; i++) clock.tick(4);
    runner.eventOff(0, 0);
    clock.tick(4);

    assert.ok(outputs.length > 20, `strobe played ${outputs.length} changes in 200 ms`);
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
    runner.eventOn(0, 0);
    assert.equal(outputs.length, 4);
  });

  test('an empty keyLed file outputs nothing and does not stall the loop', async () => {
    const { outputs, press } = await startRunner({ '1 1 1': '' });

    press(0, 0);
    clock.tick(4);

    assert.deepEqual(outputs, []);
    assert.equal(clock.scheduled, true);
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
