# Platform parity

Where Android, iOS and Web stand relative to each other. Update this in the same
change that creates or closes a gap — a gap that only exists in someone's head
comes back.

Last verified: 2026-09-08

## Repos

| Platform | Repo | Notes |
|---|---|---|
| Android | `unipad-android` | Oldest, largest user base, all outside contributors so far |
| iOS | `unipad-ios` | Newest; screens and engine fully ported |
| Web | `unipad.io` | Player + store + docs site; also hosts this `meta/` directory |

## Screens

Every Android screen has an iOS counterpart.

| Android | iOS |
|---|---|
| SplashActivity | `Splash/SplashView` |
| MainActivity | `Main/MainView` |
| PlayActivity | `Play/PlayView` |
| FBStoreActivity | `Store/StoreView` |
| SettingsActivity | `Settings/SettingsView` |
| ThemeActivity | `Theme/ThemeView` |
| TransferActivity | `Transfer/TransferView` |
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
- **CFW driver, iOS: ported, unverified on hardware.** `LaunchpadProCFWDriver`
  (unipad-ios, 2026-09-06) mirrors the Android note map and has unit tests for it,
  but nobody has plugged a Pro MK2 on the "Launchpad Open" firmware into an iPhone yet.
  Auto-detect keys on a CoreMIDI source name starting with "Launchpad Open".
- **Dual-launchpad support.** Android only, still in review (#27); needs the contributor's rebase over the `MidiConnection` changes from #41 and #51.

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

### Known remaining differences (2026-09-07 review, not yet closed)

- **Android has no search on the pack list**; iOS and web do.
- **Android sort options are three**; iOS offers five (play count, last opened).
- **The web player UI localisation is open in a PR** (unipad.io#15, feat/play-i18n). `/play` now
  renders ko/en like the rest of the site; the gap closes when that PR merges.
- **iOS `TransferView` is unreachable** (no navigation calls it), so the screen table above
  overstates parity for that row.
- **Deleting a pack leaves the database row on Android and iOS** and removes it on the web.
- **Analytics events exist on the web only.**

## Slide across pads

Dragging a finger onto another pad plays it and releases the one it left.

| Platform | Behaviour |
|---|---|
| Android | Opt-in: Settings > Play > "Slide across pads" (`PreferenceManager.slideMode`), off by default so a resting palm does not trigger runs. `SlideTouchOverlayView` over the grid, since 2026-09-06 (unipad-android#26). Ships after 4.1.5. |
| iOS | Always on (`MultiTouchView.touchesMoved`). |
| Web | Always on (`PadGrid` uses `elementFromPoint` with pointer capture). |

The two always-on platforms have no palm-rejection complaint on record; revisit if one arrives.
