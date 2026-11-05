// Includes the longest ZIP comment and matches the iOS importer's footer window.
const ZIP_FOOTER_BYTES = 66_000;

/** A cheap rejection check, not archive validation: the parser still checks any matching file. */
export async function hasZipEndRecord(file: Blob): Promise<boolean> {
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - ZIP_FOOTER_BYTES)).arrayBuffer());
  for (let offset = tail.length - 4; offset >= 0; offset--) {
    if (tail[offset] === 0x50 && tail[offset + 1] === 0x4b
      && tail[offset + 2] === 0x05 && tail[offset + 3] === 0x06) return true;
  }
  return false;
}
