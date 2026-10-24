import type { AudioFacts } from './audioSafety';
import {
  AudioBits,
  AudioData,
  InvalidAudio,
  add,
  multiply,
  requireAudio,
} from './audioData';

function crcStep(
  value: number,
  byte: number,
  width: number,
  polynomial: number,
): number {
  let crc = value ^ (byte << (width - 8));
  for (let i = 0; i < 8; i++)
    crc = (crc << 1) ^ ((crc & (1 << (width - 1))) !== 0 ? polynomial : 0);
  return crc & ((1 << width) - 1);
}
export function inspectFlac(d: AudioData): AudioFacts {
  let at = 4,
    last = false,
    rate = 0,
    channels = 0,
    bits = 0;
  while (!last) {
    d.range(at, 4);
    const type = d.byte(at),
      length = d.uint(at + 1, 3),
      payload = at + 4;
    d.range(payload, length);
    if (at === 4) {
      requireAudio((type & 127) === 0 && length === 34);
      rate = d.uint(payload + 10, 3) >>> 4;
      channels = ((d.byte(payload + 12) >>> 1) & 7) + 1;
      bits =
        (((d.byte(payload + 12) & 1) << 4) | (d.byte(payload + 13) >>> 4)) + 1;
      requireAudio(rate > 0);
    } else requireAudio((type & 127) !== 0 && (type & 127) < 127);
    last = (type & 128) !== 0;
    at = payload + length;
  }
  return {
    sampleRate: rate,
    channels,
    frames: BigInt(
      inspectFlacFrames(d, at, d.size, rate, channels, bits, true),
    ),
    format: 'flac',
  };
}
interface FlacFrame {
  end: number;
  samples: number;
  number: number;
  variable: boolean;
  assignment: number;
}
/** CRC-checked physical blocks, also usable for independently bounded FLAC-in-MP4 samples. */
export function inspectFlacFrames(
  d: AudioData,
  from: number,
  limit: number,
  rate: number,
  channels: number,
  bits: number,
  zeroOrigin = false,
): number {
  function header(start: number): FlacFrame {
    d.range(start, 6, limit);
    requireAudio(d.byte(start) === 255 && (d.byte(start + 1) & 0xfe) === 0xf8);
    const variable = (d.byte(start + 1) & 1) !== 0,
      blockCode = d.byte(start + 2) >>> 4,
      rateCode = d.byte(start + 2) & 15,
      assignment = d.byte(start + 3) >>> 4,
      precision = (d.byte(start + 3) >>> 1) & 7;
    requireAudio(
      (d.byte(start + 3) & 1) === 0 &&
        assignment <= 10 &&
        (assignment < 8 ? assignment + 1 : 2) === channels &&
        precision !== 3,
    );
    requireAudio([bits, 8, 12, 0, 16, 20, 24, 32][precision] === bits);
    let pos = start + 4;
    const first = d.byte(pos++);
    let number: number;
    if (first < 128) number = first;
    else {
      const count = Math.clz32(~first & 255) - 24;
      requireAudio(count >= 2 && count <= 7);
      number = first & (0x7f >>> count);
      for (let i = 0; i < count - 1; i++) {
        const next = d.byte(pos++);
        requireAudio((next & 0xc0) === 0x80);
        number = add(multiply(number, 64), next & 63);
      }
    }
    let samples: number;
    if (blockCode === 1) samples = 192;
    else if (blockCode >= 2 && blockCode <= 5) samples = 576 << (blockCode - 2);
    else if (blockCode === 6) samples = d.byte(pos++) + 1;
    else if (blockCode === 7) {
      samples = d.uint(pos, 2) + 1;
      pos += 2;
    } else if (blockCode >= 8) samples = 256 << (blockCode - 8);
    else throw new InvalidAudio();
    let frameRate: number;
    if (rateCode === 0) frameRate = rate;
    else if (rateCode <= 11)
      frameRate = [
        88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000,
        96000,
      ][rateCode - 1];
    else if (rateCode === 12) frameRate = d.byte(pos++) * 1000;
    else if (rateCode === 13) {
      frameRate = d.uint(pos, 2);
      pos += 2;
    } else if (rateCode === 14) {
      frameRate = d.uint(pos, 2) * 10;
      pos += 2;
    } else throw new InvalidAudio();
    requireAudio(frameRate === rate);
    d.range(start, pos - start + 1, limit);
    let crc = 0;
    for (let i = start; i < pos; i++) crc = crcStep(crc, d.byte(i), 8, 7);
    requireAudio(crc === d.byte(pos++));
    return { end: pos, samples, number, variable, assignment };
  }
  let at = from;
  requireAudio(at < limit);
  let frame = header(at);
  const origin = zeroOrigin ? 0 : frame.number;
  let total = 0,
    ordinal = 0;
  while (true) {
    requireAudio(
      frame.number === add(origin, frame.variable ? total : ordinal),
    );
    const body = new AudioBits(multiply(limit - frame.end, 8), false, index =>
      d.byte(frame.end + index),
    );
    function residual(order: number): void {
      const method = body.read(2);
      requireAudio(method <= 1);
      const parameterBits = method === 0 ? 4 : 5,
        partitions = 1 << body.read(4);
      requireAudio(frame.samples % partitions === 0);
      for (let partition = 0; partition < partitions; partition++) {
        const count =
          frame.samples / partitions - (partition === 0 ? order : 0);
        requireAudio(count >= 0);
        const parameter = body.read(parameterBits);
        if (parameter === (1 << parameterBits) - 1)
          body.skip(multiply(count, body.read(5)));
        else
          for (let i = 0; i < count; i++) {
            while (body.read(1) === 0) {
              /* Physical bit limit bounds unary codes. */
            }
            body.skip(parameter);
          }
      }
    }
    for (let channel = 0; channel < channels; channel++) {
      const extra =
        frame.assignment === 8 || frame.assignment === 10
          ? channel === 1
          : frame.assignment === 9
            ? channel === 0
            : false;
      let precision = bits + (extra ? 1 : 0);
      requireAudio(body.read(1) === 0);
      const type = body.read(6);
      if (body.read(1) !== 0) {
        let wasted = 1;
        while (body.read(1) === 0) {
          wasted++;
          requireAudio(wasted < precision);
        }
        precision -= wasted;
      }
      requireAudio(precision > 0);
      if (type === 0) body.skip(precision);
      else if (type === 1) body.skip(multiply(frame.samples, precision));
      else if (type >= 8 && type <= 12) {
        const order = type - 8;
        requireAudio(order <= frame.samples);
        body.skip(multiply(order, precision));
        residual(order);
      } else if (type >= 32) {
        const order = (type & 31) + 1;
        requireAudio(order <= frame.samples);
        body.skip(multiply(order, precision));
        const coefficientBits = body.read(4);
        requireAudio(coefficientBits < 15);
        body.skip(5);
        body.skip(order * (coefficientBits + 1));
        residual(order);
      } else throw new InvalidAudio();
    }
    requireAudio(body.read((8 - (body.position % 8)) % 8) === 0);
    const end = add(frame.end, body.position / 8);
    d.range(end, 2, limit);
    let crc = 0;
    for (let p = at; p < end + 2; p++)
      crc = crcStep(crc, d.byte(p), 16, 0x8005);
    requireAudio(crc === 0);
    total = add(total, frame.samples);
    ordinal++;
    at = end + 2;
    if (at === limit) break;
    const next = header(at);
    requireAudio(next.variable === frame.variable);
    frame = next;
  }
  return total;
}
