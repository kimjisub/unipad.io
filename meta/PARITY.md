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

## Slide across pads

Dragging a finger onto another pad plays it and releases the one it left.

| Platform | Behaviour |
|---|---|
| Android | Opt-in: Settings > Play > "Slide across pads" (`PreferenceManager.slideMode`), off by default so a resting palm does not trigger runs. `SlideTouchOverlayView` over the grid, since 2026-09-06 (unipad-android#26). Present in the 4.1.8 (115) sold build *(re-read 2026-09-30)*. |
| iOS | Always on (`MultiTouchView.touchesMoved`). |
| Web | Always on (`PadGrid` uses `elementFromPoint` with pointer capture). |

The two always-on platforms have no palm-rejection complaint on record; revisit if one arrives.
