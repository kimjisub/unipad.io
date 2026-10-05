import { test } from 'node:test';
import assert from 'node:assert/strict';
import { padGroupOffsetX } from './padGroupOffset';

const INSET = 8;
const STRIP = 122;

// Mirrors PlayPage: the stage spans from the menu strip to the right inset, and one unit
// fits the pads plus every visible chain column into it.
function layout(screenWidth: number, screenHeight: number, leftChain: boolean, rightChain: boolean) {
  const stageLeft = INSET + STRIP;
  const stageWidth = screenWidth - stageLeft - INSET;
  const columns = 8 + (leftChain ? 1 : 0) + (rightChain ? 1 : 0);
  const unit = Math.floor(Math.min(stageWidth / columns, (screenHeight - 2 * INSET) / 8));
  const metrics = {
    screenWidth,
    stageLeft,
    stageWidth,
    padWidth: unit * 8,
    leftChainWidth: leftChain ? unit : 0,
    rightChainWidth: rightChain ? unit : 0,
  };
  const offset = padGroupOffsetX(metrics);
  const padLeft = stageLeft + offset + metrics.leftChainWidth;
  return { ...metrics, offset, padCentre: padLeft + metrics.padWidth / 2 };
}

function assertInsideStage(l: ReturnType<typeof layout>) {
  assert.ok(l.offset >= 0, 'left chain column runs under the menu strip');
  assert.ok(l.offset + l.leftChainWidth + l.padWidth + l.rightChainWidth <= l.stageWidth,
    'right chain column runs past the screen edge');
}

const landscape: [string, number, number][] = [
  ['20.5:9 phone (2460x1080)', 915, 402],
  ['iPhone landscape', 844, 390],
  ['16:9 laptop', 1280, 720],
  ['16:9 desktop', 1920, 1080],
];

for (const [name, w, h] of landscape) {
  test(`pad grid sits on the screen centre: ${name}`, () => {
    for (const rightChain of [false, true]) {
      const l = layout(w, h, false, rightChain);
      assert.ok(Math.abs(l.padCentre - w / 2) <= 0.5, `off by ${l.padCentre - w / 2}px`);
      assertInsideStage(l);
    }
  });
}

test('a narrow window shifts the pads only enough to clear the menu strip', () => {
  const l = layout(600, 402, false, true);
  assert.ok(l.padCentre > 300);
  assert.equal(l.offset, 0);
  assertInsideStage(l);
});

test('the pads move left when centring would push the right chain column off screen', () => {
  const offset = padGroupOffsetX({
    screenWidth: 1000, stageLeft: 130, stageWidth: 862, padWidth: 800, leftChainWidth: 0, rightChainWidth: 62,
  });
  assert.equal(offset, 0);
  assert.equal(padGroupOffsetX({
    screenWidth: 1000, stageLeft: 30, stageWidth: 962, padWidth: 800, leftChainWidth: 0, rightChainWidth: 100,
  }), 62);
});

test('a left chain column stays clear of the menu strip', () => {
  const l = layout(640, 402, true, true);
  assert.equal(l.offset, 0);
  assertInsideStage(l);
});
