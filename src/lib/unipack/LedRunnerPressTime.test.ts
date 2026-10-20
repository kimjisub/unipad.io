import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { LedRunner } from './LedRunner';
import { ManualClock, parseWithLeds, recordingListener } from './testUtils';

describe('LED press times', () => {
  let clock: ManualClock;
  beforeEach(() => { clock = new ManualClock(); clock.install(); });
  afterEach(() => { clock.uninstall(); });

  async function start(leds: Record<string, string>) {
    const { listener, outputs } = recordingListener();
    const runner = new LedRunner(await parseWithLeds(leds), listener, () => 0, () => {});
    runner.launch();
    // Keep times as well as colours: catching up must happen in this tick, not a later one.
    const recorded: string[] = [];
    listener.onPadLedTurnOn = (x, y, _color, velocity) => { recorded.push(`${x},${y}=${velocity}@${clock.now}`); };
    listener.onPadLedTurnOff = (x, y) => { recorded.push(`${x},${y}=0@${clock.now}`); };
    return { runner, recorded, outputs };
  }

  test('a late first tick plays from the press time', async () => {
    const { runner, recorded } = await start({ '1 1 1': 'o 1 1 a 5\nd 10\nf 1 1' });
    runner.eventOn(0, 0);
    clock.tick(12);
    clock.tick(4);
    assert.deepEqual(recorded, ['0,0=5@1012', '0,0=0@1012']);
  });

  test('a late tick interleaves animations by due time', async () => {
    const { runner, recorded } = await start({
      '1 1 1': 'o 2 2 a 5\nd 5\no 2 2 a 9\nd 100',
      '1 2 2': 'o 2 2 a 21\nd 100',
    });
    runner.eventOn(0, 0);
    clock.tick(0);
    clock.now = 1002;
    runner.eventOn(1, 1);
    clock.tick(6);
    assert.deepEqual(recorded, ['1,1=5@1000', '1,1=21@1008', '1,1=9@1008']);
  });

  test('a repress drains the old steps due before it and cuts off later steps', async () => {
    const { runner, recorded } = await start({
      '1 1 1': 'o 1 1 a 5\nd 10\no 2 2 a 9\nd 10\no 1 2 a 13\nd 100',
    });
    runner.eventOn(0, 0);
    clock.tick(0);
    clock.now = 1015;
    runner.eventOn(0, 0);
    clock.tick(13);
    assert.deepEqual(recorded, [
      '0,0=5@1000', '1,1=9@1028', '0,0=0@1028', '1,1=0@1028',
      '0,0=5@1028', '1,1=9@1028',
    ]);
  });

  test('a step due at the repress time plays before shutdown and the new start', async () => {
    const { runner, recorded } = await start({
      '1 1 1': 'o 1 1 a 5\nd 10\no 1 1 a 9\nd 10\no 2 2 a 13\nd 100',
    });
    runner.eventOn(0, 0);
    clock.tick(0);
    clock.now = 1010;
    runner.eventOn(0, 0);
    clock.tick(2);
    assert.deepEqual(recorded, ['0,0=5@1000', '0,0=9@1012', '0,0=0@1012', '0,0=5@1012']);
  });

  test('two presses between ticks still end the earlier animation', async () => {
    const { runner, recorded } = await start({ '1 1 1': 'o 1 1 a 5\nd 2\no 2 2 a 9\nd 100' });
    runner.eventOn(0, 0);
    clock.now = 1001;
    runner.eventOn(0, 0);
    clock.tick(3);
    assert.deepEqual(recorded, ['0,0=5@1004', '0,0=0@1004', '0,0=5@1004', '1,1=9@1004']);
  });

  for (const [pressedAt, expected] of [
    [1008, ['0,0=0@1016', '1,1=0@1016', '0,0=5@1016', '1,1=9@1020']],
    [1010, ['0,0=5@1016', '1,1=9@1020']],
  ] as const) {
    test(`a late press at ${pressedAt} only cleans up an animation still running then`, async () => {
      const { runner, recorded } = await start({ '1 1 1': 'o 1 1 a 5\nd 10\no 2 2 a 9' });
      runner.eventOn(0, 0);
      clock.tick(0);
      clock.tick(12);
      clock.now = 1014;
      runner.eventOn(0, 0, pressedAt);
      clock.tick(2);
      clock.tick(4);
      assert.deepEqual(recorded, ['0,0=5@1000', '1,1=9@1012', ...expected]);
    });
  }

  test('a release before the first tick ends a pending endless animation', async () => {
    const { runner, recorded } = await start({ '1 1 1 0': 'o 1 1 a 5\nd 10\no 2 2 a 9\nd 100' });
    runner.eventOn(0, 0);
    clock.now = 1002;
    runner.eventOff(0, 0);
    clock.tick(20);
    assert.deepEqual(recorded, ['0,0=5@1022', '0,0=0@1022']);
  });
});
