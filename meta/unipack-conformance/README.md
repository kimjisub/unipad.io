# UniPack conformance corpus

One set of small packs, read by the Android, iOS and web parsers and runners, with the result each is
expected to give. It answers "do the three platforms read this pack the same way?" for the packs in
this directory and nothing more. **Passing this corpus is not "every UniPack is 100% compatible".**
Real packs use more of the format than these cases exercise; see [What is not covered](#what-is-not-covered).

This directory is the single source. The apps carry a byte-identical copy of `corpus.json` and of its hash
`corpus.sha256`; a copy that drifts is detected (see [Keeping the copies in step](#keeping-the-copies-in-step)).

## Files

| File | Role |
|---|---|
| `GRAMMAR.md` | The UniPack grammar, edition G1: 103 numbered items, what each rule is, whether it is read (`parse`) or played and lit (`output`), and where it comes from. |
| `grammar.mjs` | Reads `GRAMMAR.md`, and lists the items a platform's harness cannot observe at all (`HARNESS_LIMITS`). |
| `cases.mjs` | The case list: input files, the grammar items each case checks, expected result, basis, and which platform cannot observe a case. Edit this, then rebuild. |
| `lib.mjs` | Sound asset generator, input fingerprint, expected-result builders. |
| `assets/tone-440.mp3` | The one sound kept as bytes: `tone-440` encoded as MP3 (see [Sounds](#case-format)). |
| `palette.json` | The 128 colours an `auto` velocity resolves to (reference copy, see PAL-001). |
| `divergences.json` | Differences observed on a platform today, pinned so a change in either direction is noticed. |
| `corpus.json` | Generated from the files above. The only file the apps read cases from. |
| `corpus.sha256` | The sha256 of `corpus.json`, one `<sha256>  corpus.json` line. Every harness refuses a `corpus.json` that does not hash to it. |
| `build-corpus.mjs` | `node meta/unipack-conformance/build-corpus.mjs` writes both, `--check` verifies both are current. |
| `sync.mjs` | Copies `corpus.json` and `corpus.sha256` into the app checkouts, or `--check`s that the copies are identical. |
| `copies.json`, `copies.mjs` | The app commits whose copies CI compares (see [The comparison in CI](#the-comparison-in-ci)). |
| `report.mjs` | Joins the three platforms' result files into one table, one row per case, and says per grammar item whether it is confirmed on each platform. |
| `materialize.mjs` | Writes one case's pack to a folder or `.zip` so it can be opened by hand on a device (`materialize.mjs KS-001 --out /tmp/x --zip`). |
| `selftest.mjs` | Tests of the tooling itself: `corpus.json` and `corpus.sha256` are what the sources build, what `report.mjs` may and may not count, and which copies `sync.mjs --check` refuses. `pnpm test:unipack` runs it. |
| `diagnostics/` | The web parser's warnings as written, and a separate tool that explains its number warnings as format or range. It never changes a result or a status. See its README. |

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
- the case is `undetermined`, or the corpus says the platform cannot observe it (`unobserved`) and the
  platform recorded no result for it.

The table starts with when each result file was written (`generatedAt`) and whether that run asserted,
so an old file or a record-only one is visible.

**Grammar items.** Every case names the items of [GRAMMAR.md](GRAMMAR.md) it checks (`items`);
`build-corpus.mjs` refuses a case without them or with a number the grammar does not list. `report.mjs`
then reports each of the 103 items per platform (`grammar.rows` in `--json`). An item is **confirmed**
on a platform when

- at least one case checks it;
- every case that checks it is a `pass` on that platform;
- for an `output` item, at least one of those cases is a `run` or `palette` case (a parse result does not
  show what is played or lit);
- the platform's harness can observe the item at all (`HARNESS_LIMITS` in `grammar.mjs`): Android and
  the web do not decode sounds, so A-01 to A-05 are never confirmed there; no harness imports an archive
  (F-05, F-06); and where the pack is written to a disk that does not tell `INFO` from `info`, a parser
  that opens only the exact name passes F-01 too, so Android and iOS confirm F-01 only when their result
  file says `"caseSensitiveFileSystem": true`.

The four numbers it prints: confirmed items per platform of 103, items confirmed on all three platforms
of 103, and items any case checks of 103 (`grammar.confirmed`, `grammar.confirmedOnAllThree`,
`grammar.withCases`). Five items have no case, because these cases cannot reach them: importing an
archive (F-05, F-06) and decoding OGG, M4A and a sound whose name does not match its content (A-03 to
A-05) are for each platform's own tests.

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
| `unverified` | No result to compare: the platform did not run, ran another corpus, cannot observe the case (`unobserved`) and recorded no result for it, or the case is `undetermined` (below). Never counted as a pass. |

A case is `determined` when a format doc (`content/docs/en/unipack`) or an intent stated in a
platform's own commit history or tests names the expected result. Otherwise it is `undetermined`: the
platforms still run it, the observed results are printed side by side, and it is `unverified` on every
platform until someone decides. `basis[].type` says which: `doc` (checked to exist at build time),
`intent` (a commit or test that states it), `reference` (the Android implementation, for the palette),
`agreed` and `decision` (below). No case is undetermined today; the harnesses' own checks make one from a
determined case to show that it is never a pass.
`decision` also stands for an item the grammar decides (`G1 decision` in GRAMMAR.md); its `ref` names the
item.

**Agreed behaviour.** When an undetermined case gives the same result on Android, iOS and the web, that
result is held as the expected one with an `agreed` basis, whose `ref` names the runs it was observed in
and whose `note` keeps the open question. It does not say the behaviour is right; it makes a change on
any one platform show up as a `fail` instead of passing unnoticed. A doc or an intent that decides the
case replaces it. Cases that rest on agreement are marked `[agreed]` in the table and counted on their
own line (`agreed` in `--json`), apart from those a doc or an intent decides. A case whose platforms
disagree is never given the result of two platforms against the third; it stays undetermined until it
is decided (below). INF-012 (`squareButton` true when it is not written) was held this way because all
three apps start from true; info.mdx now gives the same default.

**Decided behaviour.** When the platforms disagree, the maintainers choose the expected result. Where the
choice can be stated in a format doc, the doc is changed and the case rests on a `doc` basis like any
other: INF-007 (an `info` line without `=` is ignored, without a warning), INF-010 and INF-016 (a
`buttonX` or a `buttonY` that is not an integer refuses the pack), INF-015 (`info.json` is no `info` file) and KS-018 (a UTF-16
keySound with a byte order mark is read). Otherwise it rests on a `decision` basis, whose `ref` names
who decided and when and whose `note` the reason: KL-024 (an LED event outside the pad grid is kept as
written and skipped when lit), and the cases of the items GRAMMAR.md decides (S-12, T-03, T-04, A-06,
RS-09, RS-10, RL-12). Decided cases are marked `[decision]` in the table and counted on their own line (`decided` in
`--json`). Each platform that does not give the decided result yet is pinned in `divergences.json`, so
its suite stays green until its own fix removes the pin.

A case can also name a platform whose harness cannot observe it (`unobserved`, with the reason). While
that platform records no result for the case, the case is `unverified` there with that reason; the
others are judged as usual. A result the platform does record is judged like any other, so a harness
that has come to observe the case is not hidden behind the old reason: equal to the expected result is a
pass, anything else a fail. Marked today: the cases that watch sound stops (RUN-S-008 to RUN-S-010) on
iOS, and the queue reset on a chain change (RUN-S-012, RUN-S-013) on iOS (see "What each
harness measures"). RUN-A-001, RUN-A-002, RUN-RP-003, RUN-RP-004 (the autoPlay runner read the wall
clock) and RUN-L-006, RUN-L-007 (leaving the play screen) were marked on iOS until its harness came to
record results for them (see `stop` and autoPlay below).

## Case format

```jsonc
{
  "id": "KS-001",            // stable; the same id on every platform
  "items": ["S-01"],         // the GRAMMAR.md items it checks, at least one
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
  "basis": [ { "type": "doc", "ref": "content/docs/en/unipack/key-sound.mdx", "note": "..." } ],   // or agreed / decision, see Statuses
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
PCM WAV), and the 440 Hz tone encoded as MP3 (`tone-440-mp3`: LAME 3.100, `lame --silent --resample 44.1
-b 64 --cbr --noreplaygain`, MPEG-1 Layer III 44.1 kHz mono). The MP3 is kept as bytes in
`assets/tone-440.mp3` so that a machine without the encoder builds the same corpus; `lib.mjs` records the
sha256 of the WAV it was encoded from and of the MP3, and refuses either when it changes or when the MP3
does not start with an MPEG audio frame. Regenerate with `node meta/unipack-conformance/build-corpus.mjs`;
the bytes and sha256 are in `corpus.assets`. No pack, song or third-party audio is copied here. `Faded.zip` and other packs on the
maintainers' machines were used for local comparison only and are not part of this corpus. The generated
signals contain no third-party material; the repository's licence applies to them (the owner has not been
asked to choose another).

## Normalized result

Coordinates are 0-based in every result and step (files are 1-based, as authors write them). File
names are reported composed (Unicode NFC), as the corpus writes them; a disk that hands them back
decomposed does not change a result.

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
| `range` | `chain\|x\|y\|loop\|coordinate is incorrect`, `out of range` |
| `missing-file` | `sound was not found`, `sounds directory not found`, `doesn't exist` |
| `missing-field` | `title\|producerName\|buttonX\|buttonY\|chain was missing` |
| anything else | `other(<message>)`, so a new message shows up as a difference |

`run` layer: the case's `scenario` is played against the platform's LED runner, sound engine and
autoPlay runner on one virtual clock, and reports `{ "checkpoints": [ [event, ...], ... ] }`, one list
per `observe` step holding what happened since the previous one, in the order it happened. Steps:
`press`/`release` (x, y: the sound engine and the LED runner, as the play screen calls them), `chain`
(c: the user picks a chain), `advance` (ms of virtual time, runners ticking at 4 ms, autoPlay at 1 ms),
`observe`, `autoplay` (start the autoPlay runner; with `"toPads": true` each of its presses and releases
also goes to the sound engine and the LED runner, as the play screens forward them), `stop` (leave the
play screen), `watchStops` (from here on also report the voices the sound engine stops). Events:
`["sound", chain, x, y, file, loop]` (loop as stored: -1 endless, 0 once, N repeats),
`["soundStop", chain, x, y, file]` (only after `watchStops`: the engine stopped a voice that a press
started, the first time; chain, x, y and file are those of its `sound` event; a stop scheduled when a
repeated sound starts is not one),
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
| `stop` | the play screen's `onStop`: `screenVisible = false`, `ledInit()` | `AutoPlayRunner.stop()`, `LedRunner.stop()`, `SoundEngine.destroy()`, then the main screen's step that takes the MIDI controller back (`MainViewModel.setupMidiController` → `MainMidiControllerAdapter.onAttach` → `sendClearLed`) against a recording MIDI driver; the clear call is observed, not what a physical Launchpad receives | `LedRunner.stop()`, `SoundEngine.destroy()`, `AutoPlayRunner.stop()` |
| autoPlay | `AutoPlayRunner` on the virtual clock; with `toPads` a press goes to `PlayActivityViewModel.padTouch` on the main thread, as its own listener posts `padEvent` there | `AutoPlayRunner` on the virtual clock (its clock and sleep are passed in by the harness) | `AutoPlayRunner` on the virtual clock; with `toPads` a press goes to the same sound and LED calls as a pad press, as `useUniPadEngine` forwards it to `padTouchOn` |
| Decoding | not decoded: the recording engine stands in for the decoder too, so a sound event says the runner asked for the file. It fails to decode bytes that do not start like a WAV (`RIFF…WAVE`) or an MP3 (`ID3` or a frame), as the native decoder would | decoded by `AVAudioFile` in the real engine | not decoded: the Web Audio stand-in returns a buffer for bytes that start like a WAV or an MP3 and fails to decode others |
| Sound stops (`watchStops`) | a `stopVoice` call of the runner for a voice the recording engine started | not observed: the real engine keeps no record a test can read of the voices it stops | `stop()` without a time on a started source of the Web Audio stand-in |
| Chain change | the view model's `ChainObserver` (clamps into the pack) and the queue reset it registers in `initPlayback`, as the play screen sets it up | the runner's `ChainObserver` (clamps into the pack); no `PlayViewModel`, so no queue reset | `changeChain` (`chainChange.ts`), the clamp and queue reset `useUniPadEngine` runs for every chain change |

The reset of every pad's queue position when the chain changes (RS-10) is done by the play screens
(Android `PlayActivityViewModel`, iOS `PlayViewModel`, web `useUniPadEngine`), not by the runners. The
web harness runs the same function the play screen does (`changeChain`) and the Android harness sets the
view model up as the play screen does; the iOS harness does not attach `PlayViewModel`, so RUN-S-012 and
RUN-S-013 are `unobserved` there. The other cases are written so that
they do not depend on it.

The iOS harness waits 300 ms before it destroys the sound engine to let the short corpus sounds finish
and avoid a reproduced deadlock when a repeated sound is stopped while cycling. This wait hides the
hang from these conformance cases; it does not make the app safe. The independent review on 2026-09-30 reproduced
exit hangs in 3 of 3 runs and immediate re-press hangs in 2 of 2 runs on iOS 26.4, in addition to the
iOS 27.0 exit reproduction. See RESULTS.md, "iOS: destroy() while a repeated sound is cycling".
Fixing the hang in the app is a separate change.

`palette` layer: `{ "argb": [128 lowercase 8-digit hex strings] }` from the platform's colour table.

## Checks that can fail

A comparison that cannot fail would prove nothing, so each platform's suite also contains checks that
break one thing on purpose and require the comparison to notice: a changed input file no longer matches
its fingerprint; a changed expected coordinate turns a pass into a fail; a changed input with the same
expected result fails; a parser stand-in that sees none of the case fails; an LED runner whose `eventOn`
is a no-op fails a run case; on the web, a chain change without the play screen's queue reset fails
RUN-S-012, the decoder stand-in leaves a pad silent only when its sound is not audio, and a scenario that
does not watch stops reports none; a pinned difference that stops happening (or changes) is an unexpected
result; an undetermined case never counts as a pass; a case marked `unobserved` for the platform is
unverified while it records no result. `selftest.mjs` does the same for `report.mjs`: a pass claimed
without a result, a pass claimed on an undetermined case, results handed in under another platform's name and an
iOS log given as `--android` all have to come out unverified, and a result recorded for a case marked
`unobserved` is judged from that result. It also checks the grammar side: GRAMMAR.md lists 103 items,
`build-corpus.mjs` refuses a case without items or with an unknown or repeated one, and an item is
confirmed only as described in [What `report.mjs` counts](#running-it).

## Keeping the copies in step

`corpus.json` is copied byte for byte to

- `unipad-android/app/src/test/resources/unipack-conformance/corpus.json`
- `unipad-ios/unipadTests/UniPackConformance/corpus.json`

together with `corpus.sha256`. `node meta/unipack-conformance/sync.mjs --android <checkout> --ios <checkout>`
copies both; with `--check` it only compares and exits 1 when either file is missing or differs.

Each harness, before it runs anything, hashes the `corpus.json` it actually read and compares the result
with the `corpus.sha256` beside it (on iOS the copy in the test bundle, or the one beside the sources, as
the result file's `corpusSource` says). A missing `corpus.sha256` or a different hash fails the run, a
record-only run included. That catches a copy that was edited or half copied. It cannot catch an older
`corpus.json` copied together with its own older `corpus.sha256`: only `sync.mjs --check` against this
directory does, and CI runs it (below). Every platform also reports the sha256 of the copy it read, and `report.mjs` marks a
platform whose hash differs from the canonical file as unverified.

After editing `cases.mjs`, `palette.json` or `divergences.json`: `build-corpus.mjs`, then `sync.mjs`, then
the three suites. `pnpm test:unipack` fails while `corpus.json` is not what the sources build.

### The comparison in CI

The `UniPack corpus copies` job in `.github/workflows/ci.yml` checks out only the copy folder of each app
repository at an exact commit and runs `selftest.mjs`, `build-corpus.mjs --check` and
`sync.mjs --check --android … --ios …` against this commit. Which app commits it compares:

- pull requests and pushes to `main`: the ones in `copies.json`;
- a manual run (`workflow_dispatch`): the `android` and `ios` inputs, or `copies.json` for an empty one;
- the weekly scheduled run: the latest commit of each app's default branch, so a copy changed only in an
  app is noticed.

`copies.json` holds exactly `android` and `ios`, each a full 40-character commit hash; `copies.mjs` refuses a
branch, a tag or a short hash, so the comparison never runs against a moving target. When a change to the
corpus is reviewed together with its app copies, `copies.json` names the commits of the app pull requests;
once those are merged, `copies.json` is moved to the merge commits on the app default branches. To run the
comparison locally, check out both apps at the pinned commits and run the three commands above.

## What is covered

Per item, `report.mjs` lists the cases that check it. In short:

- files: root files and folders in any letter case, other names (`keySounds`, `info.txt`, `info.json`), files in sub folders of keyLED.
- text: the UTF-8 byte order mark and UTF-16 with a byte order mark in every file, CP949 text (legacy Korean Windows).
- info: every key, whitespace, unknown keys, lines without `=`, a key written twice, chain range 1..24, missing required files, missing title/producer, zero and non-numeric sizes, `squareButton` values other than `true`.
- keySound: coordinates and their end values, loop and wormhole, columns after the sixth, queues, blank/short/comment-like lines, malformed numbers, missing sound files and folder, sub folders, sound names in other letter case, spaces, tabs, CRLF, BOM, UTF-16.
- keyLed: file name mapping and loop, queue order, on/off/delay/chain in both spellings, hex/auto/velocity colours, round LEDs 1..32 and out-of-range ones, the logo in every spelling, malformed events, empty file, CRLF.
- autoPlay: on/off/touch/chain/delay in the long and the short spelling (`o`, `f`, `t`, `c`, `d`), queue numbering and reset, wormhole after `on` and after `touch`, out-of-range and malformed lines, empty file.
- runners: sound queue and chain, wormhole chain switch, its timing and a wormhole to a chain the pack does not have, a sound that cannot be decoded, endless and repeated sound loops, which sounds a release and a second press stop, the queue reset on a chain change (web), LED timeline with zero and negative delays, loop count, release of an endless and of a counted animation, several animations on one pad, two animations on one light, an event outside the pad grid, chain event, logo, exit, autoPlay timeline, its queue numbers after a hand press and a chain, and stop.
- shapes common in real packs (`RP-`, `RUN-RP-`): an 8 x 8 grid to its last pad, an MP3 sound read and
  started, lights that repeat or loop endlessly while autoPlay presses and releases the pad, and
  `squareButton=false`. Five-part keyLED names (`1 1 1 1 a`) are held on an agreed basis.
- palette: the 128 colours.

## What is not covered

- Zip import and extraction, nested top folders, other archive quirks (the web reads a zip, the apps a folder).
- A file whose name matches exactly next to one that differs only in case (`a.wav` and `A.WAV`): a disk that does not tell case apart cannot hold both. Where the disk does not, a parser that opens only the exact name of a root file also passes FS-001 (see "Grammar items"); KS-019 to KS-021 name the sound as it is on disk, so it fails such a parser anyway.
- Real audio: decoding, latency, mixing, the Oboe / AVAudioEngine / Web Audio engines. Android and the web use a recorder in place of the engine and do not decode the MP3; iOS runs its real engine but the test cannot hear it.
- Stopping autoPlay without leaving the screen: the play screens clear the lights themselves then (web `ledInit`, Android `onEnd`), outside every harness's seam, so whether a light the autoPlay lit stays on is not observed.
- Where a pad is pressed on screen, the shape of a button with `squareButton=false`, real light timing, and how many real packs play the same.
- MIDI devices and drivers, Launchpad colour output, the play screens, practice/guide mode of autoPlay, volume, theme packs.
- What a user sees after leaving the play screen on iOS, and on any platform with a real Launchpad connected.
- Android with Pro light mode off (its default), where round and logo lights of a keyLED file are hidden.
- The queue reset on a chain change on Android and iOS, and which voices the iOS engine stops (see "What each harness measures").
- A pack opened in the running app on a device or in a browser: no capture exists yet for any platform.
- Sound loop timing and stop-on-release of endless sounds (the engines differ and the docs do not decide).
- Encodings other than UTF-8, UTF-16 with BOM and CP949.
- Large packs, memory and timing under load.
- Whether the palette matches a Launchpad: the reference copy is Android's table.
- Whether an `agreed` result is the right behaviour: it is only what the three platforms did.
