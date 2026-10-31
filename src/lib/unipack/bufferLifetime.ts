/** Discard exclusively owned bytes without waiting for garbage collection, when supported. */
export function releaseArrayBuffer(bytes: ArrayBuffer): void {
  try {
    if (bytes.byteLength > 0 && typeof bytes.transfer === 'function') bytes.transfer(0);
  } catch {
    // An unavailable or refused transfer must not turn a successful load into a failure.
  }
}
