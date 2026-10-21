import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { parseUniPack } from '../../../src/lib/unipack/parser.ts';
import { parseResult } from '../../../src/lib/unipack/conformanceHarness.ts';

for (const [label, prefix, directory] of [
  ['empty LED folder', '', 'keyLED'],
  ['nested empty LED folder with mixed case', 'outer/inner/', 'KeyLed/nested/empty'],
  ['absent LED folder', '', null],
]) {
  test(`the external-folder runner matches direct parsing: ${label}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'real-pack-web-test-'));
    try {
      const root = join(dir, 'packs', 'p1');
      mkdirSync(join(root, prefix), { recursive: true });
      const zip = new JSZip();
      for (const [name, contents] of Object.entries({
        info: 'title=Test\nproducerName=Tester\nbuttonX=2\nbuttonY=2\nchain=1\nsquareButton=true\n',
        keySound: '',
      })) {
        writeFileSync(join(root, prefix, name), contents);
        zip.file(`${prefix}${name}`, contents);
      }
      if (directory) {
        mkdirSync(join(root, prefix, directory), { recursive: true });
        zip.folder(`${prefix}${directory}`);
      }
      const direct = parseResult(await parseUniPack(await zip.generateAsync({ type: 'arraybuffer' })));
      assert.equal(direct.keyLedExist, directory !== null);
      execFileSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./run-web.mjs', import.meta.url)),
        '--packs', join(dir, 'packs'), '--out', join(dir, 'results')], { encoding: 'utf8', timeout: 30_000 });
      const result = JSON.parse(readFileSync(join(dir, 'results', 'web', 'p1.json'), 'utf8'));
      assert.deepEqual(result, { platform: 'web', id: 'p1', actual: direct });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
