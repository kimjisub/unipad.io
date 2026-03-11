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
type MidiEventKind = 'noteOn' | 'noteOff' | 'cc';

const X_STYLE_CIRCLE_NOTES = [
  91, 92, 93, 94, 95, 96, 97, 98,
  89, 79, 69, 59, 49, 39, 29, 19,
  8, 7, 6, 5, 4, 3, 2, 1,
  10, 20, 30, 40, 50, 60, 70, 80,
] as const;

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

const MATRIX_CIRCLE_CODES = [
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

  async connect(
    listener: MidiControllerListener,
    options?: {
      profile?: LaunchpadProfile;
      onStatusChange?: (status: MidiConnectionStatus) => void;
    },
  ): Promise<boolean> {
    this.listener = listener;
    this.requestedProfile = options?.profile ?? 'auto';
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not supported');
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: true });
      this.setupDevices();
      this.sendInitSysExToAllOutputs();
      options?.onStatusChange?.(this.getStatus());
      this.midiAccess.onstatechange = () => {
        this.setupDevices();
        this.sendInitSysExToAllOutputs();
        options?.onStatusChange?.(this.getStatus());
      };
      return this.connected;
    } catch (err) {
      console.warn('MIDI access denied:', err);
      options?.onStatusChange?.(this.getStatus());
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

  private sendInitSysExToAllOutputs(): void {
    this.resolvedProfile = 'none';
    for (const output of this.outputs) {
      const profile = this.resolveProfile(output.name ?? '', this.requestedProfile);
      const messages = this.getInitSysExMessages(profile);
      if (profile !== 'none') {
        this.resolvedProfile = profile;
      }
      for (const message of messages) {
        try {
          output.send(message);
        } catch {
          // ignore per-device SysEx failures
        }
      }
    }
    if (this.outputs.length === 0 && this.requestedProfile !== 'auto') {
      this.resolvedProfile = this.requestedProfile;
    }
  }

  private resolveProfile(outputName: string, requested: LaunchpadProfile): ResolvedProfile {
    if (requested !== 'auto') return requested;

    const name = outputName.toLowerCase();
    if (name.includes('launchpad mini mk3')) return 'launchpad_mini_mk3';
    if (name.includes('launchpad pro mk3')) return 'launchpad_pro_mk3';
    if (name.includes('launchpad x')) return 'launchpad_x';
    if (name.includes('launchpad mk2')) return 'launchpad_mk2';
    if (name.includes('launchpad s')) return 'launchpad_s';
    if (name.includes('launchpad pro')) return 'launchpad_pro';
    if (name.includes('midi fighter') || name.includes('midifighter')) return 'midifighter';
    if (name.includes('matrix')) return 'matrix';
    if (name.includes('master keyboard')) return 'master_keyboard';
    return 'none';
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
      case 'launchpad_mk2':
        this.handleXStyleNote(note, kind === 'noteOn');
        break;
      case 'launchpad_s':
        this.handleLaunchpadSInput(kind, note, velocity);
        break;
      case 'midifighter':
        this.handleFourByFourBlockInput(kind, note, false);
        break;
      case 'matrix':
        this.handleMatrixInput(kind, note, velocity);
        break;
      case 'master_keyboard':
        this.handleMasterKeyboardInput(kind, note, velocity);
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
    if (note >= 100 && note <= 107) {
      const c = note - 100;
      this.listener.onChainTouch(c);
      this.listener.onFunctionKey(c + 8);
      return;
    }
    if (note >= 108 && note <= 115) {
      const f = 24 - (note - 108);
      this.listener.onFunctionKey(f);
    }
  }

  private handleMatrixInput(kind: MidiEventKind, note: number, velocity: number): void {
    if (kind === 'cc' || velocity <= 0 && kind === 'noteOn') return;
    this.handleFourByFourBlockInput(kind, note, true);
  }

  private handleMasterKeyboardInput(kind: MidiEventKind, note: number, _velocity: number): void {
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
    if (profile === 'midifighter') {
      const padX = x + 1;
      const padY = y + 1;
      if (padY >= 1 && padY <= 4) return { note: -4 * padX + padY + 67, status: 0x92 };
      if (padY >= 5 && padY <= 8) return { note: -4 * padX + padY + 95, status: 0x92 };
      return null;
    }
    if (profile === 'matrix') {
      const padX = x + 1;
      const padY = y + 1;
      if (padY >= 1 && padY <= 4) return { note: -4 * padX + padY + 67, status: 0x91 };
      if (padY >= 5 && padY <= 8) return { note: -4 * padX + padY + 95, status: 0x91 };
      return null;
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
      profile === 'launchpad_pro' ||
      profile === 'launchpad_mk2'
    ) {
      const note = X_STYLE_CIRCLE_NOTES[index];
      return note === undefined ? null : { type: 'note', value: note, status: 0x90 };
    }
    if (profile === 'launchpad_s') {
      const target = LAUNCHPAD_S_CIRCLE_NOTES[index];
      if (!target) return null;
      return target.kind === 'cc'
        ? { type: 'cc', value: target.value, status: 0xb0 }
        : { type: 'note', value: target.value, status: 0x90 };
    }
    if (profile === 'matrix') {
      const note = MATRIX_CIRCLE_CODES[index];
      return note === undefined ? null : { type: 'note', value: note, status: 0x91 };
    }
    if (index >= 0 && index < 8) return { type: 'note', value: 91 + index, status: 0x90 };
    return null;
  }

  sendFunctionKeyLed(index: number, velocity: number): void {
    const target = this.getFunctionTargetForProfile(index);
    if (!target) return;
    const mappedVelocity = this.getFunctionVelocityForProfile(velocity);
    if (target.type === 'cc') {
      this.sendCC(target.value, mappedVelocity, target.status & 0x0f);
      return;
    }
    this.sendNote(target.value, mappedVelocity, target.status & 0x0f);
  }

  private getFunctionVelocityForProfile(velocity: number): number {
    const profile = this.getMappingProfile();
    if (profile === 'launchpad_s') {
      return LAUNCHPAD_S_COLOR_CODES[velocity] ?? 0;
    }
    return velocity;
  }

  private getChainFunctionIndex(c: number): number | null {
    if (c < 0 || c > 7) return null;
    const profile = this.getMappingProfile();
    if (
      profile === 'launchpad_x' ||
      profile === 'launchpad_mini_mk3' ||
      profile === 'launchpad_pro_mk3' ||
      profile === 'launchpad_pro' ||
      profile === 'launchpad_mk2' ||
      profile === 'launchpad_s' ||
      profile === 'matrix'
    ) {
      return c + 8;
    }
    return null;
  }

  sendNote(note: number, velocity: number, channel = 0): void {
    const status = velocity > 0 ? 0x90 | channel : 0x80 | channel;
    for (const output of this.outputs) {
      output.send([status, note, velocity]);
    }
  }

  sendCC(cc: number, value: number, channel = 0): void {
    for (const output of this.outputs) {
      output.send([0xb0 | channel, cc, value]);
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
    const functionKeyCount = profile === 'matrix' ? 32 : 16;
    for (let i = 0; i < functionKeyCount; i++) {
      this.sendFunctionKeyLed(i, 0);
    }
  }

  disconnect(): void {
    for (const input of this.inputs) {
      input.onmidimessage = null;
    }
    this.inputs = [];
    this.outputs = [];
    this.connected = false;
    this.inputName = null;
    this.outputName = null;
    this.resolvedProfile = 'none';
  }
}
