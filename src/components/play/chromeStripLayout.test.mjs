import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./PlayPage.tsx', import.meta.url), 'utf8');

const styleOf = (marker) => {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} not found in PlayPage.tsx`);
  const open = source.indexOf('style={{', start);
  return source.slice(open, source.indexOf('}}', open));
};

// The ControlPanel (menu, play-mode segments, tools) is wider than the minimum strip.
// A strip pinned to a fixed width centers the wider panel over it, pushing its left
// edge past the screen edge, so the strip has to grow with the panel and the pad
// stage has to start where the strip actually ends.
test('left chrome strip grows with the control panel instead of clipping it', () => {
  const strip = styleOf('ref={observeChromeStrip}');
  assert.doesNotMatch(strip, /\bwidth:/);
  assert.match(strip, /minWidth: `\$\{CHROME_STRIP_WIDTH\}px`/);
});

test('pad stage is inset by the measured strip width', () => {
  const stage = styleOf('ref={centerStageRef}');
  assert.match(stage, /left: `\$\{stageInsetLeft \+ chromeStripWidth\}px`/);
});

// Korean labels may break between any two characters, so without nowrap the
// segments shrink the panel and stack "가이드" one syllable per line.
test('play mode segment labels stay on one line', () => {
  const panel = readFileSync(new URL('./ControlPanel.tsx', import.meta.url), 'utf8');
  const segment = panel.slice(panel.indexOf('function PlayModeSegmented'), panel.indexOf('function CheckItem'));
  const buttonClass = segment.match(/<button[^>]*?className="([^"]*)"/);
  assert.ok(buttonClass, 'play mode segment button not found');
  assert.match(buttonClass[1], /\bwhitespace-nowrap\b/);
});
