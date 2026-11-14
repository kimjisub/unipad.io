import { fadeThemeColor } from '@/lib/unipack/ThemeManager';

/** The play screen's own options panel background, shown when the theme sets no `option_window`. */
export const DEFAULT_OPTION_PANEL_BACKGROUND = 'rgba(22,30,43,0.94)';

/** The apps draw a theme's `option_window` at 94% opacity. */
const OPTION_PANEL_OPACITY = 0.94;

const LIGHT_INK = '#ffffff';
const DARK_INK = '#161e2b';

export interface OptionPanelColors {
  background: string;
  /** Text, icons, fills and switch parts on the panel, in whichever of white or dark reads better on it. */
  ink: string;
}

function rgbOf(color: string): [number, number, number] {
  const hex = color.slice(1, 7);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2 relative luminance of an opaque colour. */
function luminance([r, g, b]: [number, number, number]): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The options panel colours for a loaded theme colour (`#rrggbb` or `#rrggbbaa`): the theme's
 * `option_window` at 94% opacity, replacing any opacity of its own as the Android app does, so the
 * panel is always nearly opaque and the content colour picked for the colour is the one seen.
 * Without one, the panel keeps its own dark background and white content.
 */
export function optionPanelColors(optionWindow: string | undefined): OptionPanelColors {
  if (!optionWindow) return { background: DEFAULT_OPTION_PANEL_BACKGROUND, ink: LIGHT_INK };
  const panel = luminance(rgbOf(optionWindow));
  const darkReadsBetter = contrastRatio(luminance(rgbOf(DARK_INK)), panel) >= contrastRatio(1, panel);
  return {
    background: fadeThemeColor(optionWindow.slice(0, 7), OPTION_PANEL_OPACITY),
    ink: darkReadsBetter ? DARK_INK : LIGHT_INK,
  };
}
