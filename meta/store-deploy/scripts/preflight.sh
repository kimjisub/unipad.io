#!/usr/bin/env bash
# preflight.sh — read-only checks before a store deploy. Prints current versions and
# flags anything that would make a release unsafe. Never mutates state.
#
# Usage: preflight.sh <android|ios>
set -euo pipefail

PLATFORM="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

# Resolve a fastlane binary that actually runs. On this machine the rbenv shim is
# broken (ruby 2.7.2 linked against a removed openssl@1.1), so plain `fastlane` fails;
# the Homebrew formula ships its own ruby and works. Prefer whatever runs.
resolve_fastlane() {
  if fastlane --version >/dev/null 2>&1; then echo "fastlane"; return; fi
  local prefix
  prefix="$(brew --prefix 2>/dev/null || true)"
  local brewfl="${prefix:-/opt/homebrew}/bin/fastlane"
  if [ -x "$brewfl" ] && "$brewfl" --version >/dev/null 2>&1; then echo "$brewfl"; return; fi
  echo ""
}

check_git() {
  local dir="$1"
  if [ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]; then
    echo "  ⚠️  uncommitted changes in $dir (a version bump will be added on top)"
  else
    echo "  ✓ working tree clean"
  fi
  echo "  branch: $(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null)"
}

case "$PLATFORM" in
  android)
    DIR="$ROOT/unipad-android"
    echo "== Android preflight =="
    # pipefail + set -e: a grep with no match used to abort the script after the header line,
    # which reads like a transient failure. Report the miss instead.
    grep -E "applicationId|versionCode|versionName" "$DIR/app/build.gradle" 2>/dev/null | sed 's/^/  /' \
      || echo "  ✗ could not read applicationId/versionCode/versionName from $DIR/app/build.gradle"
    [ -f "$DIR/keystore.properties" ] && echo "  ✓ keystore.properties present" || echo "  ✗ keystore.properties MISSING"
    FL="$(resolve_fastlane)"; [ -n "$FL" ] && echo "  ✓ fastlane: $FL" || echo "  ✗ no working fastlane (see SKILL.md env note)"
    check_git "$DIR"
    ;;
  ios)
    DIR="$ROOT/unipad-ios"
    echo "== iOS preflight =="
    grep -E "MARKETING_VERSION|CURRENT_PROJECT_VERSION|PRODUCT_BUNDLE_IDENTIFIER = kim.jisub.unipad;" \
      "$DIR/unipad.xcodeproj/project.pbxproj" 2>/dev/null | sort -u | sed 's/^[[:space:]]*/  /' \
      || echo "  ✗ could not read MARKETING_VERSION/CURRENT_PROJECT_VERSION from $DIR/unipad.xcodeproj/project.pbxproj"
    xcrun --find xcodebuild >/dev/null 2>&1 && echo "  ✓ xcodebuild available" || echo "  ✗ xcodebuild missing"
    FL="$(resolve_fastlane)"; [ -n "$FL" ] && echo "  ✓ fastlane: $FL" || echo "  ✗ no working fastlane (see SKILL.md env note)"
    check_git "$DIR"
    ;;
  *)
    echo "usage: preflight.sh <android|ios>" >&2; exit 2 ;;
esac
