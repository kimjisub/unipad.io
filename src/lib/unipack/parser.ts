import JSZip from 'jszip';
import {
  AutoPlay,
  AutoPlayElement,
  LedAnimation,
  LedEvent,
  NO_WORMHOLE,
  Sound,
  UniPackData,
  UniPackInfo,
} from './types';
import { LAUNCHPAD_ARGB } from './colors';

export async function parseUniPack(
  zipData: ArrayBuffer,
  onPhase?: (phase: string) => void,
): Promise<UniPackData> {
  onPhase?.('Reading archive...');
  const zip = await JSZip.loadAsync(zipData);
  const errors: string[] = [];

  const rootPrefix = findRootPrefix(zip);

  onPhase?.('Loading info...');
  const info = await parseInfo(zip, rootPrefix, errors);
  if (!info) throw new Error('Invalid UniPack: missing info file');

  onPhase?.('Loading sounds...');
  const { soundTable, soundFiles } = await parseKeySound(
    zip,
    rootPrefix,
    info,
    errors,
  );
  onPhase?.('Loading LEDs...');
  const ledAnimationTable = await parseKeyLed(zip, rootPrefix, info, errors);
  onPhase?.('Loading autoplay...');
  const autoPlay = await parseAutoPlay(
    zip,
    rootPrefix,
    info,
    soundTable,
    errors,
  );

  let soundCount = 0;
  for (let c = 0; c < info.chain; c++) {
    for (let x = 0; x < info.buttonX; x++) {
      for (let y = 0; y < info.buttonY; y++) {
        soundCount += soundTable[c][x][y]?.length ?? 0;
      }
    }
  }

  let ledCount = 0;
  if (ledAnimationTable) {
    for (let c = 0; c < info.chain; c++) {
      for (let x = 0; x < info.buttonX; x++) {
        for (let y = 0; y < info.buttonY; y++) {
          ledCount += ledAnimationTable[c][x][y]?.length ?? 0;
        }
      }
    }
  }

  return {
    info,
    soundTable,
    ledAnimationTable,
    autoPlay,
    soundFiles,
    keyLedExist: ledAnimationTable !== null,
    autoPlayExist: autoPlay !== null,
    soundCount,
    ledCount,
    errors,
  };
}

function findRootPrefix(zip: JSZip): string {
  const paths = Object.keys(zip.files);

  for (const p of paths) {
    const lower = p.toLowerCase();
    if (lower === 'info' || lower.endsWith('/info')) {
      const idx = p.lastIndexOf('/');
      if (idx === -1) return '';
      return p.substring(0, idx + 1);
    }
  }

  const dirs = new Set<string>();
  for (const p of paths) {
    const firstSlash = p.indexOf('/');
    if (firstSlash !== -1) {
      dirs.add(p.substring(0, firstSlash + 1));
    }
  }
  if (dirs.size === 1) {
    const prefix = Array.from(dirs)[0];
    if (zip.files[prefix + 'info'] || zip.files[prefix + 'Info']) {
      return prefix;
    }
  }

  return '';
}

function getFile(zip: JSZip, prefix: string, name: string): JSZip.JSZipObject | null {
  const paths = [
    prefix + name,
    prefix + name.toLowerCase(),
    prefix + name.charAt(0).toUpperCase() + name.slice(1),
  ];
  for (const p of paths) {
    if (zip.files[p] && !zip.files[p].dir) return zip.files[p];
  }
  // case-insensitive fallback
  const target = (prefix + name).toLowerCase();
  for (const [path, file] of Object.entries(zip.files)) {
    if (path.toLowerCase() === target && !file.dir) return file;
  }
  return null;
}

function getDir(zip: JSZip, prefix: string, name: string): string | null {
  const paths = [
    prefix + name + '/',
    prefix + name.toLowerCase() + '/',
    prefix + name.toUpperCase() + '/',
  ];
  for (const p of paths) {
    if (zip.files[p] && zip.files[p].dir) return p;
  }
  // case-insensitive fallback
  const target = (prefix + name + '/').toLowerCase();
  for (const path of Object.keys(zip.files)) {
    if (path.toLowerCase().startsWith(target)) {
      const dirEnd = path.indexOf('/', prefix.length);
      if (dirEnd !== -1) return path.substring(0, dirEnd + 1);
    }
  }
  return null;
}

async function parseInfo(
  zip: JSZip,
  prefix: string,
  errors: string[],
): Promise<UniPackInfo | null> {
  const file = getFile(zip, prefix, 'info');
  if (!file) {
    errors.push("info doesn't exist");
    return null;
  }

  const text = await file.async('text');
  const info: UniPackInfo = {
    title: '',
    producerName: '',
    buttonX: 0,
    buttonY: 0,
    chain: 0,
    squareButton: true,
    website: null,
  };

  for (const line of splitLines(text)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    switch (key) {
      case 'title': info.title = value; break;
      case 'producerName': info.producerName = value; break;
      case 'buttonX': info.buttonX = strictInt(value); break;
      case 'buttonY': info.buttonY = strictInt(value); break;
      case 'chain': info.chain = strictInt(value); break;
      case 'squareButton': info.squareButton = value === 'true'; break;
      case 'website': info.website = value; break;
    }
  }

  if (!info.title) errors.push('info: title was missing');
  if (!info.producerName) errors.push('info: producerName was missing');
  if (!info.buttonX) errors.push('info: buttonX was missing');
  if (!info.buttonY) errors.push('info: buttonY was missing');
  if (!info.chain) errors.push('info: chain was missing');
  // NaN passes every `<`/`>` comparison, so a chain of "abc" used to reach the table allocation.
  if (!Number.isInteger(info.chain) || info.chain < 1 || info.chain > 24) {
    errors.push('info: chain out of range');
    return null;
  }
  // Same bound as iOS: a negative value or a 100000-wide grid is rejected instead of allocating.
  if (!Number.isInteger(info.buttonX) || !Number.isInteger(info.buttonY)
    || info.buttonX < 0 || info.buttonX > 64 || info.buttonY < 0 || info.buttonY > 64) {
    errors.push('info: buttonX/buttonY out of range');
    return null;
  }

  return info;
}

async function parseKeySound(
  zip: JSZip,
  prefix: string,
  info: UniPackInfo,
  errors: string[],
): Promise<{ soundTable: (Sound[] | null)[][][]; soundFiles: Map<string, ArrayBuffer> }> {
  const table: (Sound[] | null)[][][] = Array.from({ length: info.chain }, () =>
    Array.from({ length: info.buttonX }, () =>
      Array.from({ length: info.buttonY }, () => null),
    ),
  );
  const soundFiles = new Map<string, ArrayBuffer>();

  const keySoundFile = getFile(zip, prefix, 'keySound');
  if (!keySoundFile) {
    const keySoundLower = getFile(zip, prefix, 'keysound');
    if (!keySoundLower) {
      // Android and iOS treat a missing keySound as critical; here the pack opened with every
      // pad silent and one warning.
      throw new Error("Invalid UniPack: keySound doesn't exist");
    }
    return parseKeySoundFromFile(keySoundLower, zip, prefix, info, table, soundFiles, errors);
  }
  return parseKeySoundFromFile(keySoundFile, zip, prefix, info, table, soundFiles, errors);
}

async function parseKeySoundFromFile(
  file: JSZip.JSZipObject,
  zip: JSZip,
  prefix: string,
  info: UniPackInfo,
  table: (Sound[] | null)[][][],
  soundFiles: Map<string, ArrayBuffer>,
  errors: string[],
): Promise<{ soundTable: (Sound[] | null)[][][]; soundFiles: Map<string, ArrayBuffer> }> {
  const text = await file.async('text');

  for (const line of splitLines(text)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length <= 2) continue;

    let c: number, x: number, y: number;
    const soundURL: string | undefined = parts[3];
    let loop = 0;
    let wormhole = NO_WORMHOLE;

    try {
      c = strictInt(parts[0]) - 1;
      x = strictInt(parts[1]) - 1;
      y = strictInt(parts[2]) - 1;
      if (parts.length >= 5) loop = strictInt(parts[4]) - 1;
      if (parts.length >= 6) wormhole = strictInt(parts[5]) - 1;
    } catch {
      errors.push(`keySound: [${trimmed}] format is incorrect`);
      continue;
    }

    // Android records "format is incorrect" for a short or non-numeric line and keeps going;
    // here a 3-token line reached findSoundFile with undefined and threw out of the whole parse,
    // and a NaN loop/wormhole later set the chain to NaN and silenced every pad.
    if (isNaN(c) || isNaN(x) || isNaN(y) || typeof soundURL !== 'string' || soundURL.length === 0
      || !Number.isFinite(loop) || !Number.isFinite(wormhole)) {
      errors.push(`keySound: [${trimmed}] format is incorrect`);
      continue;
    }

    if (c < 0 || c >= info.chain) {
      errors.push(`keySound: [${trimmed}] chain is incorrect`);
      continue;
    }
    if (x < 0 || x >= info.buttonX) {
      errors.push(`keySound: [${trimmed}] x is incorrect`);
      continue;
    }
    if (y < 0 || y >= info.buttonY) {
      errors.push(`keySound: [${trimmed}] y is incorrect`);
      continue;
    }

    // Find sound file in zip
    const soundPath = findSoundFile(zip, prefix, soundURL);
    if (!soundPath) {
      errors.push(`keySound: [${trimmed}] sound was not found`);
      continue;
    }

    if (!soundFiles.has(soundPath)) {
      const data = await zip.files[soundPath].async('arraybuffer');
      soundFiles.set(soundPath, data);
    }

    const sound: Sound = {
      file: soundPath,
      audioBuffer: null,
      loop,
      wormhole,
      num: table[c][x][y]?.length ?? 0,
    };

    if (!table[c][x][y]) table[c][x][y] = [];
    table[c][x][y]!.push(sound);
  }

  return { soundTable: table, soundFiles };
}

/** \r\n, lone \r (classic Mac) and \n; splitting on '\n' alone made a CR-only file one line. */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** parseInt is lenient ("3abc" -> 3, "1 1 1.txt" -> 1), so a pack authored here had dead pads on
 *  Android, which rejects those lines. Only a complete integer counts. */
function strictInt(token: string | undefined): number {
  if (token === undefined || !/^[+-]?\d+$/.test(token)) return NaN;
  return Number(token);
}

/** Android parses the colour with a 32-bit toInt(16): more than six hex digits overflow and the
 *  event is dropped. */
function strictHex(token: string | undefined): number {
  if (token === undefined || !/^[0-9a-fA-F]{1,6}$/.test(token)) return NaN;
  return parseInt(token, 16);
}

function findSoundFile(zip: JSZip, prefix: string, soundURL: string): string | null {
  const candidates = [
    `${prefix}sounds/${soundURL}`,
    `${prefix}Sounds/${soundURL}`,
    `${prefix}sounds/${soundURL.toLowerCase()}`,
  ];
  for (const c of candidates) {
    if (zip.files[c] && !zip.files[c].dir) return c;
  }
  // Case-insensitive match of the whole candidate path. The old `endsWith` fallback also matched
  // "a.wav" against "sounds/beta.wav" and any nested folder, so a pack that played here had
  // missing or wrong sounds on Android.
  const wanted = candidates.map((c) => c.toLowerCase());
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (wanted.includes(path.toLowerCase())) return path;
  }
  return null;
}

async function parseKeyLed(
  zip: JSZip,
  prefix: string,
  info: UniPackInfo,
  errors: string[],
): Promise<(LedAnimation[] | null)[][][] | null> {
  const keyLedDir = getDir(zip, prefix, 'keyLed') || getDir(zip, prefix, 'keyled');
  if (!keyLedDir) return null;

  const table: (LedAnimation[] | null)[][][] = Array.from({ length: info.chain }, () =>
    Array.from({ length: info.buttonX }, () =>
      Array.from({ length: info.buttonY }, () => null),
    ),
  );

  const ledFiles = Object.entries(zip.files)
    // Direct children only (Android/iOS list the directory), and sorted by file name in code-unit
    // order: locale collation on the full path put multi-mapped files in a different order, so the
    // pad's first animation differed from Android's.
    .filter(([path, file]) => {
      if (file.dir || !path.startsWith(keyLedDir) || path === keyLedDir) return false;
      return !path.slice(keyLedDir.length).includes('/');
    })
    .sort(([a], [b]) => {
      const na = a.substring(a.lastIndexOf('/') + 1).toLowerCase();
      const nb = b.substring(b.lastIndexOf('/') + 1).toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    });

  for (const [path, file] of ledFiles) {
    const fileName = path.substring(path.lastIndexOf('/') + 1).trim();
    const parts = fileName.split(/\s+/);
    if (parts.length <= 2) continue;

    let c: number, x: number, y: number, loop = 1;
    try {
      c = strictInt(parts[0]) - 1;
      x = strictInt(parts[1]) - 1;
      y = strictInt(parts[2]) - 1;
      if (parts.length >= 4) loop = strictInt(parts[3]);
    } catch {
      errors.push(`keyLed: [${fileName}] format is incorrect`);
      continue;
    }

    if (isNaN(c) || c < 0 || c >= info.chain) {
      errors.push(`keyLed: [${fileName}] chain is incorrect`);
      continue;
    }
    if (isNaN(x) || x < 0 || x >= info.buttonX) {
      errors.push(`keyLed: [${fileName}] x is incorrect`);
      continue;
    }
    if (isNaN(y) || y < 0 || y >= info.buttonY) {
      errors.push(`keyLed: [${fileName}] y is incorrect`);
      continue;
    }
    if (isNaN(loop) || loop < 0) {
      errors.push(`keyLed: [${fileName}] loop is incorrect`);
      continue;
    }

    const text = await file.async('text');
    const ledEvents: LedEvent[] = [];

    for (const line of splitLines(text)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const split = trimmed.split(/\s+/);

      try {
        const option = split[0];
        switch (option) {
          case 'on':
          case 'o': {
            const xToken = split[1];
            let ledX: number, ledY: number;
            let ledColor = -1;
            let ledVelocity = 4;

            if (xToken === '*' || xToken === 'mc') {
              ledX = -1;
              ledY = strictInt(split[2]) - 1;
            } else if (xToken === 'l') {
              continue;
            } else {
              ledX = parseInt(xToken, 10) - 1;
              ledY = strictInt(split[2]) - 1;
            }

            if (split.length === 4) {
              ledColor = strictHex(split[3]) + 0xFF000000;
            } else if (split.length === 5) {
              if (split[3] === 'auto' || split[3] === 'a') {
                ledVelocity = strictInt(split[4]);
                // Android throws on a palette index outside 0..127 and drops the event.
                if (!(ledVelocity >= 0 && ledVelocity < LAUNCHPAD_ARGB.length)) {
                  errors.push(`keyLed: [${fileName}].[${trimmed}] format is incorrect`);
                  continue;
                }
                ledColor = LAUNCHPAD_ARGB[ledVelocity] ?? 0;
              } else {
                ledVelocity = strictInt(split[4]);
                ledColor = strictHex(split[3]) + 0xFF000000;
              }
            } else {
              errors.push(`keyLed: [${fileName}].[${trimmed}] format is incorrect`);
              continue;
            }
            if (!Number.isFinite(ledY) || (ledX !== -1 && !Number.isFinite(ledX)) || !Number.isFinite(ledColor) || !Number.isFinite(ledVelocity)) {
              errors.push(`keyLed: [${fileName}].[${trimmed}] format is incorrect`);
              continue;
            }

            ledEvents.push({ type: 'on', x: ledX, y: ledY, color: ledColor, velocity: ledVelocity });
            break;
          }
          case 'off':
          case 'f': {
            const xToken = split[1];
            let ledX: number, ledY: number;
            if (xToken === '*' || xToken === 'mc') {
              ledX = -1;
              ledY = strictInt(split[2]) - 1;
            } else if (xToken === 'l') {
              continue;
            } else {
              ledX = parseInt(xToken, 10) - 1;
              ledY = strictInt(split[2]) - 1;
            }
            if (!Number.isFinite(ledY) || (ledX !== -1 && !Number.isFinite(ledX))) {
              errors.push(`keyLed: [${fileName}].[${trimmed}] format is incorrect`);
              continue;
            }
            ledEvents.push({ type: 'off', x: ledX, y: ledY });
            break;
          }
          case 'delay':
          case 'd': {
            // A NaN delay froze the animation with its LEDs stuck on (state.delay += NaN never
            // becomes <= currTime again); Android drops the event.
            const delay = strictInt(split[1]);
            if (!Number.isFinite(delay)) {
              errors.push(`keyLed: [${fileName}].[${trimmed}] format is incorrect`);
              continue;
            }
            ledEvents.push({ type: 'delay', delay });
            break;
          }
          case 'chain':
          case 'c': {
            const chain = strictInt(split[1]) - 1;
            if (!Number.isFinite(chain)) {
              errors.push(`keyLed: [${fileName}].[${trimmed}] format is incorrect`);
              continue;
            }
            ledEvents.push({ type: 'chain', chain });
            break;
          }
          default:
            errors.push(`keyLed: [${fileName}].[${trimmed}] format is incorrect`);
        }
      } catch {
        errors.push(`keyLed: [${fileName}].[${trimmed}] format is incorrect`);
      }
    }

    if (!table[c][x][y]) table[c][x][y] = [];
    table[c][x][y]!.push({ ledEvents, loop, num: table[c][x][y]!.length });
  }

  return table;
}

async function parseAutoPlay(
  zip: JSZip,
  prefix: string,
  info: UniPackInfo,
  soundTable: (Sound[] | null)[][][],
  errors: string[],
): Promise<AutoPlay | null> {
  const file = getFile(zip, prefix, 'autoPlay') || getFile(zip, prefix, 'autoplay');
  if (!file) return null;

  const text = await file.async('text');
  const elements: AutoPlayElement[] = [];
  const map: number[][] = Array.from({ length: info.buttonX }, () =>
    Array.from({ length: info.buttonY }, () => 0),
  );
  let currChain = 0;

  function soundGet(c: number, x: number, y: number, num: number): Sound | null {
    const sounds = soundTable[c]?.[x]?.[y];
    if (!sounds || sounds.length === 0) return null;
    return sounds[num % sounds.length];
  }

  for (const line of splitLines(text)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const split = trimmed.split(/\s+/);

    let option: string;
    let x = -1, y = -1, chain = -1, delay = -1;

    try {
      option = split[0];
      switch (option) {
        // NaN passes every `< 0 || >= n` comparison, so `o x 3` used to reach map[NaN][y] and throw
        // out of the whole parse, and a NaN delay stalled autoPlay forever. Android drops the line.
        case 'on':
        case 'o':
        case 'off':
        case 'f':
        case 'touch':
        case 't':
          x = strictInt(split[1]) - 1;
          y = strictInt(split[2]) - 1;
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= info.buttonX || y < 0 || y >= info.buttonY) {
            errors.push(`autoPlay: [${trimmed}] coordinate is incorrect`);
            continue;
          }
          break;
        case 'chain':
        case 'c':
          chain = strictInt(split[1]) - 1;
          if (!Number.isFinite(chain) || chain < 0 || chain >= info.chain) {
            errors.push(`autoPlay: [${trimmed}] chain is incorrect`);
            continue;
          }
          break;
        case 'delay':
        case 'd':
          delay = strictInt(split[1]);
          if (!Number.isFinite(delay)) {
            errors.push(`autoPlay: [${trimmed}] delay is incorrect`);
            continue;
          }
          break;
        default:
          errors.push(`autoPlay: [${trimmed}] format is incorrect`);
          continue;
      }
    } catch {
      errors.push(`autoPlay: [${trimmed}] format is incorrect`);
      continue;
    }

    switch (option) {
      case 'on':
      case 'o': {
        elements.push({ type: 'on', x, y, currChain, num: map[x][y] });
        const sound = soundGet(currChain, x, y, map[x][y]);
        map[x][y]++;
        if (sound && sound.wormhole !== NO_WORMHOLE) {
          currChain = sound.wormhole;
          elements.push({ type: 'chain', c: currChain });
          for (const row of map) row.fill(0);
        }
        break;
      }
      case 'off':
      case 'f':
        elements.push({ type: 'off', x, y, currChain });
        break;
      case 'touch':
      case 't':
        elements.push({ type: 'on', x, y, currChain, num: map[x][y] });
        elements.push({ type: 'off', x, y, currChain });
        map[x][y]++;
        break;
      case 'chain':
      case 'c':
        currChain = chain;
        elements.push({ type: 'chain', c: currChain });
        for (const row of map) row.fill(0);
        break;
      case 'delay':
      case 'd':
        elements.push({ type: 'delay', delay });
        break;
    }
  }

  return { elements };
}
