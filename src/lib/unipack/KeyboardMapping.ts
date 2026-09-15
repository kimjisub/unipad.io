// Maps computer keyboard keys to an 8x8 pad grid
// Layout mimics a physical launchpad from top-left
const KEYBOARD_MAP_8x8: Record<string, [number, number]> = {
  // Row 0 (top)
  '1': [0, 0], '2': [0, 1], '3': [0, 2], '4': [0, 3],
  '5': [0, 4], '6': [0, 5], '7': [0, 6], '8': [0, 7],
  // Row 1
  'q': [1, 0], 'w': [1, 1], 'e': [1, 2], 'r': [1, 3],
  't': [1, 4], 'y': [1, 5], 'u': [1, 6], 'i': [1, 7],
  // Row 2
  'a': [2, 0], 's': [2, 1], 'd': [2, 2], 'f': [2, 3],
  'g': [2, 4], 'h': [2, 5], 'j': [2, 6], 'k': [2, 7],
  // Row 3
  'z': [3, 0], 'x': [3, 1], 'c': [3, 2], 'v': [3, 3],
  'b': [3, 4], 'n': [3, 5], 'm': [3, 6], ',': [3, 7],
  // Row 4
  '!': [4, 0], '@': [4, 1], '#': [4, 2], '$': [4, 3],
  '%': [4, 4], '^': [4, 5], '&': [4, 6], '*': [4, 7],
  // Row 5
  'Q': [5, 0], 'W': [5, 1], 'E': [5, 2], 'R': [5, 3],
  'T': [5, 4], 'Y': [5, 5], 'U': [5, 6], 'I': [5, 7],
  // Row 6
  'A': [6, 0], 'S': [6, 1], 'D': [6, 2], 'F': [6, 3],
  'G': [6, 4], 'H': [6, 5], 'J': [6, 6], 'K': [6, 7],
  // Row 7
  'Z': [7, 0], 'X': [7, 1], 'C': [7, 2], 'V': [7, 3],
  'B': [7, 4], 'N': [7, 5], 'M': [7, 6], '<': [7, 7],
};

// The same layout by physical key (KeyboardEvent.code), rows 4-7 being the Shift variants of
// rows 0-3. `e.key` changes with Shift/CapsLock/layout, so a pad pressed as Shift+Q ('Q') and
// released after Shift went up ('q') never got its release and stayed lit.
const KEYBOARD_ROWS_BY_CODE: string[][] = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma'],
];

/** Pad for a physical key, or null. Shift selects rows 4-7 when the grid has them. */
export function getPadForKeyCode(
  code: string,
  shift: boolean,
  buttonX: number,
  buttonY: number,
): [number, number] | null {
  for (let row = 0; row < KEYBOARD_ROWS_BY_CODE.length; row++) {
    const col = KEYBOARD_ROWS_BY_CODE[row].indexOf(code);
    if (col === -1) continue;
    const x = shift ? row + 4 : row;
    if (x >= Math.min(buttonX, 8) || col >= Math.min(buttonY, 8)) return null;
    return [x, col];
  }
  return null;
}

export function getKeyboardMapping(buttonX: number, buttonY: number): Record<string, [number, number]> {
  if (buttonX <= 8 && buttonY <= 8) {
    const filtered: Record<string, [number, number]> = {};
    for (const [key, [x, y]] of Object.entries(KEYBOARD_MAP_8x8)) {
      if (x < buttonX && y < buttonY) {
        filtered[key] = [x, y];
      }
    }
    return filtered;
  }
  // For grids larger than 8x8, only map the first 8x8
  return KEYBOARD_MAP_8x8;
}

// Chain switching keys: F1-F12 and 9,0,-,= for up to 16 chains
const CHAIN_KEYS: Record<string, number> = {
  'F1': 0, 'F2': 1, 'F3': 2, 'F4': 3,
  'F5': 4, 'F6': 5, 'F7': 6, 'F8': 7,
  'F9': 8, 'F10': 9, 'F11': 10, 'F12': 11,
  '9': 12, '0': 13, '-': 14, '=': 15,
};

export function getChainKey(key: string): number | null {
  return CHAIN_KEYS[key] ?? null;
}
