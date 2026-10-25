const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * JSZip bypasses decodeFileName for UTF-8-marked entries. Some older archivers set that flag on
 * CP949 names too. Clear only those invalid marks in a private copy of the central directory so
 * JSZip can use our UTF-8/CP949 decoder. File data, offsets and the caller's saved bytes stay intact.
 * Unsupported or malformed directory structures are left for JSZip to validate.
 */
export function repairArchiveNameFlags(data: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0) return data;
  let directoryEnd = end;
  let directorySize = u32(end + 12);
  if (directorySize === 0xffffffff || u32(end + 16) === 0xffffffff || u16(end + 10) === 0xffff) {
    // ZIP64 has its own end record before the 20-byte locator. Locate it by its declared length,
    // which also works when a self-extracting archive has bytes prepended to every ZIP offset.
    const locator = end - 20;
    if (locator < 0 || u32(locator) !== 0x07064b50) return data;
    let zip64 = -1;
    for (let at = locator - 56; at >= Math.max(0, locator - 65535); at--) {
      if (u32(at) === 0x06064b50 && BigInt(at + 12) + view.getBigUint64(at + 4, true) === BigInt(locator)) { zip64 = at; break; }
    }
    if (zip64 < 0) return data;
    directoryEnd = zip64;
    directorySize = Number(view.getBigUint64(zip64 + 40, true));
  }
  const start = directoryEnd - directorySize;
  if (!Number.isSafeInteger(start) || start < 0) return data;
  const flags: number[] = [];
  let at = start;
  while (at < directoryEnd) {
    if (at + 46 > directoryEnd || u32(at) !== 0x02014b50) return data;
    const nameEnd = at + 46 + u16(at + 28);
    const next = nameEnd + u16(at + 30) + u16(at + 32);
    if (next > directoryEnd) return data;
    if (u16(at + 8) & 0x800) {
      try { STRICT_UTF8.decode(bytes.subarray(at + 46, nameEnd)); }
      catch { flags.push(at + 8); }
    }
    at = next;
  }
  if (!flags.length) return data;
  const repaired = data.slice(0);
  const patched = new DataView(repaired);
  for (const offset of flags) patched.setUint16(offset, u16(offset) & ~0x800, true);
  return repaired;
}
