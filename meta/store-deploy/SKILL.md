---
name: store-deploy
description: Deploy UniPad to the app stores from this machine — build, sign, and upload the Android app to Google Play and the iOS app to App Store Connect / TestFlight via fastlane, pulling all secrets from 1Password. Use when the user asks to release, ship, publish, or deploy UniPad to the Play Store / App Store / TestFlight, or bump a store build. Runs locally; no CI.
---

# UniPad store deploy

Ship UniPad to Google Play (Android) and App Store Connect / TestFlight (iOS) from this
machine using fastlane. All secrets live in 1Password and are injected at runtime — nothing
sensitive is written to a repo or a commit.

## Layout

- `unipad-android/fastlane/` — `Appfile` + `Fastfile` (`build_only`, `deploy` lanes)
- `unipad-ios/fastlane/` — `Appfile` + `Fastfile` (`build_only`, `deploy` lanes)
- `scripts/op-bootstrap.sh` — pulls upload creds from 1Password into `fastlane/.secrets/` (gitignored)
- `scripts/preflight.sh` — read-only pre-release checks

## Before you start (once)

Confirm with the user which release track before every upload — **always ask, never assume**:
- Android: `internal` (default) · `alpha` · `beta` · `production`
- iOS: `testflight` (default) · `appstore`

Signing is already configured:
- Android release signing is wired in `app/build.gradle` via `keystore.properties` (real upload key).
- iOS uses Automatic signing, team `TU5R3B6V43`.

### fastlane binary (important on this machine)

The rbenv shim `fastlane` is broken here (ruby 2.7.2 linked against a removed
`openssl@1.1`). Use the Homebrew fastlane instead. Every command below resolves it via:

```bash
FL="fastlane"; fastlane --version >/dev/null 2>&1 || FL="$(brew --prefix)/bin/fastlane"
```

Then call `"$FL" <platform> <lane>`. `preflight.sh` prints which binary it resolved.

## Required 1Password items

| Item name | Type | Used for | Status |
|---|---|---|---|
| `UniPad keystore` | Document (asdf.jks) | Android signing (backup of local key) | ✅ exists |
| `UniPad Play Service Account` | Document (JSON) | Play upload | ⛔ create in Play Console → Setup → API access |
| `UniPad ASC API Key` | Item w/ fields `key_id`, `issuer_id`, `key_p8_base64` | iOS upload | ⛔ create a **Team Key** in App Store Connect → Users and Access → Integrations |

Override item names with `OP_PLAY_JSON_ITEM` / `OP_ASC_KEY_ITEM` env vars if named differently.

## Deploy — Android

```bash
FL="fastlane"; fastlane --version >/dev/null 2>&1 || FL="$(brew --prefix)/bin/fastlane"
op vault list >/dev/null || eval "$(op signin)"       # 1Password reachable (see note below)
scripts/preflight.sh android                          # review version + git state

# Assign first, then eval. `eval "$(...)"` on its own would eval the script's ERROR text
# when 1Password needs re-auth, producing a confusing failure instead of stopping here.
SECRETS="$(scripts/op-bootstrap.sh android deploy)" || exit 1
eval "$SECRETS"                                       # exports PLAY_JSON_KEY_FILE

cd unipad-android && "$FL" android deploy track:internal   # ask user for track first
cd .. && scripts/op-bootstrap.sh android cleanup      # wipe fastlane/.secrets
```

The `deploy` lane bumps `versionCode` (+1), builds a signed AAB, and uploads to the chosen
track as a **draft** (a `production` upload is marked completed). Pass `no_bump:true` to skip
the version bump.

## Deploy — iOS

```bash
FL="fastlane"; fastlane --version >/dev/null 2>&1 || FL="$(brew --prefix)/bin/fastlane"
op vault list >/dev/null || eval "$(op signin)"
scripts/preflight.sh ios

SECRETS="$(scripts/op-bootstrap.sh ios deploy)" || exit 1
eval "$SECRETS"                                       # ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_B64

cd unipad-ios
"$FL" ios verify_auth                                 # cheap ASC auth check first
"$FL" ios deploy target:testflight                    # ask user for target first
# iOS writes no secret file (the key travels as base64 in env), so there is nothing to wipe.
```

The `deploy` lane bumps the build number, archives with `-allowProvisioningUpdates` (the ASC
key lets Xcode manage the distribution profile), and uploads to TestFlight or App Store.

## Build-only verification (no upload creds needed)

Use these to confirm the build/sign path without touching a store:

```bash
FL="fastlane"; fastlane --version >/dev/null 2>&1 || FL="$(brew --prefix)/bin/fastlane"
cd unipad-android && "$FL" android build_only   # signed release AAB
cd unipad-ios && "$FL" ios build_only           # compiles Release, unsigned
```

## Rules

- **Always confirm the track/target with the user before uploading.** Uploads are outward-facing.
- Run `op-bootstrap.sh <platform> cleanup` after every deploy, even on failure, so no secret
  file lingers in `fastlane/.secrets/`.
- Never commit `fastlane/.secrets/`, the keystore, the Play JSON, or the `.p8` (all gitignored).
- The version bump is a real edit to `build.gradle` / the xcodeproj — leave it for the user to
  commit; don't commit it yourself unless asked.
- If an upload cred's 1Password item is missing, `op-bootstrap.sh` prints exactly what to create.
