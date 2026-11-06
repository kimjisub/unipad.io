# Android later-input release observations

The two remaining historical Android failure pins are removed using the actual
ordered records from [unipad-android#358](https://github.com/kimjisub/unipad-android/pull/358),
application test commit `a9d7484eae409c794e47146c360bd98d1994c477`.
The application ownership fix is [unipad-android#309](https://github.com/kimjisub/unipad-android/pull/309),
merge `112ac382`. The recording changes merged as `5809edbdae40669c0422163243a0cf6ca2b0419b`.

The original 391-case G6 corpus SHA-256 is
`13cc746d567347d304f46d01518011f1c2aaf1d8ce19c5877bf2419b6c98ab7d`.
The IDs, case fingerprints, scenario steps and expected results are unchanged.
`comparison.json` contains an independent conversion of the original ordered
sound requests and pad-light changes into each checkpoint's events. For these
four records there are no equal-millisecond timestamps across the sound and
light channels. Original file digests are included.

| Case | Corrected application | Ownership condition restored to the old defect |
| --- | --- | --- |
| RUN-G617, two fingers | All four checkpoints match | Checkpoints three and four fail |
| RUN-G618, finger and virtual controller | All four checkpoints match | Checkpoints three and four fail |

In the corrected records, releasing the later input stops the sound and pack
light at checkpoint three; releasing the earlier input adds no output event.
The additional `-press-light.json` observations keep the press indication on
until the last input releases. The separate restored-defect patch changes only
the ownership condition and reproduces the historical failure.

Device: Android API 35, `sdk_gphone64_arm64`, build `AE3A.240806.043`.
Command: `ANDROID_SERIAL=<rented-device> bash scripts/ci-connected-tests.sh
com.kimjisub.launchpad.basefeatures.ConformanceScreenObservationTest`.
The independent run discovered and started all ten tests and exited zero.

These records use real-time screen input, a virtual controller path and a
recording audio output. Their recorder status remains `unverified`: they do
not certify virtual-clock timing, the physical USB transport, rendered screen
pixels or speaker output. They do not change the previous common run's 23
unverified cases into passes. The historical failure records remain under
`../android-input-release-observations/`.
