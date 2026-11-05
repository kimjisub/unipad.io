import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { hasZipEndRecord } from './zipPreflight';

async function archive(comment = '') {
  const zip = new JSZip();
  zip.file('info', 'title=Test');
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', comment }));
}

test('accepts a normal archive', async () => {
  assert.equal(await hasZipEndRecord(new Blob([await archive()])), true);
});

test('accepts an archive with bytes before its first local header', async () => {
  assert.equal(await hasZipEndRecord(new Blob(['prefix', await archive()])), true);
});

test('accepts the maximum ZIP comment', async () => {
  assert.equal(await hasZipEndRecord(new Blob([await archive('a'.repeat(65_535))])), true);
});

test('rejects empty and zero-filled files', async () => {
  for (const bytes of [new Uint8Array(0), new Uint8Array(100_000)]) {
    assert.equal(await hasZipEndRecord(new Blob([bytes])), false);
  }
});

test('rejects a file that only starts with a local ZIP header', async () => {
  const bytes = new Uint8Array(100_000);
  bytes.set([0x50, 0x4b, 0x03, 0x04]);
  assert.equal(await hasZipEndRecord(new Blob([bytes])), false);
});

test('reads only the final 66,000 bytes, even for a large file', async () => {
  const file = new Blob([new Uint8Array(100_000)]);
  const slice = file.slice.bind(file);
  file.slice = (start, end) => {
    assert.equal(start, 34_000);
    assert.equal(end, undefined);
    return slice(start, end);
  };
  file.arrayBuffer = async () => { throw new Error('must not read the entire file'); };
  assert.equal(await hasZipEndRecord(file), false);
});

test('an incidental end signature is left to the archive parser', async () => {
  assert.equal(await hasZipEndRecord(new Blob([new Uint8Array([0x50, 0x4b, 0x05, 0x06])])), true);
});

test('propagates read failures so the caller can explain them', async () => {
  const file = new Blob();
  const error = new DOMException('Unreadable', 'NotReadableError');
  file.slice = () => {
    const tail = new Blob();
    tail.arrayBuffer = async () => { throw error; };
    return tail;
  };
  await assert.rejects(hasZipEndRecord(file), error);
});
