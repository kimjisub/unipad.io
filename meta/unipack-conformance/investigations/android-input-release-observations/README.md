# Android input release observations

These original result files were collected on application commit
[`208afb9e5be3bebef9fd50c5e1b77dcb40e29330`](https://github.com/kimjisub/unipad-android/commit/208afb9e5be3bebef9fd50c5e1b77dcb40e29330),
after [unipad-android#304](https://github.com/kimjisub/unipad-android/pull/304).
They retain their original source corpus SHA256
`fe37e7731224b51218d94a351e9513beab3f60206100511f90d238612b1069c8` (382 cases).
Neither file is relabelled as a full run of the subsequently generated corpus.

| File | SHA256 |
| --- | --- |
| [RUN-G617.json](RUN-G617.json) | `90aa9083125a706bba3da30cc62d48c01090256cd6b05fad84fd70d12f09a330` |
| [RUN-G618.json](RUN-G618.json) | `5866b8aa01d14c230421c6a94dd322705378ac404a19d0dbe246a34ca2b2dde0` |

A local test-only input adapter sent distinct fingers through `PadTouchTracker` to
`padTouch`, and controller input through `controllerPadTouch`. It advanced each scenario's
clock by the specified 20 ms and observed the application playback and light runners.
Pack output was collected with press feedback disabled; the same scenario was then run
with press feedback enabled to observe pressed state separately. Both pressed sequences
match `[true, true, true, false]`. Both pack outputs delay `soundStop` and `ledOff`
from the third checkpoint until the fourth, contrary to the unchanged expectations.

The selected `PlayerInputReleaseObservationTest` suite ran two tests, with two value
comparison failures, no errors or skips, exit code 1. The command took 202.082 seconds;
the test suite took 6.489 seconds. This was one command execution and four scenario
executions (feedback off and on for each case). The test-only overlay was not a public
helper commit. Application source and stored app corpus copies were not modified.

```sh
./gradlew -I verification/player-input/observe.init.gradle :app:testDebugUnitTest \
  --tests 'com.kimjisub.launchpad.unipack.conformance.PlayerInputReleaseObservationTest' \
  --rerun --no-build-cache --no-daemon --console=plain
```

This JVM observation controls the clock and recording engine. It does not test screen
event delivery or rendering, physical fingers, USB delivery, decoding, native mixing,
audible output, or all 382 cases. The pre-#304 observations on `777cc4a3` are historical:
they must not replace these results on the changed input implementation.
