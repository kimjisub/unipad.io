# Results (2026-09-30)

Corpus `b5cd0bda223c…` (sha256 of `corpus.json`), 124 cases, checked out at unipad-android 20207d89,
unipad-ios 6244e49, unipad.io 8019666 plus the uncommitted conformance files. Regenerate this table with
`report.mjs` (README, "Running it"). It describes these 124 cases only; it does not show that every
UniPack is compatible, and 100% compatibility is not known.

| Platform | pass | fail (pinned) | unsupported | intended difference | unverified | results written (UTC) |
|---|---|---|---|---|---|---|
| Android | 104 | 1 | 0 | 0 | 19 | 2026-09-30 11:43:36 |
| iOS | 95 | 6 | 0 | 0 | 23 | 2026-09-30 12:02:42 |
| Web | 89 | 16 | 0 | 0 | 19 | 2026-09-30 12:00:03 |

Pass on all three platforms: 78 of 124. Formats exercised: info, keySound, keyLED, autoPlay (both
spellings of every command), the colour palette, and the sound, LED and autoPlay runners (see README for
the list, and what was not exercised).

- **Unverified, 19 on every platform:** cases where no doc or stated intent decides the expected result
  (`undetermined`). Their observed results agree on all three platforms for 15 of them and differ for 4
  (INF-007, INF-010, INF-015, KS-018).
- **Unverified, iOS only (4):** RUN-A-001 and RUN-A-002 (the iOS `AutoPlayRunner` reads the wall clock and
  sleeps in real time), RUN-L-006 and RUN-L-007 (on iOS the lights are cleared by the main screen after the
  play screen is left, a screen-level step the harness does not drive). None of the four is known to
  fail on iOS; they are not measured.
- **Fail** means the platform's result differs from the expected one. Each is pinned in
  `divergences.json` with the observed result and its cause; the platform suites stay green while a
  pinned result is unchanged and go red when it changes or disappears. The differences are listed in
  `meta/PARITY.md`, "Open differences found by the corpus", and each becomes a separate narrow fix.
- A pass on the runner cases (RUN-*) shows each platform at the seam described in README, "What each
  harness measures". It does not show real sound, real timing, a real Launchpad, or what a user sees on
  screen. No pack of the corpus has been opened in a running app on any platform yet.

## Changes from the first run of the same day

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

| Platform | Command | Result |
|---|---|---|
| Web | `pnpm test:unipack` | 175 tests pass (39 existing + 136 conformance, including the 19 tooling tests of `selftest.mjs`) |
| Android | `./gradlew :app:testDebugUnitTest --rerun --no-build-cache --tests 'com.kimjisub.launchpad.unipack.conformance.*'` | 124 case tests + 8 checks that can fail, all pass |
| iOS | `TEST_RUNNER_UNIPACK_CONFORMANCE_OUT=<dir> xcodebuild test -only-testing:unipadTests/UniPackConformanceTests` (iPhone 17 Pro simulator, iOS 27.0) | 12 tests pass, 1 skipped (the destroy reproduction below, off by default) |

Android ran in a copy of the checkout with a placeholder `keystore.properties` (the build reads it
unconditionally); `app/src` and `design/src` of the copy were compared equal to the checkout. iOS was run
on the iOS 27.0 simulator only; iOS 17 and 18, the app's lowest supported versions, have no simulator on
this machine and were not run.

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

Two 10 ms sine tones (440 Hz, 660 Hz) and 10 ms of silence, synthesized by `lib.mjs`. No third-party audio.
No licence beyond the repository's was chosen for them; the owner has not been asked.
