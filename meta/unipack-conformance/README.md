# UniPack conformance corpus

One set of small packs, read by the Android, iOS and web parsers and runners, with the result each is
expected to give. It answers "do the three platforms read this pack the same way?" for the packs in
this directory and nothing more. **Passing this corpus is not "every UniPack is 100% compatible".**
Real packs use more of the format than these cases exercise; see [What is not covered](#what-is-not-covered).

This directory is the single source. The apps carry a byte-identical copy of `corpus.json`; a copy that
drifts is detected (see [Keeping the copies in step](#keeping-the-copies-in-step)).

## Files

| File | Role |
|---|---|
| `cases.mjs` | The case list: input files, expected result, basis, and which platform cannot observe a case. Edit this, then rebuild. |
| `lib.mjs` | Sound asset generator, input fingerprint, expected-result builders. |
| `palette.json` | The 128 colours an `auto` velocity resolves to (reference copy, see PAL-001). |
| `divergences.json` | Differences observed on a platform today, pinned so a change in either direction is noticed. |
| `corpus.json` | Generated from the four files above. The only file the apps read. |
| `build-corpus.mjs` | `node meta/unipack-conformance/build-corpus.mjs` writes it, `--check` verifies it is current. |
| `sync.mjs` | Copies `corpus.json` into the app checkouts, or `--check`s that the copies are identical. |
| `report.mjs` | Joins the three platforms' result files into one table, one row per case. |
| `materialize.mjs` | Writes one case's pack to a folder or `.zip` so it can be opened by hand on a device (`materialize.mjs KS-001 --out /tmp/x --zip`). |
| `selftest.mjs` | Tests of the tooling itself: `corpus.json` is what the sources build, and what `report.mjs` may and may not count. `pnpm test:unipack` runs it. |

## Running it

```sh
# web (repo root of unipad.io): parser and runners, the tooling's own tests (selftest.mjs), and
# .next/cache/unipack-conformance/web.json
pnpm test:unipack

# Android (repo root of unipad-android): writes app/build/unipack-conformance/android.json
./gradlew :app:testDebugUnitTest --rerun --no-build-cache --tests 'com.kimjisub.launchpad.unipack.conformance.*'

# iOS (repo root of unipad-ios): prints UNIPACK-CONFORMANCE lines and writes ios.json
TEST_RUNNER_UNIPACK_CONFORMANCE_OUT=/tmp/unipack-conformance \
  xcodebuild test -project unipad.xcodeproj -scheme unipad -only-testing:unipadTests/UniPackConformanceTests \
  -destination 'platform=iOS Simulator,name=<a simulator>'

# the copies in the app checkouts are the canonical file
node meta/unipack-conformance/sync.mjs --android <unipad-android checkout> --ios <unipad-ios checkout> --check

# then, from unipad.io
node meta/unipack-conformance/report.mjs --web .next/cache/unipack-conformance/web.json \
  --android <android.json> --ios <ios.json>
```

**Android: `--rerun --no-build-cache` is part of the command.** Gradle stores a passing test task and
answers the next run with `UP-TO-DATE` or `FROM-CACHE` without running anything; `android.json` is not an
output Gradle knows about, so it is then not written again and an older one stays where it was. The two
options make the task run. They are not set in the build files because those are outside this work's
scope.

**iOS: environment variables need the `TEST_RUNNER_` prefix.** xcodebuild hands a variable to the test
process only when it is given as `TEST_RUNNER_<NAME>`; the test reads `<NAME>`. Without
`UNIPACK_CONFORMANCE_OUT` the file goes to the simulator's temporary directory, and the path is printed
as `UNIPACK-CONFORMANCE-OUT`.

**What `report.mjs` counts.** It takes each platform's JSON result file and works the status of every
case out itself, from the result (`actual`) the platform recorded; the status the platform wrote is only
cross-checked. A case is **unverified, never a pass,** when

- the platform was not given, or the file given for it says it is another platform's (`--android web.json`);
- the platform ran a corpus with another `corpusSha256`, or the case with another input fingerprint;
- the platform wrote a status without the result it is based on. A test log is such a file: its
  `UNIPACK-CONFORMANCE` lines carry the claimed status only, so a log given in place of the JSON file
  makes every case of that platform unverified;
- the status the platform wrote is not the one its result earns;
- the case is `undetermined`, or the corpus says the platform cannot observe it (`unobserved`).

The table starts with when each result file was written (`generatedAt`) and whether that run asserted,
so an old file or a record-only one is visible.

**Record-only runs.** `UNIPACK_CONFORMANCE_DUMP=1`, exactly that value, writes every result without
asserting any case, to look at what a platform does before a difference is pinned. `0`, `false`, an
empty value and no variable are ordinary asserting runs. A record-only run says so
(`UNIPACK-CONFORMANCE-RECORD-ONLY`, and `"assertions": "skipped"` in the result file) and **always ends
as a failed run**: one check fails on purpose (web `this run > asserted every case`, Android the
`UniPackConformanceCasesTest` class, iOS `thisRunAssertedEveryCase`). That is what keeps Gradle from
storing it as a passing result and answering the next ordinary run from it. On iOS the variable is
`TEST_RUNNER_UNIPACK_CONFORMANCE_DUMP=1`.

## Statuses

Each case is reported per platform as exactly one of:

| Status | Meaning |
|---|---|
| `pass` | The platform's result equals the expected result. |
| `fail` | It does not, and nothing in the corpus calls that intended. Pinned in `divergences.json` when it is a known difference, so the suite stays green while the report shows it. |
| `unsupported` | The platform does not support this format. Pinned like `fail`, with the observed result. |
| `intended-difference` | The platforms are meant to differ and the docs or PARITY.md say so. Pinned with the reason. None yet. |
| `unverified` | No result to compare: the platform did not run, ran another corpus, cannot observe the case (`unobserved`), or the case is `undetermined` (below). Never counted as a pass. |

A case is `determined` only when a format doc (`content/docs/en/unipack`) or an intent stated in a
platform's own commit history or tests names the expected result. Otherwise it is `undetermined`: the
platforms still run it, the observed results are printed side by side, and it is `unverified` on every
platform until someone decides. `basis[].type` says which: `doc` (checked to exist at build time),
`intent` (a commit or test that states it), `reference` (the Android implementation, for the palette).
Expected results are never taken from what the three parsers agree on.

A case can also name a platform whose harness cannot observe it (`unobserved`, with the reason). That
platform does not run the case and reports it as `unverified`; the others are judged as usual. Today:
RUN-A-001 and RUN-A-002 on iOS (the autoPlay runner cannot be driven on a virtual clock) and RUN-L-006
and RUN-L-007 on iOS (leaving the play screen, see `stop` below).

## Case format

```jsonc
{
  "id": "KS-001",            // stable; the same id on every platform
  "layer": "parse",          // parse | run | palette
  "area": "keySound",
  "title": "...",
  "files": [                 // the pack, as files. Exactly one of text | base64 | asset per file
    { "path": "info", "text": "title=..." },
    { "path": "sounds/a.wav", "asset": "tone-440" }   // bytes come from corpus.assets
  ],
  "fingerprint": "...",      // sha256 of the files, formula below
  "expectation": "determined",   // or "undetermined" (then "question" and no "expected")
  "expected": { ... },
  "basis": [ { "type": "doc", "ref": "content/docs/en/unipack/key-sound.mdx", "note": "..." } ],
  "scenario": [ ... ],       // run layer only
  "known": { "ios": { "status": "fail", "actual": { ... }, "note": "..." } },  // from divergences.json
  "unobserved": { "ios": "why the iOS harness cannot observe this case" }
}
```

**Fingerprint.** sha256 over the input files sorted by the UTF-8 bytes of their path; per file
`UTF8(path) 0x00 decimal(byte length) 0x00 bytes 0x0A`. `text` is UTF-8 encoded exactly as written (BOM and
CRLF are kept), `asset` bytes are the base64 decoded content of `assets[name]`. A harness recomputes it
and refuses a case whose files no longer hash to the declared value. `corpusSha256` is the sha256 of the
`corpus.json` bytes; every platform reports the hash of its own copy.

**Sounds.** Only what `lib.mjs` synthesizes: two 10 ms sine tones and 10 ms of silence (8 kHz mono 8-bit
PCM WAV). Regenerate with `node meta/unipack-conformance/build-corpus.mjs`; the bytes and sha256 are in
`corpus.assets`. No pack, song or third-party audio is copied here. `Faded.zip` and other packs on the
maintainers' machines were used for local comparison only and are not part of this corpus. The generated
signals contain no third-party material; the repository's licence applies to them (the owner has not been
asked to choose another).

## Normalized result

Coordinates are 0-based in every result and step (files are 1-based, as authors write them).

`parse` layer: the platform's real parser reads the pack (Android and iOS from a folder written from
`files`, the web from a zip of them) and reports

```jsonc
{ "loaded": false }                       // the pack is refused (critical error / thrown)
{
  "loaded": true,
  "info":   { "title", "producerName", "buttonX", "buttonY", "chain", "squareButton", "website"? },  // website only when non-empty
  "sounds": [ { "c", "x", "y", "queue": [ { "file", "loop", "wormhole" } ] } ],   // cells with at least one sound, ordered by c, x, y; file relative to sounds/
  "keyLedExist": true,                    // a keyLed folder exists
  "leds":   [ { "c", "x", "y", "queue": [ { "loop", "events": [ ... ] } ] } ],
  "autoPlay": null | [ ... ],
  "errors": [ "keySound:format", ... ]    // in the order the parser recorded them
}
```

LED events: `["on", x, y, "aarrggbb", velocity]`, `["off", x, y]`, `["delay", ms]`, `["chain", c]`. `x = -1` is a
round or logo LED and `y` its index (the logo is 32). AutoPlay elements: `["on", x, y, chain, num]`,
`["off", x, y, chain]`, `["chain", c]`, `["delay", ms]`.

When `loaded` is false nothing else is compared: the apps list why in `errors`, the web parser throws.

**Error kinds.** Each platform's message is reduced to `section:kind`, section being the text before the
first `:` (`info`, `keySound`, `keyLed`, `autoPlay`) and kind one of

| kind | messages |
|---|---|
| `format` | `format is incorrect`, `format is not found` |
| `range` | `chain\|x\|y\|loop\|coordinate\|delay is incorrect`, `out of range` |
| `missing-file` | `sound was not found`, `sounds directory not found`, `doesn't exist` |
| `missing-field` | `title\|producerName\|buttonX\|buttonY\|chain was missing` |
| anything else | `other(<message>)`, so a new message shows up as a difference |

`run` layer: the case's `scenario` is played against the platform's LED runner, sound engine and
autoPlay runner on one virtual clock, and reports `{ "checkpoints": [ [event, ...], ... ] }`, one list
per `observe` step holding what happened since the previous one, in the order it happened. Steps:
`press`/`release` (x, y: the sound engine and the LED runner, as the play screen calls them), `chain`
(c: the user picks a chain), `advance` (ms of virtual time, runners ticking at 4 ms, autoPlay at 1 ms),
`observe`, `autoplay` (start the autoPlay runner), `stop` (leave the play screen). Events:
`["sound", chain, x, y, file, loop]` (loop as stored: -1 endless, 0 once, N repeats),
`["ledOn", x, y, "aarrggbb", velocity]`, `["ledOff", x, y]`, `["chain", c]` (a keyLed `c` line or a
wormhole switched the chain; the harness's chain follows), `["autoOn", x, y]`, `["autoOff", x, y]`,
`["autoChain", c]`.

Cases leave 20 ms or more between an event that a `delay` schedules and the `observe` that expects it,
because such an event can be two ticks (8 ms) late. RUN-L-003 observes 12 ms after a release on purpose:
the off it expects is sent by the first tick after the release, and the animation's own off would follow
at 40 ms, so a later `observe` could not tell the two apart.

**What each harness measures.** The three are not the same seam, and a pass means "this platform, at
this seam":

| | Android | iOS | Web |
|---|---|---|---|
| Sound | `SoundRunner` with a recording stand-in for the native (Oboe) engine; a sound event is a `play` call the runner made | the real `SoundEngine` on `AVAudioEngine` (nothing is replaced); a sound event is the head of the pad's queue read just before a press that raised `playsStarted`, not what the engine played | `SoundEngine` with a recording stand-in for Web Audio; a sound event is a started buffer source |
| Lights | what the play screen would draw: `PlayActivityViewModel` with a `ChannelManager`, read at `UiCallback` | `LedRunner.Listener` batches, the runner alone | `LedRunnerListener` calls, the runner alone |
| Round and logo lights | measured with **Pro light mode on**. The play screen starts with it off, where the LED channel's round and logo lights are hidden (`PlayActivityViewModel.proLightMode`); that default is not measured | no such setting in the runner | no such setting in the runner |
| `stop` | the play screen's `onStop`: `screenVisible = false`, `ledInit()` | not observed (RUN-L-006, RUN-L-007 are `unobserved`): iOS clears the Launchpad when the main screen takes the MIDI controller back, a screen-level step this harness does not drive | `LedRunner.stop()`, `SoundEngine.destroy()`, `AutoPlayRunner.stop()` |
| autoPlay | `AutoPlayRunner` on the virtual clock | not observed (wall clock) | `AutoPlayRunner` on the virtual clock |

The reset of every pad's queue position when the chain changes is done by the play screens (Android
`PlayActivityViewModel`, iOS `PlayViewModel`, web `useUniPadEngine`), not by the runners, and no harness
attaches it. No case depends on it today; a case that presses a pad again after its chain changed would
need it.

The iOS harness waits 300 ms before it destroys the sound engine to let the short corpus sounds finish
and avoid a reproduced deadlock when a repeated sound is stopped while cycling. This wait hides the
hang from these conformance cases; it does not make the app safe. The independent review on 2026-09-30 reproduced
exit hangs in 3 of 3 runs and immediate re-press hangs in 2 of 2 runs on iOS 26.4, in addition to the
iOS 27.0 exit reproduction. See RESULTS.md, "iOS: destroy() while a repeated sound is cycling".
The product fix is tracked separately as JIS-42 in Paperclip.

`palette` layer: `{ "argb": [128 lowercase 8-digit hex strings] }` from the platform's colour table.

## Checks that can fail

A comparison that cannot fail would prove nothing, so each platform's suite also contains checks that
break one thing on purpose and require the comparison to notice: a changed input file no longer matches
its fingerprint; a changed expected coordinate turns a pass into a fail; a changed input with the same
expected result fails; a parser stand-in that sees none of the case fails; an LED runner whose `eventOn`
is a no-op fails a run case; a pinned difference that stops happening (or changes) is an unexpected
result; an undetermined case never counts as a pass; a case marked `unobserved` for the platform is
unverified and is not run. `selftest.mjs` does the same for `report.mjs`: a pass claimed without a
result, a pass claimed on an undetermined case, results handed in under another platform's name and an
iOS log given as `--android` all have to come out unverified.

## Keeping the copies in step

`corpus.json` is copied byte for byte to

- `unipad-android/app/src/test/resources/unipack-conformance/corpus.json`
- `unipad-ios/unipadTests/UniPackConformance/corpus.json`

`node meta/unipack-conformance/sync.mjs --android <checkout> --ios <checkout>` copies it; with `--check` it
only compares and exits 1 on a difference. On every run each platform also reports the sha256 of the copy
it read, and `report.mjs` marks a platform whose hash differs from the canonical file as unverified.

After editing `cases.mjs`, `palette.json` or `divergences.json`: `build-corpus.mjs`, then `sync.mjs`, then
the three suites. `pnpm test:unipack` fails while `corpus.json` is not what the sources build.

## What is covered

- info: every key, whitespace, unknown keys, chain range 1..24, missing required files, missing title/producer, zero and non-numeric sizes.
- keySound: coordinates and their end values, loop and wormhole, queues, blank/short/comment-like lines, malformed numbers, missing sound files and folder, sub folders, spaces, tabs, CRLF, BOM, UTF-16.
- keyLed: file name mapping and loop, queue order, on/off/delay/chain in both spellings, hex/auto/velocity colours, round LEDs 1..32 and out-of-range ones, the logo in every spelling, malformed events, empty file, CRLF.
- autoPlay: on/off/touch/chain/delay in the long and the short spelling (`o`, `f`, `t`, `c`, `d`), queue numbering and reset, wormhole, out-of-range and malformed lines, empty file.
- runners: sound queue and chain, wormhole chain switch, endless and repeated sound loops, LED timeline, loop count, release, chain event, logo, exit, autoPlay timeline and stop.
- palette: the 128 colours.

## What is not covered

- Zip import and extraction, nested top folders, other archive quirks (the web reads a zip, the apps a folder).
- File and folder name case (`keyLED` vs `keyled`, `A.WAV` vs `a.wav`): it depends on the file system of the machine running the test.
- Real audio: decoding, latency, mixing, the Oboe / AVAudioEngine / Web Audio engines. Android and the web use a recorder in place of the engine; iOS runs its real engine but the test cannot hear it.
- MIDI devices and drivers, Launchpad colour output, the play screens, practice/guide mode of autoPlay, volume, theme packs.
- What a user sees after leaving the play screen on iOS, and on any platform with a real Launchpad connected.
- Android with Pro light mode off (its default), where round and logo lights of a keyLED file are hidden.
- The queue reset on a chain change (done by the play screens, see "What each harness measures").
- A pack opened in the running app on a device or in a browser: no capture exists yet for any platform.
- Sound loop timing and stop-on-release of endless sounds (the engines differ and the docs do not decide).
- Encodings other than UTF-8 and UTF-16 with BOM (legacy Korean encodings).
- Large packs, memory and timing under load.
- Whether the palette matches a Launchpad: the reference copy is Android's table.
- `info.json`, and every `undetermined` case: observed only.
