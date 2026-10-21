# UniPack grammar, edition G4

G4 clarifies L-07: compare NFC-normalized, lower-cased file names by UTF-16 code units,
without changing the paths used to open them. Decomposed accents and Hangul must queue as their
composed spellings do. Names equal under this comparison retain their input listing order;
archives containing canonically equivalent duplicate paths are outside this rule.
G3 corrects E-09: a negative delay shortens later waits but never takes back time already waited.
G2 added T-09: numeric fields are signed decimal 32-bit integers; larger numbers are format errors.

What a UniPack is, item by item: how the Android, iOS and web apps read a pack, and what they play and
light, in which order and when. Every conformance case names the items it checks (`items` in
`cases.mjs`), and `report.mjs` reports each item as confirmed or not per platform. The denominator of
every number it prints is the **104 items** below; what is left out is listed at the end.

An item number never changes meaning. To change or add a rule the edition goes up (G2, …) and the change
is written at the top of this file; a number that is dropped is not used again. An expected result in
the corpus changes only when a rule does, never to match what an app does today.

- **Kind:** `parse` is how the pack is read, checked by a parse result. `output` is which sound plays in
  which order, which light shows which colour and when, checked by running a scenario only (a `run` or
  `palette` case).
- **Basis:** `doc` means the format docs (`content/docs/{ko,en}/unipack/*.mdx`) state it. `apps agree`
  means the docs are silent but the three apps' code and tests mean the same thing (the docs should say
  so). `G1 decision` means the docs and the apps, or the apps among themselves, differed, and this edition
  decides; the reason is in the last column.
- **Where:** the doc section, the code that implements it (files on `main`), and real packs that use it.

## What this edition decides

The table below records the state used to establish G1. G4 additionally changes queues whose
names contain decomposed characters to match their composed spellings, and makes the existing
Android/web UTF-16 comparison explicit on iOS as well.
For the current per-platform status, run `report.mjs`; fixes do not change these grammar rules.

The original G1 items below choose no new product behaviour. Each of those decisions either keeps what the three apps
already do and corrects the docs, reads what the author clearly meant, or keeps grammar that is already
written (line order, wormholes, `touch` = `on` + `off`). No pack that loads and plays today changes in
any of them.

| Item | Difference | Decided | To change |
|---|---|---|---|
| I-08 | The docs give `squareButton` the default false, the three apps true | true (the apps) | docs |
| E-06, RL-06 | The docs call the logo `l` "not supported", the three apps light it | lit (the apps) | docs |
| RS-09 | The docs switch a wormhole "after playback", the three apps 100 ms after the press | 100 ms after the press (the apps) | docs |
| RS-10 | The docs reset the queues only on an autoPlay `chain`, the three apps on every chain change | every chain change (the apps) | docs |
| E-14, RL-12 | LED coordinates outside the pad grid: Android and iOS keep them and skip them when lit, the web drops them with a warning (packs in the official store do this) | kept, skipped when lit | web |
| S-12 | Sound name case: the web finds the file, iOS on a device does not and stays silent, Android depends on the file system (packs in the official store do this) | found (an exact match first) | iOS, check Android |
| A-06 | A sound that cannot be decoded: on all three apps the pad stops at that sound and never reaches the next | only that slot is silent; the queue and the wormhole go on | all three |
| A-04 | M4A: not in the docs, used by real packs | a supported format | docs, check all three |
| A-05 | Named `.wav`, content MP3 (packs in the official store do this) | played by its content | check all three |
| F-05 | Files beside the pack in a zip: the web opens it, Android and iOS do not when a single file sits beside the top folder | opened when exactly one folder holds an `info` | Android, iOS |
| F-06 | File name encoding inside a zip: only iOS reads CP949 again | UTF-8, else CP949 | Android, web |
| T-03 | Encoding rules: the docs only speak of keySound | the same for every text file | docs, check web |
| T-04 | Legacy Korean encodings: only iOS reads them | after UTF-8 and UTF-16, CP949 | Android, web |

Other gaps noted when G1 was introduced, for rules already stated in the docs (not new decisions): I-02 and I-04 (Android), T-02
(web), A-03 OGG (iOS cannot open it; no real pack seen uses it), P-04 a wormhole under `touch` (all
three), RS-05 releasing an endless sound (Android looks at the loop of the queue's next sound), RS-06
releasing after the chain changed (Android, web).

## Items

### F. File and folder names and paths (7)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| F-01 | At the pack root, `info`, `keySound`, `autoPlay` (files) and `sounds`, `keyLED` (folders) are found whatever their letter case. Another name (`keySounds`, `info.txt`) is not that file. | parse | apps agree | Not in the docs. Android `UniPackFolder.kt` 138-155, iOS `UniPackFolder.swift` 88-105, web `parser.ts` getFile/getDir |
| F-02 | A pack without `info` or `keySound` does not open. | parse | doc | info.mdx properties table, key-sound.mdx first line |
| F-03 | A file with another name, such as `info.json`, is not read as `info`. | parse | doc | info.mdx |
| F-04 | The `keyLED` folder and the `autoPlay` file may be absent (no lights, no autoPlay). Without a `sounds` folder every keySound line warns that its sound is missing. | parse | doc | key-sound.mdx validation, info.mdx |
| F-05 | Importing a zip opens the one folder that holds `info` as the pack: top folders wrapped around it are taken off, and `__MACOSX`, dot files and other files beside it are ignored. | parse | G1 decision | Not in the docs. Android `UniPackImporter.kt`, `FileManager.kt` 20-40 (only a lone folder, up to 8 levels), iOS `FileManager+Extensions.swift` 13-26 (one file beside it is enough to fail), web `parser.ts` findRootPrefix (any depth). Decided: when the pack the author put in is unambiguous, it opens. No pack that opens today changes. |
| F-06 | File names inside a zip are read as UTF-8; a name without the UTF-8 flag that is not valid UTF-8 is read as CP949 (Korean Windows). | parse | G1 decision | Not in the docs. iOS `UniPackImporter.swift` 282-289 (UTF-8, CP949, Latin-1), Android zip4j default (UTF-8 only), web JSZip (UTF-8). Decided: real packs carry sound names outside ASCII, such as Korean. |
| F-07 | Only the files directly inside the `keyLED` folder are LED files (files in sub folders are not read). | parse | apps agree | web `parser.ts` parseKeyLed comment, the Android and iOS folder listings |

### T. Text files: encoding, lines, columns (9)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| T-01 | A text file is read as UTF-8, and a UTF-8 byte order mark at its start is dropped. | parse | apps agree | key-sound.mdx "The file is UTF-8". The byte order mark of info, keyLED and autoPlay is T-03. |
| T-02 | A UTF-16 keySound (little or big endian) that starts with a byte order mark is read. | parse | doc | key-sound.mdx first paragraph |
| T-03 | The encoding rules of T-01 and T-02 hold for info, keyLED and autoPlay as well. | parse | G1 decision | The docs speak of keySound only. Android `UniPackFolder.kt` 29-53 and iOS `UniPackFolder.swift` 603-632 read every text file with the same function. Decided: there is no reason for the files of one pack to follow different encoding rules. |
| T-04 | A text file that is neither UTF-8 nor UTF-16 with a byte order mark is read as CP949 (which includes EUC-KR). | parse | G1 decision | Not in the docs. iOS `UniPackFolder.swift` 603-632 (EUC-KR, then CP949); Android and the web read UTF-8 only. Decided: this is what Windows Notepad saved as "ANSI" on Korean systems. |
| T-05 | A line ends with LF, CRLF or a lone CR, and the last line needs no line end. | parse | apps agree | cases.mjs WHITESPACE (unipad-android 22a45925) |
| T-06 | Columns are split on runs of spaces and tabs, and spaces around a line are ignored, so a file name cannot contain a space. | parse | apps agree | cases.mjs WHITESPACE |
| T-07 | Blank lines are ignored. | parse | doc | key-sound.mdx validation |
| T-08 | There is no comment syntax. A line starting with `#` is handled by the file's usual rules (ignored when it has too few columns, a format warning when its command is unknown). | parse | apps agree | cases.mjs AGREED |

| T-09 | Numeric fields in keySound lines, keyLED file names and events, and autoPlay lines are signed decimal integers from -2147483648 to 2147483647. A number outside that range is a format error: skip only its line (or the file for a keyLED file name). In-range values follow each field's rules: out-of-pack chains and coordinates are range errors; delay and the velocity after a hex colour are kept as written. Storing the smallest number minus one internally may saturate at -2147483648 on Android instead of -2147483649; this representation difference does not change output. | parse | G2 decision | parser.ts strictInt, Android toIntOrNull. Leading plus signs and leading zeroes are not exercised. |

### I. info (11)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| I-01 | One `key=value` per line, split at the first `=`, spaces around both sides dropped. Unknown keys are ignored. | parse | doc | info.mdx first paragraph |
| I-02 | A line without `=` is ignored, without a warning. | parse | doc | info.mdx first paragraph |
| I-03 | A missing or empty `title` or `producerName` only warns; the pack opens. | parse | doc | info.mdx validation |
| I-04 | A `buttonX` or `buttonY` that is not an integer (`abc`) refuses the pack. | parse | doc | info.mdx validation |
| I-05 | A `buttonX` or `buttonY` of 0 warns, and every pad in that direction is out of range. | parse | doc | info.mdx validation |
| I-06 | A negative `buttonX` or `buttonY`, or one above 64, refuses the pack. | parse | apps agree | info.mdx says "1 or more" only; all three apps accept 0..64 (cases.mjs AGREED). The docs should state the upper bound. |
| I-07 | `chain` is 1 to 24. Outside that, or not a number, refuses the pack. | parse | doc | info.mdx properties table and validation |
| I-08 | Without `squareButton` the buttons are square (true). | parse | G1 decision | info.mdx says "default: false"; all three apps start from true (INF-012). Decided: keep the apps, correct the docs. Nothing changes for users. |
| I-09 | `squareButton` is true only when it is exactly `true`; any other value (`false`, `True`, `1`) is false. | parse | apps agree | Android `UniPackFolder.kt` 166-216, iOS 145-191, web parseInfo |
| I-10 | `website` is optional and kept as written (empty means none). | parse | doc | info.mdx properties table |
| I-11 | When a key appears twice, the last value counts. | parse | apps agree | The three apps' code (not in the docs) |

### S. keySound (12)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| S-01 | A line is `chain x y soundFile [loop] [wormhole]`, numbers counted from 1 (chain 1..chain, x 1..buttonX, y 1..buttonY). | parse | doc | key-sound.mdx syntax |
| S-02 | A line whose chain, x or y is out of range is skipped with a range warning. | parse | doc | key-sound.mdx validation |
| S-03 | A line of 1 or 2 columns is ignored silently; 3 columns (no sound file) is a format warning. | parse | doc | key-sound.mdx validation |
| S-04 | A number column (chain, x, y, loop, wormhole) that is not an integer (letters, a decimal point, trailing letters) skips the line with a format warning. | parse | apps agree | the basis of the cases.mjs KS-M cases |
| S-05 | loop: left out or 1 plays once, 0 endlessly, N (2 or more) N times in all. It is stored minus one (-1 endless, 0 once). | parse | doc | key-sound.mdx Loop Values |
| S-06 | wormhole: the sixth column, the chain a press of that sound moves to. | parse | doc | key-sound.mdx syntax and example |
| S-07 | A wormhole to a chain the pack does not have moves to the nearest chain it has (the first or the last). | output | apps agree | Not in the docs. All three clamp the chain to 0..chain-1 (Android `ChainObserver.kt` 16-21, iOS `ChainObserver.swift` 31-39, web `useUniPadEngine.ts` setChain) |
| S-08 | Columns after the sixth are ignored. | parse | apps agree | The three apps' code (not in the docs) |
| S-09 | Several sounds on one pad form a queue in the order of the file. | parse | doc | key-sound.mdx Circular Queue |
| S-10 | A line naming a sound file that is not under `sounds/` is skipped with a missing-sound warning. | parse | doc | key-sound.mdx validation |
| S-11 | A sound file name is a path relative to `sounds/` and may name a sub folder (`fx/sweep.wav`). | parse | doc | sounds.mdx example and notes |
| S-12 | A sound is found even when the letter case of the name in keySound differs from the file's. A file whose name matches exactly, case included, is used first; otherwise the whole path under `sounds/`, including subfolders, is compared without case. A folder is never a sound. The reported name is the stored file name. | parse | G1 decision | sounds.mdx tells authors the name must match exactly. The web ignores case, iOS tells case apart on a device (`UniPackFolder.swift` 270-273), Android follows the file system (`UniPackFolder.kt` 239-286). Packs in the official store do this. Decided: such packs already sound on the web and are silent on iOS; the file the author meant is clear, so it is found. The docs' advice to authors stays. |

### A. Sound file formats (6)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| A-01 | A WAV (PCM) sound plays. | output | doc | sounds.mdx supported formats |
| A-02 | An MP3 sound plays. | output | doc | sounds.mdx supported formats |
| A-03 | An OGG Vorbis sound plays. | output | doc | sounds.mdx supported formats ("recommended"). iOS cannot open it (`SoundEngine.swift` 262 comment). No real pack seen uses OGG. |
| A-04 | An M4A (AAC) sound plays. | output | G1 decision | Not in the docs. Real packs use it. Decided: a format real packs use belongs in the grammar and the docs. |
| A-05 | A sound whose extension does not match its content (named `.wav`, MP3 inside) is decoded by its content and plays. | output | G1 decision | Not in the docs. Packs in the official store do this. Decided: the sound the author meant is clear. |
| A-06 | A sound that cannot be decoded is silent in its slot only: the pad's queue moves on to the next sound, and that sound's wormhole still applies. The pack closes only when no sound can be decoded. | output | G1 decision | PARITY.md "Sound decoding failures". On all three apps the queue does not move past a sound that failed to decode, so the pad stays silent (Android `SoundRunner.kt` soundOn pushes only inside `sound.id >= 0`, iOS `SoundEngine.swift` 503-506, web `SoundEngine.ts` 142). Decided: keep the queue order (S-09) and the wormhole (S-06) the author wrote. |

### L. keyLED file names (9)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| L-01 | An LED file is named `chain x y [loop]` (split on spaces, counted from 1). | parse | doc | key-led.mdx file naming |
| L-02 | loop: left out is once, 0 endless, N N times. | parse | doc | key-led.mdx file naming |
| L-03 | A file whose chain, x or y is out of range is ignored with a range warning. | parse | doc | key-led.mdx validation |
| L-04 | A file with a negative loop is ignored with a warning. | parse | doc | key-led.mdx validation ("warning") |
| L-05 | A number column of the name that is not an integer ignores the file with a format warning. | parse | apps agree | the basis of cases.mjs KL-N |
| L-06 | A fifth or later column of the name (`1 1 1 1 a`) is ignored (other tools name several files for one pad this way). | parse | apps agree | cases.mjs RP-002 (AGREED) |
| L-07 | Several files for one pad queue by their file names: normalize to NFC, lower-case, then compare UTF-16 code units lexicographically. Read the files by their original paths. Equal comparison keys retain input listing order. | parse | G4 decision | key-led.mdx circular queue. Android and web preserve decomposed archive names, while Swift compares canonically equivalent spellings; NFC keeps the existing order for composed names and removes the spelling-dependent difference. |
| L-08 | A file whose name has fewer than 3 columns is ignored silently. | parse | apps agree | cases.mjs KL-006 (AGREED) |
| L-09 | A pack with a `keyLED` folder has lights, even when the folder is empty. | parse | apps agree | cases.mjs KL-007 (AGREED) |

### E. keyLED events (15)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| E-01 | The events `on`/`o`, `off`/`f`, `delay`/`d` and `chain`/`c` are read in the long and the short spelling. | parse | doc | key-led.mdx Event Syntax |
| E-02 | A colour is up to 6 hex digits without `#`. 7 digits or more, a `#`, or a character that is not hex drops the line with a format warning. | parse | doc | key-led.mdx Color Specification |
| E-03 | A hex colour alone carries velocity 4. A velocity after a hex colour (0..127) is what goes to the Launchpad; a value above 127 is kept as written. | parse | apps agree | cases.mjs VEL4, KL-020 (the docs give no default) |
| E-04 | `auto`/`a` followed by a velocity 0..127 is that colour of the palette (C-01). A missing or out-of-range velocity drops the line with a format warning. | parse | doc | key-led.mdx Color Specification |
| E-05 | `*` or `mc` followed by 1..32 is a round (chain) button light. 0, 33 and other numbers out of range are dropped without a warning; a value that is not a number is a format warning. | parse | doc | key-led.mdx Special Coordinates |
| E-06 | `l` is the logo light (the 33rd round button position). `o l colour`, `o l auto v`, `o l _ colour` and `f l` are read; a malformed logo line is a format warning. | parse | G1 decision | key-led.mdx says "not supported, ignored"; all three apps light it (cases.mjs LOGO). Decided: keep the apps, correct the docs. |
| E-07 | `off x y` with too few coordinates, or letters, is a format warning. | parse | apps agree | cases.mjs KL-M08 to M10 |
| E-08 | `delay ms` that is not an integer, or has no value, is a format warning. | parse | apps agree | cases.mjs KL-M20 to M22 |
| E-09 | A delay moves the next event to the sum of all delays before it. `delay 0` does not wait. A negative delay is added as written too, but an event never comes before the one above it: time already waited is not taken back, only the waits after it get shorter. Example: `d 100`, `d -60`, `f 1 1`, `d 100`, `o 2 1` turns the light off at 100 ms and on at 140 ms. | output | apps agree | key-led.mdx "Waits the specified milliseconds before the next event" (negative values are not mentioned). Android `LedRunner.kt`, iOS `LedRunner.swift` and web `LedRunner.ts` take the next event only once `delay <= currTime`. |
| E-10 | `chain N` that is not an integer, or has no value, is a format warning. A chain number the pack does not have is kept as written. | parse | apps agree | cases.mjs KL-M23, M24, KL-023 |
| E-11 | The columns of an `on` line: `on x y colour`, `on x y colour v` or `on x y auto v` only. Too few, too many, or a velocity in letters is a format warning. | parse | doc | key-led.mdx validation ("4 tokens / 5 tokens") |
| E-12 | A line with an unknown command is skipped with a format warning. | parse | doc | key-led.mdx validation ("skipped") |
| E-13 | Letters mixed into a coordinate (`1b`) are a format warning. | parse | apps agree | cases.mjs KL-M04 to M06 |
| E-14 | An `on` or `off` outside the pad grid (0, negative, beyond buttonX or buttonY) is kept as written without a warning and skipped when lit (RL-12). | parse | G1 decision | cases.mjs KL-024 (a maintainers' decision). Packs in the official store do this; the web drops such lines with a warning today. |
| E-15 | An empty LED file still counts as one animation of its pad. | parse | apps agree | cases.mjs KL-021 |

### P. autoPlay commands (8)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| P-01 | The commands `on`/`o`, `off`/`f`, `touch`/`t`, `chain`/`c` and `delay`/`d`. | parse | doc | auto-play.mdx Commands |
| P-02 | `on` and `touch` advance the pad's sound queue number by one, and `chain` sets every pad's number back to 0. | parse | doc | auto-play.mdx Behavior |
| P-03 | When the sound an `on` plays has a wormhole, the chain becomes that chain from there on and the numbers go back to 0. | parse | doc | auto-play.mdx Behavior |
| P-04 | `touch` is `on` + `off`, so a `touch` of a pad whose sound has a wormhole switches the chain as in P-03. | parse | doc | auto-play.mdx Commands ("on + off in one line") and Behavior. None of the three apps follows it when parsing (code read): the chain switches 100 ms into the run and the next command switches it back. |
| P-05 | A line with a coordinate or chain outside the pack is skipped with a range warning. | parse | doc | auto-play.mdx Notes |
| P-06 | A number column that is not an integer, or missing, skips the line with a format warning. | parse | apps agree | the basis of cases.mjs AP-M |
| P-07 | A line with an unknown command is skipped with a format warning. | parse | apps agree | cases.mjs AP-M10 (AGREED) |
| P-08 | An empty autoPlay file is an autoPlay with no commands. | parse | doc | auto-play.mdx |

### RS. Running: sound (10)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| RS-01 | A press plays the first sound of the pad's queue, and the next press the next one (back to the first after the last). | output | doc | key-sound.mdx Circular Queue |
| RS-02 | The sound of the chain selected now plays. | output | doc | key-sound.mdx |
| RS-03 | A pad without a sound plays nothing. | output | doc | key-sound.mdx |
| RS-04 | loop 0 asks for an endless sound, loop N for N plays in all. | output | doc | key-sound.mdx Loop Values. Checked up to the repeat value handed to the engine; whether N plays are heard is for the device checks. |
| RS-05 | A release stops only an endless (loop 0) sound that its own press started. A sound played once or N times plays to its end. | output | apps agree | Not in the docs. The three apps mean the same (Android `SoundRunner.kt` soundOff, iOS `SoundEngine.swift` 578-584, web heldNodes). Android judges by the loop of the next sound, after the queue has moved on (`SoundRunner.kt` soundOff): in a queue [endless A, once B] releasing A does not stop it, in [once A, endless B] releasing A stops it. |
| RS-06 | When the chain changes while a pad is held, its release still stops the endless sound its press started. | output | apps agree | Not in the docs. |
| RS-07 | Pressing the same pad again stops the pad's previous sound and starts the next one (the sounds of one pad do not overlap; different pads do). | output | apps agree | Not in the docs. The three apps agree (Android `SoundRunner.kt` 184, iOS 497, web 134-139) |
| RS-08 | Pressing a sound with a wormhole switches to that chain, and the next press plays a sound of the new chain. | output | doc | key-sound.mdx syntax and example |
| RS-09 | The chain switch of a wormhole happens 100 ms after the press (not when the sound ends). | output | G1 decision | key-sound.mdx says "after playback"; all three apps switch 100 ms after the press (Android `SoundRunner.kt` 194-198, iOS 569-575, web 160-162). Decided: keep the apps, correct the docs. Nothing changes for users. |
| RS-10 | Every change of chain (by the user, a wormhole, a light or autoPlay, even to the same chain) sets the sound and light queues of every pad of that chain back to their first entry. | output | G1 decision | auto-play.mdx speaks of the autoPlay `chain` only. The three play screens do it on every change (Android `PlayActivityViewModel.kt` 454-462, iOS `PlayViewModel.swift` 476-487, web `useUniPadEngine.ts` 358-381). Decided: the three apps' behaviour becomes the grammar. |

### RL. Running: lights (12)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| RL-01 | The on, delay and off of an LED file come out at the times written. | output | doc | key-led.mdx Full Example |
| RL-02 | An animation with loop N plays N times and stays dark afterwards. | output | doc | key-led.mdx file naming |
| RL-03 | An endless (loop 0) animation stops at once when the pad is released, and the lights it lit go off. | output | apps agree | the basis of cases.mjs RUN-L-003 |
| RL-04 | An animation played once or N times plays to its end after the pad is released. | output | apps agree | The three apps agree (Android `LedRunner.kt` 285-296, iOS 297-307, web 261-268) |
| RL-05 | A `chain` event inside an LED file switches the chain at that moment; a chain the pack does not have becomes the nearest one. | output | doc | key-led.mdx chain. The part that moves to the nearest chain has no case yet. |
| RL-06 | The logo light lights and goes off on time. | output | G1 decision | E-06 |
| RL-07 | A round button light lights and goes off. | output | doc | key-led.mdx Special Coordinates |
| RL-08 | Leaving the play screen turns every lit light off, and no light follows. | output | apps agree | the basis of cases.mjs RUN-L-006 |
| RL-09 | Pressing a pad again during its animation turns that animation's lights off and starts the next animation from its beginning. | output | apps agree | cases.mjs RUN-L-008 (AGREED) |
| RL-10 | Several animations on one pad play in turn, one per press. | output | doc | key-led.mdx "circular queue" |
| RL-11 | When two animations light the same light, the later one owns it, and the other animation's `off` does not turn it off. | output | apps agree | Not in the docs. The three apps agree (Android `LedRunner.kt` 134-157, iOS 169 and 185, web 140, 151 and 177) |
| RL-12 | A light event outside the pad grid is skipped when lit, and the other events of the same file come out as written. | output | G1 decision | E-14 |

### RA. Running: autoPlay (4)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| RA-01 | autoPlay presses and releases from top to bottom, waiting for each `delay`. Commands without a delay between them come out at the same time. | output | doc | auto-play.mdx Behavior and Notes |
| RA-02 | autoPlay's presses and releases sound and light as if pressed by hand. | output | doc | auto-play.mdx ("play sound + start LED") |
| RA-03 | Leaving the play screen stops autoPlay, and no press follows. | output | apps agree | the basis of cases.mjs RUN-A-002 |
| RA-04 | autoPlay's `chain` and wormholes switch the chain at that moment, and the next `on` plays the sound and light of the queue number decided when the file was read. | output | doc | auto-play.mdx Behavior |

### C. Palette (1)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| C-01 | The 128 colours an `auto` velocity 0..127 stands for. | output | apps agree | palette.json (Android `LaunchpadColor.ARGB`). Comparing them with a Launchpad's real colours is for the device checks. |

### Not counted (out of scope)

| What | Why |
|---|---|
| Practice, guide and step modes | App features, not pack grammar (they use the autoPlay file as it is). What the screen does is a product question. |
| The lights left on when autoPlay is stopped on the play screen | The result of using the app, not something written in the pack. |
| How many sounds play at once (the docs say 30, Android and iOS 64, the web has no limit) | Engine performance, for the device checks. The docs should say "at least 30". |
| Android hiding round and logo lights while its Pro light mode is off | An app setting. The checks measure with it on. |
| What reaches a real Launchpad, real sound latency and mixing | Outside these checks (the device checks). |
| Several packs in one zip | Not seen in a real pack yet. Decided in a later edition when one appears. |
| autoPlay text written by the recorder | A file the app makes. Reading it follows the P items. |
