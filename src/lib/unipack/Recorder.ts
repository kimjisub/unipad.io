export interface RecordEvent {
  type: 'on' | 'off' | 'chain' | 'delay';
  x?: number;
  y?: number;
  chain?: number;
  delay?: number;
  timestamp: number;
}

export class Recorder {
  private events: RecordEvent[] = [];
  private startTime = 0;
  private lastEventTime = 0;
  recording = false;

  start(currentChain?: number): void {
    this.events = [];
    this.startTime = performance.now();
    this.lastEventTime = this.startTime;
    this.recording = true;
    if (currentChain !== undefined) {
      this.events.push({ type: 'chain', chain: currentChain, timestamp: this.startTime });
    }
  }

  stop(): RecordEvent[] {
    this.recording = false;
    return [...this.events];
  }

  recordOn(x: number, y: number): void {
    if (!this.recording) return;
    this.addDelay();
    this.events.push({ type: 'on', x, y, timestamp: performance.now() });
  }

  recordOff(x: number, y: number): void {
    if (!this.recording) return;
    this.addDelay();
    this.events.push({ type: 'off', x, y, timestamp: performance.now() });
  }

  recordChain(chain: number): void {
    if (!this.recording) return;
    this.addDelay();
    this.events.push({ type: 'chain', chain, timestamp: performance.now() });
  }

  private addDelay(): void {
    const now = performance.now();
    const delay = Math.round(now - this.lastEventTime);
    // Android: delay가 0이어도 항상 기록
    this.events.push({ type: 'delay', delay, timestamp: now });
    this.lastEventTime = now;
  }

  exportAsAutoPlay(): string {
    const lines: string[] = [];
    for (const event of this.events) {
      switch (event.type) {
        case 'on':
          lines.push(`t ${(event.x ?? 0) + 1} ${(event.y ?? 0) + 1}`);
          break;
        case 'off':
          // Android에서는 off 이벤트를 기록하지 않음 (touch on만 기록)
          break;
        case 'chain':
          lines.push(`chain ${(event.chain ?? 0) + 1}`);
          break;
        case 'delay':
          lines.push(`d ${event.delay ?? 0}`);
          break;
      }
    }
    return lines.join('\n');
  }
}
