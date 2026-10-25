# Two iOS playback observations

The retained [`ios.json`](ios.json) is a nine-case partial run on unipad-ios
`e8ac34d11373b3ed071535e365ddc382c1929496`. Its SHA256 is
`c4b39c69a4611761a0e011a1c20266a6845a1f76c89f55e137c47a7e348ffdf2`.
It records seven matches and two value mismatches; the test command exited 65.
The original corpus was G6, 382 cases, SHA256
`7ac226a82324ba278859443772c67be864387809138b1884fe57cbc187bc4180`.
The original bytes, statuses and corpus hash are retained without alteration.
This file is historical evidence, not a run on the current canonical corpus.

Both cases have the same files, fingerprints, scenarios, bases and expectations
in the canonical corpus and in the partial run's corpus. No aggregate platform
result is recalculated from this partial run. These observations cover sound
requests and chain callbacks; audible output, rendered press indicators and
physical MIDI output remain unverified.

## RUN-G613: a stored value is not the playback repeat count

Input `keySound`: `1 1 1 a.wav -1`. Fingerprint:
`776790a9a9ec424ef5927a1ccb98e7a52386e5de5234857941403ca66ce6f3ef`.
The expected checkpoints remain a sound request with repeat value `0`, then
an empty checkpoint after release. The original file instead records `-2`.

The [harness at the tested commit](https://github.com/kimjisub/unipad-ios/blob/e8ac34d11373b3ed071535e365ddc382c1929496/unipadTests/UniPackConformance/ConformanceHarness.swift#L447-L457)
checks that a playback started, then writes the parsed queue head's `loop`.
It does not observe the repeat count used by the audio scheduler.
The [engine's scheduling branch](https://github.com/kimjisub/unipad-ios/blob/e8ac34d11373b3ed071535e365ddc382c1929496/unipad/Services/Audio/SoundEngine.swift#L688-L711)
repeats indefinitely only for `-1`, schedules finite repeats only above zero,
and schedules one buffer for other values, including `-2`. Only infinite
voices are retained for release. Source inspection therefore identifies an
observation error, rather than evidence of different audible playback.

Do not pin this raw stored value as an app playback defect or rewrite the
original failure as a pass. The iOS harness needs an observation based on the
scheduling semantics and a regression test, followed by a fresh asserting run
with the unchanged expected value. No iOS implementation is changed here.

## RUN-G616: stopping autoPlay leaves a delayed chain callback

Input `keySound`: `1 1 1 a.wav 1 2`, three chains, and `autoPlay`:
`on 1 1` followed by `d 1000`. Fingerprint:
`b1ceceb9ff70d40274b1f282ba16e25713d5200b4d457e019e11cd63f43b446d`.
The scenario observes after 20 ms, turns autoPlay off, then observes after
another 150 ms. The first checkpoint is unchanged:

```json
[["autoOn",0,0],["sound",0,0,0,"a.wav",0],["autoChain",1]]
```

The expected second checkpoint is `[]`; the recorded value is `[["chain",1]]`.
The harness's default `turnOffAutoPlay` calls `switchPlayMode(.none)` and its
chain observer records the real `ChainObserver` callbacks. The
[mode-off branch](https://github.com/kimjisub/unipad-ios/blob/e8ac34d11373b3ed071535e365ddc382c1929496/unipad/ViewModels/PlayViewModel.swift#L870-L884)
stops the runner but does not cancel pending sound wormholes. The
[delayed engine task](https://github.com/kimjisub/unipad-ios/blob/e8ac34d11373b3ed071535e365ddc382c1929496/unipad/Services/Audio/SoundEngine.swift#L721-L738)
can consequently call `chain.setValue` afterward. This is a real callback
difference, and only this case received an iOS failure pin. That original observation remains
a compatibility failure. The pin must be retired after the app is fixed
and a new run demonstrates the unchanged expected checkpoints.

## Existing test coverage and limits

At the tested commit, `PlaybackStopTests.testStoppingAutoplayPreservesFiniteAndOneShotSounds`
uses written repeat counts `1` and `50`, not a negative count. Its tests of
release after a wormhole verify infinite-voice release, rather than absence
of a delayed chain callback after stopping. `AutoPlayTouchWormholeTests`
checks parsed chain commands, not cancellation of the sound engine task.
These existing tests do not establish a pass for either disputed observation.
No simulator, audio rendering or iOS test was rerun for this investigation.

The tooling regression verifies the original file hash and fingerprints,
excludes RUN-G613 from playback pins, retains the old RUN-G616 actual as a failure and rejects
the historical partial run as current-corpus evidence. The corrected-observation check below requires the obsolete pin to be absent before
counting its matching actual as a pass.

## Corrected callback observation (2026-10-25)

[unipad-ios#217](https://github.com/kimjisub/unipad-ios/pull/217), merged as
`c87cb492297d8a3e107c4890dfcb2334a993bec1`, adds `soundEngine?.cancelPendingWormholes()` to the
[real mode-off branch](https://github.com/kimjisub/unipad-ios/blob/2827087ecbf1449ab8d5c55df22cd09610cc7e27/unipad/ViewModels/PlayViewModel.swift#L882-L896).
The new run uses application base `2827087ecbf1449ab8d5c55df22cd09610cc7e27`, plus
executor changes retained separately with the run. That base alone does not identify the complete
executed test source. The retained executor patch SHA256 is
`e2f6b08770f6be7819cbfcd933440079f54c792f0166a067c3fd824406ce24d1`; its manifest and
source files were checked byte for byte. The executed `ConformanceHarness.swift` has SHA256
`f751b89cf3b7dec67b6fa612904b5044df3029be30cf7acd311ed292dda8b9f8`.

The adapter still selects a `PlayViewModel` for `screenInputs` and `autoplayOff`, installs its real
chain observer, attaches the real `SoundEngine`, and calls `switchPlayMode(.none)` through the
default `turnOffAutoPlay` dependency. Its checkpoint drains real callback events after the same
20 ms / stop / 150 ms scenario. The added product-observation dispatch returns nil for RUN-G616,
which has no operation fixture or observation override; it continues through the runner adapter.
The patch adds observation support for other cases and autoPlay end-state steps, without replacing
this case's stop, sound, chain or checkpoint paths. The test entry uses default dependencies.
Thus the empty final checkpoint follows the app cancellation change, rather than a substituted
expected result. Input files, scenario, fingerprint and expected result match the earlier corpus.

The retained [`fixed-ios.json`](fixed-ios.json), SHA256
`ef20299f39072a0cc1f7e44994941203ed43bc74345618779316639c9019ee30`, was generated at
`2026-10-25T08:43:50Z` on iPhone 17 Pro / iOS 27.0 with assertions checked and corpus source bundle.
Its corpus SHA256 is `859e24aafe7de59082daf45a5f0fb64b538d7330a662ce051145a556a8940b20`.
The raw statuses total 374 pass, 3 fail and 5 unverified. The enclosing xcodebuild test-without-building
run exited 65 after 135.52 seconds; this is a failed full run. RUN-G616 alone records the unchanged
expected checkpoints, with detail `a pinned difference no longer occurs; update divergences.json`.
The report correctly refuses to count that as a pass while the old pin remains.

Only RUN-G616's obsolete iOS pin is removed. The tooling regression fails before removal and passes
afterward, checks both immutable observation hashes, keeps the old callback actual a failure and
checks the new actual against the unchanged expectation. A synthetic current-corpus envelope tests
classification only; it is not an iOS rerun. Both retained actual runs are rejected as current-corpus
evidence after regeneration. Neither their statuses nor their corpus hashes are changed. A fresh
native run and public copy references remain with the existing native verification work; this
record does not add a dependency to that work. Audible output, rendered input feedback and physical
MIDI remain unverified here.
