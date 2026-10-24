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
difference, and only this case receives an iOS failure pin. It still counts
as a compatibility failure. The pin must be retired after the app is fixed
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
excludes RUN-G613 from playback pins, retains RUN-G616 as a failure and rejects
the historical partial run as current-corpus evidence. It also checks that a
result equal to the expectation cannot count as a pass while a stale pin remains.
