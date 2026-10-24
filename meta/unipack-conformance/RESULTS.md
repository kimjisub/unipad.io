# Results

## Trailing-wait observations after the web runner fix (2026-10-24)

The prepared canonical corpus advances from `3f6b68d623d0870f126285653426948c2b6309a939c71c4bc0f5a15b27c257b6`
to `c317515689ac9cb218c1de5d3159e4861898025fb47242c006da37cddc54d743` (382 cases, grammar G6,
114 items). Only the web failure observations for RUN-P001 and RUN-P002 are removed.
All 382 inputs, per-case fingerprints, scenarios and expected outputs are unchanged; the earlier
removal of twelve resolved web playback observations is preserved.

The complete web conformance run used the exact `AutoPlayRunner.ts`, `SoundEngine.ts` and
`useUniPadEngine.ts` source blobs from application commit `7f231f6fbb4b47bc59388cbd5ff6b360f05bf6c9`
overlaid for validation. The canonical change itself contains no application implementation.
`node --import tsx --test src/lib/unipack/conformance.test.ts` passed 414 assertions with zero skips.
The 382 recorded case results contain **361 passes and 21 failures**. Every remaining failure matches
its unchanged web pin: sixteen parsing/selection cases and five mapper cases. Assertions accepting
those pins do not turn the failures into compatibility passes.

| Case | Before the fix | With the fix |
|---|---|---|
| RUN-P001 | Ends at the first checkpoint, before the final wait | Paired touch, active before 2000 ms, one end at 2000 ms |
| RUN-P002 | Ends before suspension can preserve the final wait | Paired touch, suspension freezes the remaining wait, one end after resuming the remaining time |

On the same new corpus, the unmodified application at `cf7409543b5e24d936ba73c80e92121d0c80da34`
fails exactly these two assertions; the other 21 recorded failures remain pinned. Raw before/after
results retain their original corpus hashes and source provenance. These virtual-clock runner
observations do not establish real audio, manual-resume UI, device output or native application results.

Android and iOS were not rerun. Their existing historical objects in `copies.json` remain unchanged
until reviewed public copy commits exist. The explicit historical check warns for both apps, while
`sync.mjs --check --require-current` rejects both old copies. Prepared copies of the new bytes pass
the strict check; this is a byte comparison, not a native test run or a public copy-commit handoff.
The older reports below retain their original counts and timestamps.

## Web playback observations retired with G6 (2026-10-24)

This retained section records the earlier G6 merge, before the trailing-wait update above.

[unipad.io#173](https://github.com/kimjisub/unipad.io/pull/173), merged as
`cf7409543b5e24d936ba73c80e92121d0c80da34`, fixes twelve observed playback differences:
RUN-G601, RUN-G602, RUN-G603, RUN-G604, RUN-G605, RUN-G607, RUN-G608, RUN-G609,
RUN-G610, RUN-G616, RUN-G617 and RUN-G618. The G6 corpus merge
([unipad.io#165](https://github.com/kimjisub/unipad.io/pull/165),
`d60027651f347043b7a7766a0686d3109f3d9f3c`) already retired their web failure pins.
No further pin removal or corpus regeneration is needed for these twelve cases.

An asserting `pnpm test:unipack` rerun on that merged main passed all 969 tests and recorded
382 cases: 359 pass and 23 fail. Each of the twelve actual results equals its unchanged expected
result and retains its input fingerprint. The 23 remaining pinned web failures are still failures
in compatibility results, even though their assertions pass. RUN-G606 also passes under the revised
manual-chain-selection rule documented in the README; it is separate from these twelve fixes.

The canonical corpus remains grammar G6, 382 cases, SHA256
`3f6b68d623d0870f126285653426948c2b6309a939c71c4bc0f5a15b27c257b6`.
`build-corpus.mjs --check` and the tooling self-tests pass. No case input, expected result, basis,
other platform record or generated corpus byte was changed by this documentation update.

`copies.json` retains the explicit historical snapshots introduced with G6: Android
`ea259f65bd28ea9c5efb631b151ce651c9ff214e` and iOS
`9aac4c159a67ce1774a588745f6ffbb4afad2f4a`, both with corpus SHA256
`47b3a60d056ab0e6e4695eb2d5d123689ce2161a90d4aa7d8ad9d7ac20de6ba5`.
`sync.mjs --check` with those exact commit arguments verifies their declared bytes and warns that
both copies are behind canonical. This checks historical copy integrity only; neither app was rerun,
and neither is current G6 compatibility evidence. A final cross-platform check must use current
copies and `--require-current`. The aggregate reports below remain historical.

## Changes after normalized LED filename ordering and wormhole warning cases (2026-10-22)

The canonical corpus advances from SHA256
`37096f03b811ae4813ed3a5b68dffbb6da70d741cf67bae4a5c52559e4a8eabf` (204 cases) to
`f9cd132254aace54890f683ecbc3dca46bfdd6bc0795fd97a63033b5ad0e459e` (210 cases), with grammar G4.
KL-026 through KL-030 cover composed and decomposed Latin accents and Hangul, and UTF-16 filename
ordering. KS-023 checks that a wormhole outside the pack's chain range keeps its sound, clamps its
destination to the nearest chain and records a range warning. The earlier removal of RUN-A-003's
resolved Android observation-order pin is preserved.

`copies.json` pins the merged Android commit `a1476effb41ecbd6478cbb6bba4d28d14ae32e2c`
([unipad-android#290](https://github.com/kimjisub/unipad-android/pull/290)) and iOS commit
`4d450460c7e723646422bcc7df815bfaa167ae32`
([unipad-ios#188](https://github.com/kimjisub/unipad-ios/pull/188)). Their `corpus.json` and
`corpus.sha256` copies are byte-identical to the current canonical files (`sync.mjs --check`).

The aggregate tables below have not been regenerated from new platform result files for these
210 cases or grammar G4. Their counts and timestamps remain historical; matching corpus copies
alone does not establish new platform results. The following sections retain the earlier corpus
changes, copy pins and reports.

## Changes after the Android autoPlay chain-order fix (2026-10-21)

[unipad-android#283](https://github.com/kimjisub/unipad-android/pull/283) fixes the duplicate chain-change
notification when an autoPlay chain command is followed by a press. RUN-A-003 now matches its existing
expected event order, so its Android observation-order pin is removed. Case ids, inputs, fingerprints,
scenarios, expected results and bases are unchanged; the other pinned differences are retained.

The previous canonical corpus SHA256 was
`e233029559c3a251ad8c2103905135a08a7d4b0207715ea0e8633f228c7bb358`; the new SHA256 is
`37096f03b811ae4813ed3a5b68dffbb6da70d741cf67bae4a5c52559e4a8eabf` (204 cases).
This preserves the earlier removal of the iOS unobserved marks for RUN-S-008, RUN-S-009, RUN-S-010,
RUN-S-012 and RUN-S-013 in [unipad.io#147](https://github.com/kimjisub/unipad.io/pull/147).

`copies.json` now pins the merged Android commit `1988e6c58d4532cb45a8684b8b8360948bf54156` and iOS
commit `24254551f5b973e2e0f9452ef96cf8fb1629f2a7`
([unipad-ios#176](https://github.com/kimjisub/unipad-ios/pull/176)). Both commits contain byte-identical
`corpus.json` and `corpus.sha256` copies of the new canonical corpus (`sync.mjs --check`).

The aggregate table below has not been regenerated for this corpus from new app result files.
It retains the earlier report's results and timestamps, including its old Android pinned failure and
five unverified iOS cases; those counts do not describe the current corpus. Matching copies alone
do not establish new platform results.

## Retained report (2026-10-20, Korea time)

Corpus `241f719f594cf6156db9c0084cc37e70ddad2c19d8a52858e0727e76ade9890b`, 204 cases,
grammar G3 (104 items). The report was regenerated from retained, asserting result files, not from
new app runs: Android `d34406a71f050b849a4e9d667b64795aedc896f0`, iOS
`a396cb12d0acd8c3eeecadb100660cac9af73c97`, and web `7d05e704629327eac6897e161f03e542a8a7f183`.
Both app commits contained byte-identical copies of that historical corpus. The current merge-commit
pins are listed above.

| Platform | pass | fail (pinned) | unsupported | intended difference | unverified | results written (UTC) |
|---|---|---|---|---|---|---|
| Android | 203 | 1 | 0 | 0 | 0 | 2026-10-20T09:35:42.705798Z |
| iOS | 199 | 0 | 0 | 0 | 5 | 2026-10-20T08:58:14Z |
| Web | 204 | 0 | 0 | 0 | 0 | 2026-10-20T09:24:30.575Z |

Pass on all three platforms: 198 of 204. Confirmed grammar items: Android 94/104, iOS 95/104,
web 97/104; 90/104 on all three; 99/104 have a case. These figures describe the corpus and what the
harnesses can observe, not compatibility with every UniPack.

At the time of this retained report, T-09 allowed two Android internal storage representations
in KS-B08 and KL-BE10. That historical reporting exception no longer applies: G6 requires the exact
decremented value `-2147483649` on every platform and rejects saturation at `-2147483648`.
The old aggregate above is retained evidence, not a result under the current rule.

At the time of this report, RUN-A-003's Android observation-order pin still counted as a failure,
and iOS could not observe sound stops in RUN-S-008 through RUN-S-010 or chain-change counter resets
in RUN-S-012 and RUN-S-013. These limitations have since been resolved as described above; the
historical table is retained without recalculating its aggregate.

## Earlier report (2026-10-19)

Corpus `aae2cc7215f5afdfb2220c1f160ec96edc058bd111f45d1a499e759c1c3c2f56` (sha256 of `corpus.json`), 172 cases. These results were recorded by tests that assert the expected outcomes
on committed checkouts: unipad-android `b27171e7386f88b111f14956345fd97343a2f7c7`, unipad-ios
`f24c22ad099995e14f80bfe35112d657808c4e98` and unipad.io `5227ad7f56c3b9074f35ec0e41b057f2ee1c714d`.
Each commit existed before its run started. The app results were recorded on the pull request
commits above, before the pull requests merged. `copies.json` now pins their main-branch merge
commits: Android `45bc80c203429b8b327e6344bcde4fcdd927970e` and iOS
`7110eb27702cb2bd002db07d23ea7fdf95418e46`. Both merge commits contain byte-identical corpus
copies to the tested commits and this canonical directory (`sync.mjs --check`).
The web result was recorded after merging default-branch commit `f0c3d6056d67cf3628e1590701414981b7225bb1`
with the integer cases. A later merge of `acda043` and the copy-pin and documentation updates
leave the canonical corpus unchanged; the table retains the recorded results and timestamps above.

The table comes from `report.mjs` on these new result files (README, "Running it"). It describes these
172 cases only; it does not show that every UniPack is compatible, and 100% compatibility is not known.

| Platform | pass | fail (pinned) | unsupported | intended difference | unverified | results written (UTC) |
|---|---|---|---|---|---|---|
| Android | 170 | 2 | 0 | 0 | 0 | 2026-10-18T23:28:06.493445Z |
| iOS | 172 | 0 | 0 | 0 | 0 | 2026-10-19T01:40:45Z |
| Web | 172 | 0 | 0 | 0 | 0 | 2026-10-18T23:22:48.414Z |

Pass on all three platforms: 170 of 172, 17 of them on an agreed basis (Android 17, iOS 17, web 17 of
the 17) and 33 on a decision basis (Android 33, iOS 35, web 35 of the 35).

- **Two Android storage differences are pinned: KS-B08 and KL-BE10.** Subtracting 1 from the smallest
  32-bit integer gives `-2147483649` on iOS and the web; Android keeps `-2147483648` in its 32-bit
  fields. Both sound loop values play once; both LED coordinates and chains stay outside the pack.
  The grammar does not define this stored value, and the user-visible result is the same.
  The report counts the pins as failures, not passes; all other cases pass on all three platforms.
- **No case is unverified or undetermined.** On iOS, leaving the play screen is observed up to the main
  screen's clear call to the MIDI driver, not what a physical Launchpad receives.
- **The app pull requests are merged and their copies are pinned.** The table was regenerated from
  the retained result files above; it does not claim new app test runs on the merge commits.

## Changes after the 32-bit integer cases

The default-branch corpus before the integer cases was `98d8f5fb401f…` (138 cases). This update adds 34 cases covering
numbers outside the signed 32-bit range and its two ends in keySound, keyLED file names and events,
and autoPlay. A number outside the range is a format error; only its line or file is skipped and the
next valid one is kept. A keyLED file name uses 240 digits in place of 400 to fit the 255-byte name
limit. The two ends remain numbers, with the existing range checks and storage rules for each field.

The earlier integer-case corpus was `ba80283d9b32…` (171 cases). All its cases are unchanged; the
172-case corpus also retains RUN-RP-005 from the default branch, which checks that turning autoPlay
off stops its endless sound while a sound held by the person keeps playing. All 138 default-branch
cases are unchanged too.

- Android no longer wraps the smallest 32-bit integer to `2147483647` when storing a sound loop or LED
  coordinate or chain 0-based. Its two remaining storage differences are pinned as described above.
- The corpus does not cover the two ends in a keySound wormhole. Android and the web warn and clamp a
  wormhole outside the pack, whereas iOS keeps it without warning. Although the web now agrees with
  Android, iOS still differs; those end values remain excluded rather than choosing a new common
  expectation here. Android's own range test checks the wraparound fix there. Other missing positions
  and spellings are listed in the README.
- All three platform result files were written by new runs on the committed checkouts above, not
  reused from the earlier 171-case corpus.

## Changes after the Android `info` fix

The previous canonical corpus SHA256 was `4a67dbe1e919…` (137 cases). Only the Android pins for INF-007,
INF-010 and INF-016 are gone: ids, input files, fingerprints, expected results and bases are unchanged.

- **Android gives the decided result for INF-007, INF-010 and INF-016.** It skips an `info` line without
  `=` without a warning and refuses a pack whose `buttonX` or `buttonY` is not an integer
  (`info : buttonX is not a number`) instead of opening it with no pad column or row. Android now passes
  137 of 137 (134 and 3 pinned fails before).
- iOS and the web give the same results as on `4a67dbe1…` (137, 0, 0 each). The Android copy is the one
  in 9e00b363, and the iOS copy the one in ead429bc (`sync.mjs --check` passes against both).

## Changes after the sound name cases that differ from the file only in case

The previous canonical corpus SHA256 was `fe56df2756a0…` (133 cases). Four cases were added; the other
133 are unchanged (the two corpora were compared case by case).

- **KS-019, KS-020, KS-021 and RUN-S-006 cover a `keySound` name that differs from its file only in
  upper and lower case.** Official store packs list `End.wav` for a file stored as `END.wav`. When no file
  has exactly the listed path under `sounds/`, the file whose whole path differs only in case is the
  pad's sound, and its name is the stored one (`a.wav`, `END.wav`, `fx/s.wav`); a file of that name in
  another folder, or a folder, is still `keySound:missing-file`. `sounds.mdx` says so.
- **All three platforms pass the four.** The web already looked sounds up this way. iOS played those
  pads silent and Android did on storage that tells upper and lower case apart; both now find the file
  and record the stored name, so a harness that finds `A.wav` only because the disk ignores case still
  fails.
- Two files whose names differ only in case (`kick.wav` and `Kick.wav`) are not covered: no rule decides
  which one plays, and the app harnesses cannot write such a pack on a disk that ignores case (README).
- Android and iOS give the same results as on `fe56df27…` for the other 133 cases (130, 3, 0 and 133,
  0, 0), and so does the web (133, 0, 0).

## Changes after the web reads UTF-16 text and keeps keyLED events outside the grid

The previous canonical corpus SHA256 was `3f1845257d22…` (133 cases). Only the web pins for KS-018 and
KL-024 are gone: the two corpora were compared case by case, and only `known` differs, on those two.

- **The web passes KS-018 and KL-024.** It reads a text file that starts with a UTF-16 byte order mark
  (`info`, `keySound`, keyLED files and `autoPlay`) and keeps a keyLED event outside the pad grid without a
  warning; the LED runner skips it when it is lit. The web now passes 133 of 133 (131 and 2 pinned fails
  before).
- Android and iOS give the same results as on `3f184525…` (130, 3, 0 and 133, 0, 0). Both copies were
  synchronized to `fe56df27…` (`sync.mjs --check` passes against both pull request copies).

## Changes after dropping the iOS unobserved marks

The previous canonical corpus SHA256 was `4ae6a72cb475…` (133 cases). It still marked RUN-L-006,
RUN-L-007, RUN-A-001, RUN-A-002, RUN-RP-003 and RUN-RP-004 as unobserved on iOS, although the iOS harness
records a result for all six and they pass.

- **The six marks and their reasons are gone.** No case is marked `unobserved` now. Ids, input files,
  fingerprints, expected results, bases and pinned differences are unchanged: the two corpora were
  compared case by case, and only `unobserved` differs, on those six.
- **The iOS harness no longer keeps its list of the six** (`newlyObservableCases`), which let it run
  them in spite of the mark. A case the corpus marks `unobserved` for iOS is again reported unverified
  with its reason and not run.
- **`selftest.mjs` marks two cases `unobserved` itself** (a parse case and a run case) to keep checking
  how `report.mjs` treats such a case, since the corpus has none. With the check that returns the reason
  removed from `report.mjs`, the test fails.
- The table is the same as on `4ae6a72c…`: Android 130, 3, 0; iOS 133, 0, 0; web 131, 2, 0. All three
  were rerun on the new corpus. The Android and iOS copies were synchronized to `3f184525…`
  (`sync.mjs --check` passes against both pull request copies).

## Changes after the iOS `info` fix

The previous canonical corpus SHA256 was `72064eeab90f…` (132 cases).

- **iOS gives the decided result for INF-007, INF-010 and INF-015.** It skips an `info` line without
  `=` without a warning, refuses a pack whose grid size is not an integer, and no longer reads
  `info.json`. Its three pins were removed.
- **INF-016 was added:** `buttonY=abc` refuses the pack, like `buttonX=abc` in INF-010, so a fix of
  `buttonX` alone no longer passes. iOS and the web pass it; Android opens the pack with `buttonY` 0 and
  is pinned.
- The other 132 input fingerprints, `palette.json` and the assets are unchanged.

## Changes after iOS observed the six exit and autoPlay cases

On the previous 132-case corpus (`72064eeab90f…`) the table left RUN-A-001, RUN-A-002, RUN-RP-003,
RUN-RP-004, RUN-L-006 and RUN-L-007 unverified on iOS, and 121 of 132 passed on all three platforms.

- **The iOS harness records a result for the six.** It drives `AutoPlayRunner` on a virtual clock (the
  runner's clock and sleep are passed in; the app keeps the real ones) and, at `stop`, runs the main
  screen's step that takes the MIDI controller back (`MainViewModel.setupMidiController` →
  `MainMidiControllerAdapter.onAttach` → `sendClearLed`) against a recording MIDI driver. A harness that
  skips that step or the autoPlay stop fails its own checks.
- **`report.mjs` judges those results.** It used to return unverified for any case the corpus marks
  `unobserved` for a platform, before looking at the result. The reason now applies only while the
  platform records no result; a recorded result is compared with the expected one like any other.
  For that 132-case run, with the previous `report.mjs` the same three result files give iOS 123 pass and 6 unverified; with this one
  129 pass. All six iOS results equal the expected ones, with the corpus input fingerprints.
- The corpus still marks the six `unobserved` on iOS, and the iOS harness still lists them as observable
  despite that mark. The corpus, its expected results and the pinned differences are unchanged.
- Not checked: what a physical Launchpad shows after leaving the play screen, real sound and real timing.

## Changes after the decided expectations

The previous canonical corpus SHA256 was
`aa16cb34a0cf…`. On it every platform left INF-007, INF-010, INF-015, KS-018 and KL-024 undetermined and
unverified, and no difference was pinned.

- **The five cases have an expected result.** The maintainers chose one where the platforms disagreed:
  - INF-007: an `info` line without `=` is ignored, with no warning. Added to `info.mdx`.
  - INF-010: a `buttonX` or `buttonY` that is not an integer (for example `abc`) refuses the pack. Added
    to `info.mdx`. A value of 0 still only warns (INF-009).
  - INF-015: `info.json` in place of `info` refuses the pack. `info.mdx` already names only `info`.
  - KS-018: a keySound saved as UTF-16 with a byte order mark is read normally. Added to `key-sound.mdx`
    ("UTF-8, or UTF-16 with a byte order mark").
  - KL-024: an LED event outside the pad grid is kept as written, with no warning, and skipped when lit.
    Not stated in a doc; it rests on the new `decision` basis, counted apart from `doc` and `agreed`.
- **Seven differences are pinned** in `divergences.json` with the result each platform gave on the
  `aa16cb34…` corpus (listed above), so every suite stays green until the platform's own fix.
- The harnesses' check that an undetermined case is never a pass now makes one from KS-001, since the
  corpus has none.
- The 132 input fingerprints, `palette.json` and the assets are unchanged. The Android and iOS copies
  were synchronized to `72064eea…` (`sync.mjs --check` passes against both pull request copies).

## Changes after the web format-warning fix and the agreed expectations

The previous canonical corpus SHA256 was
`c30e75b9985e2fbb591ada9da3fac0a5437515ebe8a90e8f95ff8679066283d8`. On it the web passed 95 cases and
failed 15 pinned ones, every platform left 22 undetermined cases unverified, and 89 of 132 passed on
all three platforms.

- **The 15 web differences are gone.** KL-N01..N05 (a keyLED file name whose chain, x, y or loop is not
  a whole number) and AP-M01..M09, AP-M11 (an autoPlay line whose coordinate, chain or delay is not a
  whole number) were dropped by all three platforms, but the web reported a range error
  (`keyLed: [a 1 1] chain is incorrect`, `autoPlay: [on a 1] coordinate is incorrect`) where Android
  and iOS report a format error. `parser.ts` now reports `… format is incorrect` for a value that is not
  a whole number; a number outside the pack is still a range error. The 15 web pins were removed from
  `divergences.json`, and the web now passes all 15.
- **17 of the 22 undetermined cases are held on an agreed basis.** On the `c30e75b9…` corpus all three
  platforms gave the same result for each of them; that result is now the expected one with an `agreed`
  basis, and every platform passes all 17 on the new corpus. This replaces the earlier rule, recorded
  under "Changes after the independent review" and "Changes from the first run" below, that left KL-003,
  AP-004, KL-M07, AP-M10, KL-025 and AP-022 undetermined because agreement does not establish an
  expected warning. The open question stays in each case's `basis[].note`.
- **5 cases stay undetermined:** INF-007, INF-010, INF-015, KS-018 and KL-024, whose platforms disagree.
- The 132 input fingerprints, `palette.json` and the assets are unchanged. The Android and iOS copies
  were synchronized to `aa16cb34…` (`sync.mjs --check` passes against both pull request copies).

## Changes after the real-pack shape cases

The previous canonical corpus SHA256 was
`3c8ec4875cffab4dabbd454f32fbb7f2b30b5d977b1d25ca0a0b8b21ebc251b9` (124 cases). Eight cases were added
for shapes real packs use: RP-001 and RUN-RP-001 (an 8 x 8 grid to its last pad), RP-003 and RUN-RP-002
(an MP3 sound read and started), RUN-RP-003 and RUN-RP-004 (lights that repeat twice or loop endlessly
while autoPlay presses and releases the pad, then leaving the screen), RP-004 (`squareButton=false`), and
RP-002 (five-part keyLED file names, undetermined; all three platforms read both files and queue them in
name order). Every new expected result comes from a format doc or an intent already stated for an
existing case; none was taken from what the platforms returned. All seven determined cases pass on
every platform that can observe them, so no difference was pinned.

The 124 earlier cases are unchanged: ids, input files, input fingerprints, expected results, bases,
pinned differences and `unobserved` reasons were compared field by field with the `3c8ec487…` corpus and
none differs. The new `tone-440-mp3` asset is added beside the three earlier ones, which are unchanged.

`corpus.sha256` now travels with `corpus.json`, and each harness refuses a copy without it or one that
does not hash to it. On each platform a copy with one byte changed and a copy without `corpus.sha256`
failed the suite; a 124-case copy with its own matching `corpus.sha256` passed the suite and failed
`sync.mjs --check`; the restored copy passed both. On the base harness (unipad.io f8f27e0) the copy with
one byte changed in a case title passed all 136 tests.

## Changes after the web coordinate fix

The previous canonical corpus SHA256 was
`2317abb20fe8499fef8b9e9c4e0dc11e63849a8db5ba020d353418c835520c8b`, with 16 pinned platform differences,
all on the web. KL-M05 recorded the web keyLED parser reading `o 1b 1 FF0000` with `parseInt`, which
stopped at the trailing letter and lit pad (0,0) instead of reporting the line.

[unipad.io PR #37](https://github.com/kimjisub/unipad.io/pull/37), merged into main as
[`ffe8fa0`](https://github.com/kimjisub/unipad.io/commit/ffe8fa0916bd27a38b5dc086a4f0da1c721da46b),
reads both pad coordinates with `strictInt` and rejects coordinates outside the pad grid in
`parser.ts`. Its parser test uses the unchanged KL-M05 input. With the conformance files on top of
that main, the web suite reported KL-M05 as "a pinned difference no longer occurs": the web result now
equals the expected one (one keyLED format error, only the off event, pack loaded).

Only the KL-M05 web pin was removed from `divergences.json`; the other 15 web records are unchanged. The
regenerated canonical corpus SHA256 is
`3c8ec4875cffab4dabbd454f32fbb7f2b30b5d977b1d25ca0a0b8b21ebc251b9`. All 124 input fingerprints,
expected results and bases are unchanged, including KL-M05
`823dcef302eeeb875ef6676fdd8f0807606d3a0b964f8747b22492b99de4edb1`; `cases.mjs` and `palette.json`
are unchanged. The empty KL-M05 object retains its position without pinning any platform result.

The table above remains the historical run on an earlier corpus; no new aggregate or cross-platform pass
count is inferred. The Android and iOS copies must be synchronized to this corpus and their suites rerun
separately. No product parser, runner or expectation was changed here.

## Changes after the iOS keyLED argument fix

The previous canonical corpus SHA256 was
`ed629f5ab29c616b2da273631e1fc579e4a17b637167cc34d435659c00956c96`, with 22 pinned platform differences,
six of them on iOS. All six came from the iOS keyLED parser accepting arguments the other platforms reject:
KL-012 (round LED numbers 0 and 33 kept), KL-M11, KL-M12 and KL-014 (extra or unparsable trailing tokens
lit instead of reported), and KL-M17 and KL-M18 (an out-of-range auto velocity read as the colour
`ff00000a`).

[unipad-ios PR #56](https://github.com/kimjisub/unipad-ios/pull/56), merged into main as
[`0c0e47c9`](https://github.com/kimjisub/unipad-ios/commit/0c0e47c9a10ca563101ef898b022b012a3aa5e4b),
drops round LED numbers outside 1..32 and rejects extra trailing arguments and malformed supplied
velocities in `UniPackFolder.swift`. Its `KeyLedInputValidationTests` use the unchanged inputs of all six
cases. The unipad-ios required check on PR #52 (run
[37335742392](https://github.com/kimjisub/unipad-ios/actions/runs/37335742392), the PR merged with main
`c1adfa44`) reported each of the six as "a pinned difference no longer occurs".

Only those six iOS pins were removed from `divergences.json`; the 16 web records are unchanged. The
regenerated canonical corpus SHA256 is
`2317abb20fe8499fef8b9e9c4e0dc11e63849a8db5ba020d353418c835520c8b`. All 124 input fingerprints,
expected results and bases are unchanged; `cases.mjs` and `palette.json` are unchanged. The six empty
objects retain their positions without pinning any platform result.

The table above remains the historical run on an earlier corpus; no new aggregate or cross-platform pass
count is inferred. The web suite was rerun after this pin removal: all 175 tests pass. The iOS unit tests
were run on unipad-ios PR #52 merged with main `c1adfa44` and this corpus copied in (results in the PR).
Android was not rerun here. No product parser, runner or expectation was changed here.

## Changes after the Android colour-length fix

The previous canonical corpus SHA256 was
`30ad4442b7abf40ee0cbfcc97976999fbde4571b30f1d39590425620e4c465eb`, with 23 pinned platform differences.
KL-M13 previously recorded Android accepting `o 1 1 1234567` as `on 0 0 00234567 4`, with no error.
`UniPackFolder.kt` converted the colour with `toInt(16)` without checking its length; the seven-digit
value carried into the alpha byte when the opaque-alpha offset was added.

[unipad-android PR #133](https://github.com/kimjisub/unipad-android/pull/133), merged into main as
[`59f8ebcf`](https://github.com/kimjisub/unipad-android/commit/59f8ebcf493e82a6a2726ba39757a88aa41184ea),
rejects direct colour tokens longer than six characters before integer conversion. Its
`klM13_sevenDigitColorIsReportedAndSkipped` regression uses the unchanged KL-M13 input and requires
one format error, only the off event, and a successfully loaded pack.

Only the KL-M13 Android pin was removed from `divergences.json`; the other 22 platform records are
unchanged. The regenerated canonical corpus SHA256 is
`ed629f5ab29c616b2da273631e1fc579e4a17b637167cc34d435659c00956c96`. All 124 input fingerprints, expected results and
bases are unchanged, including KL-M13
`7c21fd3e45e558cad69336af853868c266c389c42cbf81d2417a297eb9a36744`; `cases.mjs` and `palette.json`
are unchanged. The empty KL-M13 object retains its position without pinning any platform result.

The table above remains the historical run on the previous corpus. Android and iOS were not rerun
here, and no new aggregate or cross-platform pass count is inferred. The web suite was rerun before
and after this pin removal: all 175 tests pass in each run, and all 124 recorded web case results are
identical. App copies must be synchronized and rerun separately against the new corpus before a new
three-platform table can be produced. No product parser, runner or expectation was changed here.

## Changes after the independent review

The 2026-09-30 review left two documentation/expectation corrections. The previously checked tooling
and harness code were preserved; no product parser or runner was changed.

- KL-003 and AP-004 now use the same evidence rule as KL-M07 and AP-M10. The docs require out-of-range
  files or lines to be ignored/skipped but do not say whether that produces a warning. Both cases are
  `undetermined`, still run and record their full results, and never count as a pass. All three
  currently agree, which does not establish an expected warning. This reduces the shared pass count
  from 78 to 76 and increases every platform's undetermined count from 19 to 21.
- The README now describes the 300 ms wait as avoiding a reproduced deadlock, matching this document
  and the iOS harness comment. It is a test workaround and does not fix the app.
- All 124 input fingerprints, synthesized assets and the 23 pinned divergent cases are unchanged.
  The baseline's 20 sample packs and their expectations are unaffected. Its 60 real-app comparisons
  remain unverified; unit tests do not demonstrate audible sound, device LEDs or actual user input.
- The product hang is a separate fix. Do not count the blocked repeated-sound
  scenario as a device pass.

## Changes from the first run on 2026-09-30

The first run (corpus `9958d0be7f15…`, 123 cases, 79 on all three) was re-checked by an independent
review. What changed, and why:

- RUN-L-006 and RUN-L-007 were pinned as an iOS failure ("iOS does not turn LEDs off when the play screen
  is left"). The iOS harness had stopped the LED runner alone, while Android was measured at its play
  screen, so the failure came from the test, not from the app. Both are now unverified on iOS.
- KL-M07 and AP-M10 (a line starting with an unknown word) were decided as "one format error", while the
  same kind of line in KL-025 and AP-022 was undetermined. No doc says whether the skipped line warns, so
  all four are undetermined now; the three platforms all record one format error for each.
- AP-005 is new: the short autoPlay spellings `o`, `f`, `t`, `c`, `d` from `auto-play.mdx`. Passes on all three.
- `report.mjs` used to accept a status a platform wrote without the result behind it, and did not check
  that a file given as `--android` was Android's. Both now make every affected case unverified, as does a
  test log given in place of a result file.

## How the checks were run

On 2026-10-16, after dropping the iOS unobserved marks (corpus `3f1845257d22…`):

| Platform | Command | Result |
|---|---|---|
| Web | `pnpm test:unipack` | 309 tests pass; `node --test meta/unipack-conformance/selftest.mjs`: 25 pass |
| Android | `./gradlew :app:testDebugUnitTest --rerun --no-build-cache --tests 'com.kimjisub.launchpad.unipack.conformance.*'` on d1e6c257 | BUILD SUCCESSFUL; 130 pass, INF-007, INF-010 and INF-016 fail as pinned |
| iOS | `TEST_RUNNER_UNIPACK_CONFORMANCE_OUT=<dir> xcodebuild test -only-testing:unipadTests/UniPackConformanceTests -only-testing:unipadTests/ConformanceRegressionTests -parallel-testing-enabled NO UNIPAD_WARNINGS_AS_ERRORS=YES` on 89286af6 (iPhone 17 Pro simulator, iOS 27.0, Xcode 27.0) | TEST SUCCEEDED, 26 tests pass, 133 corpus cases included; 133 pass, RUN-L-006, RUN-L-007, RUN-A-001, RUN-A-002, RUN-RP-003 and RUN-RP-004 among them with recorded results |

All runs asserted cases (`assertions: checked`) and reported the canonical corpus hash.
`build-corpus.mjs --check` passes, and `sync.mjs --check` passes against checkouts of the two app merge
commits in `copies.json`. With the `unobserved` check removed from `report.mjs`, `selftest.mjs` fails one test.

On 2026-10-15, after merging the current default branch into the iOS info corpus change:

- `report.mjs` regenerated the current 133-case summary from the retained Android and iOS result
  files and the fresh web result file. iOS passes all 133 cases, including the six already observed
  exit and autoPlay cases. No corpus bytes or app copies changed in the merge.
- `build-corpus.mjs --check` and `sync.mjs --check` passed against both app pull-request copies.
- `node --test meta/unipack-conformance/selftest.mjs`: 25 passed. `pnpm test:unipack`: 308 passed.
- Node 24.15.0 and pnpm 9.11.0: frozen install, production audit, type check, lint, `pnpm test` and
  the production build passed. The build used the workflow's fake public Firebase configuration.
- The merge resolution changes the result document only. App and browser screen tests were not
  rerun for this document correction; the app verification recorded for its unchanged head applies.

On 2026-10-12, after the iOS observation of the six (corpus `72064eeab90f…`):

| Platform | Command | Result |
|---|---|---|
| Web | `pnpm test:unipack` | 300 tests pass |
| Android | `./gradlew :app:testDebugUnitTest --rerun --no-build-cache --tests 'com.kimjisub.launchpad.unipack.conformance.*'` on 7859c691 | BUILD SUCCESSFUL; 132 case tests + 10 checks that can fail run, none fail; 130 pass, INF-007 and INF-010 fail as pinned |
| iOS | `xcodebuild build-for-testing` (Debug, generic iOS Simulator, warnings as errors) on aa7188a, then `TEST_RUNNER_UNIPACK_CONFORMANCE_OUT=<dir> xcodebuild test-without-building -only-testing:unipadTests/UniPackConformanceTests -only-testing:unipadTests/ConformanceRegressionTests -parallel-testing-enabled NO` (iPhone 17 Pro simulator, iOS 27.0, Xcode 27.0) | TEST EXECUTE SUCCEEDED, 26 tests pass, 132 corpus cases included, read from the test bundle; 129 pass, INF-007, INF-010 and INF-015 fail as pinned |

All runs asserted cases (`assertions: checked`) and reported the canonical corpus hash.
`sync.mjs --check` passes against the two app checkouts.

On 2026-10-12 (corpus `72064eeab90f…`):

| Platform | Command | Result |
|---|---|---|
| Web | `pnpm test:unipack` | 300 tests pass |
| Android | `./gradlew :app:testDebugUnitTest --rerun --no-build-cache --tests 'com.kimjisub.launchpad.unipack.conformance.*'` | BUILD SUCCESSFUL; 130 pass, INF-007 and INF-010 fail as pinned |
| iOS | `TEST_RUNNER_UNIPACK_CONFORMANCE_OUT=<dir> xcodebuild test -only-testing:unipadTests/UniPackConformanceTests` (iPhone 17 Pro simulator, iOS 27.0, Xcode 27.0) | TEST SUCCEEDED, 132 corpus cases included, read from the test bundle; 123 pass, INF-007, INF-010 and INF-015 fail as pinned |

All runs asserted cases (`assertions: checked`) and reported the canonical corpus hash.

On 2026-10-12 (corpus `aa16cb34a0cf…`):

| Platform | Command | Result |
|---|---|---|
| Web | `pnpm test:unipack` | 300 tests pass; the tooling subprocess runs 23 tests |
| Android | `./gradlew :app:testDebugUnitTest --rerun --no-build-cache --tests 'com.kimjisub.launchpad.unipack.conformance.*'` | 132 case tests + 10 checks that can fail, all pass |
| iOS | `TEST_RUNNER_UNIPACK_CONFORMANCE_OUT=<dir> xcodebuild test -only-testing:unipadTests/UniPackConformanceTests -only-testing:unipadTests/ConformanceRegressionTests` (simulator, warnings as errors; the simulator model, iOS and Xcode versions and the test count were not recorded) | exit 0, 132 corpus cases included |

All runs asserted cases (`assertions: checked`) and reported the canonical corpus hash. With the previous
`parser.ts` (unipad.io 83632e6) put back, `pnpm test:unipack` fails 32 of 300: the 17 new parser tests
and the 15 corpus cases whose pinned web difference was removed (KL-N01 to KL-N05, AP-M01 to AP-M09 and
AP-M11), so the corpus cases now catch this regression themselves. All 300 pass on e5d85f6.

On 2026-10-11 (corpus `c30e75b9985e…`):

| Platform | Command | Result |
|---|---|---|
| Web | `pnpm test:unipack` | 276 tests pass; the tooling subprocess runs 21 tests |
| Android | `./gradlew :app:testDebugUnitTest --rerun --no-build-cache --tests 'com.kimjisub.launchpad.unipack.conformance.*'` | 132 case tests + 10 checks that can fail, all pass |
| iOS | `TEST_RUNNER_UNIPACK_CONFORMANCE_OUT=<dir> xcodebuild test-without-building -only-testing:unipadTests/UniPackConformanceTests -only-testing:unipadTests/ConformanceRegressionTests` (iPhone 17 Pro simulator, iOS 27.0, Xcode 27.0) | 23 tests pass, 132 corpus cases included, read from the test bundle |

All runs asserted cases (`assertions: checked`) and reported the canonical corpus hash.

On 2026-10-02 (corpus `30ad4442b7ab…`):

| Platform | Command | Result |
|---|---|---|
| Web | `pnpm test:unipack` | 175 tests pass; the tooling subprocess runs 20 tests, including the new warning-evidence regression |
| Android | `./gradlew :app:testDebugUnitTest --rerun --no-build-cache --tests 'com.kimjisub.launchpad.unipack.conformance.*'` | 124 case tests + 8 checks that can fail, all pass |
| iOS | `TEST_RUNNER_UNIPACK_CONFORMANCE_OUT=<dir> xcodebuild test -only-testing:unipadTests/UniPackConformanceTests` (iPhone 17 Pro simulator, iOS 26.4) | 134 test invocations pass (124 corpus cases included), 1 skipped (the opt-in destroy reproduction below) |

All runs asserted cases (`assertions: checked`) and reported the canonical corpus hash.
`build-corpus.mjs --check`, `sync.mjs --check`, the 20 tooling tests and targeted ESLint also passed.
The new warning-evidence regression failed on the recovered source (`KL-003: determined`), then
passed after the correction. The aggregate was produced from the three fresh JSON files, not logs.

Android ran in an isolated worktree with an ignored, unused signing placeholder and a local
SDK path, both removed afterwards. Its first configuration attempt lacked the SDK path; the rerun
completed successfully (132 targeted tests, 60 tasks executed, no cached test result). iOS ran on
26.4; iOS 17 and 18 have no simulator on this machine and were not run. Unit test hosts use local-only
Firebase services, so these checks are not evidence of production event delivery.

A read-only device listing afterwards confirmed the simulator used was shut down.

## iOS: destroy() while a repeated sound is cycling

**Reproduced, not fixed here (the app code is outside this work).** In the simulator, `SoundEngine`
hangs the main thread for good when a pad's sound is stopped while that sound is a repeated one
(keySound loop 2 or more, stored loop above 0) and still cycling.

- **Smallest input:** the KS-001 pack with the keySound `1 1 1 a.wav 3` (the 10 ms 440 Hz tone, played
  three times). Press pad (1, 1) and call `SoundEngine.destroy()` right after it.
- **Command:** in unipad-ios, `TEST_RUNNER_UNIPACK_CONFORMANCE_REPRO_DESTROY=1 xcodebuild test -project
  unipad.xcodeproj -scheme unipad -destination id=<simulator> -collect-test-diagnostics never
  '-only-testing:unipadTests/UniPackConformanceTests/destroyWhileARepeatedSoundIsCycling()'`. The test
  ends the process after 20 s when `destroy()` has not returned, so a hang shows up as a crash with the
  message `UNIPACK-CONFORMANCE-REPRO-DESTROY destroy() did not return within 20.0 s`.
- **Observed:** first while the harness was written (2026-09-30, before 09:44 UTC): the test host stopped
  answering twice after `destroy()` with a repeated sound left (`XPC connection interrupted`, restart
  took more than five minutes). The inputs of those runs were not kept. The independent review of the
  same day did not see a hang, because the harness then waited 300 ms before `destroy()`.
  Retried 2026-09-30 11:54-11:57 UTC on the iPhone 17 Pro simulator, iOS 27.0: **3 runs out of 3 hung on
  the first round** (press, then `destroy()` 0 ms later), each time ended by the 20 s limit.
- **Independent review:** on 2026-09-30 12:17–12:18 UTC, iOS 26.4 also hung on immediate
  `destroy()` in 3 of 3 runs. A temporary repeated-pad probe hung in 2 of 2 runs; a once-only sound
  returned in 10.7 ms. These are preserved review findings, not new reproductions in the October 2
  conformance run. The opt-in hang reproduction remained skipped in that run.
- **Where it hangs** (crash reports of the three runs, all the same): the main thread is in
  `SoundEngine.destroy()` → `-[AVAudioPlayerNode stop]` → `AVAudioPlayerNodeImpl::StopImpl()`, waiting for
  the player's completion-handler queue. That queue is running the completion handler `SoundEngine.soundOn`
  schedules for a repeated sound, which calls `node.isPlaying` and waits for the engine lock
  (`AVAudioNodeImplBase::GetAttachAndEngineLock`) that the stopping main thread holds. Each waits for the
  other.
- **The same stop on the play screen** (a one-off probe in a temporary copy, not kept in the suite):
  pressing the same pad again at once while its repeated sound cycles hangs the same way
  (`SoundEngine.soundOn` → `stopByPlayID` → `-[AVAudioPlayerNode stop]`). A sound played once, or an
  endless one, pressed and destroyed at once returned in about 13 ms.
- **What the 300 ms wait works around:** the harness gives the scenario's sounds 300 ms to end before it
  destroys the engine (`ConformanceHarness.soundSettleNanoseconds`). The corpus sounds are 10 ms long and
  repeat at most twice, so by then no completion handler is pending and `stop()` has nothing to wait for.
  The wait hides this hang from the conformance cases; it does not make the app safe.
- **Not known:** whether it happens on a device, how often real packs use keySound loop 2 or more, and
  whether iOS 17 or 18 behave the same. Nothing was changed in the app for it; it is reported as a
  separate problem.

## Rights of the sample sounds

Two 10 ms sine tones (440 Hz, 660 Hz) and 10 ms of silence, synthesized by `lib.mjs`, and the 440 Hz
tone encoded as MP3 with LAME 3.100. No third-party audio.
No licence beyond the repository's was chosen for them; the owner has not been asked.
