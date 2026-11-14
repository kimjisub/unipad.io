import { fadeThemeColor, themeColorChannels, type ThemeColorChannels as Color } from '@/lib/unipack/ThemeManager';

/** The play screen's own options panel background, shown when the theme sets no `option_window`. */
export const DEFAULT_OPTION_PANEL_BACKGROUND = 'rgba(22,30,43,0.94)';

/** The apps draw a theme's `option_window` at 94% opacity. */
const OPTION_PANEL_OPACITY = 0.94;

const LIGHT_INK = '#ffffff';
const DARK_INK = '#161e2b';
const SEGMENT_TEXT = '#000000';

/** The colours the panel draws besides its content colour and the theme's accent. */
export const OPTION_PANEL_MARKS = {
  danger: '#FF6B6B',
  record: '#ef4444',
  youtube: '#f87171',
  website: '#60a5fa',
  midiConnected: '#22c55e',
} as const;

/** WCAG AA contrast for text, and for icons and marks that stand for a control or its state. */
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_GRAPHIC_CONTRAST = 3;

/** The panel's content colour (`--panel-ink`, set on the panel) at `percent` opacity. */
export const panelInk = (percent: number) => `color-mix(in srgb, var(--panel-ink) ${percent}%, transparent)`;

const SECONDARY_TEXT_PERCENT = 65;
const SWITCH_TRACK_ON_FACTOR = 0.5;
const SWITCH_TRACK_OFF_PERCENT = 10;
const SWITCH_THUMB_OFF_PERCENT = 70;

export interface SwitchColors {
  track: string;
  thumb: string;
}

export interface SegmentColors {
  fill: string;
  text: string;
}

export interface OptionPanelColors {
  background: string;
  /** Text, icons, fills and switch parts on the panel. */
  ink: string;
  /** Section titles and other secondary text. */
  inkSecondary: string;
  /** The close and Quit marks. */
  danger: string;
  /** Icons drawn in the theme's accent. */
  accent: string;
  youtube: string;
  website: string;
  midiConnected: string;
  accentSwitch: SwitchColors;
  recordSwitch: SwitchColors;
  switchOff: SwitchColors;
  /** The chosen segment of a segmented choice. */
  segmentActive: SegmentColors;
  /**
   * Safari draws the volume slider's thumb white whatever its accent colour, which is lost on a light
   * panel; there the panel draws the slider itself in its content colour.
   */
  drawnVolumeSlider: boolean;
}

const BLACK: Color = { r: 0, g: 0, b: 0, alpha: 1 };
const WHITE: Color = { r: 255, g: 255, b: 255, alpha: 1 };
/** The dimming laid over the play screen behind the open panel. */
const SCRIM: Color = { ...BLACK, alpha: 0.5 };

const channels = (color: string): Color => themeColorChannels(color) ?? BLACK;
const withAlpha = (color: Color, alpha: number): Color => ({ ...color, alpha: color.alpha * alpha });

function over(top: Color, bottom: Color): Color {
  const alpha = top.alpha + bottom.alpha * (1 - top.alpha);
  if (alpha === 0) return { ...BLACK, alpha: 0 };
  const mix = (t: number, b: number) => (t * top.alpha + b * bottom.alpha * (1 - top.alpha)) / alpha;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), alpha };
}

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG 2 relative luminance of an opaque colour. */
function luminance({ r, g, b }: Color): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(a: Color, b: Color): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The lowest contrast `color`, drawn over each opaque backdrop, has against it. */
function worstContrast(color: Color, backdrops: Color[]): number {
  return Math.min(...backdrops.map((backdrop) => contrastRatio(over(color, backdrop), backdrop)));
}

/**
 * What the panel can look like on screen: its colour over the dimming, over the darkest and the
 * lightest play screen a theme can put behind it.
 */
function backdropsOf(panel: Color): Color[] {
  return [BLACK, WHITE].map((screen) => over(panel, over(SCRIM, screen)));
}

type Lab = [number, number, number];

function toOklab({ r, g, b }: Color): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Lab): Color {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channel = (c: number) => Math.round(Math.min(255, Math.max(0, fromLinear(c))));
  return {
    r: channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha: 1,
  };
}

const READABLE_STEPS = 50;

/**
 * Null when `color` already reaches `minRatio` on every backdrop. Otherwise the colour moved towards
 * `towards`, or else black or white, whichever the backdrops contrast with more, only as far as
 * needed, in a space where only its lightness changes, so it keeps its hue. Where no step gets there
 * the result is that black or white. This is the Android app's rule for its options panel.
 */
function readableOn(color: Color, backdrops: Color[], minRatio: number, towards?: Color): Color | null {
  if (worstContrast(color, backdrops) >= minRatio) return null;
  const target = towards ?? [BLACK, WHITE].reduce((best, c) => (worstContrast(c, backdrops) > worstContrast(best, backdrops) ? c : best));
  const [from, to] = [toOklab(over(color, backdrops[0])), toOklab(target)];
  for (let step = 1; step <= READABLE_STEPS; step++) {
    const t = step / READABLE_STEPS;
    const candidate = fromOklab(from.map((v, i) => v + (to[i] - v) * t) as Lab);
    if (worstContrast(candidate, backdrops) >= minRatio) return candidate;
  }
  return target;
}

const hex = ({ r, g, b }: Color) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** `css` (whose channels are `color`) where it already reads on the backdrops, else its readable replacement. */
function readable(css: string, color: Color, backdrops: Color[], minRatio: number, towards?: Color): string {
  const moved = readableOn(color, backdrops, minRatio, towards);
  return moved ? hex(moved) : css;
}

const directionOf = (color: Color) => (luminance(color) < 0.5 ? BLACK : WHITE);

/** `preferred` where it reaches `minRatio` on `fill` over every backdrop, else whichever of white or dark reads better there. */
function contentOn(fill: Color, backdrops: Color[], preferred: string, minRatio: number): string {
  const behind = backdrops.map((backdrop) => over(fill, backdrop));
  const contrast = (css: string) => worstContrast(channels(css), behind);
  if (contrast(preferred) >= minRatio) return preferred;
  return contrast(LIGHT_INK) >= contrast(DARK_INK) ? LIGHT_INK : DARK_INK;
}

function switchOn(color: string, ink: string, backdrops: Color[]): SwitchColors {
  const css = fadeThemeColor(color, SWITCH_TRACK_ON_FACTOR);
  const faded = withAlpha(channels(color), SWITCH_TRACK_ON_FACTOR);
  const track = readable(css, faded, backdrops, MIN_GRAPHIC_CONTRAST);
  const thumb = contentOn(track === css ? faded : channels(track), backdrops, ink, MIN_GRAPHIC_CONTRAST);
  return { track, thumb };
}

/**
 * The options panel colours for a loaded theme colour (`#rrggbb` or `#rrggbbaa`) and the theme's
 * accent: the theme's `option_window` at 94% opacity, replacing any opacity of its own as the
 * Android app does, with content in whichever of white or dark reads better on it. As in the Android
 * app, each colour drawn on the panel keeps its value where it reads on every backdrop the panel can
 * have (text 4.5:1, marks 3:1) and is otherwise moved in lightness until it does.
 * Without a theme colour, the panel keeps its own dark background and its colours as they are.
 */
export function optionPanelColors(optionWindow: string | undefined, accent: string): OptionPanelColors {
  const switchOff = { track: panelInk(SWITCH_TRACK_OFF_PERCENT), thumb: panelInk(SWITCH_THUMB_OFF_PERCENT) };
  if (!optionWindow) {
    const thumbOn = 'var(--panel-ink)';
    return {
      background: DEFAULT_OPTION_PANEL_BACKGROUND,
      ink: LIGHT_INK,
      inkSecondary: panelInk(SECONDARY_TEXT_PERCENT),
      ...OPTION_PANEL_MARKS,
      accent,
      accentSwitch: { track: fadeThemeColor(accent, SWITCH_TRACK_ON_FACTOR), thumb: thumbOn },
      recordSwitch: { track: fadeThemeColor(OPTION_PANEL_MARKS.record, SWITCH_TRACK_ON_FACTOR), thumb: thumbOn },
      switchOff,
      segmentActive: { fill: accent, text: SEGMENT_TEXT },
      drawnVolumeSlider: false,
    };
  }

  const opaque = { ...channels(optionWindow), alpha: 1 };
  const backdrops = backdropsOf({ ...opaque, alpha: OPTION_PANEL_OPACITY });
  const content = contrastRatio(channels(DARK_INK), opaque) >= contrastRatio(channels(LIGHT_INK), opaque) ? DARK_INK : LIGHT_INK;
  const ink = readable(content, channels(content), backdrops, MIN_TEXT_CONTRAST);
  const inkColor = channels(ink);
  const towards = directionOf(inkColor);
  const mark = (css: string) => readable(css, channels(css), backdrops, MIN_GRAPHIC_CONTRAST);
  const accentMark = mark(accent);

  return {
    background: fadeThemeColor(optionWindow.slice(0, 7), OPTION_PANEL_OPACITY),
    ink,
    inkSecondary: readable(panelInk(SECONDARY_TEXT_PERCENT), withAlpha(inkColor, SECONDARY_TEXT_PERCENT / 100), backdrops, MIN_TEXT_CONTRAST, towards),
    danger: mark(OPTION_PANEL_MARKS.danger),
    accent: accentMark,
    youtube: mark(OPTION_PANEL_MARKS.youtube),
    website: mark(OPTION_PANEL_MARKS.website),
    midiConnected: mark(OPTION_PANEL_MARKS.midiConnected),
    accentSwitch: switchOn(accent, ink, backdrops),
    recordSwitch: switchOn(OPTION_PANEL_MARKS.record, ink, backdrops),
    switchOff: {
      track: switchOff.track,
      thumb: readable(switchOff.thumb, withAlpha(inkColor, SWITCH_THUMB_OFF_PERCENT / 100), backdrops, MIN_GRAPHIC_CONTRAST, towards),
    },
    segmentActive: {
      fill: accentMark,
      text: contentOn(channels(accentMark), backdrops, SEGMENT_TEXT, MIN_TEXT_CONTRAST),
    },
    drawnVolumeSlider: towards === BLACK,
  };
}
