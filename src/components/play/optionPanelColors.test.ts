import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_OPTION_PANEL_BACKGROUND,
  MIN_GRAPHIC_CONTRAST,
  MIN_TEXT_CONTRAST,
  OPTION_PANEL_MARKS,
  optionPanelColors,
  panelInk,
} from './optionPanelColors';

const ACCENT = '#414F66';

// An independent WCAG 2 check of what the panel shows: a colour over the panel, the panel over the
// half-black dimming, over a black or a white play screen.
type Rgb = [number, number, number];
const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const mix = (top: Rgb, alpha: number, bottom: Rgb): Rgb => top.map((c, i) => c * alpha + bottom[i] * (1 - alpha)) as Rgb;
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const screens = (optionWindow: string): Rgb[] =>
  ([[0, 0, 0], [255, 255, 255]] as Rgb[]).map((screen) => mix(rgbOf(optionWindow), 0.94, mix([0, 0, 0], 0.5, screen)));

/** `#rrggbb`, `rgba(…)` or the panel's content colour at a percentage, as [colour, opacity]. */
function resolve(css: string, ink: string): [Rgb, number] {
  const inkMix = /var\(--panel-ink\) ([\d.]+)%/.exec(css);
  if (inkMix) return [rgbOf(ink), Number(inkMix[1]) / 100];
  const rgba = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(css);
  if (rgba) return [[1, 2, 3].map((i) => Number(rgba[i])) as Rgb, Number(rgba[4])];
  return [rgbOf(css === 'var(--panel-ink)' ? ink : css), 1];
}

/** The lowest contrast `css` has against what is right behind it, over every possible play screen. */
function worst(optionWindow: string, css: string, ink: string, under?: string): number {
  const [color, alpha] = resolve(css, ink);
  return Math.min(...screens(optionWindow).map((panel) => {
    const [base, baseAlpha] = under ? resolve(under, ink) : [panel, 1];
    const behind = mix(base, baseAlpha, panel);
    return ratio(mix(color, alpha, behind), behind);
  }));
}

test('without a theme options panel colour every panel colour stays as the play screen has always drawn it', () => {
  assert.deepEqual(optionPanelColors(undefined, ACCENT), {
    background: DEFAULT_OPTION_PANEL_BACKGROUND,
    ink: '#ffffff',
    inkSecondary: panelInk(65),
    volumeValue: panelInk(40),
    hint: panelInk(35),
    ...OPTION_PANEL_MARKS,
    accent: ACCENT,
    accentSwitch: { track: 'rgba(65, 79, 102, 0.5)', thumb: 'var(--panel-ink)' },
    recordSwitch: { track: 'rgba(239, 68, 68, 0.5)', thumb: 'var(--panel-ink)' },
    switchOff: { track: panelInk(10), thumb: panelInk(70) },
    segment: { track: panelInk(6), fill: ACCENT, text: '#000000', idleText: panelInk(70) },
    card: { fill: panelInk(6), text: 'var(--panel-ink)', secondaryText: panelInk(65), linkIcon: panelInk(30) },
    drawnVolumeSlider: false,
  });
});

test('a theme options panel colour is drawn at 94% opacity, as the apps draw it', () => {
  assert.equal(optionPanelColors('#424242', ACCENT).background, 'rgba(66, 66, 66, 0.94)');
});

test('an eight-digit theme colour is drawn at 94% opacity too, its own opacity replaced as the Android app does', () => {
  assert.equal(optionPanelColors('#ff000080', ACCENT).background, 'rgba(255, 0, 0, 0.94)');
});

test('panel content turns dark on a light theme background and stays white on a dark one', () => {
  assert.equal(optionPanelColors('#ffffff', ACCENT).ink, '#161e2b');
  assert.equal(optionPanelColors('#ffeb3b', ACCENT).ink, '#161e2b');
  assert.equal(optionPanelColors('#424242', ACCENT).ink, '#ffffff');
  assert.equal(optionPanelColors('#0d47a1', ACCENT).ink, '#ffffff');
});

test('a nearly transparent light colour is drawn as the opaque light panel its dark content is picked for', () => {
  const colors = optionPanelColors('#ffffff10', ACCENT);
  assert.equal(colors.background, 'rgba(255, 255, 255, 0.94)');
  assert.equal(colors.ink, '#161e2b');
});

test('on a dark panel colours that already read keep their exact values', () => {
  const colors = optionPanelColors('#000000', '#4FC3F7');
  assert.equal(colors.ink, '#ffffff');
  assert.equal(colors.inkSecondary, panelInk(65));
  assert.equal(colors.danger, OPTION_PANEL_MARKS.danger);
  assert.equal(colors.accent, '#4FC3F7');
  assert.equal(colors.youtube, OPTION_PANEL_MARKS.youtube);
  assert.equal(colors.website, OPTION_PANEL_MARKS.website);
  assert.equal(colors.midiConnected, OPTION_PANEL_MARKS.midiConnected);
  assert.equal(colors.accentSwitch.track, 'rgba(79, 195, 247, 0.5)');
  assert.deepEqual(colors.switchOff, { track: panelInk(10), thumb: panelInk(70) });
  assert.deepEqual(colors.segment, { track: panelInk(6), fill: '#4FC3F7', text: '#000000', idleText: panelInk(70) });
  assert.equal(colors.drawnVolumeSlider, false);
});

test('the red close and Quit marks darken on a white panel only as far as 3:1, and stay red', () => {
  const { danger, ink } = optionPanelColors('#ffffff', ACCENT);
  assert.ok(worst('#ffffff', OPTION_PANEL_MARKS.danger, ink) < MIN_GRAPHIC_CONTRAST, 'the old red already read on white');
  assert.ok(worst('#ffffff', danger, ink) >= MIN_GRAPHIC_CONTRAST, `${danger} on white`);
  assert.ok(worst('#ffffff', danger, ink) < MIN_GRAPHIC_CONTRAST + 0.2, `${danger} moved further than needed`);
  const [r, g, b] = rgbOf(danger);
  assert.ok(r > g + 50 && r > b + 50, `${danger} is no longer red`);
});

const PANELS = ['#ffffff', '#ffeb3b', '#777777', '#424242', '#0d47a1', '#2196f3', '#808080', '#9e9e9e'];

/** Mid greys where neither black nor white reaches 4.5:1 over both screens; white, the better one, is kept. */
const NO_READABLE_TEXT = new Set(['#777777']);

test('panel text reaches 4.5:1 over any play screen, or is the best black or white where none can', () => {
  for (const panel of PANELS) {
    const { ink, inkSecondary } = optionPanelColors(panel, ACCENT);
    if (NO_READABLE_TEXT.has(panel)) {
      assert.equal(ink, '#ffffff');
      assert.ok(worst(panel, '#ffffff', ink) >= worst(panel, '#000000', ink), `${panel}: black reads better`);
      continue;
    }
    assert.ok(worst(panel, ink, ink) >= MIN_TEXT_CONTRAST, `${panel}: text ${ink}`);
    assert.ok(worst(panel, inkSecondary, ink) >= MIN_TEXT_CONTRAST, `${panel}: secondary text ${inkSecondary}`);
  }
});

test('marks for a control or its state reach 3:1 on every panel colour', () => {
  for (const panel of PANELS) {
    for (const accent of [ACCENT, '#ffeb3b', '#ff00ff80']) {
      const colors = optionPanelColors(panel, accent);
      const { ink } = colors;
      for (const key of ['danger', 'accent', 'youtube', 'website', 'midiConnected'] as const) {
        assert.ok(worst(panel, colors[key], ink) >= MIN_GRAPHIC_CONTRAST, `${panel}/${accent}: ${key} ${colors[key]}`);
      }
      for (const key of ['accentSwitch', 'recordSwitch'] as const) {
        const { track, thumb } = colors[key];
        assert.ok(worst(panel, track, ink) >= MIN_GRAPHIC_CONTRAST, `${panel}/${accent}: ${key} track ${track}`);
        assert.ok(worst(panel, thumb, ink, track) >= MIN_GRAPHIC_CONTRAST, `${panel}/${accent}: ${key} thumb ${thumb} on ${track}`);
      }
      assert.ok(worst(panel, colors.switchOff.thumb, ink) >= MIN_GRAPHIC_CONTRAST, `${panel}: switched-off thumb`);
      const { fill, text } = colors.segment;
      assert.ok(worst(panel, fill, ink) >= MIN_GRAPHIC_CONTRAST, `${panel}/${accent}: chosen segment ${fill}`);
      assert.ok(worst(panel, text, ink, fill) >= MIN_TEXT_CONTRAST, `${panel}/${accent}: chosen segment text ${text} on ${fill}`);
    }
  }
});

test('the volume level, hints and segments not chosen reach 4.5:1 on every panel colour', () => {
  for (const panel of PANELS) {
    const { ink, volumeValue, hint, segment } = optionPanelColors(panel, ACCENT);
    if (NO_READABLE_TEXT.has(panel)) continue;
    assert.ok(worst(panel, volumeValue, ink) >= MIN_TEXT_CONTRAST, `${panel}: volume level ${volumeValue}`);
    assert.ok(worst(panel, hint, ink) >= MIN_TEXT_CONTRAST, `${panel}: hint ${hint}`);
    assert.ok(worst(panel, segment.idleText, ink, segment.track) >= MIN_TEXT_CONTRAST, `${panel}: segment not chosen ${segment.idleText}`);
  }
});

const DARK_PANELS = ['#000000', ...PANELS];

test('the link icons reach 3:1 on the pack info card they sit on, not just on the bare panel', () => {
  for (const panel of DARK_PANELS) {
    const { ink, card } = optionPanelColors(panel, ACCENT);
    assert.ok(worst(panel, card.linkIcon, ink, card.fill) >= MIN_GRAPHIC_CONTRAST, `${panel}: link icon ${card.linkIcon} on ${card.fill}`);
  }
});

test('the pack title, producer and size reach 4.5:1 on the pack info card', () => {
  for (const panel of DARK_PANELS) {
    if (NO_READABLE_TEXT.has(panel)) continue;
    const { ink, card } = optionPanelColors(panel, ACCENT);
    const text = card.text === 'var(--panel-ink)' ? ink : card.text;
    assert.ok(worst(panel, text, ink, card.fill) >= MIN_TEXT_CONTRAST, `${panel}: title ${text} on ${card.fill}`);
    assert.ok(worst(panel, card.secondaryText, ink, card.fill) >= MIN_TEXT_CONTRAST, `${panel}: producer ${card.secondaryText} on ${card.fill}`);
  }
});

test('faint content that already reads keeps its value, and the rest moves only as far as needed', () => {
  assert.equal(optionPanelColors('#000000', ACCENT).segment.idleText, panelInk(70));
  assert.equal(optionPanelColors('#ffffff', ACCENT).segment.idleText, panelInk(70));
  assert.equal(optionPanelColors('#2196f3', ACCENT).segment.track, panelInk(6));
  const { ink, volumeValue } = optionPanelColors('#2196f3', ACCENT);
  assert.ok(worst('#2196f3', panelInk(40), ink) < MIN_TEXT_CONTRAST, 'the old volume level already read on blue');
  assert.ok(worst('#2196f3', volumeValue, ink) < MIN_TEXT_CONTRAST + 0.3, `${volumeValue} moved further than needed`);
});

test('on a mid grey the track behind the segments is thinned so their text can read, as the Android app thins its fills', () => {
  const { ink, segment } = optionPanelColors('#808080', ACCENT);
  assert.ok(worst('#808080', '#000000', ink, panelInk(6)) < MIN_TEXT_CONTRAST, 'black already read on the full track');
  assert.notEqual(segment.track, panelInk(6));
  assert.ok(worst('#808080', segment.idleText, ink, segment.track) >= MIN_TEXT_CONTRAST, `${segment.idleText} on ${segment.track}`);
  const { card } = optionPanelColors('#808080', ACCENT);
  assert.notEqual(card.fill, panelInk(6));
  assert.ok(worst('#808080', card.secondaryText, ink, card.fill) >= MIN_TEXT_CONTRAST, `${card.secondaryText} on ${card.fill}`);
});

test('the panel draws the volume slider itself only where its content is dark', () => {
  assert.equal(optionPanelColors(undefined, ACCENT).drawnVolumeSlider, false);
  assert.equal(optionPanelColors('#424242', ACCENT).drawnVolumeSlider, false);
  assert.equal(optionPanelColors('#ffffff', ACCENT).drawnVolumeSlider, true);
  assert.equal(optionPanelColors('#ffeb3b', ACCENT).drawnVolumeSlider, true);
});
