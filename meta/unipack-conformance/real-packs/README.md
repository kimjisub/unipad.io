# Real packs through the three parsers

The [conformance corpus](../README.md) checks small packs written for the purpose. This directory runs
**real packs** through the same parser call and the same normalized result on Android, iOS and the web,
and compares the three. It answers "do the three apps read these packs the same way?" for a set of
packs you can count, such as every pack in the official store list. It says nothing about packs outside
that set, and nothing about real audio, light timing or where a pad is pressed on screen.

Packs are not kept in this repository (most are remixes of commercial music). Every tool takes the
packs' location as an argument; results identify a pack by an id and a fingerprint, never by its title.

## Files

| File | Role |
|---|---|
| `store.mjs` | Reads the official store list, asks the file server (HEAD) for each pack, reuses a kept copy of the same size and ETag or downloads it, and unzips each pack into `<work>/packs/<id>`. Writes `<work>/stages.json` with every step per pack. |
| `run-web.mjs` | The web parser over every pack folder: `<out>/web/<id>.json`. |
| `compare.mjs` | Joins `android/`, `ios/` and `web/` results: same, different (which part, which platform) or failed, per pack. |
| `packs.mjs` | Pack folders: listing, fingerprint (the corpus formula over every file), file and line counts. |
| `tools.test.mjs` | Tests of these tools (`pnpm test`). |

The app runners live with the conformance harness of each app:
`unipad-android` `app/src/test/java/com/kimjisub/launchpad/unipack/conformance/RealPackResultsTest.kt` and
`unipad-ios` `unipadTests/UniPackConformance/RealPackResultsTests.swift`. Both skip themselves unless
`UNIPACK_REAL_PACKS` is set, so ordinary test runs are unchanged.

## Running it

```sh
# 1. official store packs: list, HEAD, reuse or download, unzip (stages.json)
node meta/unipack-conformance/real-packs/store.mjs --archive <kept zips> --work <work>

# 2. the three parsers (each writes <work>/results/<platform>/<id>.json)
node --import tsx meta/unipack-conformance/real-packs/run-web.mjs --packs <work>/packs --out <work>/results

UNIPACK_REAL_PACKS=<work>/packs UNIPACK_REAL_PACKS_OUT=<work>/results \
  ./gradlew :app:testDebugUnitTest --rerun --no-build-cache \
  --tests 'com.kimjisub.launchpad.unipack.conformance.RealPackResultsTest'          # in unipad-android

TEST_RUNNER_UNIPACK_REAL_PACKS=<work>/packs TEST_RUNNER_UNIPACK_REAL_PACKS_OUT=<work>/results \
  xcodebuild test -project unipad.xcodeproj -scheme unipad \
  -only-testing:unipadTests/RealPackResultsTests -destination 'id=<simulator>'      # in unipad-ios

# 3. compare
node meta/unipack-conformance/real-packs/compare.mjs --results <work>/results --packs <work>/packs \
  --stages <work>/stages.json --json <work>/compare.json
```

Any folder of pack folders works in place of step 1 (for example a collection of packs), as long as
each folder is named by an id (`[A-Za-z0-9_][A-Za-z0-9_.-]*`) that does not carry the title.

**Part of a set.** Every step takes `--only <id,id>` or `--only-file <file>` (Android and iOS:
`UNIPACK_REAL_PACKS_ONLY=<id,id>`; `store.mjs` takes the store list keys). Use it to run only the packs
the file server now serves differently, or a pack that was added. When the conformance corpus or a
parser changes, run the whole set again from the kept copies (`store.mjs --offline` skips the HEAD
requests and unzips the kept copies as they are, and says so in `stages.json`).

## What is compared

Each runner writes the corpus's normalized `parse` result (see [Normalized result](../README.md#normalized-result))
for every pack: info, every keySound queue, every keyLED animation, the autoPlay elements and the error
kinds. `compare.mjs` splits it into six parts, `loaded`, `info`, `keySound`, `keyLed`, `autoPlay` and
`errors`, and compares each part across the three platforms exactly. A part that differs names the
platform that stands apart when the other two agree (`all-three` when none do).

The summary of each platform's reading (`--json`) holds: hashes of title, producer and website; button
grid, chain count and `squareButton`; keySound entries and the pads that have them; keyLED animations
and events; autoPlay commands by kind; error counts by kind; and a short hash of each part. From the
pack itself, the same for every platform: file count, bytes, non-blank keySound and autoPlay lines,
keyLED and sound file counts. Lines a parser skipped are the non-blank lines minus the entries it kept.

`stages.json` records, per store pack: the list entry, the server's HEAD status, size and ETag, whether
the kept copy was reused or downloaded, and the unzip (files, single top folders unwrapped as the apps'
import does, or the error). It names the store code and URL and stays on the machine that ran it; the
comparison output does not.

What a run trusts from an earlier one:

- `<archive>/heads.json` keeps the size and ETag of the file the server served when a kept copy was last
  reused or downloaded. It changes only then, so a download that fails leaves the old record and the
  next run tries again instead of taking the old copy for the new file.
- `<work>/packs/<id>` is removed before each pack is brought in. A pack that is not served, not
  downloaded or not unzipped in this run has no folder, so the runners cannot read an earlier one.
- With `--stages`, `compare.mjs` lists every pack of that run and reports one that was not unzipped as
  `not-read` with its step, whatever results an earlier run left in `--results`.

## Limits

- A pack is read from a folder on the machine running the tests, so file lookups follow that machine's
  file system. A keySound line naming `End.wav` for a file stored as `END.wav` is found by the web (it
  matches names regardless of case) and by the Android JVM test on a case-insensitive macOS volume,
  which reports the name written in keySound; an Android device's storage may not find it, and that is
  not observed here. The iOS test on a simulator does not find it and reports `keySound:missing-file`.
- The web reads a zip made in memory from the folder, the apps read the folder; zip import itself is
  not compared (see the corpus's [What is not covered](../README.md#what-is-not-covered)).
- No playback: autoPlay is compared as the parsed command list, not run on a clock.
