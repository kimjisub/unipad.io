import type { AudioFacts, AudioInspection } from './audioSafety';
import {
  AAC_SAMPLE_RATES,
  AudioData,
  AudioReadLimit,
  InvalidAudio,
  add,
  requireAudio,
} from './audioData';
import { inspectOgg } from './oggInspection';
import { inspectFlac } from './flacInspection';
import { inspectMp4 } from './mp4Inspection';

/** Inspect actual file contents before native decoding; filename and advertised duration are irrelevant. */
export function inspectAudio(input: Uint8Array | ArrayBuffer): AudioInspection {
  try {
    const d = new AudioData(input);
    let facts: AudioFacts;
    if (d.matches(0, 'RIFF')) facts = inspectWave(d);
    else if (d.matches(0, 'OggS')) facts = inspectOgg(d);
    else if (d.matches(0, 'fLaC')) facts = inspectFlac(d);
    else if (['ftyp', 'moov', 'mdat'].some(t => d.matches(4, t)))
      facts = inspectMp4(d);
    else {
      try {
        facts = inspectMpeg(d);
      } catch (error) {
        if (!(error instanceof InvalidAudio)) throw error;
        facts = inspectMp4(d);
      }
    }
    return { exclusion: null, facts };
  } catch (error) {
    if (error instanceof InvalidAudio) return { exclusion: 'INVALID_FORMAT' };
    if (error instanceof AudioReadLimit || error instanceof RangeError)
      return { exclusion: 'READ_FAILURE' };
    throw error;
  }
}
function inspectWave(d: AudioData): AudioFacts {
  requireAudio(d.matches(8, 'WAVE'));
  let at = 12,
    rate = 0,
    channels = 0,
    align = 0,
    encoding = 0,
    compressedFrames = BigInt(0),
    dataBytes = 0;
  let foundData = false,
    foundFormat = false;
  while (at < d.size) {
    if (d.size - at < 8 && foundFormat && foundData) break;
    d.range(at, 8);
    const length = d.uint(at + 4, 4, true),
      payload = at + 8,
      available = Math.min(length, d.size - payload);
    const isData = d.matches(at, 'data');
    if (available < length && !isData && foundFormat && foundData) break;
    if (!isData) d.range(payload, length);
    if (d.matches(at, 'fmt ')) {
      requireAudio(!foundFormat && length >= 16);
      foundFormat = true;
      encoding = d.uint(payload, 2, true);
      channels = d.uint(payload + 2, 2, true);
      rate = d.uint(payload + 4, 4, true);
      align = d.uint(payload + 12, 2, true);
      const bits = d.uint(payload + 14, 2, true);
      if (encoding === 0xfffe) {
        requireAudio(length >= 40 && d.uint(payload + 16, 2, true) >= 22);
        encoding = d.uint(payload + 24, 2, true);
        requireAudio(
          d.uint(payload + 26, 2, true) === 0 &&
            d.uint(payload + 28, 4, true) === 0x00100000 &&
            d.uint(payload + 32, 4) === 0x800000aa &&
            d.uint(payload + 36, 4) === 0x00389b71,
        );
      }
      requireAudio(
        [1, 3, 85].includes(encoding) && channels > 0 && rate > 0 && align > 0,
      );
      if (encoding !== 85) {
        requireAudio(
          bits >= 8 &&
            bits <= 64 &&
            bits % 8 === 0 &&
            (encoding !== 3 || bits === 32 || bits === 64),
        );
        requireAudio(align === channels * (bits / 8));
      }
    } else if (isData) {
      foundData = true;
      requireAudio(align > 0);
      if (encoding === 85) {
        const facts = inspectMpeg(d, payload, payload + available);
        requireAudio(
          facts.format === 'mp3' &&
            facts.sampleRate === rate &&
            facts.channels === channels,
        );
        compressedFrames += facts.frames;
      } else dataBytes = add(dataBytes, available - (available % align));
    }
    const padded = add(length, length % 2);
    if (padded > d.size - payload) break;
    at = payload + padded;
  }
  requireAudio(
    foundFormat && foundData && align > 0 && dataBytes % align === 0,
  );
  return {
    sampleRate: rate,
    channels,
    frames: encoding === 85 ? compressedFrames : BigInt(dataBytes / align),
    format: 'wav',
  };
}
function mpegEnd(d: AudioData, start: number, end: number): number {
  let tail = end;
  while (true) {
    if (tail - start >= 128 && d.matches(tail - 128, 'TAG')) {
      tail -= 128;
      continue;
    }
    if (tail - start < 32 || !d.matches(tail - 32, 'APETAGEX')) return tail;
    const before = tail;
    try {
      const footer = tail - 32,
        version = d.uint(footer + 8, 4, true),
        length = d.uint(footer + 12, 4, true),
        count = d.uint(footer + 16, 4, true),
        flags = d.uint(footer + 20, 4, true);
      requireAudio(
        (version === 1000 || version === 2000) &&
          length >= 32 &&
          length <= tail - start &&
          (flags & 0x20000000) === 0 &&
          d.uint(footer + 24, 8) === 0,
      );
      const body = tail - length;
      let first = body;
      if ((flags & 0x80000000) !== 0) {
        requireAudio(body - start >= 32);
        first -= 32;
        requireAudio(
          d.matches(first, 'APETAGEX') &&
            d.uint(first + 8, 4, true) === version &&
            d.uint(first + 12, 4, true) === length &&
            d.uint(first + 16, 4, true) === count &&
            (d.uint(first + 20, 4, true) & 0x20000000) !== 0,
        );
      }
      requireAudio(count <= (footer - body) / 10);
      let at = body;
      for (let i = 0; i < count; i++) {
        d.range(at, 8, footer);
        const size = d.uint(at, 4, true),
          itemFlags = d.uint(at + 4, 4, true);
        requireAudio(itemFlags <= 5);
        at += 8;
        let keyLength = 0;
        while (true) {
          d.range(at, 1, footer);
          const value = d.byte(at++);
          if (value === 0) break;
          requireAudio(
            value >= 32 && value <= 126 && value !== 61 && ++keyLength <= 255,
          );
        }
        requireAudio(keyLength > 0);
        d.range(at, size, footer);
        at += size;
      }
      requireAudio(at === footer);
      tail = first;
    } catch (error) {
      if (!(error instanceof InvalidAudio)) throw error;
      tail = before;
    }
    if (tail === before) return tail;
  }
}
interface MpegFrame {
  rate: number;
  channels: number;
  samples: number;
  bytes: number;
  version: number;
  layer: number;
}
function sameStream(a: MpegFrame, b: MpegFrame): boolean {
  return (
    a.rate === b.rate &&
    a.channels === b.channels &&
    a.version === b.version &&
    a.layer === b.layer
  );
}
function mpegFrame(d: AudioData, at: number, end: number): MpegFrame | null {
  if (at < 0 || at > end || end - at < 4) return null;
  const h = d.uint(at, 4);
  if (h >>> 21 !== 0x7ff) return null;
  const version = (h >>> 19) & 3,
    layer = (h >>> 17) & 3,
    index = (h >>> 12) & 15,
    rateIndex = (h >>> 10) & 3;
  if (version === 1 || layer === 0 || index < 1 || index > 14 || rateIndex >= 3)
    return null;
  const rate =
      [44100, 48000, 32000][rateIndex] /
      (version === 3 ? 1 : version === 2 ? 2 : 4),
    channels = ((h >>> 6) & 3) === 3 ? 1 : 2;
  const rates =
    version === 3 && layer === 3
      ? [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448]
      : version === 3 && layer === 2
        ? [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
        : version === 3
          ? [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
          : layer === 3
            ? [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256]
            : [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const bitrate = rates[index - 1],
    padding = (h >>> 9) & 1,
    samples = layer === 3 ? 384 : layer === 1 && version !== 3 ? 576 : 1152;
  const bytes =
    layer === 3
      ? (Math.floor((12000 * bitrate) / rate) + padding) * 4
      : Math.floor(((samples === 576 ? 72000 : 144000) * bitrate) / rate) +
        padding;
  return { rate, channels, samples, bytes, version, layer };
}
function inspectMpeg(d: AudioData, start = 0, payloadEnd = d.size): AudioFacts {
  const end = mpegEnd(d, start, payloadEnd);
  let at = start;
  while (at < end) {
    if (d.byte(at) === 0) {
      at++;
      continue;
    }
    if (end - at < 3 || !d.matches(at, 'ID3')) break;
    d.range(at, 10, end);
    requireAudio(d.byte(at + 3) >= 2 && d.byte(at + 3) <= 4);
    let length = 0;
    for (let i = 6; i <= 9; i++) {
      const b = d.byte(at + i);
      requireAudio(b < 128);
      length = length * 128 + b;
    }
    const footer = d.byte(at + 3) === 4 && (d.byte(at + 5) & 16) !== 0 ? 10 : 0,
      size = add(length, 10 + footer);
    d.range(at, size, end);
    at += size;
  }
  if (end - at >= 2 && d.byte(at) === 255 && (d.byte(at + 1) & 0xf6) === 0xf0)
    return inspectAdts(d, at, end);
  let probes = Math.min(1048576, Math.max(4096, (end - start) * 4));
  const frameAt = (position: number) => {
    if (probes-- <= 0) throw new AudioReadLimit();
    return mpegFrame(d, position, end);
  };
  const first = frameAt(at);
  requireAudio(first && first.bytes <= end - at);
  let anchorAt = at,
    anchor: MpegFrame | null = null;
  while (anchorAt < end) {
    const candidate = frameAt(anchorAt);
    if (candidate && candidate.bytes <= end - anchorAt) {
      const nextAt = anchorAt + candidate.bytes,
        next = frameAt(nextAt);
      if (nextAt === end || (next && sameStream(candidate, next))) {
        anchor = candidate;
        break;
      }
    }
    anchorAt++;
  }
  if (!anchor) {
    anchor = first;
    anchorAt = at;
  }
  const layout = anchor;
  let frames = BigInt(0),
    stream = layout;
  while (at < end) {
    const frame = frameAt(at);
    if (at < anchorAt) {
      if (
        frame &&
        frames > BigInt(0) &&
        !sameStream(layout, frame) &&
        frame.bytes <= end - at &&
        frame.bytes > anchorAt - at
      )
        throw new InvalidAudio();
      if (frame && sameStream(layout, frame) && frame.bytes <= anchorAt - at) {
        frames += BigInt(frame.samples);
        at += frame.bytes;
      } else at++;
      continue;
    }
    if (!frame || frame.bytes > end - at) {
      at++;
      continue;
    }
    const nextAt = at + frame.bytes,
      next = frameAt(nextAt),
      continuous = nextAt === end || (!!next && sameStream(frame, next));
    if (!continuous)
      for (let inside = at + 4; inside < nextAt; inside++) {
        const candidate = frameAt(inside);
        if (
          candidate &&
          sameStream(stream, candidate) &&
          candidate.bytes <= end - inside
        ) {
          const followingAt = inside + candidate.bytes,
            following = frameAt(followingAt);
          requireAudio(
            followingAt !== end &&
              (!following || !sameStream(candidate, following)),
          );
        }
      }
    if (!sameStream(stream, frame)) {
      requireAudio(!continuous);
      at++;
      continue;
    }
    frames += BigInt(frame.samples);
    stream = frame;
    at = nextAt;
  }
  requireAudio(frames > BigInt(0));
  return {
    sampleRate: stream.rate,
    channels: stream.channels,
    frames,
    format: 'mp3',
  };
}
function inspectAdts(d: AudioData, start: number, end: number): AudioFacts {
  let at = start,
    frames = BigInt(0),
    rate = 0,
    channels = 0;
  while (at < end) {
    d.range(at, 7, end);
    requireAudio(d.byte(at) === 255 && (d.byte(at + 1) & 0xf6) === 0xf0);
    const index = (d.byte(at + 2) >>> 2) & 15;
    requireAudio(index < AAC_SAMPLE_RATES.length);
    const r = AAC_SAMPLE_RATES[index],
      configuration = ((d.byte(at + 2) & 1) << 2) | (d.byte(at + 3) >>> 6),
      c = configuration === 7 ? 8 : configuration;
    requireAudio(c > 0 && (rate === 0 || (rate === r && channels === c)));
    const length =
      ((d.byte(at + 3) & 3) << 11) |
      (d.byte(at + 4) << 3) |
      (d.byte(at + 5) >>> 5);
    requireAudio(length >= ((d.byte(at + 1) & 1) === 1 ? 7 : 9));
    d.range(at, length, end);
    frames += BigInt(1024) * BigInt((d.byte(at + 6) & 3) + 1);
    rate = r;
    channels = c;
    at += length;
  }
  requireAudio(frames > BigInt(0));
  return { sampleRate: rate, channels, frames, format: 'aac' };
}
