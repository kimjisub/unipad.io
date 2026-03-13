import { Sound, NO_WORMHOLE, UniPackData } from './types';

export class SoundEngine {
  private audioContext: AudioContext;
  private gainNode: GainNode;
  private bufferCache = new Map<string, AudioBuffer>();
  private activeNodes = new Map<string, AudioBufferSourceNode>();
  private chainValue: () => number;
  private setChain: (c: number) => void;
  private unipack: UniPackData;
  private loaded = false;
  private onLoadProgress?: (loaded: number, total: number) => void;

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

    this.audioContext = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: 44100,
    });
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
  }

  setVolume(level: number, maxLevel: number = 7): void {
    this.gainNode.gain.value = maxLevel > 0 ? level / maxLevel : 1;
  }

  getVolume(maxLevel: number = 7): number {
    return Math.round(this.gainNode.gain.value * maxLevel);
  }

  async load(): Promise<string[]> {
    if (this.loaded) return [];

    const entries = Array.from(this.unipack.soundFiles.entries());
    const total = entries.length;
    let loadedCount = 0;
    const failedFiles: string[] = [];

    const batchSize = 10;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async ([path, data]) => {
          try {
            const buffer = await this.audioContext.decodeAudioData(data.slice(0));
            this.bufferCache.set(path, buffer);
          } catch {
            console.warn(`Failed to decode audio: ${path}`);
            failedFiles.push(path);
          }
          loadedCount++;
          this.onLoadProgress?.(loadedCount, total);
        }),
      );
    }

    // Assign buffers to sounds
    const { soundTable, info } = this.unipack;
    for (let c = 0; c < info.chain; c++) {
      for (let x = 0; x < info.buttonX; x++) {
        for (let y = 0; y < info.buttonY; y++) {
          const sounds = soundTable[c][x][y];
          if (sounds) {
            for (const sound of sounds) {
              sound.audioBuffer = this.bufferCache.get(sound.file) ?? null;
            }
          }
        }
      }
    }

    this.loaded = true;
    return failedFiles;
  }

  async resume(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  private stopKey(chain: number, x: number, y: number): string {
    return `${chain}-${x}-${y}`;
  }

  soundOn(x: number, y: number): void {
    const chain = this.chainValue();
    const key = this.stopKey(chain, x, y);

    // Stop currently playing sound for this pad
    const existing = this.activeNodes.get(key);
    if (existing) {
      try { existing.stop(); } catch { /* already stopped */ }
      this.activeNodes.delete(key);
    }

    const sound = this.soundGet(chain, x, y);
    if (!sound || !sound.audioBuffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = sound.audioBuffer;
    source.connect(this.gainNode);

    if (sound.loop === -1) {
      // loop=-1 means loop forever (original: loop count 0 = infinite loop in SoundPool)
      source.loop = true;
    } else if (sound.loop > 0) {
      source.loop = true;
      source.start(0);
      const stopTime = this.audioContext.currentTime + sound.audioBuffer.duration * (sound.loop + 1);
      source.stop(stopTime);
      this.soundPush(chain, x, y);
      this.activeNodes.set(key, source);
      source.onended = () => this.activeNodes.delete(key);

      if (sound.wormhole !== NO_WORMHOLE) {
        setTimeout(() => this.setChain(sound.wormhole), 100);
      }
      return;
    }

    source.start(0);
    this.soundPush(chain, x, y);
    this.activeNodes.set(key, source);
    source.onended = () => this.activeNodes.delete(key);

    if (sound.wormhole !== NO_WORMHOLE) {
      setTimeout(() => this.setChain(sound.wormhole), 100);
    }
  }

  soundOff(x: number, y: number): void {
    const chain = this.chainValue();
    const sound = this.soundGet(chain, x, y);
    if (sound && sound.loop === -1) {
      const key = this.stopKey(chain, x, y);
      const node = this.activeNodes.get(key);
      if (node) {
        try { node.stop(); } catch { /* already stopped */ }
        this.activeNodes.delete(key);
      }
    }
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

  destroy(): void {
    this.activeNodes.forEach((node) => {
      try { node.stop(); } catch { /* already stopped */ }
    });
    this.activeNodes.clear();
    this.audioContext.close();
  }

  get context(): AudioContext {
    return this.audioContext;
  }
}
