import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTION_PANEL_BACKGROUND, optionPanelColors } from './optionPanelColors';

test('without a theme options panel colour the panel keeps its own dark background and white content', () => {
  assert.deepEqual(optionPanelColors(undefined), { background: DEFAULT_OPTION_PANEL_BACKGROUND, ink: '#ffffff' });
});

test('a theme options panel colour is drawn at 94% opacity, as the apps draw it', () => {
  assert.equal(optionPanelColors('#424242').background, 'rgba(66, 66, 66, 0.94)');
});

test('an eight-digit theme colour keeps its own opacity under the 94%', () => {
  assert.equal(optionPanelColors('#ff000080').background, 'rgba(255, 0, 0, 0.472)');
});

test('panel content turns dark on a light theme background and stays white on a dark one', () => {
  assert.equal(optionPanelColors('#ffffff').ink, '#161e2b');
  assert.equal(optionPanelColors('#ffeb3b').ink, '#161e2b');
  assert.equal(optionPanelColors('#424242').ink, '#ffffff');
  assert.equal(optionPanelColors('#0d47a1').ink, '#ffffff');
});

test('the content colour follows the colour itself, not its opacity', () => {
  assert.equal(optionPanelColors('#ffffff10').ink, '#161e2b');
});
