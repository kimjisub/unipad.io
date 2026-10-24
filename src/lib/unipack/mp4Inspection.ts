import type { AudioFacts } from './audioSafety';
import {
  AAC_SAMPLE_RATES,
  AudioBits,
  AudioData,
  InvalidAudio,
  add,
  bigAdd,
  bigMultiply,
  capacity,
  multiply,
  requireAudio,
} from './audioData';
import { inspectFlacFrames } from './flacInspection';
import { opusPacketFrames } from './oggInspection';
interface Box {
  type: string;
  data: number;
  end: number;
}
const MAX_BOXES = 4096,
  MAX_ROWS = 262144,
  MAX_SIZES = 1048576;
function boxes(d: AudioData, from: number, end: number): Box[] {
  const result: Box[] = [];
  let at = from;
  while (at < end) {
    capacity(result.length + 1, MAX_BOXES);
    d.range(at, 8, end);
    const small = d.uint(at, 4),
      header = small === 1 ? 16 : 8;
    d.range(at, header, end);
    const size =
      small === 0 ? end - at : small === 1 ? d.uint(at + 8, 8) : small;
    requireAudio(size >= header);
    d.range(at, size, end);
    const type = String.fromCharCode(
      d.byte(at + 4),
      d.byte(at + 5),
      d.byte(at + 6),
      d.byte(at + 7),
    );
    result.push({ type, data: at + header, end: at + size });
    at += size;
  }
  return result;
}
function child(d: AudioData, parent: Box, type: string): Box {
  const found = boxes(d, parent.data, parent.end).filter(b => b.type === type);
  requireAudio(found.length === 1);
  return found[0];
}
function tableCount(d: AudioData, box: Box, stride: number): number {
  d.range(box.data, 8, box.end);
  const count = d.uint(box.data + 4, 4);
  d.range(box.data + 8, multiply(count, stride), box.end);
  capacity(count, MAX_ROWS);
  return count;
}
interface Codec {
  type: string;
  rate: number;
  channels: number;
  aacFrames: number | null;
  alacFrames: number;
  precision: number;
  opusStreams: number;
  pcmAlign: number;
}
function codec(d: AudioData, entry: Box): Codec {
  requireAudio(
    ['mp4a', 'alac', 'fLaC', 'Opus', 'sowt', 'twos', 'lpcm'].includes(
      entry.type,
    ),
  );
  d.range(entry.data, 28, entry.end);
  const version = d.uint(entry.data + 8, 2);
  requireAudio(version <= 1);
  const headerSize = version === 1 ? 44 : 28;
  d.range(entry.data, headerSize, entry.end);
  const children = {
    type: 'entry',
    data: entry.data + headerSize,
    end: entry.end,
  };
  let channels = d.uint(entry.data + 16, 2),
    rate = d.uint(entry.data + 24, 4) >>> 16;
  const result: Codec = {
    type: entry.type,
    rate,
    channels,
    aacFrames: null,
    alacFrames: 0,
    precision: 0,
    opusStreams: 0,
    pcmAlign: 0,
  };
  if (entry.type === 'mp4a') {
    const items = boxes(d, children.data, children.end),
      direct = items.filter(b => b.type === 'esds'),
      wave = items.filter(b => b.type === 'wave');
    const esds =
      direct.length === 1
        ? direct[0]
        : wave.length === 1
          ? child(d, wave[0], 'esds')
          : null;
    requireAudio(esds);
    const config = aacConfig(d, esds);
    rate = config.rate;
    if (config.channels !== 0) channels = config.channels;
    result.rate = rate;
    result.channels = channels;
    result.aacFrames = config.packetFrames;
  } else if (entry.type === 'alac') {
    const c = child(d, children, 'alac');
    d.range(c.data, 28, c.end);
    const frames = d.uint(c.data + 4, 4);
    requireAudio(frames > 0);
    result.rate = d.uint(c.data + 24, 4);
    result.channels = d.byte(c.data + 13);
    result.alacFrames = frames;
  } else if (entry.type === 'fLaC') {
    const c = child(d, children, 'dfLa');
    d.range(c.data, 42, c.end);
    requireAudio(
      d.uint(c.data, 4) === 0 &&
        (d.byte(c.data + 4) & 127) === 0 &&
        d.uint(c.data + 5, 3) === 34,
    );
    const info = c.data + 8;
    result.rate = d.uint(info + 10, 3) >>> 4;
    result.channels = ((d.byte(info + 12) >>> 1) & 7) + 1;
    result.precision =
      (((d.byte(info + 12) & 1) << 4) | (d.byte(info + 13) >>> 4)) + 1;
  } else if (entry.type === 'Opus') {
    const c = child(d, children, 'dOps');
    d.range(c.data, 11, c.end);
    requireAudio(d.byte(c.data) === 0);
    channels = d.byte(c.data + 1);
    const family = d.byte(c.data + 10);
    let streams = 1;
    if (family === 0) requireAudio(channels >= 1 && channels <= 2);
    else {
      d.range(c.data, 13 + channels, c.end);
      streams = d.byte(c.data + 11);
      const coupled = d.byte(c.data + 12);
      requireAudio(
        streams > 0 && coupled <= streams && streams + coupled <= 255,
      );
      for (let i = 0; i < channels; i++) {
        const mapping = d.byte(c.data + 13 + i);
        requireAudio(mapping === 255 || mapping < streams + coupled);
      }
    }
    result.rate = 48000;
    result.channels = channels;
    result.opusStreams = streams;
  } else {
    const bits = d.uint(entry.data + 18, 2);
    requireAudio(
      bits >= 8 &&
        bits <= 64 &&
        bits % 8 === 0 &&
        channels >= 1 &&
        channels <= 8,
    );
    const align = channels * (bits / 8);
    if (version === 1)
      requireAudio(
        d.uint(entry.data + 32, 4) === bits / 8 &&
          d.uint(entry.data + 36, 4) === align,
      );
    result.pcmAlign = align;
  }
  requireAudio(result.rate > 0 && result.channels > 0);
  return result;
}
/** Validate every sample extent and reserve physical output independently of container timestamps. */
export function inspectMp4(d: AudioData): AudioFacts {
  const top = boxes(d, 0, d.size),
    media = top.filter(b => b.type === 'mdat'),
    movies = top.filter(b => b.type === 'moov');
  requireAudio(media.length > 0 && movies.length === 1);
  for (const track of boxes(d, movies[0].data, movies[0].end).filter(
    b => b.type === 'trak',
  )) {
    const mdia = child(d, track, 'mdia'),
      handler = child(d, mdia, 'hdlr');
    d.range(handler.data, 12, handler.end);
    if (!d.matches(handler.data + 8, 'soun')) continue;
    const mdhd = child(d, mdia, 'mdhd'),
      version = d.byte(mdhd.data);
    requireAudio(version <= 1);
    const clockOffset = version === 0 ? 12 : 20;
    d.range(mdhd.data, clockOffset + 4, mdhd.end);
    const clock = BigInt(d.uint(mdhd.data + clockOffset, 4));
    requireAudio(clock > BigInt(0));
    const stbl = child(d, child(d, mdia, 'minf'), 'stbl'),
      stsd = child(d, stbl, 'stsd');
    d.range(stsd.data, 8, stsd.end);
    const entries = boxes(d, stsd.data + 8, stsd.end);
    requireAudio(
      entries.length === d.uint(stsd.data + 4, 4) && entries.length > 0,
    );
    const codecs = entries.map(e => codec(d, e)),
      c = codecs[0];
    requireAudio(
      codecs.every(other =>
        Object.keys(c).every(
          key => c[key as keyof Codec] === other[key as keyof Codec],
        ),
      ),
    );
    const { rate, channels, aacFrames } = c,
      stts = child(d, stbl, 'stts'),
      timeCount = tableCount(d, stts, 8);
    let samples = 0,
      ticks = BigInt(0),
      verifiedFrames = BigInt(0);
    for (let i = 0; i < timeCount; i++) {
      const at = stts.data + 8 + i * 8,
        count = d.uint(at, 4),
        delta = d.uint(at + 4, 4);
      requireAudio(count > 0);
      const zeroFirst =
        i === 0 && count === 1 && delta === 0 && aacFrames !== null;
      requireAudio(delta > 0 || zeroFirst);
      samples = add(samples, count);
      ticks = bigAdd(ticks, bigMultiply(BigInt(count), BigInt(delta)));
      if (aacFrames !== null) {
        const actual = bigMultiply(BigInt(delta), BigInt(rate)),
          full = bigMultiply(BigInt(aacFrames), clock),
          partialLast =
            !zeroFirst && i === timeCount - 1 && count === 1 && actual < full;
        requireAudio(
          zeroFirst ||
            partialLast ||
            (actual >= full ? actual - full : full - actual) < BigInt(rate),
        );
        const frames = partialLast
          ? actual / clock +
            (actual % clock === BigInt(0) ? BigInt(0) : BigInt(1))
          : BigInt(aacFrames);
        verifiedFrames = bigAdd(
          verifiedFrames,
          bigMultiply(BigInt(count), frames),
        );
      }
    }
    const stsz = child(d, stbl, 'stsz');
    d.range(stsz.data, 12, stsz.end);
    const constantSize = d.uint(stsz.data + 4, 4),
      sizeCount = d.uint(stsz.data + 8, 4);
    requireAudio(sizeCount === samples && samples > 0);
    if (constantSize === 0) {
      capacity(sizeCount, MAX_SIZES);
      d.range(stsz.data + 12, multiply(sizeCount, 4), stsz.end);
    }
    const offsets = boxes(d, stbl.data, stbl.end).filter(
      b => b.type === 'stco' || b.type === 'co64',
    );
    requireAudio(offsets.length === 1);
    const offsetBox = offsets[0],
      width = offsetBox.type === 'co64' ? 8 : 4,
      chunks = tableCount(d, offsetBox, width),
      stsc = child(d, stbl, 'stsc'),
      mappings = tableCount(d, stsc, 12);
    requireAudio(chunks > 0 && mappings > 0);
    if (c.pcmAlign === 0 && aacFrames === null) capacity(samples, MAX_SIZES);
    let physicalFrames = BigInt(0),
      mapping = 0,
      used = 0;
    // Bounded primitive arrays avoid one object per file-controlled chunk.
    const starts = new Float64Array(chunks),
      ends = new Float64Array(chunks);
    let nextFirst = mappings > 1 ? d.uint(stsc.data + 20, 4) : chunks + 1;
    requireAudio(d.uint(stsc.data + 8, 4) === 1);
    for (let chunk = 1; chunk <= chunks; chunk++) {
      if (chunk === nextFirst) {
        mapping++;
        nextFirst =
          mapping + 1 < mappings
            ? d.uint(stsc.data + 8 + (mapping + 1) * 12, 4)
            : chunks + 1;
      }
      requireAudio(nextFirst > chunk && nextFirst <= chunks + 1);
      const row = stsc.data + 8 + mapping * 12,
        count = d.uint(row + 4, 4),
        description = d.uint(row + 8, 4);
      requireAudio(
        count > 0 &&
          count <= samples - used &&
          description >= 1 &&
          description <= entries.length,
      );
      let bytes = 0;
      if (constantSize !== 0) bytes = multiply(count, constantSize);
      else
        for (let sample = used; sample < used + count; sample++) {
          const size = d.uint(stsz.data + 12 + sample * 4, 4);
          requireAudio(size > 0);
          bytes = add(bytes, size);
        }
      const offset = d.uint(offsetBox.data + 8 + (chunk - 1) * width, width);
      let low = 0,
        high = media.length - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (media[middle].data <= offset) low = middle + 1;
        else high = middle - 1;
      }
      requireAudio(high >= 0);
      const extent = media[high];
      requireAudio(offset <= extent.end && bytes <= extent.end - offset);
      if (c.pcmAlign !== 0) {
        requireAudio(bytes % c.pcmAlign === 0);
        physicalFrames = bigAdd(physicalFrames, BigInt(bytes / c.pcmAlign));
      } else if (aacFrames === null) {
        let packetAt = offset;
        for (let sample = used; sample < used + count; sample++) {
          const size =
            constantSize !== 0
              ? constantSize
              : d.uint(stsz.data + 12 + sample * 4, 4);
          let frames: number;
          if (c.type === 'alac')
            frames = alacFrames(d, packetAt, size, c.alacFrames);
          else if (c.type === 'fLaC')
            frames = inspectFlacFrames(
              d,
              packetAt,
              packetAt + size,
              rate,
              channels,
              c.precision,
            );
          else if (c.type === 'Opus')
            frames = opusPacketFrames(size, c.opusStreams, index => {
              requireAudio(index >= 0 && index < size);
              return d.byte(packetAt + index);
            });
          else throw new InvalidAudio();
          physicalFrames = bigAdd(physicalFrames, BigInt(frames));
          packetAt += size;
        }
      }
      starts[chunk - 1] = offset;
      ends[chunk - 1] = offset + bytes;
      used += count;
    }
    requireAudio(used === samples && mapping + 1 === mappings);
    starts.sort();
    ends.sort();
    for (let i = 1; i < starts.length; i++)
      requireAudio(starts[i] >= ends[i - 1]);
    const numerator = bigMultiply(ticks, BigInt(rate)),
      timeline =
        numerator / clock +
        (numerator % clock === BigInt(0) ? BigInt(0) : BigInt(1));
    return {
      sampleRate: rate,
      channels,
      frames:
        aacFrames !== null
          ? verifiedFrames
          : physicalFrames > timeline
            ? physicalFrames
            : timeline,
      format: 'm4a',
    };
  }
  throw new InvalidAudio();
}
function alacFrames(
  d: AudioData,
  at: number,
  size: number,
  maximum: number,
): number {
  const b = new AudioBits(multiply(size, 8), false, index =>
    d.byte(at + index),
  );
  requireAudio([0, 1, 3].includes(b.read(3)));
  b.skip(16);
  const explicit = b.read(1) !== 0;
  b.skip(3);
  const frames = explicit ? b.read(32) : maximum;
  requireAudio(frames >= 1 && frames <= maximum);
  return frames;
}
function aacConfig(
  d: AudioData,
  box: Box,
): { rate: number; channels: number; packetFrames: number } {
  function descriptor(
    at: number,
    end: number,
  ): { tag: number; data: number; end: number } {
    d.range(at, 2, end);
    const tag = d.byte(at);
    let pos = at + 1,
      length = 0,
      done = false;
    for (let i = 0; i < 4 && !done; i++) {
      d.range(pos, 1, end);
      const b = d.byte(pos++);
      length = length * 128 + (b & 127);
      if ((b & 128) === 0) done = true;
    }
    requireAudio(done);
    d.range(pos, length, end);
    return { tag, data: pos, end: pos + length };
  }
  const es = descriptor(box.data + 4, box.end);
  requireAudio(es.tag === 3);
  d.range(es.data, 3, es.end);
  const flags = d.byte(es.data + 2);
  let pos = es.data + 3;
  if ((flags & 128) !== 0) pos += 2;
  if ((flags & 64) !== 0) {
    d.range(pos, 1, es.end);
    pos += 1 + d.byte(pos);
  }
  if ((flags & 32) !== 0) pos += 2;
  const decoder = descriptor(pos, es.end);
  requireAudio(decoder.tag === 4);
  d.range(decoder.data, 13, decoder.end);
  const config = descriptor(decoder.data + 13, decoder.end);
  requireAudio(config.tag === 5);
  const b = new AudioBits((config.end - config.data) * 8, false, index =>
    d.byte(config.data + index),
  );
  const objectType = () => {
    const type = b.read(5);
    return type === 31 ? 32 + b.read(6) : type;
  };
  const frequency = () => {
    const index = b.read(4);
    if (index === 15) return b.read(24);
    requireAudio(index < AAC_SAMPLE_RATES.length);
    return AAC_SAMPLE_RATES[index];
  };
  let type = objectType(),
    rate = frequency();
  const coreRate = rate,
    configuration = b.read(4);
  requireAudio(configuration <= 7);
  let channels = configuration === 7 ? 8 : configuration;
  if (type === 5 || type === 29) {
    const stereo = type === 29;
    rate = frequency();
    type = objectType();
    if (stereo && channels === 1) channels = 2;
  }
  const short = b.read(1) !== 0,
    baseFrames =
      type === 23 || type === 39 ? (short ? 480 : 512) : short ? 960 : 1024;
  if (type >= 1 && type <= 4 && configuration !== 0) {
    if (b.read(1) !== 0) b.skip(14);
    const extension = b.read(1);
    if (extension === 0 && b.position + 16 <= (config.end - config.data) * 8) {
      if (b.read(11) === 0x2b7 && objectType() === 5 && b.read(1) !== 0) {
        rate = frequency();
        if (
          b.position + 12 <= (config.end - config.data) * 8 &&
          b.read(11) === 0x548 &&
          b.read(1) !== 0 &&
          channels === 1
        )
          channels = 2;
      }
    }
  }
  requireAudio(
    coreRate > 0 &&
      rate % coreRate === 0 &&
      rate / coreRate >= 1 &&
      rate / coreRate <= 2,
  );
  return { rate, channels, packetFrames: baseFrames * (rate / coreRate) };
}
