import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

// A hook called after an early return (e.g. `if (!mounted) return null`) changes the
// hook count between renders and takes the whole player down when the panel opens.
test('play components call hooks unconditionally', async () => {
  const eslint = new ESLint({ cwd: projectRoot });
  const results = await eslint.lintFiles(['src/components/play']);
  const violations = results.flatMap((result) =>
    result.messages
      .filter((message) => message.ruleId === 'react-hooks/rules-of-hooks')
      .map((message) => `${result.filePath.slice(projectRoot.length)}:${message.line} ${message.message}`),
  );

  assert.deepEqual(violations, []);
});
