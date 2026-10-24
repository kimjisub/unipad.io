import type { AudioFacts } from './audioSafety';
import {
  AudioBits,
  AudioData,
  InvalidAudio,
  add,
  multiply,
  requireAudio,
} from './audioData';
interface Span {
  at: number;
  length: number;
  index: number;
}
class Packet {
  constructor(
    private readonly d: AudioData,
    private readonly spans: readonly Span[],
    readonly size: number,
  ) {}
  byte(index: number): number {
    requireAudio(
      Number.isSafeInteger(index) && index >= 0 && index < this.size,
    );
    let low = 0,
      high = this.spans.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.spans[mid].index <= index) low = mid;
      else high = mid - 1;
    }
    const span = this.spans[low];
    return this.d.byte(span.at + index - span.index);
  }
  matches(index: number, text: string): boolean {
    return (
      index >= 0 &&
      index <= this.size &&
      text.length <= this.size - index &&
      [...text].every((c, i) => this.byte(index + i) === c.charCodeAt(0))
    );
  }
  uint(index: number, count: number): number {
    let value = 0;
    for (let i = count - 1; i >= 0; i--)
      value = add(multiply(value, 256), this.byte(index + i));
    return value;
  }
  bits(): AudioBits {
    return new AudioBits(multiply(this.size, 8), true, index =>
      this.byte(index),
    );
  }
}
/** Validate page CRCs, lacing, sequence and packet sizes before using granule positions. */
export function inspectOgg(d: AudioData): AudioFacts {
  let at = 0,
    serial = -1,
    sequence = 0,
    packetCount = 0,
    packetSize = 0,
    rate = 0,
    channels = 0,
    opus = false,
    streams = 1,
    preSkip = BigInt(0);
  const spans: Span[] = [];
  let shortBlock = 0,
    longBlock = 0,
    modes: boolean[] = [],
    previousBlock = 0,
    calculated = BigInt(0),
    lastPacketFrames = BigInt(0),
    granule = BigInt(0),
    origin: bigint | null = null,
    ended = false;
  while (at < d.size) {
    requireAudio(!ended && d.matches(at, 'OggS'));
    d.range(at, 27);
    requireAudio(d.byte(at + 4) === 0);
    const flags = d.byte(at + 5);
    requireAudio((flags & 0xf8) === 0);
    const stream = d.uint(at + 14, 4, true),
      pageSequence = d.uint(at + 18, 4, true);
    if (serial === -1) {
      requireAudio(
        (flags & 2) !== 0 && (flags & 1) === 0 && pageSequence === 0,
      );
      serial = stream;
    } else requireAudio((flags & 2) === 0);
    requireAudio(
      stream === serial &&
        pageSequence === sequence &&
        ((flags & 1) !== 0) === packetSize > 0,
    );
    sequence = (sequence + 1) % 4294967296;
    const segments = d.byte(at + 26);
    d.range(at + 27, segments);
    let payloadBytes = 0;
    for (let i = 0; i < segments; i++) payloadBytes += d.byte(at + 27 + i);
    const pageSize = 27 + segments + payloadBytes;
    d.range(at, pageSize);
    let crc = 0;
    for (let i = 0; i < pageSize; i++) {
      const b = i >= 22 && i <= 25 ? 0 : d.byte(at + i);
      crc ^= b << 24;
      for (let j = 0; j < 8; j++) crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
    }
    requireAudio(crc >>> 0 === d.uint(at + 22, 4, true));
    let payload = at + 27 + segments,
      completed = 0;
    for (let i = 0; i < segments; i++) {
      const size = d.byte(at + 27 + i);
      if (size > 0) {
        const last = spans[spans.length - 1];
        if (last && last.at + last.length === payload) last.length += size;
        else spans.push({ at: payload, length: size, index: packetSize });
        packetSize = add(packetSize, size);
      }
      payload += size;
      if (size < 255) {
        const packet = new Packet(d, spans, packetSize);
        if (packetCount === 0) {
          opus = packet.matches(0, 'OpusHead');
          if (opus) {
            requireAudio(
              packet.size >= 19 && packet.byte(8) >= 1 && packet.byte(8) <= 15,
            );
            channels = packet.byte(9);
            rate = 48000;
            preSkip = BigInt(packet.uint(10, 2));
            const family = packet.byte(18);
            requireAudio(family !== 0 || (channels >= 1 && channels <= 2));
            if (family !== 0) {
              requireAudio(packet.size >= 21 + channels);
              streams = packet.byte(19);
              const coupled = packet.byte(20);
              requireAudio(
                streams > 0 && coupled <= streams && streams + coupled <= 255,
              );
              for (let c = 0; c < channels; c++)
                requireAudio(
                  packet.byte(21 + c) === 255 ||
                    packet.byte(21 + c) < streams + coupled,
                );
            }
          } else {
            requireAudio(
              packet.size === 30 &&
                packet.byte(0) === 1 &&
                packet.matches(1, 'vorbis') &&
                packet.uint(7, 4) === 0,
            );
            channels = packet.byte(11);
            rate = packet.uint(12, 4);
            const sizes = packet.byte(28),
              small = sizes & 15,
              large = sizes >>> 4;
            requireAudio(
              small >= 6 &&
                small <= 13 &&
                large >= small &&
                large <= 13 &&
                (packet.byte(29) & 1) !== 0,
            );
            shortBlock = 1 << small;
            longBlock = 1 << large;
          }
          requireAudio(rate > 0 && channels > 0);
        } else if (packetCount === 1)
          requireAudio(
            opus
              ? packet.matches(0, 'OpusTags')
              : packet.byte(0) === 3 && packet.matches(1, 'vorbis'),
          );
        else if (!opus && packetCount === 2)
          modes = vorbisModes(packet, channels);
        else if (opus) {
          requireAudio(packet.size > 0);
          lastPacketFrames = BigInt(
            opusPacketFrames(packet.size, streams, index => packet.byte(index)),
          );
          calculated += lastPacketFrames;
        } else {
          const bits = packet.bits();
          requireAudio(bits.read(1) === 0 && modes.length > 0);
          const mode = bits.read(ilog(modes.length - 1));
          requireAudio(mode < modes.length);
          const block = modes[mode] ? longBlock : shortBlock;
          if (modes[mode]) bits.skip(2);
          lastPacketFrames = BigInt(block);
          if (previousBlock !== 0)
            calculated += BigInt((previousBlock + block) / 4);
          previousBlock = block;
        }
        packetCount++;
        completed++;
        spans.length = 0;
        packetSize = 0;
      }
    }
    const unset = Array.from({ length: 8 }, (_, i) => d.byte(at + 6 + i)).every(
      b => b === 255,
    );
    if (!unset) {
      const raw = d.uintBig(at + 6, 8, true);
      if (calculated > BigInt(0) && origin === null)
        origin = raw > calculated ? raw - calculated : BigInt(0);
      const start = origin ?? BigInt(0);
      requireAudio(raw >= start);
      const current = raw - start;
      requireAudio(
        completed > 0 && current >= granule && current <= calculated,
      );
      granule = current;
    } else requireAudio(completed === 0);
    if ((flags & 4) !== 0) {
      requireAudio(
        !unset &&
          packetSize === 0 &&
          calculated > BigInt(0) &&
          granule >= preSkip &&
          calculated - granule <= lastPacketFrames,
      );
      ended = true;
    }
    at += pageSize;
  }
  requireAudio(ended);
  return {
    sampleRate: rate,
    channels,
    frames: granule - preSkip,
    format: opus ? 'opus' : 'ogg',
  };
}
function ilog(n: number): number {
  return n === 0 ? 0 : 32 - Math.clz32(n);
}
function vorbisModes(packet: Packet, channels: number): boolean[] {
  requireAudio(packet.byte(0) === 5 && packet.matches(1, 'vorbis'));
  const b = packet.bits();
  b.skip(56);
  const codebooks = b.read(8) + 1;
  for (let i = 0; i < codebooks; i++) {
    requireAudio(b.read(24) === 0x564342);
    const dimensions = b.read(16),
      entries = b.read(24);
    requireAudio(dimensions > 0 && entries > 0);
    if (b.read(1) === 1) {
      let current = 0,
        length = b.read(5) + 1;
      while (current < entries) {
        requireAudio(length <= 32);
        const count = b.read(ilog(entries - current));
        requireAudio(count <= entries - current);
        current += count;
        length++;
      }
    } else {
      const sparse = b.read(1) === 1;
      if (sparse) {
        for (let j = 0; j < entries; j++) if (b.read(1) !== 0) b.skip(5);
      } else b.skip(entries * 5);
    }
    const lookup = b.read(4);
    requireAudio(lookup <= 2);
    if (lookup > 0) {
      b.skip(64);
      const bits = b.read(4) + 1;
      b.skip(1);
      let values: number;
      if (lookup === 2) values = multiply(entries, dimensions);
      else {
        function fits(base: number): boolean {
          let product = 1;
          for (let j = 0; j < dimensions; j++) {
            if (base > Math.floor(entries / product)) return false;
            product *= base;
          }
          return true;
        }
        let low = 1,
          high = entries;
        while (low < high) {
          const mid = Math.floor((low + high + 1) / 2);
          if (fits(mid)) low = mid;
          else high = mid - 1;
        }
        values = low;
      }
      b.skip(multiply(values, bits));
    }
  }
  const times = b.read(6) + 1;
  for (let i = 0; i < times; i++) requireAudio(b.read(16) === 0);
  const floors = b.read(6) + 1;
  for (let i = 0; i < floors; i++) {
    const type = b.read(16);
    if (type === 0) {
      b.skip(54);
      const books = b.read(4) + 1;
      for (let j = 0; j < books; j++) requireAudio(b.read(8) < codebooks);
    } else if (type === 1) {
      const partitions = Array.from({ length: b.read(5) }, () => b.read(4)),
        classes = new Array<number>(Math.max(-1, ...partitions) + 1);
      for (let j = 0; j < classes.length; j++) {
        classes[j] = b.read(3) + 1;
        const sub = b.read(2);
        if (sub > 0) requireAudio(b.read(8) < codebooks);
        for (let k = 0; k < 1 << sub; k++) requireAudio(b.read(8) <= codebooks);
      }
      b.skip(2);
      const rangeBits = b.read(4);
      for (const partition of partitions)
        b.skip(classes[partition] * rangeBits);
    } else throw new InvalidAudio();
  }
  const residues = b.read(6) + 1;
  for (let i = 0; i < residues; i++) {
    requireAudio(b.read(16) <= 2);
    b.skip(72);
    const classifications = b.read(6) + 1;
    requireAudio(b.read(8) < codebooks);
    const cascades = Array.from({ length: classifications }, () => {
      const low = b.read(3);
      return low | ((b.read(1) === 1 ? b.read(5) : 0) << 3);
    });
    for (const cascade of cascades)
      for (let k = 0; k < 8; k++)
        if ((cascade & (1 << k)) !== 0) requireAudio(b.read(8) < codebooks);
  }
  const mappings = b.read(6) + 1;
  for (let i = 0; i < mappings; i++) {
    requireAudio(b.read(16) === 0);
    const submaps = b.read(1) === 1 ? b.read(4) + 1 : 1;
    if (b.read(1) === 1) {
      const count = b.read(8) + 1;
      for (let j = 0; j < count; j++) {
        const magnitude = b.read(ilog(channels - 1)),
          angle = b.read(ilog(channels - 1));
        requireAudio(
          magnitude !== angle && magnitude < channels && angle < channels,
        );
      }
    }
    requireAudio(b.read(2) === 0);
    if (submaps > 1)
      for (let j = 0; j < channels; j++) requireAudio(b.read(4) < submaps);
    for (let j = 0; j < submaps; j++) {
      b.skip(8);
      requireAudio(b.read(8) < floors && b.read(8) < residues);
    }
  }
  const modes = Array.from({ length: b.read(6) + 1 }, () => {
    const block = b.read(1) !== 0;
    requireAudio(b.read(16) === 0 && b.read(16) === 0 && b.read(8) < mappings);
    return block;
  });
  requireAudio(b.read(1) === 1);
  return modes;
}
/** All streams except the last have a self-delimited final frame length. */
export function opusPacketFrames(
  size: number,
  streams: number,
  byte: (index: number) => number,
): number {
  let pos = 0,
    duration = 0;
  for (let stream = 0; stream < streams; stream++) {
    const toc = byte(pos++),
      configuration = toc >>> 3,
      frameSamples =
        configuration >= 16
          ? 120 << (configuration & 3)
          : configuration >= 12
            ? 480 << (configuration & 1)
            : (configuration & 3) === 3
              ? 2880
              : 480 << (configuration & 3),
      code = toc & 3;
    let count = code === 0 ? 1 : 2,
      vbr = code === 2,
      padding = 0;
    if (code === 3) {
      const control = byte(pos++);
      count = control & 63;
      vbr = (control & 128) !== 0;
      requireAudio(count >= 1 && count <= 48);
      if ((control & 64) !== 0) {
        let next: number;
        do {
          next = byte(pos++);
          padding = add(padding, next === 255 ? 254 : next);
          requireAudio(padding <= size - pos);
        } while (next === 255);
      }
    }
    requireAudio(frameSamples * count <= 5760);
    const samples = frameSamples * count;
    requireAudio(duration === 0 || duration === samples);
    duration = samples;
    const length = () => {
      const first = byte(pos++);
      return first < 252 ? first : first + 4 * byte(pos++);
    };
    let known = 0;
    if (vbr) for (let i = 0; i < count - 1; i++) known = add(known, length());
    let payload: number;
    if (stream < streams - 1) {
      const last = length();
      payload = vbr ? add(known, last) : multiply(count, last);
    } else {
      requireAudio(pos <= size && padding <= size - pos);
      const available = size - pos - padding;
      requireAudio(
        vbr
          ? known <= available && available - known <= 1275
          : available % count === 0 && available / count <= 1275,
      );
      payload = available;
    }
    requireAudio(
      pos <= size && padding <= size - pos && payload <= size - pos - padding,
    );
    pos += payload + padding;
  }
  requireAudio(pos === size);
  return duration;
}
