# Platform parity

Where Android, iOS and Web stand relative to each other. Update this in the same
change that creates or closes a gap — a gap that only exists in someone's head
comes back.

Last verified: 2026-09-06

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

- **CFW driver, iOS: ported, unverified on hardware.** `LaunchpadProCFWDriver`
  (unipad-ios, 2026-09-06) mirrors the Android note map and has unit tests for it,
  but nobody has plugged a Pro MK2 on the "Launchpad Open" firmware into an iPhone yet.
  Auto-detect keys on a CoreMIDI source name starting with "Launchpad Open".
- **Dual-launchpad support.** Android only, still in review (#27).

## Engine

Present on both Android and iOS: UniPack parser, the four runners
(sound / LED / autoplay / chain), channel manager, local database, Firebase store,
recording, push, ZIP themes, autoplay auto-mapping.

Platform-specific by design, not gaps: Oboe low-latency audio and the Storage
Access Framework migration on Android; CoreMIDI on iOS.

## Known behaviour gaps (all platforms)

- Dragging a finger across the pad grid only triggers the first pad touched.
  Each pad installs its own touch listener handling press and release only, so
  the view that captured the gesture keeps it. See unipad-android#26.
