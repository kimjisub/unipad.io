// The conformance input fingerprint: sha256 over the input files sorted by the UTF-8 bytes of their path;
// per file:
//   UTF8(path) 0x00 decimal(length) 0x00 bytes 0x0A
// The corpus builder (meta/unipack-conformance/lib.mjs), the real-pack tools and the web harness all
// use this one function; the Kotlin and Swift harnesses recompute the same formula. Plain Node runs this
// file with type stripping, so it uses erasable TypeScript syntax only.
import { createHash } from 'node:crypto';

/**
 * The input fingerprint over `{ path }` entries whose bytes `bytesOf` returns, one at a time, so a large
 * pack read from disk is never held in memory whole.
 */
export function fingerprintOf<T extends { path: string }>(entries: readonly T[], bytesOf: (entry: T) => Uint8Array): string {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  const hash = createHash('sha256');
  for (const entry of sorted) {
    const bytes = bytesOf(entry);
    hash.update(Buffer.concat([Buffer.from(entry.path, 'utf8'), Buffer.from([0]), Buffer.from(String(bytes.length), 'ascii'), Buffer.from([0])]));
    hash.update(bytes);
    hash.update(Buffer.from([10]));
  }
  return hash.digest('hex');
}
