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

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    switch (key) {
      case 'title': info.title = value; break;
      case 'producerName': info.producerName = value; break;
      case 'buttonX': info.buttonX = parseInt(value, 10); break;
      case 'buttonY': info.buttonY = parseInt(value, 10); break;
      case 'chain': info.chain = parseInt(value, 10); break;
      case 'squareButton': info.squareButton = value === 'true'; break;
      case 'website': info.website = value; break;
    }
  }

  if (!info.title) errors.push('info: title was missing');
  if (!info.producerName) errors.push('info: producerName was missing');
  if (!info.buttonX) errors.push('info: buttonX was missing');
  if (!info.buttonY) errors.push('info: buttonY was missing');
  if (!info.chain) errors.push('info: chain was missing');
  if (info.chain < 1 || info.chain > 24) {
    errors.push('info: chain out of range');
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
      errors.push("keySound doesn't exist");
      return { soundTable: table, soundFiles };
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

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length <= 2) continue;

    let c: number, x: number, y: number, soundURL: string;
    let loop = 0;
    let wormhole = NO_WORMHOLE;

    try {
      c = parseInt(parts[0], 10) - 1;
      x = parseInt(parts[1], 10) - 1;
      y = parseInt(parts[2], 10) - 1;
      soundURL = parts[3];
      if (parts.length >= 5) loop = parseInt(parts[4], 10) - 1;
      if (parts.length >= 6) wormhole = parseInt(parts[5], 10) - 1;
    } catch {
      errors.push(`keySound: [${trimmed}] format is incorrect`);
      continue;
    }

    if (isNaN(c) || isNaN(x) || isNaN(y)) {
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

function findSoundFile(zip: JSZip, prefix: string, soundURL: string): string | null {
  const candidates = [
    `${prefix}sounds/${soundURL}`,
    `${prefix}Sounds/${soundURL}`,
    `${prefix}sounds/${soundURL.toLowerCase()}`,
  ];
  for (const c of candidates) {
    if (zip.files[c] && !zip.files[c].dir) return c;
  }
  // case-insensitive search within sounds directory
  const targetLower = soundURL.toLowerCase();
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const lower = path.toLowerCase();
    if (lower.includes('sounds/') && lower.endsWith(targetLower)) return path;
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
    .filter(([path, file]) => !file.dir && path.startsWith(keyLedDir) && path !== keyLedDir)
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));

  for (const [path, file] of ledFiles) {
    const fileName = path.substring(path.lastIndexOf('/') + 1).trim();
    const parts = fileName.split(/\s+/);
    if (parts.length <= 2) continue;

    let c: number, x: number, y: number, loop = 1;
    try {
      c = parseInt(parts[0], 10) - 1;
      x = parseInt(parts[1], 10) - 1;
      y = parseInt(parts[2], 10) - 1;
      if (parts.length >= 4) loop = parseInt(parts[3], 10);
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

    for (const line of text.split('\n')) {
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
              ledY = parseInt(split[2], 10) - 1;
            } else if (xToken === 'l') {
              continue;
            } else {
              ledX = parseInt(xToken, 10) - 1;
              ledY = parseInt(split[2], 10) - 1;
            }

            if (split.length === 4) {
              ledColor = parseInt(split[3], 16) + 0xFF000000;
            } else if (split.length === 5) {
              if (split[3] === 'auto' || split[3] === 'a') {
                ledVelocity = parseInt(split[4], 10);
                ledColor = LAUNCHPAD_ARGB[ledVelocity] ?? 0;
              } else {
                ledVelocity = parseInt(split[4], 10);
                ledColor = parseInt(split[3], 16) + 0xFF000000;
              }
            } else {
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
              ledY = parseInt(split[2], 10) - 1;
            } else if (xToken === 'l') {
              continue;
            } else {
              ledX = parseInt(xToken, 10) - 1;
              ledY = parseInt(split[2], 10) - 1;
            }
            ledEvents.push({ type: 'off', x: ledX, y: ledY });
            break;
          }
          case 'delay':
          case 'd':
            ledEvents.push({ type: 'delay', delay: parseInt(split[1], 10) });
            break;
          case 'chain':
          case 'c':
            ledEvents.push({ type: 'chain', chain: parseInt(split[1], 10) - 1 });
            break;
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

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const split = trimmed.split(/\s+/);

    let option: string;
    let x = -1, y = -1, chain = -1, delay = -1;

    try {
      option = split[0];
      switch (option) {
        case 'on':
        case 'o':
          x = parseInt(split[1], 10) - 1;
          y = parseInt(split[2], 10) - 1;
          if (x < 0 || x >= info.buttonX || y < 0 || y >= info.buttonY) {
            errors.push(`autoPlay: [${trimmed}] coordinate is incorrect`);
            continue;
          }
          break;
        case 'off':
        case 'f':
          x = parseInt(split[1], 10) - 1;
          y = parseInt(split[2], 10) - 1;
          if (x < 0 || x >= info.buttonX || y < 0 || y >= info.buttonY) {
            errors.push(`autoPlay: [${trimmed}] coordinate is incorrect`);
            continue;
          }
          break;
        case 'touch':
        case 't':
          x = parseInt(split[1], 10) - 1;
          y = parseInt(split[2], 10) - 1;
          if (x < 0 || x >= info.buttonX || y < 0 || y >= info.buttonY) {
            errors.push(`autoPlay: [${trimmed}] coordinate is incorrect`);
            continue;
          }
          break;
        case 'chain':
        case 'c':
          chain = parseInt(split[1], 10) - 1;
          if (chain < 0 || chain >= info.chain) {
            errors.push(`autoPlay: [${trimmed}] chain is incorrect`);
            continue;
          }
          break;
        case 'delay':
        case 'd':
          delay = parseInt(split[1], 10);
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
