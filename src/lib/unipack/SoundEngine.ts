import { Sound, NO_WORMHOLE, UniPackData } from './types';
import { selectAudio } from './audioSafety';
import {
  EMPTY_SOUND_LOAD_REPORT,
  INLINE_AUDIO_INSPECTOR,
  audioReferences,
  exclusionReason,
  isMemoryFailure,
  type AudioInspector,
  type SoundFailure,
  type SoundLoadReport,
} from './soundLoading';

/** Files decoded at once. Not yet measured on low-memory devices; the shared limit bounds what they hold. */
const DECODE_BATCH_SIZE = 10;

/** The input name auto play holds pads with, apart from the player's pointers, keys and launchpad. */
export const AUTO_PLAY_INPUT = 'autoplay';

interface Press { key: string; node: AudioBufferSourceNode; infinite: boolean }
interface PendingChainChange {
  chain: number;
  remaining: number;
  dueAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** WebKit's Audio Session API, not yet in TypeScript's DOM types. */
interface AudioSessionNavigator {
  audioSession: { type: 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record' };
}

/**
 * Safari plays Web Audio in the "ambient" session by default, which the iPhone's silent switch
 * mutes. "playback" plays through it, as the iOS app does; it can also pause audio another app
 * is playing. Browsers without the API are left as they are.
 */
function requestPlaybackAudioSession(): void {
  if (typeof navigator === 'undefined' || !('audioSession' in navigator)) return;
  try {
    (navigator as Navigator & AudioSessionNavigator).audioSession.type = 'playback';
  } catch {
    console.warn('Failed to set the audio session to playback');
  }
}

export class SoundEngine {
  private audioContext: AudioContext;
  private gainNode: GainNode;
  private bufferCache = new Map<string, AudioBuffer>();
  private activeNodes = new Map<string, AudioBufferSourceNode>();
  // Each press (a pad and the input holding it) owns the source selected at down time,
  // independently of the current chain and the (already advanced) sound sequence.
  // Pad "x-y" → input → presses, including earlier chains awaiting that input's release.
  private heldPresses = new Map<string, Map<string, Press[]>>();
  private chainValue: () => number;
  private setChain: (c: number) => void;
  private unipack: UniPackData;
  private loaded = false;
  private onLoadProgress?: (loaded: number, total: number) => void;
  private pendingChainChanges = new Set<PendingChainChange>();
  private chainChangesSuspended = false;
  private suspensionRevision = 0;
  private visibilitySuspended = false;
  private outputMuted = false;
  private volume = 1;
  onInterrupted: (() => void) | null = null;
  private pendingSuspensions = 0;
  private pendingResumptions = 0;
  private gestureResume: (() => void) | null = null;

  constructor(
    unipack: UniPackData,
    chainValue: () => number,
    setChain: (c: number) => void,
    onLoadProgress?: (loaded: number, total: number) => void,
  ) {
    this.unipack = unipack;
    this.chainValue = chainValue;
    this.setChain = setChain;
    this.onLoadProgress = onLoadProgress;

    requestPlaybackAudioSession();
    this.audioContext = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: 44100,
    });
    this.audioContext.onstatechange = () => {
      if (!this.visibilitySuspended && this.pendingSuspensions === 0 && this.pendingResumptions === 0 && this.audioContext.state !== 'running' && this.audioContext.state !== 'closed') {
        this.onInterrupted?.();
      }
    };
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);

    // The context is created after several awaits (file read, zip parse), i.e. outside the
    // user-gesture window, so Safari and autoplay-policy Chrome start it suspended and the
    // first pack played silently. Resume on the next gesture until it is running.
    void (typeof document !== 'undefined' && document.hidden
      ? this.setSuspended(true) : this.resume()).catch(() => {});
    if (typeof document !== 'undefined') {
      const resumeOnGesture = () => {
        if (this.visibilitySuspended) return;
        if (this.audioContext.state === 'running' || this.audioContext.state === 'closed') {
          this.removeGestureResume();
          return;
        }
        void this.resume().then(() => {
          if (this.audioContext.state === 'running') this.removeGestureResume();
        }).catch(() => {});
      };
      this.gestureResume = resumeOnGesture;
      for (const type of ['pointerdown', 'touchend', 'keydown'] as const) {
        document.addEventListener(type, resumeOnGesture, { capture: true, passive: true });
      }
    }
  }

  private removeGestureResume(): void {
    if (!this.gestureResume || typeof document === 'undefined') return;
    for (const type of ['pointerdown', 'touchend', 'keydown'] as const) {
      document.removeEventListener(type, this.gestureResume, { capture: true });
    }
    this.gestureResume = null;
  }

  setVolume(level: number, maxLevel: number = 7): void {
    this.volume = maxLevel > 0 ? level / maxLevel : 1;
    this.applyOutputVolume();
  }

  getVolume(maxLevel: number = 7): number {
    return Math.round(this.volume * maxLevel);
  }

  private applyOutputVolume(): void {
    this.gainNode.gain.value = this.outputMuted ? 0 : this.volume;
  }

  /**
   * Admits the pack's sound files under the shared limits, then decodes only the admitted ones. The
   * whole selection is made before any decoding, so a file that fails to decode keeps its reservation
   * and never lets a later file in. The pack's encoded bytes are released once read.
   */
  async load(inspector: AudioInspector = INLINE_AUDIO_INSPECTOR): Promise<SoundLoadReport> {
    if (this.loaded) return EMPTY_SOUND_LOAD_REPORT;

    const { soundTable, soundFiles, info } = this.unipack;
    const plan = await selectAudio(
      audioReferences(this.unipack),
      { chains: info.chain, width: info.buttonX, height: info.buttonY },
      identity => {
        const bytes = soundFiles.get(identity);
        return bytes ? inspector.inspect(bytes) : { exclusion: 'READ_FAILURE' };
      },
    );
    const order = new Map(plan.files.map(({ identity }, index) => [identity, index]));
    const failures: SoundFailure[] = [];
    const admitted: string[] = [];
    for (const { identity, exclusion } of plan.files) {
      if (exclusion === null) admitted.push(identity);
      else failures.push({ file: identity, reason: exclusionReason(exclusion), exclusion });
    }

    const total = plan.files.length;
    let settled = failures.length;
    for (let i = 0; i < admitted.length; i += DECODE_BATCH_SIZE) {
      await Promise.all(
        admitted.slice(i, i + DECODE_BATCH_SIZE).map(async file => {
          const reason = await this.decode(file);
          if (reason) failures.push({ file, reason, exclusion: null });
          settled++;
          this.onLoadProgress?.(settled, total);
        }),
      );
    }
    soundFiles.clear();

    for (let c = 0; c < info.chain; c++) {
      for (let x = 0; x < info.buttonX; x++) {
        for (let y = 0; y < info.buttonY; y++) {
          for (const sound of soundTable[c][x][y] ?? []) {
            sound.audioBuffer = this.bufferCache.get(sound.file) ?? null;
          }
        }
      }
    }

    this.loaded = true;
    failures.sort((a, b) => order.get(a.file)! - order.get(b.file)!);
    return {
      usedFiles: total,
      loadedFiles: this.bufferCache.size,
      failures,
      reservedCost: plan.reservedCost,
    };
  }

  /** The decoder takes the file's own bytes, without a copy: nothing reads them after this. */
  private async decode(file: string): Promise<'decode' | 'memory' | null> {
    try {
      this.bufferCache.set(file, await this.audioContext.decodeAudioData(this.unipack.soundFiles.get(file)!));
      return null;
    } catch (error) {
      console.warn(`Failed to decode audio: ${file}`, error);
      return isMemoryFailure(error) ? 'memory' : 'decode';
    }
  }

  async resume(): Promise<void> {
    if (!this.visibilitySuspended && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /** Freeze existing sources and scheduled sample ends on the audio device's own clock. */
  async setSuspended(suspended: boolean): Promise<void> {
    // A ready connection needs no native permission round trip. Keep pending or muted transitions
    // on the acknowledged path below, including a resume requested before suspension completes.
    if (!suspended && !this.visibilitySuspended && !this.outputMuted && this.audioContext.state === 'running') return;
    this.visibilitySuspended = suspended;
    const revision = ++this.suspensionRevision;
    if (this.audioContext.state === 'closed') return;
    if (suspended) {
      // Native suspension is asynchronous. Silence output before waiting for its acknowledgement.
      this.outputMuted = true;
      this.applyOutputVolume();
      if (!this.chainChangesSuspended) {
        this.chainChangesSuspended = true;
        const now = performance.now();
        for (const change of this.pendingChainChanges) {
          if (change.timer !== null) clearTimeout(change.timer);
          change.timer = null;
          change.remaining = Math.max(0, change.dueAt - now);
        }
      }
      this.pendingSuspensions++;
      try { await this.audioContext.suspend(); }
      finally { this.pendingSuspensions--; }
    } else {
      // Always enqueue resume, even if an earlier suspend has not changed state yet.
      this.pendingResumptions++;
      try { await this.audioContext.resume(); }
      finally { this.pendingResumptions--; }
      if (revision !== this.suspensionRevision || this.audioContext.state !== 'running') return;
      this.outputMuted = false;
      this.applyOutputVolume();
      if (this.chainChangesSuspended) {
        this.chainChangesSuspended = false;
        for (const change of this.pendingChainChanges) this.scheduleChainChange(change);
      }
    }
  }

  private stopKey(chain: number, x: number, y: number): string {
    return `${chain}-${x}-${y}`;
  }

  private padPresses(x: number, y: number): Map<string, Press[]> {
    const padKey = `${x}-${y}`;
    let presses = this.heldPresses.get(padKey);
    if (!presses) {
      presses = new Map();
      this.heldPresses.set(padKey, presses);
    }
    return presses;
  }

  /**
   * `input` names what holds the pad (a pointer, a key); two inputs on one pad are two presses, so a
   * release stops the endless sound its own press started even after the chain changed in between.
   */
  soundOn(x: number, y: number, input = ''): void {
    const chain = this.chainValue();
    const key = this.stopKey(chain, x, y);
    const presses = this.padPresses(x, y);
    // Keep earlier chains reachable by this input's eventual release.

    // Stop currently playing sound for this pad
    const existing = this.activeNodes.get(key);
    if (existing) {
      try { existing.stop(); } catch { /* already stopped */ }
      this.activeNodes.delete(key);
    }

    const sound = this.soundGet(chain, x, y);
    if (!sound) return;
    // A sound that could not be decoded is silent, but the pad still moves on to its next sound and
    // follows its wormhole, so the rest of the pad's sequence plays as written.
    this.soundPush(chain, x, y);
    if (sound.wormhole !== NO_WORMHOLE && input !== AUTO_PLAY_INPUT) {
      const change: PendingChainChange = { chain: sound.wormhole, remaining: 100, dueAt: 0, timer: null };
      this.pendingChainChanges.add(change);
      if (!this.chainChangesSuspended) this.scheduleChainChange(change);
    }
    if (!sound.audioBuffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = sound.audioBuffer;
    source.connect(this.gainNode);

    if (sound.loop === -1 || sound.loop > 0) source.loop = true;

    source.start(0);
    if (sound.loop > 0) {
      const stopTime = this.audioContext.currentTime + sound.audioBuffer.duration * (sound.loop + 1);
      source.stop(stopTime);
    }
    this.activeNodes.set(key, source);
    const press: Press = { key, node: source, infinite: sound.loop === -1 };
    presses.set(input, [...(presses.get(input) ?? []), press]);
    source.onended = () => this.forgetNode(presses, input, press);
  }

  /** Without `input`, every press of the pad is released. */
  soundOff(x: number, y: number, input?: string): void {
    const presses = this.padPresses(x, y);
    const released = input === undefined ? Array.from(presses.values()).flat() : (presses.get(input) ?? []);
    if (input === undefined) presses.clear();
    else presses.delete(input);
    for (const press of released) {
      if (!press?.infinite || this.activeNodes.get(press.key) !== press.node) continue;
      try { press.node.stop(); } catch { /* already stopped */ }
      this.activeNodes.delete(press.key);
    }
  }

  /** onended of an older node must not drop the newer node registered under the same key;
   *  it left an infinite-loop sample with nothing that could stop it. */
  private forgetNode(presses: Map<string, Press[]>, input: string, press: Press): void {
    if (this.activeNodes.get(press.key) === press.node) this.activeNodes.delete(press.key);
    const remaining = presses.get(input)?.filter(held => held !== press);
    if (remaining?.length) presses.set(input, remaining);
    else presses.delete(input);
  }

  private soundGet(c: number, x: number, y: number): Sound | null {
    const sounds = this.unipack.soundTable[c]?.[x]?.[y];
    if (!sounds || sounds.length === 0) return null;
    return sounds[0];
  }

  private soundPush(c: number, x: number, y: number): void {
    const sounds = this.unipack.soundTable[c]?.[x]?.[y];
    if (!sounds || sounds.length <= 1) return;
    const first = sounds.shift()!;
    sounds.push(first);
  }

  soundGetForAutoPlay(c: number, x: number, y: number, num: number): Sound | null {
    const sounds = this.unipack.soundTable[c]?.[x]?.[y];
    if (!sounds || sounds.length === 0) return null;
    return sounds[num % sounds.length];
  }

  soundPushToNum(c: number, x: number, y: number, num: number): void {
    const sounds = this.unipack.soundTable[c]?.[x]?.[y];
    if (!sounds || sounds.length === 0) return;
    const targetNum = num % sounds.length;
    for (let i = 0; i < sounds.length; i++) {
      if (sounds[0].num === targetNum) break;
      const first = sounds.shift()!;
      sounds.push(first);
    }
  }

  private scheduleChainChange(change: PendingChainChange): void {
    change.dueAt = performance.now() + change.remaining;
    change.timer = setTimeout(() => {
      if (!this.pendingChainChanges.delete(change)) return;
      this.setChain(change.chain);
    }, change.remaining);
  }

  cancelPendingChainChanges(): void {
    for (const change of this.pendingChainChanges) {
      if (change.timer !== null) clearTimeout(change.timer);
    }
    this.pendingChainChanges.clear();
  }

  /** An interruption ends every source, including finite sounds that a pad release leaves playing. */
  stopAll(): void {
    this.cancelPendingChainChanges();
    this.activeNodes.forEach(node => {
      try { node.stop(); } catch { /* already stopped */ }
    });
    this.activeNodes.clear();
    this.heldPresses.clear();
  }

  destroy(): void {
    this.suspensionRevision++;
    this.onInterrupted = null;
    this.audioContext.onstatechange = null;
    this.cancelPendingChainChanges();
    this.removeGestureResume();
    this.activeNodes.forEach((node) => {
      try { node.stop(); } catch { /* already stopped */ }
    });
    this.activeNodes.clear();
    this.heldPresses.clear();
    this.audioContext.close();
  }

  get context(): AudioContext {
    return this.audioContext;
  }
}
