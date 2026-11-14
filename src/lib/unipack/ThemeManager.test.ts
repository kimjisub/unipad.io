import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { getDefaultTheme, loadThemeFromJSZip } from './ThemeManager';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function themeZip(files: Record<string, string | Uint8Array>): JSZip {
  const zip = new JSZip();
  zip.file('theme.json', JSON.stringify({ name: 'Test', author: 'Tester', version: '1.0' }));
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip;
}

const isThemeImage = (url: string | null) => typeof url === 'string' && url.startsWith('blob:');

test('a theme without chainled.png draws its chain buttons from its own chain images', async () => {
  const theme = await loadThemeFromJSZip(themeZip({ 'chain.png': PNG, 'chain_.png': PNG, 'chain__.png': PNG }));
  assert.equal(theme.isChainLed, false);
  assert.equal(theme.chainled, null);
  assert.ok(isThemeImage(theme.chain));
  assert.ok(isThemeImage(theme.chainSelected));
  assert.ok(isThemeImage(theme.chainGuide));
});

test('a theme with only chain.png fills the missing selected and guide chain images with the built-in ones', async () => {
  const theme = await loadThemeFromJSZip(themeZip({ 'chain.png': PNG }));
  assert.equal(theme.isChainLed, false);
  assert.equal(theme.chainled, null);
  assert.equal(theme.customLogo, null);
  assert.ok(isThemeImage(theme.chain));
  assert.equal(theme.chainSelected, '/theme/chain_.png');
  assert.equal(theme.chainGuide, '/theme/chain__.png');
});

test('a theme with chainled.png keeps lit chain buttons', async () => {
  const theme = await loadThemeFromJSZip(themeZip({ 'chainled.png': PNG }));
  assert.equal(theme.isChainLed, true);
  assert.ok(isThemeImage(theme.chainled));
});

test('a theme without custom_logo.png or phantom_.png shows no logo and no centre guide image', async () => {
  const theme = await loadThemeFromJSZip(themeZip({ 'phantom.png': PNG }));
  assert.equal(theme.customLogo, null);
  assert.equal(theme.phantomVariant, null);
  assert.ok(isThemeImage(theme.phantom));
});

test('a theme with custom_logo.png and phantom_.png shows both', async () => {
  const theme = await loadThemeFromJSZip(themeZip({ 'custom_logo.png': PNG, 'phantom_.png': PNG }));
  assert.ok(isThemeImage(theme.customLogo));
  assert.ok(isThemeImage(theme.phantomVariant));
});

test('images a theme leaves out are still filled with the built-in ones', async () => {
  const theme = await loadThemeFromJSZip(themeZip({}));
  assert.equal(theme.btn, '/theme/btn.png');
  assert.equal(theme.btnPressed, '/theme/btn_.png');
  assert.equal(theme.playbg, '/theme/playbg.png');
  assert.equal(theme.phantom, '/theme/phantom.png');
});

test('the built-in theme is unchanged by loading themes', async () => {
  await loadThemeFromJSZip(themeZip({ 'chain.png': PNG }));
  const theme = getDefaultTheme();
  assert.equal(theme.isChainLed, true);
  assert.equal(theme.chainled, '/theme/chainled.png');
  assert.equal(theme.customLogo, '/theme/custom_logo.png');
  assert.equal(theme.phantomVariant, '/theme/phantom_.png');
});

test('an eight-digit colour is read with its opacity first, as the apps read it', async () => {
  const theme = await loadThemeFromJSZip(themeZip({ 'colors.json': JSON.stringify({ checkbox: '#80FF00FF', trace_log: '#FF0000' }) }));
  assert.equal(theme.colors.checkbox, '#ff00ff80');
  assert.equal(theme.colors.traceLog, '#ff0000');
});

test('each colour a theme leaves out or writes wrongly takes the built-in colour', async () => {
  const builtIn = getDefaultTheme().colors;
  const theme = await loadThemeFromJSZip(themeZip({ 'colors.json': JSON.stringify({ checkbox: 'not a colour' }) }));
  assert.equal(theme.colors.checkbox, builtIn.checkbox);
  assert.equal(theme.colors.optionWindow, builtIn.optionWindow);
  assert.equal(theme.colors.optionWindowCheckbox, builtIn.optionWindowCheckbox);
  const withoutFile = await loadThemeFromJSZip(themeZip({}));
  assert.deepEqual(withoutFile.colors, theme.colors);
});

test('a theme without its own trace colour draws the trace like the built-in theme', async () => {
  assert.equal(getDefaultTheme().colors.traceLog, undefined);
  assert.equal((await loadThemeFromJSZip(themeZip({}))).colors.traceLog, undefined);
  const theme = await loadThemeFromJSZip(themeZip({ 'colors.json': JSON.stringify({ checkbox: '#123456' }) }));
  assert.equal(theme.colors.traceLog, undefined);
});
