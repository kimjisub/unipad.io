import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repairArchiveNameFlags } from './archiveNames';
import { parseUniPack } from './parser';
import { INFO_2X2_2CHAIN, SILENT_WAV, rawNameZip } from './testUtils';

const encode = (s: string) => new TextEncoder().encode(s);
const brokenNamePack = () => rawNameZip([
  [encode('info'), INFO_2X2_2CHAIN], [encode('keySound'), '1 1 1 한.wav'],
  [new Uint8Array([...encode('sounds/'), 0xc7, 0xd1, ...encode('.wav')]), SILENT_WAV],
], true);

test('leaves valid UTF-8-marked archives and unmarked CP949 archives untouched', () => {
  for (const flag of [false, true]) {
    const data = rawNameZip([[encode('소리.wav'), SILENT_WAV]], flag);
    assert.equal(repairArchiveNameFlags(data), data);
  }
  const unmarked = rawNameZip([[new Uint8Array([0xc7, 0xd1]), SILENT_WAV]]);
  assert.equal(repairArchiveNameFlags(unmarked), unmarked);
});

test('truncated and malformed ZIP structures remain the ZIP reader\'s responsibility', () => {
  for (const data of [new ArrayBuffer(0), new ArrayBuffer(10), brokenNamePack().slice(0, -5)]) {
    assert.equal(repairArchiveNameFlags(data), data);
  }
  const malformed = brokenNamePack();
  new DataView(malformed).setUint32(malformed.byteLength - 22 + 12, 0xffffffff, true);
  assert.equal(repairArchiveNameFlags(malformed), malformed);
});

test('repairs invalid UTF-8 marks in a ZIP64 central directory, including a prepended stub', async () => {
  const original = brokenNamePack();
  const end = original.byteLength - 22;
  const old = new DataView(original);
  const data = new Uint8Array(original.byteLength + 56 + 20);
  data.set(new Uint8Array(original).subarray(0, end));
  const view = new DataView(data.buffer);
  view.setUint32(end, 0x06064b50, true);
  view.setBigUint64(end + 4, BigInt(44), true);
  view.setUint16(end + 12, 45, true); view.setUint16(end + 14, 45, true);
  view.setBigUint64(end + 24, BigInt(3), true); view.setBigUint64(end + 32, BigInt(3), true);
  view.setBigUint64(end + 40, BigInt(old.getUint32(end + 12, true)), true);
  view.setBigUint64(end + 48, BigInt(old.getUint32(end + 16, true)), true);
  view.setUint32(end + 56, 0x07064b50, true);
  view.setBigUint64(end + 64, BigInt(end), true);
  view.setUint32(end + 72, 1, true);
  data.set(new Uint8Array(original).subarray(end), end + 76);
  view.setUint32(end + 76 + 12, 0xffffffff, true);
  view.setUint32(end + 76 + 16, 0xffffffff, true);
  for (const stub of [new Uint8Array(), encode('self-extracting header')]) {
    const wrapped = new Uint8Array(stub.length + data.length);
    wrapped.set(stub); wrapped.set(data, stub.length);
    const pack = await parseUniPack(wrapped.buffer);
    assert.deepEqual(pack.errors, []);
    assert.equal(pack.soundTable[0][0][0]![0].file, 'sounds/한.wav');
  }
});
