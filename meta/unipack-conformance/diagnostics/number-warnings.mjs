// Explains the web parser's number warnings ("<section>: [<input>] <field> is incorrect") as a format
// failure, a range failure, or neither for lack of information. It reads only the warning text and the
// pack size the parser checked it against: never a case id, an expected result or a pinned difference.
// See README.md in this folder.
//
//   node meta/unipack-conformance/diagnostics/number-warnings.mjs <web-warnings.json> [--out <file>]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CAPTURE_KIND = 'unipack-conformance-raw-warnings';
export const CAUSES_KIND = 'unipack-conformance-number-warning-causes';

export const FORMAT = 'format';
export const RANGE = 'range';
export const INSUFFICIENT = 'insufficient-information';
export const NOT_A_NUMBER_WARNING = 'not-a-number-warning';

/** Android reads these numbers into a 32-bit Int and the web into a double, so beyond it they disagree. */
const INT32_MAX = 2 ** 31 - 1;

const WARNING = /^(autoPlay|keyLed|keySound): \[(.*)\] (coordinate|chain|delay|x|y|loop) is incorrect$/s;

// For each warning, the commands that can raise it (autoPlay only) and the tokens of the bracketed input
// it checks: their position, and the inclusive range a value must be in, either fixed or 1..pack[size].
const COORDINATE = [{ index: 1, size: 'buttonX' }, { index: 2, size: 'buttonY' }];
const FIELDS = {
  autoPlay: {
    coordinate: { commands: ['on', 'o', 'off', 'f', 'touch', 't'], slots: COORDINATE },
    chain: { commands: ['chain', 'c'], slots: [{ index: 1, size: 'chain' }] },
    delay: { commands: ['delay', 'd'], slots: [{ index: 1, min: -Infinity }] },
  },
  keyLed: {
    chain: { slots: [{ index: 0, size: 'chain' }] },
    x: { slots: [{ index: 1, size: 'buttonX' }] },
    y: { slots: [{ index: 2, size: 'buttonY' }] },
    loop: { slots: [{ index: 3, min: 0 }] },
  },
  keySound: {
    chain: { slots: [{ index: 0, size: 'chain' }] },
    x: { slots: [{ index: 1, size: 'buttonX' }] },
    y: { slots: [{ index: 2, size: 'buttonY' }] },
  },
};

/** What is wrong with one token, read the way the parser reads it (a complete integer only). */
function tokenProblem(value) {
  if (value === undefined) return 'missing';
  if (/^[+-]?\d+$/.test(value)) return Math.abs(Number(value)) > INT32_MAX ? 'too-large' : null;
  if (/^[+-]?\d*\.\d+$/.test(value)) return 'decimal';
  if (/^[+-]?\d+\D/.test(value)) return 'trailing-characters';
  return 'not-a-number';
}

const FORMAT_PROBLEMS = new Set(['missing', 'decimal', 'trailing-characters', 'not-a-number']);

function bounds(slot, pack) {
  if (!slot.size) return { min: slot.min, max: Infinity };
  const size = pack?.[slot.size];
  return Number.isInteger(size) && size > 0 ? { min: 1, max: size } : null;
}

/**
 * @param {{ raw: string, pack: { buttonX: number, buttonY: number, chain: number } | null }} warning
 *   the warning exactly as the parser wrote it, and the pack size it was checked against
 */
export function classifyWarning({ raw, pack }) {
  const match = WARNING.exec(raw);
  if (!match) return { cause: NOT_A_NUMBER_WARNING, reason: 'not a "<field> is incorrect" warning' };
  const [, section, input, field] = match;
  const rule = FIELDS[section][field];
  const base = { section, field };
  if (!rule) return { ...base, cause: INSUFFICIENT, reason: `${section} has no ${field} to check`, tokens: [] };
  if (/[[\]]/.test(input)) return { ...base, cause: INSUFFICIENT, reason: 'the input contains a bracket, so where it ends is ambiguous', tokens: [] };

  const parts = input.trim().split(/\s+/);
  if (rule.commands && !rule.commands.includes(parts[0])) {
    return { ...base, cause: INSUFFICIENT, reason: `"${parts[0]}" is not a command that takes a ${field}`, tokens: [] };
  }

  const tokens = rule.slots.map((slot) => ({ position: slot.index, value: parts[slot.index] ?? null, problem: tokenProblem(parts[slot.index]) }));
  const report = (cause, reason) => ({ ...base, cause, reason, tokens });

  if (tokens.some((t) => FORMAT_PROBLEMS.has(t.problem))) return report(FORMAT, 'a value is missing or is not a complete integer');
  if (tokens.some((t) => t.problem === 'too-large')) return report(INSUFFICIENT, 'an integer past the 32-bit range, which the platforms convert differently');
  for (const [i, slot] of rule.slots.entries()) {
    const range = bounds(slot, pack);
    if (!range) return report(INSUFFICIENT, `the pack has no usable ${slot.size} (absent, or not a positive integer)`);
    const n = Number(tokens[i].value);
    if (n < range.min || n > range.max) tokens[i].problem = 'out-of-range';
  }
  if (tokens.some((t) => t.problem === 'out-of-range')) return report(RANGE, 'a valid integer outside what the pack allows');
  return report(INSUFFICIENT, 'every value is a valid integer in range, so the input does not explain the warning');
}

/** Classifies every warning of a capture written by src/lib/unipack/conformance.test.ts. */
export function classifyCapture(capture, captureSha256 = null) {
  if (capture?.kind !== CAPTURE_KIND) throw new Error(`not a raw warning capture (kind ${JSON.stringify(capture?.kind)})`);
  const warnings = [];
  for (const record of capture.cases) {
    for (const raw of record.warnings ?? []) {
      // The case id and fingerprint are copied for the reader; the classification sees only raw and pack.
      warnings.push({ id: record.id, fingerprint: record.fingerprint, raw, ...classifyWarning({ raw, pack: record.pack }) });
    }
  }
  const counts = Object.fromEntries([FORMAT, RANGE, INSUFFICIENT, NOT_A_NUMBER_WARNING].map((cause) => [cause, warnings.filter((w) => w.cause === cause).length]));
  return {
    kind: CAUSES_KIND,
    from: {
      sha256: captureSha256, platform: capture.platform, corpusSha256: capture.corpusSha256, generatedAt: capture.generatedAt, source: capture.source, method: capture.method,
    },
    note: 'A supplementary explanation of warnings. It does not change any case status, and is not a sound, light or input result.',
    counts,
    warnings,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) {
    console.error('usage: number-warnings.mjs <web-warnings.json> [--out <file>]');
    process.exit(2);
  }
  const bytes = readFileSync(file);
  const text = `${JSON.stringify(classifyCapture(JSON.parse(bytes.toString('utf8')), createHash('sha256').update(bytes).digest('hex')), null, 2)}\n`;
  const out = rest[0] === '--out' ? rest[1] : null;
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
}
