# Results (2026-10-12, Korea time)

Corpus `72064eeab90f…` (sha256 of `corpus.json`), 132 cases, based on unipad-android 94c34eb7 and
unipad-ios 5f1046bc (the head commits of unipad-android PR #193 and unipad-ios PR #121, which copy this
corpus into each app and are not merged yet; the same commits as `copies.json`, which a later change moves
to their merge commits) and unipad.io 3dff4cd. Regenerate this table with `report.mjs` (README, "Running it"). It
describes these 132 cases only; it does not show that every UniPack is compatible, and 100%
compatibility is not known.

| Platform | pass | fail (pinned) | unsupported | intended difference | unverified | results written (UTC) |
|---|---|---|---|---|---|---|
| Android | 130 | 2 | 0 | 0 | 0 | 2026-10-12 09:20:08 |
| iOS | 123 | 3 | 0 | 0 | 6 | 2026-10-12 09:34:02 |
| Web | 130 | 2 | 0 | 0 | 0 | 2026-10-12 09:16:39 |

Pass on all three platforms: 121 of 132, 17 of them on an agreed basis (Android 17, iOS 17, web 17 of
the 17) and none on a decision basis (Android 1, iOS 1, web 0 of the 1). Formats exercised: info,
keySound, keyLED, autoPlay (both spellings of every command), the colour palette, the sound, LED and
autoPlay runners, an 8 x 8 grid, an MP3 sound, and lights that loop while autoPlay plays (see README for
the list, and what was not exercised).

- **Fail, 7 pinned:** the five cases whose expected result was decided after the platforms disagreed
  (README, "Decided behaviour"), on each platform that does not give it yet. Android: INF-007, INF-010.
  iOS: INF-007, INF-010, INF-015. Web: KS-018, KL-024. Each is pinned in `divergences.json` with the
  observed result and its cause; the platform suites stay green while a pinned result is unchanged and go
  red when it changes or disappears, so each platform's fix has to remove its own pins
  (`meta/PARITY.md`, "Open differences found by the corpus").
- **Decision basis, 1:** KL-024 (an LED event outside the pad grid is kept as written and skipped when
  lit). No doc states it; the `decision` basis names who decided and why. INF-007, INF-010, INF-015 and
  KS-018 rest on the format docs.
- **Agreed basis, 17:** INF-011, INF-012, KS-015, KS-017, KL-003, KL-005, KL-006, KL-007, KL-M07,
  KL-020, KL-023, KL-025, AP-004, AP-M10, AP-022, RUN-L-008 and RP-002 expect what all three platforms
  did (README, "Agreed behaviour"). A pass there shows that no platform changed, not that the
  behaviour is right. INF-012 is held at `squareButton` true although info.mdx gives false.
- **Unverified, iOS only (6):** RUN-A-001, RUN-A-002, RUN-RP-003 and RUN-RP-004 (the iOS `AutoPlayRunner`
  reads the wall clock and sleeps in real time), RUN-L-006 and RUN-L-007 (on iOS the lights are cleared
  by the main screen after the play screen is left, a screen-level step the harness does not drive). None
  of the six is known to fail on iOS; they are not measured. No case is undetermined.
- A pass on the runner cases (RUN-*) shows each platform at the seam described in README, "What each
  harness measures". It does not show real sound, real timing, a real Launchpad, or what a user sees on
  screen. No pack of the corpus has been opened in a running app on any platform yet.

## Changes after the decided expectations

The previous canonical corpus SHA256 was
`aa16cb34a0cf…`. On it every platform left INF-007, INF-010, INF-015, KS-018 and KL-024 undetermined and
unverified, and no difference was pinned.

- **The five cases have an expected result.** The maintainers chose one where the platforms disagreed:
  - INF-007: an `info` line without `=` is ignored, with no warning. Added to `info.mdx`.
  - INF-010: a `buttonX` or `buttonY` that is not an integer (for example `abc`) refuses the pack. Added
    to `info.mdx`. A value of 0 or less still only warns (INF-009).
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
