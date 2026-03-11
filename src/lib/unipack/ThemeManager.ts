import JSZip from 'jszip';

export interface ThemeMetadata {
  name: string;
  author: string;
  version: string;
}

export interface ThemeColors {
  checkbox?: string;
  traceLog?: string;
  optionWindow?: string;
  optionWindowCheckbox?: string;
}

export interface ThemeAssets {
  metadata: ThemeMetadata;
  colors: ThemeColors;
  icon: string | null;
  playbg: string | null;
  customLogo: string | null;
  btn: string | null;
  btnPressed: string | null;
  chainled: string | null;
  chain: string | null;
  chainSelected: string | null;
  chainGuide: string | null;
  phantom: string | null;
  phantomVariant: string | null;
  isChainLed: boolean;
}

const DEFAULT_THEME: ThemeAssets = {
  metadata: { name: 'Default', author: 'UniPad', version: '1.0' },
  colors: {
    checkbox: '#a6b4c9',
    traceLog: '#ffffff',
    optionWindow: '#FFFFFF',
    optionWindowCheckbox: '#414F66',
  },
  icon: '/theme/theme_ic.png',
  playbg: '/theme/playbg.png',
  customLogo: '/theme/custom_logo.png',
  btn: '/theme/btn.png',
  btnPressed: '/theme/btn_.png',
  chainled: '/theme/chainled.png',
  chain: '/theme/chain.png',
  chainSelected: '/theme/chain_.png',
  chainGuide: '/theme/chain__.png',
  phantom: '/theme/phantom.png',
  phantomVariant: '/theme/phantom_.png',
  isChainLed: true,
};

function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/png';
}

function toDataUrl(data: Uint8Array, mimeType = 'image/png'): string {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  const blob = new Blob([copy], { type: mimeType });
  return URL.createObjectURL(blob);
}

function getDirectoryPrefix(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx + 1) : '';
}

function parseJsonLoose<T>(text: string): T {
  const normalized = text.replace(/^\uFEFF/, '').trim();
  return JSON.parse(normalized) as T;
}

function detectThemePrefix(zip: JSZip, requestedPrefix = ''): string {
  if (requestedPrefix) return requestedPrefix;
  const direct = zip.files['theme.json'];
  if (direct && !direct.dir) return '';

  const candidates = Object.entries(zip.files)
    .filter(([path, file]) => !file.dir && path.toLowerCase().endsWith('/theme.json'))
    .map(([path]) => getDirectoryPrefix(path));

  return candidates[0] ?? '';
}

export async function loadThemeFromZip(zipData: ArrayBuffer): Promise<ThemeAssets> {
  const zip = await JSZip.loadAsync(zipData);
  return loadThemeFromJSZip(zip);
}

export async function loadThemeFromJSZip(zip: JSZip, prefix = ''): Promise<ThemeAssets> {
  const resolvedPrefix = detectThemePrefix(zip, prefix);
  const theme: ThemeAssets = {
    ...DEFAULT_THEME,
    colors: { ...DEFAULT_THEME.colors },
  };

  // Find theme.json
  const themeJsonFile = findFile(zip, resolvedPrefix, ['theme.json']);
  if (themeJsonFile) {
    try {
      const text = await themeJsonFile.async('text');
      const parsed = parseJsonLoose<Record<string, unknown>>(text);
      theme.metadata = {
        name: String(parsed.name ?? 'Unknown'),
        author: String(parsed.author ?? 'Unknown'),
        version: String(parsed.version ?? '1.0'),
      };
    } catch {
      console.warn('Failed to parse theme.json');
    }
  }

  // Find colors.json
  const colorsJsonFile = findFile(zip, resolvedPrefix, ['colors.json']);
  if (colorsJsonFile) {
    try {
      const text = await colorsJsonFile.async('text');
      const parsed = parseJsonLoose<Record<string, unknown>>(text);
      theme.colors = {
        checkbox: typeof (parsed.checkbox ?? parsed.checkBox) === 'string'
          ? String(parsed.checkbox ?? parsed.checkBox)
          : undefined,
        traceLog: typeof (parsed.trace_log ?? parsed.traceLog) === 'string'
          ? String(parsed.trace_log ?? parsed.traceLog)
          : undefined,
        optionWindow: typeof (parsed.option_window ?? parsed.optionWindow) === 'string'
          ? String(parsed.option_window ?? parsed.optionWindow)
          : undefined,
        optionWindowCheckbox: typeof (parsed.option_window_checkbox ?? parsed.optionWindowCheckbox) === 'string'
          ? String(parsed.option_window_checkbox ?? parsed.optionWindowCheckbox)
          : undefined,
      };
    } catch {
      console.warn('Failed to parse colors.json');
    }
  }

  // Load image assets
  const imageMap: Array<[keyof ThemeAssets, string[]]> = [
    ['icon', ['theme_ic']],
    ['playbg', ['playbg']],
    ['customLogo', ['custom_logo', 'custom-logo', 'logo']],
    ['btn', ['btn']],
    ['btnPressed', ['btn_']],
    ['chainled', ['chainled']],
    ['chain', ['chain']],
    ['chainSelected', ['chain_']],
    ['chainGuide', ['chain__']],
    ['phantom', ['phantom']],
    ['phantomVariant', ['phantom_']],
  ];

  for (const [key, stems] of imageMap) {
    const candidates: string[] = [];
    for (const stem of stems) {
      candidates.push(`${stem}.png`, `${stem}.webp`, `${stem}.jpg`, `${stem}.jpeg`);
    }
    const file = findFile(zip, resolvedPrefix, candidates);
    if (file) {
      try {
        const data = await file.async('uint8array');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (theme as any)[key] = toDataUrl(data, getMimeType(file.name));
      } catch {
        console.warn(`Failed to load theme image: ${candidates.join(', ')}`);
      }
    }
  }

  theme.isChainLed = theme.chainled !== null;

  return theme;
}

// Try to extract theme from a UniPack ZIP if it contains theme files
export async function extractThemeFromUniPackZip(zip: JSZip, rootPrefix: string): Promise<ThemeAssets | null> {
  const themeJson = findFile(zip, rootPrefix, ['theme.json']);
  if (!themeJson) return null;
  return loadThemeFromJSZip(zip, rootPrefix);
}

function findFile(zip: JSZip, prefix: string, names: string[]): JSZip.JSZipObject | null {
  const directCandidates = names.flatMap((name) => [
    prefix + name,
    prefix + name.toLowerCase(),
    prefix + name.charAt(0).toUpperCase() + name.slice(1),
  ]);
  for (const candidate of directCandidates) {
    const file = zip.files[candidate];
    if (file && !file.dir) return file;
  }

  const prefixLower = prefix.toLowerCase();
  const nameSet = new Set(names.map((name) => name.toLowerCase()));
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const lowerPath = path.toLowerCase();
    if (prefixLower && !lowerPath.startsWith(prefixLower)) continue;
    const filename = lowerPath.slice(lowerPath.lastIndexOf('/') + 1);
    if (nameSet.has(filename)) return file;
  }
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const filename = path.toLowerCase().slice(path.lastIndexOf('/') + 1);
    if (nameSet.has(filename)) return file;
  }
  return null;
}

export function releaseThemeUrls(theme: ThemeAssets): void {
  const urlFields: (keyof ThemeAssets)[] = [
    'icon', 'playbg', 'customLogo', 'btn', 'btnPressed',
    'chainled', 'chain', 'chainSelected', 'chainGuide',
    'phantom', 'phantomVariant',
  ];
  for (const field of urlFields) {
    const url = theme[field];
    if (typeof url === 'string' && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}

export function getDefaultTheme(): ThemeAssets {
  return { ...DEFAULT_THEME };
}
