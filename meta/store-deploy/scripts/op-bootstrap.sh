#!/usr/bin/env bash
# op-bootstrap.sh — materialize store-deploy secrets from 1Password into a gitignored
# temp dir and print the `export` lines the fastlane lanes read. Nothing is written to
# the repo tree except under fastlane/.secrets/ (gitignored), and `--cleanup` wipes it.
#
# Usage:
#   eval "$(op-bootstrap.sh android deploy)"   # exports PLAY_JSON_KEY_FILE (a path)
#   eval "$(op-bootstrap.sh ios deploy)"       # sources fastlane/.secrets/asc.env, which exports
#                                              # ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_B64
#   op-bootstrap.sh <platform> cleanup          # remove the temp secrets dir
#
# Only a path is ever printed; the secret values live in 600 files under fastlane/.secrets/.
#
# For build-only verification no upload creds are needed, so `build` mode is a no-op here.
#
# 1Password item names (override via env):
#   OP_PLAY_JSON_ITEM  default: "UniPad Play Service Account"  (Document: play-sa.json attachment)
#   OP_ASC_KEY_ITEM    default: "UniPad ASC API Key"            (fields: key_id, issuer_id; .p8 attachment)
set -euo pipefail

PLATFORM="${1:-}"
MODE="${2:-deploy}"

case "$PLATFORM" in
  android) REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../unipad-android" && pwd)" ;;
  ios)     REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../unipad-ios" && pwd)" ;;
  *) echo "usage: op-bootstrap.sh <android|ios> <build|deploy|cleanup>" >&2; exit 2 ;;
esac
# A typo such as `cleanp` used to fall through to the credential-materialising path.
case "$MODE" in
  build|deploy|cleanup) ;;
  *) echo "usage: op-bootstrap.sh <android|ios> <build|deploy|cleanup>" >&2; exit 2 ;;
esac
SECRETS_DIR="$REPO_DIR/fastlane/.secrets"

if [ "$MODE" = "cleanup" ]; then
  rm -rf "$SECRETS_DIR"
  echo "cleaned $SECRETS_DIR" >&2
  exit 0
fi

# Build-only verification needs no upload credentials.
if [ "$MODE" = "build" ]; then
  if [ "$PLATFORM" = "android" ] && [ ! -f "$REPO_DIR/keystore.properties" ]; then
    echo "ERROR: $REPO_DIR/keystore.properties missing — release signing not configured." >&2
    exit 1
  fi
  exit 0
fi

command -v op >/dev/null || { echo "ERROR: 1Password CLI (op) not installed." >&2; exit 1; }
# Probe with a real read, not `op whoami`: with desktop-app integration whoami reports
# "not signed in" even while vault reads work fine (biometric unlock per command).
op vault list >/dev/null 2>&1 || {
  echo "ERROR: 1Password CLI cannot read vaults." >&2
  echo "  Unlock the 1Password desktop app, or run:  eval \$(op signin)" >&2
  exit 1
}

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

if [ "$PLATFORM" = "android" ]; then
  ITEM="${OP_PLAY_JSON_ITEM:-UniPad Play Service Account}"
  if ! op item get "$ITEM" >/dev/null 2>&1; then
    echo "ERROR: 1Password item '$ITEM' not found." >&2
    echo "  Create the Play service account JSON (Play Console -> Setup -> API access)," >&2
    echo "  then store it in 1Password as a Document named '$ITEM'." >&2
    exit 1
  fi
  DEST="$SECRETS_DIR/play-sa.json"
  # Create the file with 600 before op writes into it, so the key is never world-readable.
  (umask 077 && : > "$DEST")
  op document get "$ITEM" --out-file "$DEST" --force >/dev/null
  chmod 600 "$DEST"
  # %q: the caller evals this line; a path with a space or a shell metacharacter must stay one word.
  printf 'export PLAY_JSON_KEY_FILE=%q\n' "$DEST"

elif [ "$PLATFORM" = "ios" ]; then
  ITEM="${OP_ASC_KEY_ITEM:-UniPad ASC API Key}"
  if ! op item get "$ITEM" >/dev/null 2>&1; then
    echo "ERROR: 1Password item '$ITEM' not found." >&2
    echo "  Create an App Store Connect API *Team* key:" >&2
    echo "    App Store Connect -> Users and Access -> Integrations -> App Store Connect API -> Team Keys" >&2
    echo "  Then store it in 1Password as '$ITEM' with three fields:" >&2
    echo "    key_id        (e.g. D383SF739 — also in the AuthKey_<KEYID>.p8 filename)" >&2
    echo "    issuer_id     (UUID shown above the key list)" >&2
    echo "    key_p8_base64 (base64 of the .p8:  base64 -i AuthKey_XXXX.p8 | pbcopy)" >&2
    exit 1
  fi
  KEY_ID="$(op item get "$ITEM" --fields label=key_id --reveal)"
  ISSUER_ID="$(op item get "$ITEM" --fields label=issuer_id --reveal)"
  KEY_B64="$(op item get "$ITEM" --fields label=key_p8_base64 --reveal)"
  for pair in "key_id:$KEY_ID" "issuer_id:$ISSUER_ID" "key_p8_base64:$KEY_B64"; do
    [ -n "${pair#*:}" ] || { echo "ERROR: field '${pair%%:*}' is empty on 1Password item '$ITEM'." >&2; exit 1; }
  done
  # The private key is written to a 600 file and only its path is printed: echoing the base64 to
  # stdout put the signing key into the shell history and the agent transcript that captured it.
  ENV_FILE="$SECRETS_DIR/asc.env"
  (umask 077 && : > "$ENV_FILE")
  {
    printf 'export ASC_KEY_ID=%q\n' "$KEY_ID"
    printf 'export ASC_ISSUER_ID=%q\n' "$ISSUER_ID"
    printf 'export ASC_KEY_B64=%q\n' "$KEY_B64"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  printf 'source %q\n' "$ENV_FILE"
fi
