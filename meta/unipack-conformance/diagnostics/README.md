# Warning diagnostics

The normalized result keeps a warning only as `section:kind` (see "Error kinds" in
[../README.md](../README.md)), and that kind comes from the end of the sentence, that is from how the
parser chose to word it. The web parser once ended a number it could not read and a number outside the
pack the same way (`autoPlay: [on a 1] coordinate is incorrect`, `autoPlay: [on 5 1] coordinate is
incorrect`), so both counted as `range` while Android and iOS called the first `format`. This folder
keeps what the parser actually wrote and explains each number warning from its input, **next to** the
normalized result, never in place of it, so such a wording is noticed rather than trusted.

Nothing here changes `errors`, a case's status, `web.json`, `divergences.json` or `corpus.json`. The
explanation is not a sound, light or input result, and a warning explained as `format` is not a pass.

## Files

| File | Role |
|---|---|
| `number-warnings.mjs` | Reads a raw warning file and writes the cause of each number warning. |
| `selftest.mjs` | Its tests, on warnings written by hand. `pnpm test:unipack` runs it. |

The checks on warnings the real parser wrote (the corpus cases, and the same inputs changed under new
ids) are in `src/lib/unipack/conformance.test.ts`, "raw warnings and their number cause".

## Running it

```sh
pnpm test:unipack     # also writes .next/cache/unipack-conformance/web-warnings.json
node meta/unipack-conformance/diagnostics/number-warnings.mjs \
  .next/cache/unipack-conformance/web-warnings.json --out /tmp/web-number-warning-causes.json
```

## The raw warning file (`web-warnings.json`)

Written by the web conformance run next to `web.json`, from the same parser call:

| Field | What it is |
|---|---|
| `method` | How the warnings were collected: the web parser read a zip of each case's files at run time, and its warnings were copied as written, before `normalizeError`. Text rebuilt from an older source is never put here. |
| `source` | `commit`: the checked-out commit; `uncommittedChanges`: whether the working tree differed from it. `null` where git could not tell. |
| `corpusSha256` | The corpus the run read, as in `web.json`. |
| `cases[].inputs` | The case's files: `text` for text files, `bytes` (length) for sounds. |
| `cases[].warnings` | The parser's warnings, as written and in order. `null` when the pack was refused. |
| `cases[].pack` | `buttonX`, `buttonY`, `chain` as the parser read them, which the range of a value is checked against. `null` when refused. |
| `cases[].refused` | The refusal message when the parser threw for the pack, otherwise `null`. |

Palette cases have no parser call and are not listed, nor are cases the corpus says the web cannot observe.

## Causes

`number-warnings.mjs` reads two things per warning: the warning text and the case's `pack`. It does not
read the case id, the expected result, `known` differences or anything else in the file; the id is
copied to the output for the reader only.

It handles `<section>: [<input>] <field> is incorrect`, takes the tokens of the bracketed input that the
named field uses (autoPlay `coordinate` x y, `chain`, `delay`; keyLed file name chain, x, y, loop; keySound
chain, x, y), and reports one of the causes below. `format is incorrect` names no field, so for it the
tokens are those the autoPlay command takes (`on`/`off`/`touch` x y, `chain`, `delay`), every number of
the keyLed file name, or every number of the keySound line (chain, x, y, and the loop and wormhole after
the sound name when the line has them).

| cause | when |
|---|---|
| `format` | a token the field needs is missing, a decimal, letters, or digits followed by other characters. The pack size is not needed. |
| `range` | a field warning (`coordinate`, `chain`, `x`, `y`, `loop`) whose tokens are all integers within 32 bits (-2147483648..2147483647), one outside the pack: 1..`chain`, 1..`buttonX`, 1..`buttonY`, or a keyLed loop below 0. Never `format is incorrect`: the parser names the field of such a value. |
| `insufficient-information` | the warning and the pack cannot decide it: a bracket inside the input (where it ends is ambiguous), a command that does not take the field, an integer past 32 bits (Android reads an Int, the web a double), a pack with no usable size for the field, or valid integers that do not explain the warning (in range, or for `format is incorrect` at all). |
| `not-a-number-warning` | any other warning, left alone: `format is incorrect` for an autoPlay command that takes no number, for a line inside a keyLed file (`[file].[line]`), or for a keySound line with no sound name (`[1 1 1]`) whose numbers are integers; missing files and fields; `out of range`. |

Each number warning also lists its `tokens` (`position`, `value`, `problem`: `missing`, `decimal`,
`trailing-characters`, `not-a-number`, `too-large`, `out-of-range` or `null`) and a `reason`.

The cause comes from the input, not the sentence end: `keyLed: [1 b 1] x is incorrect` is `format` and
`keyLed: [1 5 1] x is incorrect` is `range`, and `autoPlay: [on 1 1] format is incorrect` (a sentence
the input does not explain) is `insufficient-information`. Likewise `keySound: [x 1 1 a.wav] format is
incorrect` is `format`, while `keySound: [1 1 1] format is incorrect` (no sound name) is
`not-a-number-warning`.
