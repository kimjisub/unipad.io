# Platform parity

Where Android, iOS and Web stand relative to each other. Update this in the same
change that creates or closes a gap — a gap that only exists in someone's head
comes back.

Last verified: 2026-09-08. Sections marked *(re-read 2026-09-30)* were read again on that date at the latest
`main` commit of each repository (unipad-android `20207d89`, unipad-ios `1ef848d`, unipad.io `1f13a4a`); the
rest still date from 2026-09-08. "Sold build" means the commit is contained in the final release commit of a
build on sale: Android 4.1.8 (115) `7d740029` (in a staged rollout next to 4.1.3), iOS 4.1.6 (build 7)
`fe2e99c`, web `8019666` (`prod`, two commits behind baseline `3760b3c`). Everything in these sections was read from source;
none of it was run on a device.

Which devices, operating systems and browsers each platform runs on is not tracked here but in
[`compatibility/`](compatibility/README.md) (support matrix, evidence, world-distribution sources).

## Repos

| Platform | Repo | Notes |
|---|---|---|
| Android | `unipad-android` | Oldest, largest user base, all outside contributors so far |
| iOS | `unipad-ios` | Newest; screens and engine fully ported |
| Web | `unipad.io` | Player + store + docs site; also hosts this `meta/` directory |

## Screens

Every Android screen has an iOS counterpart except the file-transfer screen.

| Android | iOS |
|---|---|
| SplashActivity | `Splash/SplashView` |
| MainActivity | `Main/MainView` |
| PlayActivity | `Play/PlayView` |
| FBStoreActivity | `Store/StoreView` |
| SettingsActivity | `Settings/SettingsView` |
| ThemeActivity | `Theme/ThemeView` |
| TransferActivity | none on `main` *(re-read 2026-09-30)*: `Transfer/TransferView` was removed by unipad-ios#27 (2026-09-27) as unreachable; the sold 4.1.6 still contains the file |
| MidiSelectActivity | `MidiSelect/MidiSelectView` |
| ImportPackByUrlActivity | `Import/ImportByUrlView` |
| MidiBannerController | `MidiConnectionBannerView` + `MidiBannerCoordinator` |
| UsbMidiHandlerActivity | n/a — iOS uses CoreMIDI, there is no USB attach intent |
| BaseActivity | n/a — SwiftUI |

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
| Matrix | `Matrix` | `MatrixDriver` |
| Midi Fighter | `MidiFighter` | `MidiFighterDriver` |
| Master keyboard / fallback | `MasterKeyboard`, `Noting` | `MasterKeyboardDriver`, `GenericDriver` |

Note the Android class for the Pro MK3 is named `LaunchpadMK3`, not `LaunchpadProMK3`.

### Open gaps

- **Launchpad Pro MK2 (CFW), web: not supported.** The web `LaunchpadProfile` union has no
  `launchpad_pro_cfw`, so a CFW Pro falls back to the generic mapping and every pad is wrong.
  Android and iOS both have the driver.
- **Launchpad Core CFW: iOS only** *(re-read 2026-09-30)*. `LaunchpadCoreCFWDriver` exists in unipad-ios and has no
  Android or web counterpart (file listing of the three driver folders).
- **CFW driver, iOS: ported, unverified on hardware.** `LaunchpadProCFWDriver`
  (unipad-ios, 2026-09-06) mirrors the Android note map and has unit tests for it,
  but nobody has plugged a Pro MK2 on the "Launchpad Open" firmware into an iPhone yet.
  Auto-detect keys on a CoreMIDI source name starting with "Launchpad Open".
- **Dual-launchpad support: Android only** *(re-read 2026-09-30)*. Merged as unipad-android#64 on 2026-09-14 (replacing the
  review-stage #27); it is in the 4.1.8 (115) sold build, not in 4.1.3, and in no iOS or web code (no dual or
  secondary handling found in `Services/MIDI` or the web `MidiConnection.ts`). Never run with two physical pads.

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

The ring shows the level the same way on all three (8 - level lit, blue).

### Sound decoding failures

| Platform | Behaviour |
|---|---|
| Android, iOS | A pack whose sounds cannot be decoded shows "outOfCPU" and leaves the play screen. |
| Web | Files that fail to decode are listed as warnings and the pack keeps playing; only a pack where every file failed is a critical error. |

Deliberate: on the web a single unsupported codec should not cost the whole session, and there is
no memory pressure to escape from.

### Web-only affordances

Keyboard mapping (rows by physical key, F1-F12 for chains, Space for AutoPlay), Alt shortcuts, the
MIDI panel inside the play screen, status badges, drag-and-drop import, `?pack=`/`?code=` deep
links, a volume slider, and persistence of the volume, watermark and feedback-light toggles. These
exist because the web player is a single page with a keyboard and no settings screen; the mobile
apps keep those switches in the option panel and reset them per session.

### Known remaining differences *(re-read 2026-09-30; first written in the 2026-09-07 review)*

- **Android has no search on the pack list**; iOS (`MainViewModel.searchQuery`) and web do. Android's only search field is inside `TransferActivity`. Still open.
- **Android sort options are three** (title, producer, download date); iOS offers five (adds play count, last opened). Still open.
- **iOS has no file-transfer screen.** `TransferView` was removed from `main` by unipad-ios#27 (2026-09-27) as unreachable. The sold
  4.1.6 still has the file and a navigation case for it; whether anything in that build navigates there was not checked.
- **Deleting a pack now also removes the saved history row** (closed on `main`): unipad-android#105 and unipad-ios#32 both
  landed after the final release commits (4.1.8 `7d740029`, 4.1.6 `fe2e99c`), so neither is in a sold build yet; the web already did.
- **Analytics events differ by platform.** Web sends `pack_load`, `pad_press`, `autoplay_start`
  (`src/lib/analytics/usageEvents.ts`). iOS sends `pack_import`, `pack_load`, `play_start`, `play_end`
  (`Services/Analytics/UsageAnalytics.swift`, unipad-ios#19, 2026-09-25; its commit `f233f3b` is contained in the final
  4.1.6 release commit, so the events are in the sold build).
  Android sends none: the Firebase Analytics dependency is in `app/build.gradle` but no `logEvent` call exists in `app/src/main`.
  The web file's comment about events "shared with the Android and iOS players" does not match the iOS event names.
  How much of this reaches the analytics backend was not measured; local browser checks block all analytics requests.

## Parser and runner conformance

`meta/unipack-conformance/` holds one corpus of small packs that all three parsers and runners read, with
the expected result of each case (README there: how to run it, what each harness measures, what is
covered and what is not; RESULTS.md: the numbers). Run of 2026-10-02 (Korea time), 124 cases: 76 pass on all three
platforms; the rest are the differences below, 21 cases whose expected result no doc decides (observed
only) and 4 cases the iOS harness cannot observe. This is a result for those cases, not a statement
that every UniPack is compatible. No pack of the corpus has been opened in a running app yet. Differences
are pinned in `meta/unipack-conformance/divergences.json`; each becomes its own narrow fix.

### Open differences found by the corpus

- **Web names non-numeric values differently.** Non-numeric autoPlay values and keyLED file-name fields are reported as `range` instead of `format` (AP-M01..M09, AP-M11, KL-N01..N05). The line or file is dropped by all three; only the message differs.

### Resolved differences found by the corpus

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

- **Lights after leaving the play screen on iOS** (RUN-L-006, RUN-L-007). Android clears them in the play screen's `onStop` (#101) and the web in `LedRunner.stop()` (#32); both are measured and pass. On iOS the Launchpad is cleared by the main screen when it takes the MIDI controller back (`MainMidiControllerAdapter.onAttach`), which the unit-level harness does not drive, so the two cases are unverified there. They are not an iOS failure: an earlier version of this section said "iOS does not turn lit LEDs off when the play screen is left", which came from stopping the runner alone in the test. Nobody has checked it on a Launchpad.
- **autoPlay timing on iOS** (RUN-A-001, RUN-A-002). `AutoPlayRunner` reads the wall clock and sleeps in real time, so it cannot be driven on a virtual clock.
- **Round and logo lights on Android with Pro light mode off**, which is how the play screen starts. The corpus measures Android with it on.

### Found while building the corpus (iOS, not fixed here)

- **Stopping a repeated sound while it cycles hangs the iOS main thread** (simulator, iOS 27.0, 3 runs of 3). A keySound loop of 2 or more, then `SoundEngine.destroy()` (leaving the play screen) or the same pad pressed again: `AVAudioPlayerNode.stop()` waits for the completion handler `SoundEngine.soundOn` scheduled, which waits for the engine lock `stop()` holds. Input, command and stacks in `meta/unipack-conformance/RESULTS.md`. Not checked on a device. Android and web are not affected by this code path; whether they have their own problem there is not known.

### Documentation that disagrees with the code

- `key-led.mdx` says the logo `l` is "not supported, ignored"; all three platforms light it as circle index 32.
- `info.mdx` says `squareButton` defaults to false; all three default to true (INF-012).
- Only iOS reads `info.json` (INF-015).
- Out-of-range keyLED file names are "ignored" and autoPlay lines are "skipped" in the docs, without specifying warnings. KL-003 and AP-004 are undetermined on the same basis as the unknown-command cases; agreement between parsers is not a warning expectation.
- `auto-play.mdx` does not say what a line starting with an unknown word does, and `key-led.mdx` says such a line is "skipped" without saying whether it warns; all three record a format error (KL-M07, KL-025, AP-M10, AP-022, undetermined).

## Slide across pads

Dragging a finger onto another pad plays it and releases the one it left.

| Platform | Behaviour |
|---|---|
| Android | Opt-in: Settings > Play > "Slide across pads" (`PreferenceManager.slideMode`), off by default so a resting palm does not trigger runs. `SlideTouchOverlayView` over the grid, since 2026-09-06 (unipad-android#26). Present in the 4.1.8 (115) sold build *(re-read 2026-09-30)*. |
| iOS | Always on (`MultiTouchView.touchesMoved`). |
| Web | Always on (`PadGrid` uses `elementFromPoint` with pointer capture). |

The two always-on platforms have no palm-rejection complaint on record; revisit if one arrives.
