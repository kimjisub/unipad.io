# Chain release expectations, version 1

This is a separate synthetic corpus for what should happen when a pad is
released after its chain changes.

It supplies shared inputs and authored expectations for Android, iOS and web.
It does **not** report a platform pass, actual listening, physical multitouch,
screen captures, release readiness or the compatibility of real downloaded packs.
Product code is unchanged. The canonical 124 parser cases (including KS-003),
60 preserved result rows and their historical rates remain separate and unchanged.
Do not add these new cases to those historical denominators.

## Files and import

- `packs/manual.uni`: two chains, five mapped pads on chain 1 and two on chain 2.
- `packs/delayed.uni`: same mappings except chain 1 pad (1,1) moves to chain 2
  100 ms after playback starts, through the existing sixth keySound field.
- `sources/`: original pack text and original generated audio, no downloaded assets.
- `expectations.json`: six groups with exact input order and a complete expected
  state after each step. This is an expectation document, never an execution report.
- `manifest.json`: SHA-256 and byte size for every pack, source file and expectation.
- `generate.mjs`: deterministic ZIP and PCM creation and read-only integrity check.
- `corpus.test.mjs`: corpus consistency, web parser import, deterministic bytes,
  and rejection of corrupt copies. This suite does not run a product sound engine.

Use the same committed `.uni` bytes on each platform, through its normal pack
import path. Fresh import/state per case: chain 1, no pressed inputs, no playback,
and the first sound selected at each pad. Reusing a pack object between cases
can leave sound sequence counters advanced. No keyLED or autoPlay file is included;
`pressedInputs` refers to normal held-input feedback, not LED-script colour.

## Input and result contract

All chain numbers and pad coordinates are **one-based**. `pad=[x,y]` follows the
keySound fields: chain, x, y, filename, play count, optional destination chain.
Convert to zero-based only at platform API boundaries. Samples are 100 ms,
44,100 Hz, mono, signed 16-bit PCM with amplitude 4,000; a/b/c are distinguishable
440/660/880 Hz tones. In keySound, 0 means infinite, 1 once and 3 exactly three
plays. The sequence pad is (3,1): a infinite → b once → c three times → a infinite.
The stored parser loop values are -1/0/2, respectively.

Each `inputId` labels one press lifetime, and each `playbackId` labels the native
playback that actually starts. These are test labels, not a new pack format or
an instruction to change public APIs. Map native handles to these labels in
observations. Release/cancel always refers to that input lifetime and its original
pad, even after the current chain changes. Do not query current-chain mappings
to choose the expected stop. Old duplicate events refer to the old lifetime,
not a newly held press at the same coordinate. CR-004 has no simultaneous owners
of the same pad and does not define a new same-coordinate ownership rule.

`chain-button` means a second finger taps the existing chain button while the
first remains down (tap down/up is one listed operation). It must not release
held pads. In CR-003, the two press steps at 0 ms are one simultaneous two-contact
input batch; their listed order assigns playback labels. On iOS, sound-engine
calls may establish the unit expectation, but unsupported screen multitouch must
remain unverified. Android/web implementations should use their real screen
input paths as required by the plan. `cancel` means the platform's input-cancel
path. It must release the corresponding press feedback.

`atMs` is logical elapsed time, not a required wall-clock sleep. With fake time,
drain due timers before each checkpoint. CR-002 checks before and at the 100 ms
chain deadline; a real-device run may sample after the deadline and must record
actual times/latency rather than claiming millisecond precision. Release of a
finite sample does not stop or reschedule it. Its deadline is start + 100 ms ×
play count. `naturalEnds` records which samples have ended since the preceding
step, not a new release-stop request at that checkpoint.

Each `expected` lists new starts, immediate `releaseStops`, `naturalEnds`, current
chain, all active playback IDs, and all held input IDs. Array order is label
order; implementations may compare active/held inventories as sets. At every
step, unlisted stop/start/chain changes fail. Other input playback and feedback
remain as declared; no global sound/feedback reset is allowed. All cases finish
with no playback and no held inputs. A teardown after failure is not a passing
release result.

## Six approved groups

| Case | Pack and input order | Required result |
| --- | --- | --- |
| CR-001 | manual: A(1,1) down → chain 2 → B(2,1) down → A up → B up | Chain change preserves a; A stops only a; b and B feedback remain until B up. |
| CR-002 | delayed: A(1,1) down → 99 ms → 100 ms → B(2,1) down → A up → B up | Only at 100 ms chain becomes 2; A stops a, keeping chain 2 and b. |
| CR-003 | manual: A(1,1) and B(2,1) together → chain 2 → A up → checkpoint → B up | A stops only a; b and B feedback survive the checkpoint. |
| CR-004 | manual: A down → chain 2 → B down → cancel A → chain 1 → A2 down → stale A up/cancel → A2 up → B up | Cancel stops a; stale A cannot stop a2 or b; returning to chain 1 does not stop B from chain 2. |
| CR-005 | manual: four down/up pairs on (3,1), waiting for finite endings; then (4,1) once and (5,1) three plays → chain 2 → releases | Sequence is a/b/c/a; infinite starts stop on their own release even when the next sound is finite. Once/three keep their original 100/300 ms duration through release and chain change. |
| CR-006 | manual: A(1,1) down → checkpoint → A up, chain unchanged | Existing infinite press/release and feedback cleanup remain. |

The JSON specifies all times, expected stop targets and maintained inventories;
this table is a reading aid, not a substitute for the step data.

## Checks

Run from the repository root with its installed dependencies (Node 24.15.0,
pnpm 9.11.0). `pnpm test` includes both checks below via `pnpm test:chain-release`.
The negative integrity tests use `PAPERCLIP_RUN_SCRATCH_DIR` or
`PAPERCLIP_SCRATCH_DIR` when provided, otherwise a temporary folder under
`os.tmpdir()`. Every temporary copy is removed after the test.

```sh
node meta/unipack-conformance/chain-release-v1/generate.mjs --check
node --import tsx --test meta/unipack-conformance/chain-release-v1/corpus.test.mjs
```

`--check` reads files and fails on missing or different bytes. Regeneration is
explicit: `node meta/unipack-conformance/chain-release-v1/generate.mjs`.
Review the diff and manifest when intentionally changing an expectation. Do not
regenerate to hide a failed integrity check. Future criteria use a new suite
version; don't rewrite evidence already reported against this version.

Platform engineers add their product regression/UI tests using these files and
publish their exact command, native start/stop/chain observations, commit,
pack/expectation hashes, and before/after evidence on their implementation issue.
Name each result with `suite=chain-release-v1`, platform, case ID, input path
(unit/programmed-screen/physical), and evidence level. State separately whether
sound was listened to, decoded only, or represented by mocked engine calls.
Record unsupported input paths as unverified rather than passed. No fabricated
platform result rows or historical rate recomputation are supplied here.

## SHA-256 fingerprints

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `expectations.json` | 26350 | `3aa66349d27c751938e6f86267b5ad0ac653828288d25a3777b7c4f0fbdf7fe0` |
| `packs/delayed.uni` | 27321 | `7f8647fc894b4226df180061d94febaa9306c0a2c1a3d019299b47a6c56c7236` |
| `packs/manual.uni` | 27318 | `31b158622efea7d779b673ecea3c72906c3764a7fbae16408060eb4e0f50931d` |
| `sources/delayed/info` | 103 | `fc11289aa0b46a538363af040596397f6cc7197e6bec86f13e61630361f4200a` |
| `sources/delayed/keySound` | 128 | `24e9684d232624538d863eaac85945ecde756670ae910f1efcbc3c83db458508` |
| `sources/manual/info` | 102 | `d57dcddd32a656ba3c5314a04f20c0dc49946bc7d13a71c8fb5077cb90ee1f96` |
| `sources/manual/keySound` | 126 | `5c3eaa206ae196b69a41bec2730465a7cffa40ef929cdbf04c316a3f7b3ba2aa` |
| `sources/sounds/a.wav` | 8864 | `5c2826e1f20688fe03f056364163ea7f986db52e56fb8ba14e4a5f8ac8723a8e` |
| `sources/sounds/b.wav` | 8864 | `e7a2b5054dc955dc3031e15dd808a5b6c8bd03e58df8157c6bb94be65d42755d` |
| `sources/sounds/c.wav` | 8864 | `9a34d805babe9d0ef7d9b1d4700089bb72bed6c4a7f75083c1cc075cc4c41526` |

Manifest and source scripts are delivered at the same exact PR head commit.
