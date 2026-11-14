import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTION_PANEL_BACKGROUND, optionPanelColors } from './optionPanelColors';

test('without a theme options panel colour the panel keeps its own dark background and white content', () => {
  assert.deepEqual(optionPanelColors(undefined), { background: DEFAULT_OPTION_PANEL_BACKGROUND, ink: '#ffffff' });
});

test('a theme options panel colour is drawn at 94% opacity, as the apps draw it', () => {
  assert.equal(optionPanelColors('#424242').background, 'rgba(66, 66, 66, 0.94)');
});

test('an eight-digit theme colour is drawn at 94% opacity too, its own opacity replaced as the Android app does', () => {
  assert.equal(optionPanelColors('#ff000080').background, 'rgba(255, 0, 0, 0.94)');
});

test('panel content turns dark on a light theme background and stays white on a dark one', () => {
  assert.equal(optionPanelColors('#ffffff').ink, '#161e2b');
  assert.equal(optionPanelColors('#ffeb3b').ink, '#161e2b');
  assert.equal(optionPanelColors('#424242').ink, '#ffffff');
  assert.equal(optionPanelColors('#0d47a1').ink, '#ffffff');
});

test('a nearly transparent light colour is drawn as the opaque light panel its dark content is picked for', () => {
  assert.deepEqual(optionPanelColors('#ffffff10'), { background: 'rgba(255, 255, 255, 0.94)', ink: '#161e2b' });
});
