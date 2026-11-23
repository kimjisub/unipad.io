export function updateOggChecksum(page: Buffer): void {
  page.fill(0, 22, 26);
  let crc = 0;
  for (const byte of page) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
  }
  page.writeUInt32LE(crc >>> 0, 22);
}

// Shift audio-page positions to model a leading discard, retaining valid Ogg CRCs.
export function shiftVorbisGranules(source: Uint8Array, frames: number): Buffer {
  const bytes = Buffer.from(source);
  for (let at = 0; at < bytes.length;) {
    const segments = bytes[at + 26];
    const size = 27 + segments + bytes.subarray(at + 27, at + 27 + segments).reduce((a, b) => a + b, 0);
    const granule = bytes.readBigUInt64LE(at + 6);
    if (granule > BigInt(0) && granule !== BigInt('0xffffffffffffffff')) {
      bytes.writeBigUInt64LE(granule - BigInt(frames), at + 6);
      updateOggChecksum(bytes.subarray(at, at + size));
    }
    at += size;
  }
  return bytes;
}
