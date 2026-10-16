export interface MidiControllerListener {
  onPadTouch(x: number, y: number, pressed: boolean): void;
  onChainTouch(c: number): void;
  onFunctionKey(key: number): void;
}

export type LaunchpadProfile =
  | 'auto'
  | 'none'
  | 'launchpad_s'
  | 'launchpad_mk2'
  | 'launchpad_pro'
  | 'launchpad_x'
  | 'launchpad_mini_mk3'
  | 'launchpad_pro_mk3'
  | 'launchpad_corefw'
  | 'launchpad_corefw_rg'
  | 'midifighter'
  | 'matrix'
  | 'master_keyboard';

export interface MidiConnectionStatus {
  connected: boolean;
  inputName: string | null;
  outputName: string | null;
  requestedProfile: LaunchpadProfile;
  resolvedProfile: Exclude<LaunchpadProfile, 'auto'>;
}

type ResolvedProfile = Exclude<LaunchpadProfile, 'auto'>;

/** Round buttons are function keys 0 until this: top, right, bottom and left rows of 8. */
export const ROUND_BUTTON_COUNT = 32;

/** The logo LED (keyLED `l`), just past the round buttons as on Android and iOS. */
export const LOGO_FUNCTION_KEY = ROUND_BUTTON_COUNT;
type MidiEventKind = 'noteOn' | 'noteOff' | 'cc';

const X_STYLE_CIRCLE_NOTES = [
  91, 92, 93, 94, 95, 96, 97, 98,
  89, 79, 69, 59, 49, 39, 29, 19,
  8, 7, 6, 5, 4, 3, 2, 1,
  10, 20, 30, 40, 50, 60, 70, 80,
] as const;

// Launchpad MK2 (LaunchpadMK2.kt circleCode): top row is CC 104..111, right column is Note
// 89, 79, ..., 19; it has no bottom row or left column.
const MK2_CIRCLE_TARGETS: ReadonlyArray<{ kind: 'cc' | 'note'; value: number }> = [
  { kind: 'cc', value: 104 }, { kind: 'cc', value: 105 }, { kind: 'cc', value: 106 }, { kind: 'cc', value: 107 },
  { kind: 'cc', value: 108 }, { kind: 'cc', value: 109 }, { kind: 'cc', value: 110 }, { kind: 'cc', value: 111 },
  { kind: 'note', value: 89 }, { kind: 'note', value: 79 }, { kind: 'note', value: 69 }, { kind: 'note', value: 59 },
  { kind: 'note', value: 49 }, { kind: 'note', value: 39 }, { kind: 'note', value: 29 }, { kind: 'note', value: 19 },
];

const LAUNCHPAD_S_CIRCLE_NOTES = [
  { kind: 'cc', value: 104 },
  { kind: 'cc', value: 105 },
  { kind: 'cc', value: 106 },
  { kind: 'cc', value: 107 },
  { kind: 'cc', value: 108 },
  { kind: 'cc', value: 109 },
  { kind: 'cc', value: 110 },
  { kind: 'cc', value: 111 },
  { kind: 'note', value: 8 },
  { kind: 'note', value: 24 },
  { kind: 'note', value: 40 },
  { kind: 'note', value: 56 },
  { kind: 'note', value: 72 },
  { kind: 'note', value: 88 },
  { kind: 'note', value: 104 },
  { kind: 'note', value: 120 },
] as const;

// The round buttons of the Matrix and of CoreFW's performance mode (its src/utils/layout.rs).
const DRUM_RACK_CIRCLE_NOTES = [
  28, 29, 30, 31, 32, 33, 34, 35,
  100, 101, 102, 103, 104, 105, 106, 107,
  123, 122, 121, 120, 119, 118, 117, 116,
  115, 114, 113, 112, 111, 110, 109, 108,
] as const;

const LAUNCHPAD_S_COLOR_CODES = [
  0, 61, 62, 63, 1, 2, 3, 3,
  21, 63, 62, 61, 53, 53, 53, 53,
  53, 56, 56, 56, 56, 56, 56, 56,
  56, 56, 56, 56, 53, 53, 53, 53,
  53, 53, 53, 53, 53, 53, 53, 53,
  53, 53, 53, 53, 53, 53, 53, 53,
  53, 53, 53, 53, 37, 39, 39, 39,
  37, 39, 39, 39, 3, 55, 57, 56,
  56, 40, 53, 53, 53, 53, 53, 53,
  3, 57, 57, 56, 56, 56, 53, 53,
  53, 53, 53, 53, 58, 56, 56, 56,
  56, 56, 56, 53, 53, 53, 47, 63,
  59, 57, 57, 57, 57, 56, 56, 53,
  53, 53, 3, 19, 53, 53, 53, 53,
  53, 53, 53, 53, 53, 53, 53, 53,
  3, 3, 56, 56, 57, 57, 57, 57,
] as const;

/** CoreFW names the logo as programmer position 99, which its layout plays as note 27. */
const DRUM_RACK_LOGO_NOTE = 27;

/**
 * Launchpads running CoreFW (github.com/anthonyhfm/launchpad-core-firmware) keep the stock product name
 * and USB ids but name their two ports "<model> (DAW)" and "<model> (MIDI)". Linux puts the product name
 * in front and cuts the name at 31 characters ("Launchpad Mini MK3 MINI MK3 (MI"). Where the browser
 * shows only the product name (Android Chrome), CoreFW cannot be told apart and stays on the stock profile.
 */
const COREFW_PORT_NAME = /(?:^|\s)(pro mk3|mini mk3|lpx|mk2|pro|lps|mini) \((?:mi|da)/;

/** The S and the first Mini read red-green colour codes, as the stock firmware does. */
const COREFW_RED_GREEN_MODELS = new Set(['lps', 'mini']);

function isCoreFw(profile: ResolvedProfile): boolean {
  return profile === 'launchpad_corefw' || profile === 'launchpad_corefw_rg';
}

/** Pads in two 4x4 blocks from note 36 (left) and 68 (right), bottom row first. */
function drumRackPadNote(x: number, y: number): number | null {
  const padX = x + 1;
  const padY = y + 1;
  if (padY >= 1 && padY <= 4) return -4 * padX + padY + 67;
  if (padY >= 5 && padY <= 8) return -4 * padX + padY + 95;
  return null;
}

/** The profile Auto Detect picks for an output port name. */
export function detectLaunchpadProfile(portName: string): ResolvedProfile {
  const name = portName.toLowerCase();
  const coreFwModel = COREFW_PORT_NAME.exec(name)?.[1];
  if (coreFwModel) return COREFW_RED_GREEN_MODELS.has(coreFwModel) ? 'launchpad_corefw_rg' : 'launchpad_corefw';

  // Web MIDI reports the short product names ("LPX MIDI Out", "LPMiniMK3 ...", "LPProMK3 ..."),
  // so the long forms alone never matched and an X or a Mini MK3 fell through to 'none'.
  // Same list and order as the iOS MidiManager.
  if (name.includes('launchpad mini mk3') || name.includes('lpminimk3')) return 'launchpad_mini_mk3';
  if (name.includes('launchpad pro mk3') || name.includes('lppromk3')) return 'launchpad_pro_mk3';
  if (name.includes('launchpad x') || name.includes('lpx')) return 'launchpad_x';
  if (name.includes('launchpad mk2') || name.includes('lpmk2')) return 'launchpad_mk2';
  if (name.includes('launchpad s') || name.includes('launchpad mini')) return 'launchpad_s';
  if (name.includes('launchpad pro') || name.includes('lppro')) return 'launchpad_pro';
  if (name.includes('midi fighter') || name.includes('midifighter')) return 'midifighter';
  // The Mystrix announces a different name depending on its firmware: older
  // builds report Matrix or Matrix Pro, newer ones Mystrix or Mystrix Pro.
  // Matching only the old string meant anyone who updated had a device this
  // player could not see, and the only symptom was failing to connect, which
  // is indistinguishable from not owning one. `matrix` stays as the internal
  // profile id because the driver tables are keyed on it.
  if (name.includes('mystrix') || name.includes('matrix')) return 'matrix';
  if (name.includes('master keyboard')) return 'master_keyboard';
  return 'none';
}

export class MidiConnection {
  private midiAccess: MIDIAccess | null = null;
  private inputs: MIDIInput[] = [];
  private outputs: MIDIOutput[] = [];
  private listener: MidiControllerListener | null = null;
  private padSize = 8;
  connected = false;
  private inputName: string | null = null;
  private outputName: string | null = null;
  private requestedProfile: LaunchpadProfile = 'auto';
  private resolvedProfile: ResolvedProfile = 'none';
  private onStatusChange: ((status: MidiConnectionStatus) => void) | null = null;
  /** The mode switch (and the status report after it) still waiting to be sent. */
  private pendingInitTimers: number[] = [];

  async connect(
    listener: MidiControllerListener,
    options?: {
      profile?: LaunchpadProfile;
      onStatusChange?: (status: MidiConnectionStatus) => void;
    },
  ): Promise<boolean> {
    this.listener = listener;
    this.requestedProfile = options?.profile ?? 'auto';
    this.onStatusChange = options?.onStatusChange ?? null;
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not supported');
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: true });
      this.setupDevices();
      this.sendInitSysExToAllOutputs();
      this.notifyStatus();
      this.midiAccess.onstatechange = () => {
        this.setupDevices();
        this.sendInitSysExToAllOutputs();
        this.notifyStatus();
      };
      return this.connected;
    } catch (err) {
      console.warn('MIDI access denied:', err);
      this.notifyStatus();
      return false;
    }
  }

  private setupDevices(): void {
    if (!this.midiAccess) return;

    this.inputs = [];
    this.outputs = [];

    this.midiAccess.inputs.forEach((input) => {
      this.inputs.push(input);
      input.onmidimessage = (e) => this.handleMessage(e);
    });

    this.midiAccess.outputs.forEach((output) => {
      this.outputs.push(output);
    });

    this.inputName = this.inputs[0]?.name ?? null;
    this.outputName = this.outputs[0]?.name ?? null;
    this.connected = this.inputs.length > 0;
  }

  /**
   * Applies a model at once, in the order of Android's MidiConnection.driver setter and iOS's
   * MidiManager.driver: the lights go off in the old model's layout, the new model's mode switch is
   * sent, and only after its last message is the status reported, so the listener redraws the board
   * on a device already in its new mode and shows the model that is now in use. With no port at
   * all (disconnected, or no Web MIDI) the choice is only kept for the next connect, so no model is
   * shown as in use.
   */
  setProfile(profile: LaunchpadProfile): void {
    if (!this.connected && this.outputs.length === 0) {
      this.requestedProfile = profile;
      return;
    }
    if (this.connected) this.clearAllLeds();
    this.requestedProfile = profile;
    const lastInitDelay = this.sendInitSysExToAllOutputs();
    if (lastInitDelay === null) {
      this.notifyStatus();
    } else {
      this.pendingInitTimers.push(window.setTimeout(() => this.notifyStatus(), lastInitDelay));
    }
  }

  private notifyStatus(): void {
    this.onStatusChange?.(this.getStatus());
  }

  private cancelPendingInit(): void {
    for (const timer of this.pendingInitTimers) window.clearTimeout(timer);
    this.pendingInitTimers = [];
  }

  /** Re-resolves the profile and sends each output its mode switch, replacing one still waiting;
   *  returns when the last message goes out, or null when there is none. */
  private sendInitSysExToAllOutputs(): number | null {
    this.cancelPendingInit();
    this.resolvedProfile = 'none';
    let lastDelay: number | null = null;
    for (const output of this.outputs) {
      const profile = this.resolveProfile(output.name ?? '', this.requestedProfile);
      const messages = this.getInitSysExMessages(profile);
      if (profile !== 'none') {
        this.resolvedProfile = profile;
      }
      // 50 ms apart, as Android and iOS send them: the device needs the gap to switch mode.
      messages.forEach((message, index) => {
        this.pendingInitTimers.push(window.setTimeout(() => {
          try {
            output.send(message);
          } catch {
            // ignore per-device SysEx failures
          }
        }, index * 50));
      });
      if (messages.length > 0) lastDelay = Math.max(lastDelay ?? 0, (messages.length - 1) * 50);
    }
    if (this.outputs.length === 0 && this.requestedProfile !== 'auto') {
      this.resolvedProfile = this.requestedProfile;
    }
    return lastDelay;
  }

  private resolveProfile(outputName: string, requested: LaunchpadProfile): ResolvedProfile {
    return requested !== 'auto' ? requested : detectLaunchpadProfile(outputName);
  }

  private getInitSysExMessages(profile: ResolvedProfile): number[][] {
    if (profile === 'launchpad_mini_mk3') {
      return [
        [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0x00, 0xf7],
        [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x01, 0xf7],
      ];
    }
    if (profile === 'launchpad_pro_mk3') {
      return [
        [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0e, 0x10, 0x00, 0xf7],
        [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0e, 0x0e, 0x01, 0xf7],
      ];
    }
    if (profile === 'launchpad_x') {
      return [
        [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x10, 0x00, 0xf7],
        [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, 0x01, 0xf7],
      ];
    }
    if (profile === 'launchpad_pro') {
      return [
        [0xf0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x21, 0x00, 0xf7],
        [0xf0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x22, 0x00, 0xf7],
      ];
    }
    return [];
  }

  getStatus(): MidiConnectionStatus {
    return {
      connected: this.connected,
      inputName: this.inputName,
      outputName: this.outputName,
      requestedProfile: this.requestedProfile,
      resolvedProfile: this.resolvedProfile,
    };
  }

  private handleMessage(event: MIDIMessageEvent): void {
    if (!this.listener || !event.data) return;

    const [status = 0, note = 0, velocity = 0] = event.data;
    const kind = this.getEventKind(status, velocity);
    if (!kind) return;

    const profile = this.getMappingProfile();
    switch (profile) {
      case 'launchpad_x':
      case 'launchpad_mini_mk3':
      case 'launchpad_pro_mk3':
      case 'launchpad_pro':
        // The top row and right column of these devices are Control Change (the Android drivers'
        // circleCode entries are all 0xB0); with `kind === 'noteOn'` every CC button was dead.
        this.handleXStyleNote(note, kind === 'noteOn' || (kind === 'cc' && velocity > 0));
        break;
      case 'launchpad_mk2':
        this.handleMk2Input(kind, note, velocity);
        break;
      case 'launchpad_s':
        this.handleLaunchpadSInput(kind, note, velocity);
        break;
      case 'midifighter':
        this.handleFourByFourBlockInput(kind, note, false);
        break;
      case 'matrix':
      case 'launchpad_corefw':
      case 'launchpad_corefw_rg':
        this.handleMatrixInput(kind, note, velocity);
        break;
      case 'master_keyboard':
        this.handleMasterKeyboardInput(kind, note);
        break;
      case 'none':
      default:
        this.handleGenericInput(kind, note, velocity);
        break;
    }
  }

  private getEventKind(status: number, velocity: number): MidiEventKind | null {
    const upper = status & 0xf0;
    if (upper === 0x90) return velocity > 0 ? 'noteOn' : 'noteOff';
    if (upper === 0x80) return 'noteOff';
    if (upper === 0xb0) return 'cc';
    return null;
  }

  private handleXStyleNote(note: number, pressed: boolean): void {
    if (!this.listener) return;

    const rowFromTop = Math.floor(note / 10);
    const col1 = note % 10;
    const x = 8 - rowFromTop;
    const y = col1 - 1;
    if (x >= 0 && x < this.padSize && y >= 0 && y < this.padSize) {
      this.listener.onPadTouch(x, y, pressed);
      return;
    }

    if (note >= 91 && note <= 98) {
      if (pressed) this.listener.onFunctionKey(note - 91);
      return;
    }

    if (note >= 19 && note <= 89 && note % 10 === 9) {
      const c = 8 - Math.floor(note / 10);
      if (pressed) {
        this.listener.onChainTouch(c);
        this.listener.onFunctionKey(c + 8);
      }
      return;
    }

    if (note >= 1 && note <= 8) {
      const c = 16 - note;
      if (pressed) {
        this.listener.onChainTouch(c);
        this.listener.onFunctionKey(24 - note);
      }
      return;
    }

    if (note >= 10 && note <= 80 && note % 10 === 0) {
      const c = Math.floor(note / 10) + 15;
      if (pressed) {
        this.listener.onChainTouch(c);
        this.listener.onFunctionKey(Math.floor(note / 10) + 23);
      }
    }
  }

  /** LaunchpadMK2.kt: pads and the right column are notes on the 10-based grid, the top row is CC 104..111. */
  private handleMk2Input(kind: MidiEventKind, note: number, velocity: number): void {
    if (!this.listener) return;
    if (kind === 'cc') {
      if (note >= 104 && note <= 111 && velocity > 0) this.listener.onFunctionKey(note - 104);
      return;
    }
    const pressed = kind === 'noteOn';
    const x = 9 - Math.floor(note / 10);
    const y = note % 10;
    if (x >= 1 && x <= 8 && y >= 1 && y <= 8) {
      this.listener.onPadTouch(x - 1, y - 1, pressed);
    } else if (y === 9 && x >= 1 && x <= 8 && pressed) {
      this.listener.onChainTouch(x - 1);
      this.listener.onFunctionKey(x - 1 + 8);
    }
  }

  private handleLaunchpadSInput(kind: MidiEventKind, note: number, velocity: number): void {
    if (!this.listener) return;
    if (kind === 'noteOn' || kind === 'noteOff') {
      const x = Math.floor(note / 16) + 1;
      const y = (note % 16) + 1;
      if (y >= 1 && y <= 8) {
        this.listener.onPadTouch(x - 1, y - 1, kind === 'noteOn');
      } else if (y === 9 && kind === 'noteOn') {
        this.listener.onChainTouch(x - 1);
        this.listener.onFunctionKey(x - 1 + 8);
      }
      return;
    }
    if (kind === 'cc' && note >= 104 && note <= 111 && velocity > 0) {
      this.listener.onFunctionKey(note - 104);
    }
  }

  private handleFourByFourBlockInput(kind: MidiEventKind, note: number, includeMatrixExtras: boolean): void {
    if (!this.listener) return;
    if (kind !== 'noteOn' && kind !== 'noteOff') return;

    const pressed = kind === 'noteOn';
    if (note >= 36 && note <= 67) {
      const x = Math.floor((67 - note) / 4) + 1;
      const y = 4 - ((67 - note) % 4);
      this.listener.onPadTouch(x - 1, y - 1, pressed);
      return;
    }
    if (note >= 68 && note <= 99) {
      const x = Math.floor((99 - note) / 4) + 1;
      const y = 8 - ((99 - note) % 4);
      this.listener.onPadTouch(x - 1, y - 1, pressed);
      return;
    }

    if (!includeMatrixExtras || !pressed) return;
    // Ring banks mirror the Android Matrix driver's circleCode: top 28..35 (f 0..7),
    // right 100..107 (f 8..15), bottom 123..116 (f 16..23), left 115..108 (f 24..31).
    // The top and bottom rows were dead here and the left column mapped to f 24..17.
    if (note >= 28 && note <= 35) {
      this.listener.onFunctionKey(note - 28);
      return;
    }
    if (note >= 100 && note <= 107) {
      const c = note - 100;
      this.listener.onChainTouch(c);
      this.listener.onFunctionKey(c + 8);
      return;
    }
    if (note >= 116 && note <= 123) {
      const f = 16 + (123 - note);
      this.listener.onChainTouch(f - 8);
      this.listener.onFunctionKey(f);
      return;
    }
    if (note >= 108 && note <= 115) {
      const f = 24 + (115 - note);
      this.listener.onChainTouch(f - 8);
      this.listener.onFunctionKey(f);
    }
  }

  private handleMatrixInput(kind: MidiEventKind, note: number, velocity: number): void {
    if (kind === 'cc' || velocity <= 0 && kind === 'noteOn') return;
    this.handleFourByFourBlockInput(kind, note, true);
  }

  private handleMasterKeyboardInput(kind: MidiEventKind, note: number): void {
    this.handleFourByFourBlockInput(kind, note, false);
  }

  private handleGenericInput(kind: MidiEventKind, note: number, velocity: number): void {
    if (!this.listener) return;
    if (kind === 'cc') {
      if (note >= 104 && note <= 111 && velocity > 0) {
        this.listener.onFunctionKey(note - 104);
      }
      return;
    }

    const pressed = kind === 'noteOn';
    if (note >= 91 && note <= 98) {
      if (pressed) this.listener.onFunctionKey(note - 91);
      return;
    }
    const row = Math.floor(note / 10) - 1;
    const col = (note % 10) - 1;
    if (col === this.padSize) {
      if (pressed) this.listener.onChainTouch(row);
    } else if (row >= 0 && row < this.padSize && col >= 0 && col < this.padSize) {
      this.listener.onPadTouch(col, row, pressed);
    }
  }

  private getMappingProfile(): ResolvedProfile {
    if (this.requestedProfile !== 'auto') return this.requestedProfile;
    return this.resolvedProfile;
  }

  private getPadNoteForProfile(x: number, y: number): { note: number; status: number } | null {
    const profile = this.getMappingProfile();
    if (
      profile === 'launchpad_x' ||
      profile === 'launchpad_mini_mk3' ||
      profile === 'launchpad_pro_mk3' ||
      profile === 'launchpad_pro' ||
      profile === 'launchpad_mk2'
    ) {
      return { note: (8 - x) * 10 + (y + 1), status: 0x90 };
    }
    if (profile === 'launchpad_s') {
      return { note: x * 16 + y, status: 0x90 };
    }
    if (profile === 'midifighter' || profile === 'matrix' || isCoreFw(profile)) {
      const note = drumRackPadNote(x, y);
      if (note === null) return null;
      // CoreFW's X, Mini MK3 and Pro MK3 light only channel 1 notes (src/app/performance/mod.rs).
      const status = profile === 'midifighter' ? 0x92 : profile === 'matrix' ? 0x91 : 0x90;
      return { note, status };
    }
    if (profile === 'master_keyboard') {
      return null;
    }
    return { note: (y + 1) * 10 + (x + 1), status: 0x90 };
  }

  private getFunctionTargetForProfile(index: number): { type: 'note' | 'cc'; value: number; status: number } | null {
    const profile = this.getMappingProfile();
    if (
      profile === 'launchpad_x' ||
      profile === 'launchpad_mini_mk3' ||
      profile === 'launchpad_pro_mk3' ||
      profile === 'launchpad_pro'
    ) {
      // The ring on these devices is addressed with Control Change (Android circleCode = 0xB0);
      // sent as Note On, nothing lit.
      const note = X_STYLE_CIRCLE_NOTES[index];
      return note === undefined ? null : { type: 'cc', value: note, status: 0xb0 };
    }
    if (profile === 'launchpad_mk2') {
      const target = MK2_CIRCLE_TARGETS[index];
      if (!target) return null;
      return target.kind === 'cc'
        ? { type: 'cc', value: target.value, status: 0xb0 }
        : { type: 'note', value: target.value, status: 0x90 };
    }
    if (profile === 'launchpad_s') {
      const target = LAUNCHPAD_S_CIRCLE_NOTES[index];
      if (!target) return null;
      return target.kind === 'cc'
        ? { type: 'cc', value: target.value, status: 0xb0 }
        : { type: 'note', value: target.value, status: 0x90 };
    }
    if (profile === 'matrix' || isCoreFw(profile)) {
      const note = DRUM_RACK_CIRCLE_NOTES[index];
      return note === undefined ? null : { type: 'note', value: note, status: profile === 'matrix' ? 0x91 : 0x90 };
    }
    // Devices with no ring (Midi Fighter, a master keyboard) used to receive notes 91..98 here,
    // which a keyboard plays as audible notes when the option panel opens.
    if (profile === 'midifighter' || profile === 'master_keyboard') return null;
    if (index >= 0 && index < 8) return { type: 'note', value: 91 + index, status: 0x90 };
    return null;
  }

  sendFunctionKeyLed(index: number, velocity: number): void {
    if (index === LOGO_FUNCTION_KEY) {
      this.sendLogoLed(velocity);
      return;
    }
    const target = this.getFunctionTargetForProfile(index);
    if (!target) return;
    const mappedVelocity = this.getFunctionVelocityForProfile(velocity);
    if (target.type === 'cc') {
      this.sendCC(target.value, mappedVelocity, target.status & 0x0f);
      return;
    }
    this.sendNote(target.value, mappedVelocity, target.status & 0x0f);
  }

  /** Devices whose logo is not addressable (MK2, S, Matrix, ...) ignore it. */
  private sendLogoLed(velocity: number): void {
    const profile = this.getMappingProfile();
    if (profile === 'launchpad_x' || profile === 'launchpad_mini_mk3' || profile === 'launchpad_pro_mk3') {
      // Their programmer's references name the logo CC 99.
      this.sendCC(99, velocity);
    } else if (profile === 'launchpad_pro') {
      // Launchpad Pro programmer's reference: the side LED is index 99 (63h), reachable only by the
      // "light LED" SysEx.
      this.sendToOutputs([0xf0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x0a, 0x63, clampData(velocity), 0xf7]);
    } else if (isCoreFw(profile)) {
      this.sendNote(DRUM_RACK_LOGO_NOTE, this.getFunctionVelocityForProfile(velocity));
    }
  }

  private getFunctionVelocityForProfile(velocity: number): number {
    const profile = this.getMappingProfile();
    if (profile === 'launchpad_s' || profile === 'launchpad_corefw_rg') {
      return LAUNCHPAD_S_COLOR_CODES[velocity] ?? 0;
    }
    return velocity;
  }

  private getChainFunctionIndex(c: number): number | null {
    // Chains 0..23 map onto ring indices 8..31 (right column, bottom row, left column)
    if (c < 0 || c > 23) return null;
    const profile = this.getMappingProfile();
    if (
      profile === 'launchpad_x' ||
      profile === 'launchpad_mini_mk3' ||
      profile === 'launchpad_pro_mk3' ||
      profile === 'launchpad_pro' ||
      profile === 'launchpad_mk2' ||
      profile === 'launchpad_s' ||
      profile === 'matrix' ||
      isCoreFw(profile)
    ) {
      return c + 8;
    }
    return null;
  }

  sendNote(note: number, velocity: number, channel = 0): void {
    const v = clampData(velocity);
    const status = v > 0 ? 0x90 | channel : 0x80 | channel;
    this.sendToOutputs([status, clampData(note), v]);
  }

  sendCC(cc: number, value: number, channel = 0): void {
    this.sendToOutputs([0xb0 | channel, clampData(cc), clampData(value)]);
  }

  /** MIDIOutput.send throws on a data byte outside 0..127 (a pack LED code of 200 is valid
   *  text), and the callers (guide LEDs, autoPlay) are React callbacks with no try around them. */
  private sendToOutputs(message: number[]): void {
    for (const output of this.outputs) {
      try {
        output.send(message);
      } catch (err) {
        console.warn('MIDI send failed', err);
      }
    }
  }

  sendPadLed(x: number, y: number, velocity: number): void {
    const target = this.getPadNoteForProfile(x, y);
    if (!target) return;
    const mappedVelocity = this.getFunctionVelocityForProfile(velocity);
    this.sendNote(target.note, mappedVelocity, target.status & 0x0f);
  }

  sendChainLed(c: number, velocity: number): void {
    const fnIndex = this.getChainFunctionIndex(c);
    if (fnIndex !== null) {
      this.sendFunctionKeyLed(fnIndex, velocity);
    }
  }

  clearAllLeds(): void {
    const profile = this.getMappingProfile();
    if (profile === 'master_keyboard') return;
    for (let x = 0; x < this.padSize; x++) {
      for (let y = 0; y < this.padSize; y++) {
        this.sendPadLed(x, y, 0);
      }
    }
    // The X/Pro/Pro MK3 ring has 32 buttons; clearing only 16 left the bottom row and the left
    // column lit after leaving the pack.
    const functionKeyCount =
      profile === 'matrix' || isCoreFw(profile) || profile === 'launchpad_x' || profile === 'launchpad_mini_mk3'
        || profile === 'launchpad_pro_mk3' || profile === 'launchpad_pro'
        ? ROUND_BUTTON_COUNT
        : profile === 'midifighter' ? 0 : 16;
    for (let i = 0; i < functionKeyCount; i++) {
      this.sendFunctionKeyLed(i, 0);
    }
    this.sendLogoLed(0);
  }

  /** Leaving the pack: LEDs lit by animations that already ended are no longer tracked by the runner,
   *  so everything is turned off here before the ports are dropped. */
  release(): void {
    this.clearAllLeds();
    this.disconnect();
  }

  disconnect(): void {
    for (const input of this.inputs) {
      input.onmidimessage = null;
    }
    // Left attached, the statechange handler re-ran setupDevices on the next hot-plug and the
    // connection came back by itself after the user disconnected.
    if (this.midiAccess) this.midiAccess.onstatechange = null;
    this.cancelPendingInit();
    this.inputs = [];
    this.outputs = [];
    this.connected = false;
    this.inputName = null;
    this.outputName = null;
    this.resolvedProfile = 'none';
  }
}

function clampData(value: number): number {
  return Math.max(0, Math.min(127, Math.trunc(Number.isFinite(value) ? value : 0)));
}
