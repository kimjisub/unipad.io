/** Structural readers never allocate PCM or arrays sized by unvalidated declarations. */
export class InvalidAudio extends Error {}
export class AudioReadLimit extends Error {}
export function requireAudio(condition: unknown): asserts condition {
  if (!condition) throw new InvalidAudio();
}
export function capacity(count: number, maximum: number): void {
  if (count > maximum) throw new AudioReadLimit();
}
export function add(a: number, b: number): number {
  requireAudio(
    Number.isSafeInteger(a) &&
      Number.isSafeInteger(b) &&
      a >= 0 &&
      b >= 0 &&
      a <= Number.MAX_SAFE_INTEGER - b,
  );
  return a + b;
}
export function multiply(a: number, b: number): number {
  requireAudio(
    Number.isSafeInteger(a) &&
      Number.isSafeInteger(b) &&
      a >= 0 &&
      b >= 0 &&
      (b === 0 || a <= Math.floor(Number.MAX_SAFE_INTEGER / b)),
  );
  return a * b;
}
const MAX_LONG = (BigInt(1) << BigInt(63)) - BigInt(1);
export function bigAdd(a: bigint, b: bigint): bigint {
  requireAudio(a >= BigInt(0) && b >= BigInt(0) && a <= MAX_LONG - b);
  return a + b;
}
export function bigMultiply(a: bigint, b: bigint): bigint {
  requireAudio(
    a >= BigInt(0) && b >= BigInt(0) && (b === BigInt(0) || a <= MAX_LONG / b),
  );
  return a * b;
}
export class AudioData {
  readonly bytes: Uint8Array;
  readonly size: number;
  constructor(input: Uint8Array | ArrayBuffer) {
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.size = this.bytes.byteLength;
  }
  range(at: number, length: number, end = this.size): void {
    requireAudio(
      [at, length, end].every(Number.isSafeInteger) &&
        at >= 0 &&
        length >= 0 &&
        end <= this.size &&
        at <= end &&
        length <= end - at,
    );
  }
  byte(at: number): number {
    this.range(at, 1);
    return this.bytes[at];
  }
  uint(at: number, count: number, little = false): number {
    this.range(at, count);
    let value = 0;
    for (let i = 0; i < count; i++)
      value = add(
        multiply(value, 256),
        this.byte(at + (little ? count - 1 - i : i)),
      );
    return value;
  }
  uintBig(at: number, count: number, little = false): bigint {
    this.range(at, count);
    let value = BigInt(0);
    for (let i = 0; i < count; i++)
      value = bigAdd(
        bigMultiply(value, BigInt(256)),
        BigInt(this.byte(at + (little ? count - 1 - i : i))),
      );
    return value;
  }
  matches(at: number, text: string): boolean {
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at > this.size ||
      text.length > this.size - at
    )
      return false;
    for (let i = 0; i < text.length; i++)
      if (this.byte(at + i) !== text.charCodeAt(i)) return false;
    return true;
  }
}
export class AudioBits {
  position = 0;
  constructor(
    readonly size: number,
    private readonly little: boolean,
    private readonly byte: (at: number) => number,
  ) {}
  read(count: number): number {
    requireAudio(
      Number.isInteger(count) &&
        count >= 0 &&
        count <= 32 &&
        this.position <= this.size &&
        count <= this.size - this.position,
    );
    let result = 0;
    for (let i = 0; i < count; i++) {
      const value =
        (this.byte(Math.floor(this.position / 8)) >>>
          (this.little ? this.position % 8 : 7 - (this.position % 8))) &
        1;
      result = this.little ? result + value * 2 ** i : result * 2 + value;
      this.position++;
    }
    return result;
  }
  skip(count: number): void {
    requireAudio(
      Number.isSafeInteger(count) &&
        count >= 0 &&
        this.position <= this.size &&
        count <= this.size - this.position,
    );
    this.position += count;
  }
}
export const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
  8000, 7350,
] as const;
