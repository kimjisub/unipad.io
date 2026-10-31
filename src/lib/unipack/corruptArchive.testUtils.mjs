import JSZip from 'jszip';

/** Damage only the compressed sound payload, leaving the archive directory readable. */
export async function corruptSoundArchive(keySound = '1 1 1 a.wav\n1 1 2 a.wav') {
  const zip = new JSZip();
  zip.file('info', 'title=Damaged\nproducerName=Tests\nbuttonX=2\nbuttonY=2\nchain=1');
  zip.file('keySound', keySound);
  const sound = new Uint8Array(16384);
  let seed = 12345;
  for (let i = 0; i < sound.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    sound[i] = seed & 255;
  }
  zip.file('sounds/a.wav', sound);
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  const data = new Uint8Array(bytes);
  const view = new DataView(bytes);
  for (let at = 0; at + 30 < data.length; at++) {
    if (view.getUint32(at, true) !== 0x04034b50) continue;
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(data.subarray(at + 30, at + 30 + nameLength));
    if (name !== 'sounds/a.wav') continue;
    const start = at + 30 + nameLength + view.getUint16(at + 28, true);
    data.fill(0, start, start + 64);
    return bytes;
  }
  throw new Error('Sound payload not found');
}
