---
name: store-deploy
description: Deploy UniPad to the app stores from this machine — build, sign, and upload the Android app to Google Play and the iOS app to App Store Connect / TestFlight via fastlane, pulling all secrets from 1Password. Use when the user asks to release, ship, publish, or deploy UniPad to the Play Store / App Store / TestFlight, or bump a store build. Runs locally; no CI.
---

# UniPad store deploy

Ship UniPad to Google Play (Android) and App Store Connect / TestFlight (iOS) from this
machine using fastlane. All secrets live in 1Password and are injected at runtime — nothing
sensitive is written to a repo or a commit.

## How releases normally run

Regular releases, rollout changes and review replies go through the workspace's release tools
(`project/port/executors/run-release.sh`, `run-rollout.sh`, `reply-review.sh`). Each store call is
wrapped in `project/port/executors/with-store-creds.sh android|ios|both -- <command>`, which:

- reads 1Password with the machine's **service account token** (`OP_SERVICE_ACCOUNT_TOKEN`), not a
  person's sign-in;
- runs `unset OP_ACCOUNT` on purpose, so a personal account choice never applies to these reads;
- exports `OP_VAULT` (the project's `[store_credentials] vault`), because a service account must
  name the vault on every item read;
- calls `scripts/op-bootstrap.sh <platform> deploy` and always runs `cleanup` on exit.

Do not pin a personal account (`OP_ACCOUNT`) for this path. The manual steps in
**Deploy — Android (manual)** and **Deploy — iOS (manual)** below are the **exception path**,
for a person uploading by hand.

## Layout

- `unipad-android/fastlane/` — `Appfile` + `Fastfile` (`build_only`, `deploy`, `promote`, `rollout`, `halt` lanes)
- `unipad-ios/fastlane/` — `Appfile` + `Fastfile` (`build_only`, `verify_auth`, `deploy`, `submit` lanes)
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

## Manual sign-in (exception path only)

Both manual deploys below read 1Password as the signed-in person. This Mac has several personal
1Password accounts signed in; if the default account changes, `op-bootstrap.sh` fails with
`1Password item 'UniPad Play Service Account' not found` (or the ASC item) even though the item
exists. Either sign in to that account again with `op signin --account my.1password.com` — the
1Password CLI uses the most recently signed-in account unless a command names one, so later `op`
commands use it too — or pin it for one command only by prefixing it:
`SECRETS="$(OP_ACCOUNT=my.1password.com "$SD/scripts/op-bootstrap.sh" android deploy)"`.
Do not `export OP_ACCOUNT` for the whole shell: `with-store-creds.sh` unsets it for its own reads,
but every other `op` command you run by hand in that shell silently keeps using that account,
which makes it hard to tell which account a command read from.

## Deploy — Android (manual)

Run from the workspace root (`~/GitHub/unipad`); every path below is anchored on `SD`.

```bash
SD="$PWD/unipad.io/meta/store-deploy"
FL="fastlane"; fastlane --version >/dev/null 2>&1 || FL="$(brew --prefix)/bin/fastlane"
op vault list >/dev/null || op signin                 # 1Password reachable (see "Manual sign-in")
"$SD/scripts/preflight.sh" android                    # review version + git state

# Assign first, then eval. `eval "$(...)"` on its own would eval the script's ERROR text
# when 1Password needs re-auth, producing a confusing failure instead of stopping here.
# The script prints only a path; the credential itself is in a 600 file.
SECRETS="$("$SD/scripts/op-bootstrap.sh" android deploy)" || exit 1
eval "$SECRETS"                                       # exports PLAY_JSON_KEY_FILE

(cd unipad-android && "$FL" android deploy track:internal)   # ask user for track first
"$SD/scripts/op-bootstrap.sh" android cleanup         # wipe fastlane/.secrets
```

The `deploy` lane bumps `versionCode` to one past the higher of the local value and Play's
highest, builds a signed AAB, uploads it with the R8 mapping and the changelogs under
`fastlane/metadata/android/<locale>/changelogs/<versionCode>.txt`, and leaves it as a **draft**
on internal/alpha/beta. Pass `no_bump:true` when the version was already bumped in a release
commit. Production is staged, and the three lanes below are the whole release path:

```bash
"$FL" android promote version_code:111 fraction:0.1   # internal -> production, 10% of users
"$FL" android rollout fraction:0.5 version_code:111   # widen (1 = everyone) after checking vitals
"$FL" android halt version_code:111                   # stop the staged release
```

`deploy track:production rollout:0.1` uploads straight to production at 10% instead; use it only
when skipping internal is intended. Check `play.py vitals` for the new versionCode before widening.

## Deploy — iOS (manual)

```bash
SD="$PWD/unipad.io/meta/store-deploy"
FL="fastlane"; fastlane --version >/dev/null 2>&1 || FL="$(brew --prefix)/bin/fastlane"
op vault list >/dev/null || op signin                 # 1Password reachable (see "Manual sign-in")
"$SD/scripts/preflight.sh" ios

# Prints `source .../fastlane/.secrets/asc.env`; that file exports ASC_KEY_ID / ASC_ISSUER_ID /
# ASC_KEY_B64. The values never reach stdout or the session transcript.
SECRETS="$("$SD/scripts/op-bootstrap.sh" ios deploy)" || exit 1
eval "$SECRETS"

(cd unipad-ios && "$FL" ios verify_auth)              # cheap ASC auth check first
(cd unipad-ios && "$FL" ios deploy target:testflight) # ask user for target first
"$SD/scripts/op-bootstrap.sh" ios cleanup             # wipe fastlane/.secrets (holds the .p8)
```

The `deploy` lane derives the next build number from TestFlight, archives with
`-allowProvisioningUpdates` (the ASC key lets Xcode manage the distribution profile), uploads the
dSYM to Crashlytics, and uploads to TestFlight. Then, once ASC shows the build as processed
(`asc.py testflight`, usually a few minutes):

```bash
"$FL" ios submit build_number:N version:X.Y.Z   # run from unipad-ios/; attaches the TestFlight build
```

`submit` creates the App Store version if needed, uploads
`fastlane/metadata/en-US/release_notes.txt` (the listing has one locale), and submits for review
with automatic **phased release** on approval. Two quirks: fastlane 2.237 prints the TestFlight
upload as failed on altool's "SPI file is empty" warning although the upload succeeded (check
ASC before retrying), and `submit` must be run inside `unipad-ios/` or fastlane cannot find the
Fastfile.

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
