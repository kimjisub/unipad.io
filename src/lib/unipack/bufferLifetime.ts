/** Discard exclusively owned bytes without waiting for garbage collection. */
export function releaseArrayBuffer(bytes: ArrayBuffer): void {
  // Older browsers keep the existing garbage-collected lifetime.
  if (bytes.byteLength > 0 && typeof bytes.transfer === 'function') bytes.transfer(0);
}
