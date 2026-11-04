import assert from 'node:assert/strict';
import test from 'node:test';
import { checksOf, isLocalRequest } from './web_rules.mjs';

const profile = { first: [1280, 800], rotated: [800, 1280] };
const checks = (padPress, rotate) => checksOf(profile, { packOpened: { pads: 64 }, padPress, rotate });

test('initial sound needs a start and a running context', () => {
  for (const contextState of ['suspended', 'closed', 'interrupted', undefined]) {
    assert.equal(checks({ soundStarts: 1, contextState }).sound, false, contextState);
  }
  assert.equal(checks({ soundStarts: 0, contextState: 'running' }).sound, false);
  assert.equal(checks({ soundStarts: 1, contextState: 'running' }).sound, true);
});

test('sound after rotation needs new starts and a running context', () => {
  const rotate = { pressedAfterRotate: true, soundStartsBefore: 1, soundStartsAfter: 2,
    contextStateAfterRotate: 'running', padsAfter: { pads: 64 } };
  for (const contextStateAfterRotate of ['suspended', 'closed', 'interrupted', undefined]) {
    assert.equal(checks({}, { ...rotate, contextStateAfterRotate }).sound, false);
  }
  assert.equal(checks({}, { ...rotate, soundStartsAfter: 1 }).sound, false);
  assert.equal(checks({}, { ...rotate, pressedAfterRotate: false }).sound, false);
  assert.equal(checks({}, rotate).sound, true);
});

test('the rotate hint is expected only on phone-width portrait layouts', () => {
  const rotation = (first, rotated, portraitHintVisibleBefore, portraitHintVisibleAfter) => checksOf({ first, rotated }, {
    packOpened: { pads: 64 }, padPress: {},
    rotate: { portraitHintVisibleBefore, portraitHintVisibleAfter, padsAfter: { pads: 64 } },
  }).rotation;
  assert.equal(rotation([390, 844], [844, 390], true, false), true);
  assert.equal(rotation([390, 844], [844, 390], false, false), false);
  assert.equal(rotation([599, 960], [960, 599], true, false), true);
  for (const [first, rotated] of [[[834, 1194], [1194, 834]], [[1024, 768], [768, 1024]], [[600, 960], [960, 600]]]) {
    assert.equal(rotation(first, rotated, false, false), true, `${first}`);
    assert.equal(rotation(first, rotated, true, false), false, `${first}`);
    assert.equal(rotation(first, rotated, false, true), false, `${first}`);
  }
});

test('requests must have the same server origin', () => {
  const base = 'http://localhost:3688';
  for (const url of ['http://localhost:36880/x', 'http://localhost:3688@outside.example/x',
    'https://localhost:3688/x', 'http://outside.example/x', 'not a URL',
    'blob:http://outside.example/id']) assert.equal(isLocalRequest(url, base), false, url);
  for (const url of ['http://localhost:3688/x', 'http://localhost:3688',
    'blob:http://localhost:3688/id', 'data:audio/wav;base64,AAAA']) {
    assert.equal(isLocalRequest(url, base), true, url);
  }
  assert.equal(isLocalRequest('http://localhost:3688/other', base + '/play'), true);
});
