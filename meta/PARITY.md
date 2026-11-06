# Platform parity

Where Android, iOS and Web stand relative to each other. Update this in the same
change that creates or closes a gap — a gap that only exists in someone's head
comes back.

Source audit: 2026-11-07 (Korea time), at Android
[`f8760475`](https://github.com/kimjisub/unipad-android/tree/f8760475f0e392e241ac4a0e202eb1a59a9e513c),
iOS [`7270e169`](https://github.com/kimjisub/unipad-ios/tree/7270e1698f759f44996f65112f501e8eebf52b64)
and web [`64d7149c`](https://github.com/kimjisub/unipad.io/tree/64d7149ca627031f71b0286f639566cbc734016a),
their `main` heads when read. Screens, MIDI registration, engine behaviour and slide settings below
describe those sources, not which store build contains them. The parser/runner section keeps its
own dated observations and application commits. Simulator verification for this audit is limited to
repeated-sound stopping and play-screen responsiveness; physical MIDI and audio output remain unverified.

Which devices, operating systems and browsers each platform runs on is not tracked here but in
[`compatibility/`](compatibility/README.md) (support matrix, evidence, world-distribution sources).

## Repos

| Platform | Repo | Notes |
|---|---|---|
| Android | `unipad-android` | Android app |
| iOS | `unipad-ios` | iOS app |
| Web | `unipad.io` | Player + store + docs site; also hosts this `meta/` directory |

## Screens

The Android-to-iOS screen mapping below records source entry points; USB attachment is handled
by CoreMIDI on iOS rather than an Android-style intent.

| Android | iOS |
|---|---|
| SplashActivity | `Splash/SplashView` |
| MainActivity | `Main/MainView` |
| PlayActivity | `Play/PlayView` |
| FBStoreActivity | `Store/StoreView` |
| SettingsActivity | `Settings/SettingsView` |
| ThemeActivity | `Theme/ThemeView` |
| TransferActivity | none: `Transfer/TransferView` was removed by [unipad-ios#27](https://github.com/kimjisub/unipad-ios/pull/27) as unreachable |
| MidiSelectActivity | `MidiSelect/MidiSelectView` |
| MidiBannerController | `MidiConnectionBannerView` + `MidiBannerCoordinator` |
| UsbMidiHandlerActivity | n/a — iOS uses CoreMIDI, there is no USB attach intent |
| BaseActivity | n/a — SwiftUI |

Source inventory: [Android activities](https://github.com/kimjisub/unipad-android/tree/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/activity)
and [iOS views](https://github.com/kimjisub/unipad-ios/tree/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Views).

## MIDI drivers

| Device | Android | iOS |
|---|---|---|
| Launchpad S / Mini | `LaunchpadS` | `LaunchpadSDriver` |
| Launchpad MK2 | `LaunchpadMK2` | `LaunchpadMK2Driver` |
| Launchpad Pro | `LaunchpadPRO` | `LaunchpadProDriver` |
| Launchpad X | `LaunchpadX` | `LaunchpadXDriver` |
| Launchpad Mini MK3 | `LaunchpadMiniMK3` | `LaunchpadMiniMK3Driver` |
| Launchpad Pro MK3 | `LaunchpadMK3` | `LaunchpadProMK3Driver` |
| Launchpad Pro MK2 (CFW) | `LaunchpadPROCFW` | `LaunchpadProCFWDriver` |
| Launchpad CoreFW | `LaunchpadCoreFW` | `LaunchpadCoreCFWDriver` |
| Matrix | `Matrix` | `MatrixDriver` |
| Midi Fighter | `MidiFighter` | `MidiFighterDriver` |
| Master keyboard / fallback | `MasterKeyboard`, `Noting` | `MasterKeyboardDriver`, `GenericDriver` |

Note the Android class for the Pro MK3 is named `LaunchpadMK3`, not `LaunchpadProMK3`.

### Registration and remaining verification

- **Launchpad Pro (Launchpad Open) and CoreFW are registered on all three.** The web has
  `launchpad_pro_cfw`, `launchpad_corefw` and `launchpad_corefw_rg`
  ([profiles](../src/lib/unipack/MidiProfiles.ts), [mapping](../src/lib/unipack/MidiConnection.ts),
  [Pro mapping change #14](https://github.com/kimjisub/unipad.io/pull/14),
  [CoreFW change #107](https://github.com/kimjisub/unipad.io/pull/107)). Android registers Pro CFW and
  the RGB/two-colour CoreFW variants in
  [MidiConnection.kt](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/midi/MidiConnection.kt)
  ([CoreFW change #203](https://github.com/kimjisub/unipad-android/pull/203)); iOS registers them in
  [MidiManager.swift](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Services/MIDI/MidiManager.swift).
  Registration and code mappings do not establish correct lights or input on physical hardware;
  this audit did not connect these controllers.
- **Dual-launchpad support remains Android only in the audited sources.**
  [Android MidiConnection.kt](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/midi/MidiConnection.kt)
  maintains multiple sessions behind `dualPadModeEnabled`, introduced by
  [unipad-android#64](https://github.com/kimjisub/unipad-android/pull/64).
  [iOS MidiManager.swift](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Services/MIDI/MidiManager.swift)
  and [web MidiConnection.ts](../src/lib/unipack/MidiConnection.ts) select one controller connection.
  Two physical controllers were not tested.

## Engine

Present on both Android and iOS: UniPack parser, the four runners
(sound / LED / autoplay / chain), channel manager, local database, Firebase store,
recording, push, ZIP themes, autoplay auto-mapping.

Platform-specific by design, not gaps: Oboe low-latency audio and the Storage
Access Framework migration on Android; CoreMIDI on iOS.

### Volume

| Platform | Behaviour |
|---|---|
| Android | Sets the system media stream; a ContentObserver follows external changes. |
| iOS | Sets the system volume through MPVolumeView; KVO follows external changes. |
| Web | Sets the player's own gain node and persists the level. Browsers cannot touch the system volume, and the level survives a reload because nothing else remembers it. |

The eight volume positions show the quantized level in blue. The source paths are
[Android `setVolume`/`updateVolumeUI`](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/activity/PlayActivity.kt),
[iOS `setVolume`/`updateVolumeUI`](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/ViewModels/PlayViewModel.swift),
and [web `applyVolumeLevel` and chain display](../src/components/play/useUniPadEngine.ts).

### Sound decoding failures

| Platform | Behaviour |
|---|---|
| Android | Per-file failures are reported; admitted sounds that decode successfully remain playable. If every sound fails, playback is disabled and the failure details offer an exit. |
| iOS | Per-file failures produce a notice and successfully decoded sounds remain playable. If none can play, the screen presents a load failure instead of becoming ready. |
| Web | Failed files are listed as warnings and successfully decoded sounds remain playable; if every file fails, loading fails. |

This is no longer a web-only partial-load policy. See
[Android `onReport`/`onException`](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/viewmodel/PlayActivityViewModel.kt)
and [failure dialog](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/activity/PlayActivity.kt)
([unipad-android#331](https://github.com/kimjisub/unipad-android/pull/331)),
[iOS `onSoundLoadingComplete`](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/ViewModels/PlayViewModel.swift)
and [failure presentation](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Views/Play/PlayView.swift),
and [web sound loading](../src/lib/unipack/SoundEngine.ts)
([unipad.io#211](https://github.com/kimjisub/unipad.io/pull/211)). Engine setup failures are a separate path;
this table describes individual sound files that cannot be loaded.

### Web player controls

The web player has keyboard pad mapping (rows by physical key, F1–F12 for chains, Space for AutoPlay),
Alt shortcuts, an in-play MIDI panel, status badges, drag-and-drop import, `?pack=`/`?code=` links
and a volume slider ([PlayPage](../src/components/play/PlayPage.tsx),
[play hook](../src/components/play/useUniPadEngine.ts)).

The web saves volume, watermark, slide choice and trace display style; feedback light starts from
the pack's LED availability, rather than a saved global switch
([`PLAY_PREFERENCE_KEYS` and saved-preference loading](../src/components/play/useUniPadEngine.ts)).
iOS also saves watermark, slide choice and trace display style
([PreferenceManager](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Services/PreferenceManager.swift)).

### Library and usage differences (source audit 2026-11-07)

- **Pack-list search is present on all three.** Android's
  [`MainActivity.searchQuery` and `PackSearch.filter`](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/activity/MainActivity.kt)
  filter the saved pack list; iOS uses
  [`MainViewModel.searchQuery`](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/ViewModels/MainViewModel.swift)
  and web uses [MainScreen](../src/components/play/MainScreen.tsx).
- **Sort counts still differ:** Android has title, producer and download date
  ([MainTotalPanelViewModel](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/viewmodel/MainTotalPanelViewModel.kt));
  iOS adds play count and last opened
  ([MainViewModel.SortMethod](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/ViewModels/MainViewModel.swift)).
- **An empty title still gets a fallback in the play menu**, in
  [Android PlayActivity](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/activity/PlayActivity.kt),
  [iOS PlayOptionPanel](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Views/Play/PlayOptionPanel.swift)
  and [web `playMenuTitle`](../src/components/play/packTitle.ts).
- **Deleting a pack removes its history row** on the native apps since
  [unipad-android#105](https://github.com/kimjisub/unipad-android/pull/105) and
  [unipad-ios#32](https://github.com/kimjisub/unipad-ios/pull/32); see the current
  [Android repository deletion](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/db/repository/UnipackRepository.kt)
  and [iOS `deleteItem`](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/ViewModels/MainViewModel.swift).
- **Analytics names still differ, but Android now records events.**
  [Android UsageEvent](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/analytics/UsageEvent.kt)
  and [iOS UsageEvent](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Services/Analytics/UsageAnalytics.swift)
  name `pack_import`, `pack_load`, `play_start`, `play_first_input` and `play_end`.
  [Web UsageEvent](../src/lib/analytics/usageEvents.ts) names `pack_load`, `pad_press` and `autoplay_start`.
  Source event definitions do not prove delivery to the analytics backend; this audit did not measure it.

## Parser and runner conformance

`meta/unipack-conformance/` holds one corpus of small packs that all three parsers and runners read.
The recheck on 2026-11-07 (Korea time) uses G6, 391 cases, corpus SHA-256
`746a5ce6925926df2a27ac34313c157662e244a1a70ae873eec7f8d7391e3c64`.

| Platform | Application commit | Common cases passed | Failed | Unverified |
|---|---|---:|---:|---:|
| Android | `f47058f6f788d7b7dd372aae07bc1bc33f6c58d4` | 368 | 0 | 23 |
| iOS | `44ab0823e885c37f520f57fa9d383f2041d8d266` | 391 | 0 | 0 |
| Web | `d4e771e0bbd3ba585bf12d6157977dadd27379b5` | 391 | 0 | 0 |

All rows use the same corpus bytes, with unchanged inputs, fingerprints and expected values.
The Android and iOS commits above are the heads of the pull requests that carried the corpus copies;
those copies reached each app's `main` in merge commits `f8760475f0e392e241ac4a0e202eb1a59a9e513c`
(Android) and `7270e1698f759f44996f65112f501e8eebf52b64` (iOS), which `copies.json` names.
Each application's common and app tests use the same clean application commit; commands record
the commit and source status before and after execution. iOS uses the default Xcode 27.1
(27A9275) and an iPhone 17 Pro simulator running iOS 27.0.

Android's 23 unverified cases are KL-026/KL-028 (the host changed stored names), the ten
archive sound-identity cases, KS-G617 through KS-G619 (case-sensitive paths), and the eight
distinct screen-input cases. They are not passes. The separate Android app tests confirm
eight registered items and include captured emulator output; the web app tests confirm
seven registered items, with audio measured in Chromium only. Physical output is unverified.

The first iOS unit invocation ran twice: both preserved raw attempts passed, but the execution
wrapper initially exported only the final bundle. Combining both attempts rejects the repeated
registered unit tests, leaving that round at 99 of 114 grammar items. A separate follow-up on the
same clean commit ran the six selected unit suites and one required UI import test; every raw
attempt was collected. Its 16 registered unit tests and one UI test passed exactly once, with no
missing, skipped or repeated required tests. This does not claim a full UI-suite pass or fill
skips from the earlier full unit invocation.

Combining the common and registered app tests confirms Android 96, iOS 104 and web 104 of the
114 grammar items, with 96 confirmed on all three. iOS has 99 items confirmed by the common
run and five further items by app tests; F-01 rests on the case-sensitive common run. Unconfirmed
items remain unconfirmed, and these counts do not establish every UniPack's compatibility.

The browser inventory has 1,665 distinct registered tests. Preserved rounds cover 1,489 passes
and 176 skips: Chromium 677/12, WebKit 380/119, and Firefox 432/45 (passed/skipped).
The first full command retained 658 passes before a deleted temporary directory caused 41 failures
and one interruption. Those failures remain in the original record. A follow-up checked the
remaining Chromium and all WebKit entries, then stopped at the planned browser boundary (exit 130);
the complete Firefox command exited 0. The final selected observations match the inventory in both
directions with no missing, duplicated, retried or unexpected results. Skips retain the existing
browser-specific conditions. These are split-run observations with the first failed round retained.

The first remote full-unit run on the same iOS commit failed two sound tests on the pack-loading
deadline. [The second attempt of the whole job](https://github.com/kimjisub/unipad-ios/actions/runs/42264092093)
passed 959 tests, failed none and skipped 25. Preserve the time-only first failure and the successful
whole-job re-execution (1/1); the two tests were not rerun alone. The timeout was unchanged.

The exact public app copies are [unipad-android#365](https://github.com/kimjisub/unipad-android/pull/365)
and [unipad-ios#259](https://github.com/kimjisub/unipad-ios/pull/259), at the commits in the table.
Their downloaded corpus files pass `sync.mjs --check --require-current` against this corpus.
These references identify reviewed copies; merge status and a post-merge check remain separate.

The generated corpus and `divergences.json` have no remaining failure pins on any platform.
The two historical Android pins were removed using the ordered observations below, including
the restored-defect failures. Removing those annotations does not fill the 23 missing common
observations. Copy-byte verification is also separate from compatibility. The old 172-case and
other earlier results remain historical in [RESULTS.md](unipack-conformance/RESULTS.md).

KS-B08 and KL-BE10 have no current failure pin; both passed in these Android, iOS and web
common runs. No result here establishes every pack's compatibility, physical controllers,
phone speakers, headphones, Bluetooth output, or Android 7.0–8.0 audio output.

### Zero-width grid (`buttonX=0`)

The shared **INF-009** result agrees with the documented warning policy on all three:

| Input | Android | iOS | Web |
|---|---|---|---|
| `buttonX=0` with the INF-009 keySound lines | Opens with warnings; skips out-of-range keySound lines | Opens with warnings; skips out-of-range keySound lines | Opens with warnings; skips out-of-range keySound lines |

The unchanged [INF-009 definition](unipack-conformance/cases.mjs) expects a loaded pack,
`buttonX: 0` and both `info:missing-field` and `keySound:range` warnings. This records that
case's existing result from the common runs above; it does not extend it to every zero-sized pack. It also differs from non-integer `buttonX`, which aborts loading (INF-010). Source guards:
[Android UniPackFolder](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/unipack/UniPackFolder.kt),
[iOS UniPackFolder](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Models/UniPackFolder.swift),
[web parser](../src/lib/unipack/parser.ts), and the [info documentation](../content/docs/en/unipack/info.mdx).

### Open differences found by the corpus

There are no remaining pinned failures. Unverified observations above remain unverified.

A new difference found by the corpus is pinned in `divergences.json` and listed here until the
platform's own fix removes it.

### Resolved differences found by the corpus

- **RUN-G617/RUN-G618: Android releases the later input's sound and pack light.**
  The ownership fix in [unipad-android#309](https://github.com/kimjisub/unipad-android/pull/309)
  is confirmed by ordered screen records at `a9d7484e` from
  [unipad-android#358](https://github.com/kimjisub/unipad-android/pull/358).
  Both unchanged scenarios match every expected checkpoint, and restoring the old ownership
  condition makes the third and fourth checkpoints fail.
  [Original records, hashes and limits](unipack-conformance/investigations/android-input-release-resolution/README.md)
  distinguish this observation from the old common run's missing screen-input actual values.


- **RUN-G616: iOS cancels its delayed chain callback when autoPlay is turned off.**
  [unipad-ios#217](https://github.com/kimjisub/unipad-ios/pull/217) adds cancellation to the real
  mode-off path. A new asserting observation at application base `2827087ecbf1449ab8d5c55df22cd09610cc7e27`
  with separately retained executor changes matches the unchanged expected final checkpoint `[]`.
  Only the iOS pin is retired, producing the 382-case corpus `2223116e3a1612fcebed1d6c03e5075b3f0dbd1cd4bcffa12ff81b3e86c93d50`.
  The original partial failure and the newer full run keep their own hashes and statuses. The full
  run still failed (raw 374 pass, 3 fail, 5 unverified, exit 65), and is not a run on this regenerated
  corpus. RUN-G613 remains an unpinned repeat-count observation error. See the
  [source investigation](unipack-conformance/investigations/ios-playback-observations/README.md#corrected-callback-observation-2026-10-25)
  and [result limits](unipack-conformance/RESULTS.md#ios-delayed-chain-callback-corrected-2026-10-25).

- **RUN-G617, RUN-G618: the web play hook releases the later input's sound and lights immediately.**
  The play hook preserves each input identity and handles each release while keeping the press
  overlay until the final input. Both cases match the corrected expectations on application commit
  `1dbf0f464611041a3da6db02ce6b2175b41e4dbf` with unchanged test input SHA256 `7ac226a8…`.
  The two web pins are removed in regenerated corpus `cbb87354…` (`859e24aa…` together with the
  iOS RUN-G616 pin, the resolved RUN-P001/RUN-P002 web pins and the sixteen web sound lookup pins
  retired by [unipad.io#183](https://github.com/kimjisub/unipad.io/pull/183)); the earlier failure observations
  keep their original commit and hash. No native or physical-output pass is claimed. See [RESULTS.md](unipack-conformance/RESULTS.md#web-input-owned-release-fix-2026-10-25).
- **RUN-P001, RUN-P002: web trailing-wait observations match their existing expectations.**
  [unipad.io#178](https://github.com/kimjisub/unipad.io/pull/178), merged as
  `d8eb6ba516bf250a4894cc2b0f26edd5b9ee8291`, resolves the two web observations without
  changing inputs, fingerprints, scenarios or expected results. Only their web failure pins were
  removed. The reviewed 382-case corpus records 361 web passes and 21 remaining pinned failures;
  its SHA256 is `9bf7e8ef0676fc1370976f32c77c4fa9c96752b5d551021496e2610d2580c5b6`, including
  the newer RUN-G616 iOS failure observation. Both native references still select historical
  214-case snapshots: their two warnings remain, and strict current-copy verification is incomplete.
  See [RESULTS.md](unipack-conformance/RESULTS.md#web-trailing-wait-fix-merged-2026-10-25)
  for the reviewed commit, observation counts, initial-timer shortening of up to 1 ms and other
  verification limits.
  Android and then iOS have since moved to the 391-case current corpus copy, which the strict check
  accepts; see [the Android move](unipack-conformance/RESULTS.md#android-copy-reference-moved-to-the-current-corpus-2026-10-31)
  and [the iOS move](unipack-conformance/RESULTS.md#ios-copy-reference-moved-to-the-current-corpus-2026-11-04).
- **KS-B08, KL-BE10: Android now stores the exact zero-based value `-2147483649`.**
  [unipad-android#303](https://github.com/kimjisub/unipad-android/pull/303) resolves the sound-loop
  and LED coordinate/chain storage differences. G6 already removed both old Android pins.
  The app copy references then selected that Android merge and iOS merge `e8ac34d…`
  ([unipad-ios#213](https://github.com/kimjisub/unipad-ios/pull/213)): identical 214-case snapshots,
  SHA256 `18a80808b9c032c288c4b4791bd6c967d446b21c3b08279d1e74728d315f0b97`.
  The 382-case G6 canonical corpus is unchanged; these historical snapshots do not establish current
  app compatibility. See [RESULTS.md](unipack-conformance/RESULTS.md#android-minimum-integer-storage-differences-resolved-2026-10-25).
  Android and then iOS have since moved from these snapshots to the 391-case current corpus copy; see
  [the Android move](unipack-conformance/RESULTS.md#android-copy-reference-moved-to-the-current-corpus-2026-10-31)
  and [the iOS move](unipack-conformance/RESULTS.md#ios-copy-reference-moved-to-the-current-corpus-2026-11-04).
- **Twelve G6 web playback differences matched their expectations at that revision.**
  RUN-G617 and RUN-G618 have since received corrected input-owned release expectations and are
  failed again before the input-owned release fix above. The following observation retains its original hash.
  [unipad.io#173](https://github.com/kimjisub/unipad.io/pull/173) fixes RUN-G601..605,
  RUN-G607..610 and RUN-G616..618. Their web failure pins were already retired in
  [unipad.io#165](https://github.com/kimjisub/unipad.io/pull/165). A rerun on the merged G6 main
  confirms all twelve with unchanged inputs and expectations: 382 cases, 359 pass and 23 remaining
  pinned web failures. RUN-G606 follows a separate revised rule and is not part of this removal.
  The corpus SHA256 remains `3f6b68d623d0870f126285653426948c2b6309a939c71c4bc0f5a15b27c257b6`;
  the app pins still describe historical copies, not current compatibility results.
  See [RESULTS.md](unipack-conformance/RESULTS.md#web-playback-observations-retired-with-g6-2026-10-24)
  for the exact tested commit, copy hashes and verification limits.
- **RUN-A-003: Android no longer reports a chain change twice when an autoPlay chain command is
  followed by a press.** [unipad-android#283](https://github.com/kimjisub/unipad-android/pull/283)
  fixes the command order so the recorded events match the existing expected result. Only this Android
  observation-order pin was removed; case inputs, fingerprints, scenarios, expected results and bases
  are unchanged. The previous corpus SHA256 was
  `e233029559c3a251ad8c2103905135a08a7d4b0207715ea0e8633f228c7bb358`; the regenerated SHA256 is
  `37096f03b811ae4813ed3a5b68dffbb6da70d741cf67bae4a5c52559e4a8eabf`.
  See [RESULTS.md](unipack-conformance/RESULTS.md#changes-after-the-android-autoplay-chain-order-fix-2026-10-21)
  for the matching app-copy commits and the limits of the retained aggregate report.
- **KS-B01..08, KL-BN01..08, KL-BE01..10, AP-B01..08: a number in a pack is a 32-bit integer on all
  three.** Android always
  read pack numbers as 32-bit integers, so `2147483648` was a format error and
  only its line or file was skipped. iOS read numbers up to 64 bits and the web any number, so the same
  value was a range error there; the web also rounded numbers past 2^53 and dropped a round LED line with
  a 400-digit number without a warning. iOS and the web now read a number that does not fit in 32 bits as
  a format error and range-check one that does, as Android does. The 34 cases were added to the corpus (a
  keyLED file name holds the 400-digit number cut to 240 digits, so the name stays within the 255-byte limit of a file name); the
  previous corpus SHA256 was `844fa232eafac305f068fafad1cf4ada2e343f423a802b128242812711943c95`.
- **INF-007, INF-010, INF-016: Android reads `info` as the docs say.** Android skips an `info` line
  without `=` without a warning and refuses a pack whose `buttonX` or `buttonY` is not an integer
  (`info : buttonX is not a number`) instead of opening it with no pads. Its three pins were removed; the
  input fingerprints are unchanged. The corpus SHA256 after that fix was
  `844fa232eafac305f068fafad1cf4ada2e343f423a802b128242812711943c95`; the previous one was
  `4a67dbe1e91930816e58816490ae1522c4b7ed300a2b8a5f028bb0a281d61381`. See
  [RESULTS.md](unipack-conformance/RESULTS.md).
- **KS-019, KS-020, KS-021, RUN-S-006: a `keySound` name that differs from its file only in case
  plays that file on all three.** Official store packs list `End.wav` for a file stored as `END.wav`.
  The web already used the file whose whole path under `sounds/` differs only in case; iOS left those
  pads silent, and so did Android on storage that tells upper and lower case apart. Both now find the
  file and report its stored name. A folder, or a file of that name in another folder, is still missing.
  The four cases were added to the corpus; the previous corpus SHA256 was
  `fe56df2756a063d3416bbd5b8219c84c73b61d2ae646805ac2a8ccbd8905efa2`. See
  [RESULTS.md](unipack-conformance/RESULTS.md).
- **KS-018, KL-024: the web now reads a UTF-16 text file with a byte order mark and keeps keyLED events
  outside the pad grid.** The web read every pack text file as UTF-8, so a keySound saved as UTF-16 (Windows
  Notepad's "Unicode") had no line it understood and the pack had no sound. It now reads `info`,
  `keySound`, keyLED files and `autoPlay` as UTF-16 when they start with a byte order mark, as Android and
  iOS do for all four. A keyLED `on` or `off` outside the pad grid was dropped with a format warning per
  line; it is now kept as written, without a warning, and the LED runner skips it when it is lit, so the
  pads and the Launchpad light as before. A non-number is still a format error, and so is a column of
  `0`, which the web keeps from becoming a round LED (Android and iOS read it as one; no case covers it).
  Both web pins were removed; the input fingerprints are unchanged. The previous corpus SHA256 was
  `3f1845257d2277fb5ba03e31a0f4eaf4dbbef3da0d83bfa87d82abc66c1d51ea`. See
  [RESULTS.md](unipack-conformance/RESULTS.md).
- **INF-007, INF-010, INF-015, INF-016: iOS reads `info` as the docs say.** iOS skips an `info` line
  without `=` without a warning, refuses a pack whose `buttonX` or `buttonY` is not an integer instead of
  opening it with no pads, and no longer reads `info.json` when there is no `info` file. Its three pins
  were removed; INF-016 (`buttonY=abc`) was added so that a fix of `buttonX` alone no longer passes.
- **AP-M01..M09, AP-M11, KL-N01..N05: the web now calls a value that is not a whole number a format
  error.** The web parser reported a non-numeric autoPlay value or keyLED file-name field as a range
  error (`autoPlay: [on a 1] coordinate is incorrect`, `keyLed: [a 1 1] chain is incorrect`); Android
  and iOS report `format is incorrect`. All three dropped the line or file, so only the warning text
  differed. The web now writes `autoPlay: [on a 1] format is incorrect` and `keyLed: [a 1 1] format is
  incorrect`; a number outside the pack is still a range error. The 15 web pins were removed; the input
  fingerprints are unchanged. The previous corpus SHA256 was
  `c30e75b9985e2fbb591ada9da3fac0a5437515ebe8a90e8f95ff8679066283d8`. See
  [RESULTS.md](unipack-conformance/RESULTS.md).

- **KL-M05: the web now rejects an x coordinate with trailing letters.** The previous web result lit pad (0,0)
  for `o 1b 1 FF0000`: `parseInt` stopped at the letter. [unipad.io PR #37](https://github.com/kimjisub/unipad.io/pull/37),
  main [`ffe8fa0`](https://github.com/kimjisub/unipad.io/commit/ffe8fa0916bd27a38b5dc086a4f0da1c721da46b), reads both
  coordinates with `strictInt` and rejects coordinates outside the pad grid. Only the web pin was removed; the other
  15 web records and all 124 input fingerprints remain unchanged. The previous corpus SHA256 was
  `2317abb20fe8499fef8b9e9c4e0dc11e63849a8db5ba020d353418c835520c8b`; the regenerated corpus SHA256 is
  `3c8ec4875cffab4dabbd454f32fbb7f2b30b5d977b1d25ca0a0b8b21ebc251b9`. See
  [RESULTS.md](unipack-conformance/RESULTS.md#changes-after-the-web-coordinate-fix).
- **KL-012, KL-014, KL-M11, KL-M12, KL-M17, KL-M18: iOS now rejects malformed keyLED arguments.**
  The previous iOS results kept `o mc 33`, `o * 0`, `f mc 33` and `f mc 0` (33 reached the logo at index 32,
  0 addressed index -1), lit `o 1 1 FF0000 x`, `o 1 1 FF0000 5 6` and `o l 0 a 5 9` instead of reporting them,
  and read the out-of-range auto velocities in `o 1 1 a 200` and `o 1 1 a -1` as the colour `ff00000a`.
  [unipad-ios PR #56](https://github.com/kimjisub/unipad-ios/pull/56),
  main [`0c0e47c9`](https://github.com/kimjisub/unipad-ios/commit/0c0e47c9a10ca563101ef898b022b012a3aa5e4b),
  drops round LED numbers outside 1..32, rejects extra trailing arguments and malformed supplied
  velocities, and adds `KeyLedInputValidationTests` with the exact inputs of all six cases. Only these six
  iOS pins were removed; the 16 web records and all 124 input fingerprints remain unchanged. The previous
  corpus SHA256 was `ed629f5ab29c616b2da273631e1fc579e4a17b637167cc34d435659c00956c96`; the regenerated
  corpus SHA256 is `2317abb20fe8499fef8b9e9c4e0dc11e63849a8db5ba020d353418c835520c8b`. See
  [RESULTS.md](unipack-conformance/RESULTS.md#changes-after-the-ios-keyled-argument-fix) for the evidence
  and rerun limits; the historical aggregate above was not recalculated.
- **KL-M13: Android now rejects a 7-digit hex colour.** The previous Android result was
  `on 0 0 00234567 4` with no error: `toInt(16)` accepted seven digits and adding the alpha offset
  carried into alpha. [unipad-android PR #133](https://github.com/kimjisub/unipad-android/pull/133),
  main [`59f8ebcf`](https://github.com/kimjisub/unipad-android/commit/59f8ebcf493e82a6a2726ba39757a88aa41184ea),
  checks the colour token length before conversion and includes a regression for the exact KL-M13 input.
  Only its Android pin was removed; the other 22 records and all 124 input fingerprints remain unchanged.
  The previous corpus SHA256 was `30ad4442b7abf40ee0cbfcc97976999fbde4571b30f1d39590425620e4c465eb`;
  the regenerated corpus SHA256 is `ed629f5ab29c616b2da273631e1fc579e4a17b637167cc34d435659c00956c96`.
  See [RESULTS.md](unipack-conformance/RESULTS.md#changes-after-the-android-colour-length-fix) for the
  preserved history and rerun limits; the historical aggregate above was not recalculated.

### Not observed, so not known

iOS now measures the six cases the corpus used to mark as not observable on iOS, and all six pass: autoPlay timing (RUN-A-001, RUN-A-002, RUN-RP-003, RUN-RP-004), with `AutoPlayRunner` given a virtual clock and sleep by the harness, and the lights after leaving the play screen (RUN-L-006, RUN-L-007). See [RESULTS.md](unipack-conformance/RESULTS.md#changes-after-ios-observed-the-six-exit-and-autoplay-cases) and, for the marks being dropped, [the section above it](unipack-conformance/RESULTS.md#changes-after-dropping-the-ios-unobserved-marks). What is still not known:

- **What a Launchpad shows after the play screen is left on iOS** (RUN-L-006, RUN-L-007). Android clears them in the play screen's `onStop` (#101) and the web in `LedRunner.stop()` (#32). At `stop` the iOS harness runs the main screen's step that takes the MIDI controller back (`MainMidiControllerAdapter.onAttach` → `sendClearLed`) against a recording MIDI driver, so it sees the clear being sent, not the lights going out on a device. Nobody has checked that on a Launchpad. An earlier version of this section said "iOS does not turn lit LEDs off when the play screen is left", which came from stopping the runner alone in the test.
- **Round and logo lights on Android with Pro light mode off**, which is how the play screen starts. The corpus measures Android with it on.

### Repeated-sound stop hang: fixed, rechecked on iOS main

The September 30 hang was fixed by
[unipad-ios#51](https://github.com/kimjisub/unipad-ios/pull/51), merged October 2 as
[`c034f70d`](https://github.com/kimjisub/unipad-ios/commit/c034f70d7a87f70669f827626b08720299fd4e42).
It moved completion work out of AVFoundation's callback. In the audited
[SoundEngine/FiniteRepeatScheduler](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Services/Audio/SoundEngine.swift),
callbacks enqueue work and return; finite-repeat scheduling and stopping share a serial queue,
so stopping a node does not wait for a callback that is waiting for that queue.

Rechecked on 2026-11-07 at iOS `7270e1698f759f44996f65112f501e8eebf52b64`, with unchanged
application and test sources, on iPhone 17 Pro / iOS 27.0 using the default Xcode 27.1 (27A9275):

| Existing check | Observed result |
|---|---|
| `testRepeatedVoiceCanBeStoppedImmediately` | 30 screen-model cleanup rounds with keySound loop 3, immediately or 1–9 ms after a press; passed. |
| `testRepeatedVoiceCanBeRetriggeredImmediately` | 100 pairs of presses on the same pad with loop 3; all 200 plays started and the test passed. |
| `destroyWhileARepeatedSoundIsCycling()` | 30 rounds alternating loop 3 and 50, destroying 0–29 ms after the press; all returned in 0.2–0.4 ms and the test passed. |

The first two checks use the production `PlayViewModel`
([PlaybackStopTests](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipadTests/PlaybackStopTests.swift));
the third keeps the original short-tone reproduction input
([UniPackConformanceTests](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipadTests/UniPackConformance/UniPackConformanceTests.swift)).
These selected checks did not hang; this is not a full-suite or physical-output claim.
The original commands, stacks and failures remain as historical evidence in
[RESULTS.md](unipack-conformance/RESULTS.md#ios-destroy-while-a-repeated-sound-is-cycling).
Physical devices and older iOS versions were not checked in this audit.

### Documentation that disagrees with the code

- Out-of-range keyLED file names are "ignored" and autoPlay lines are "skipped" in the docs, without specifying warnings; all three record one range error each (KL-003, AP-004). The warning is held on an agreed basis, not as documented behaviour.
- `auto-play.mdx` does not say what a line starting with an unknown word does, and `key-led.mdx` says such a line is "skipped" without saying whether it warns; all three record a format error (KL-M07, KL-025, AP-M10, AP-022, held on an agreed basis).

## Slide across pads

All three offer a saved, opt-in setting, **off by default**. When enabled, dragging a finger onto
another pad plays it and releases the one it left. When disabled, moving over another pad does
not start that pad.

| Platform | Setting and input path |
|---|---|
| Android | [Settings > Play](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/activity/SettingsActivity.kt) > "Slide across pads". [`PreferenceManager.slideMode`](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/manager/PreferenceManager.kt) defaults to `false`; [PlayActivity](https://github.com/kimjisub/unipad-android/blob/f8760475f0e392e241ac4a0e202eb1a59a9e513c/app/src/main/java/com/kimjisub/launchpad/activity/PlayActivity.kt) applies it to `padTouch.slide`. Introduced by [unipad-android#26](https://github.com/kimjisub/unipad-android/pull/26). |
| iOS | [Settings](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Views/Settings/SettingsView.swift) and [play options](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Views/Play/PlayOptionPanel.swift) both bind `SlideEnabled`, default `false` in [PreferenceManager](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Services/PreferenceManager.swift). [PadGridView/MultiTouchView](https://github.com/kimjisub/unipad-ios/blob/7270e1698f759f44996f65112f501e8eebf52b64/unipad/Views/Play/PadGridView.swift) checks `slideEnabled` on movement. Added by [unipad-ios#231](https://github.com/kimjisub/unipad-ios/pull/231). |
| Web | Play options > "Slide across pads". [OptionPanel](../src/components/play/OptionPanel.tsx) updates the saved `slideMode` in [useUniPadEngine](../src/components/play/useUniPadEngine.ts); [PadGrid](../src/components/play/PadGrid.tsx) defaults to `false` and gates pointer movement on that value. Added by [unipad.io#187](https://github.com/kimjisub/unipad.io/pull/187). |
