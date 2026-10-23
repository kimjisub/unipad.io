# UniPack grammar, edition G6

G6 specifies sound path normalization and deterministic matching; ASCII numeric and colour fields;
missing size keys; zero wormholes and negative sound repeats; release ownership across chains and
inputs; manual and autoPlay wormhole timing; and autoPlay's authority over its scripted chain.
Subtracting one from -2147483648 must store -2147483649 on every platform: there is no Android
representation exception. G6 also specifies archive-name decoding even with a wrong UTF-8 flag,
Info-ZIP Unicode paths, refusal of multiple packs in one archive, and Ogg Opus playback (A-07).
The current availability of each rule is measured by tests, not implied by this specification.
The public docs distinguish the target grammar from support still pending in an app.

G6 revision, 2026-10-23: a later manual chain selection cancels a press's pending wormhole
(RS-09, RUN-G606). The later explicit player choice takes precedence over the earlier press;
this replaces the initial G6 rule rather than inferring a rule from how many apps implement it.
Closing the play screen also cancels pending manual wormholes. AutoPlay and LED chain commands
retain their own rules. Earlier observations must retain their original corpus hash.

G5 also clarifies S-07: validate a wormhole before other pad fields and missing sound files (KS-024 and KS-025).

G5 clarifies E-05/E-14: a numeric first coordinate of 0 addresses circular lights; a zero second coordinate alone remains an out-of-grid pad event. Numeric coordinates are kept without warnings, including invalid circular indices, which are skipped when lit.

G4 clarifies L-07: compare NFC-normalized, lower-cased file names by UTF-16 code units,
without changing the paths used to open them. Decomposed accents and Hangul must queue as their
composed spellings do. Names equal under this comparison retain their input listing order;
archives containing canonically equivalent duplicate paths are outside this rule.
G4 also clarifies S-07's existing behavior in all three apps: retain a sound with an out-of-range
wormhole destination, clamp it to the nearest chain and record a range warning (KS-023).
G3 corrects E-09: a negative delay shortens later waits but never takes back time already waited.
G2 added T-09: numeric fields are signed decimal 32-bit integers; larger numbers are format errors.

What a UniPack is, item by item: how the Android, iOS and web apps read a pack, and what they play and
light, in which order and when. Every conformance case names the items it checks (`items` in
`cases.mjs`), and `report.mjs` reports each item as confirmed or not per platform. The denominator of
every number it prints is the **105 items** below; what is left out is listed at the end.

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

The historical rows above describe the starting point, not current defects. CP949 file names and
text are now read by all three apps; all three parse a wormhole under `touch`; Android releases the
voice its press started and advances past undecodable queue slots; iOS now decodes OGG Vorbis.
See the G6 case list for differences still awaiting an app correction.

## G6 input and device conventions

`squareButton=false` changes the button shape only. Pack lights keep running; press feedback follows
the normal default (off with keyLED, on without it). Computer keyboard pad, chain and option shortcuts
remain a web input method, not a requirement for the Android or iOS apps. They follow the same pad rules.
A website is stored unchanged; when opened, a missing scheme means `https://`, and only HTTP(S) links
are opened. A hex-only light sends Launchpad velocity 4 (E-03), rather than converting RGB to the
nearest palette entry. Leaving play or disconnecting does not restore the Launchpad's previous mode.
These screen and hardware conventions need app or device tests; a parser result does not prove them.

## Items

### F. File and folder names and paths (7)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| F-01 | At the pack root, `info`, `keySound`, `autoPlay` (files) and `sounds`, `keyLED` (folders) are found whatever their letter case. Another name (`keySounds`, `info.txt`) is not that file. | parse | apps agree | Not in the docs. Android `UniPackFolder.kt` 138-155, iOS `UniPackFolder.swift` 88-105, web `parser.ts` getFile/getDir |
| F-02 | A pack without `info` or `keySound` does not open. | parse | doc | info.mdx properties table, key-sound.mdx first line |
| F-03 | A file with another name, such as `info.json`, is not read as `info`. | parse | doc | info.mdx |
| F-04 | The `keyLED` folder and the `autoPlay` file may be absent (no lights, no autoPlay). Without a `sounds` folder every keySound line warns that its sound is missing. | parse | doc | key-sound.mdx validation, info.mdx |
| F-05 | Importing a zip opens the unique folder that holds `info`: top wrappers, metadata and unrelated sidecars are ignored. If more than one pack is present, refuse it with an explicit multiple-packs reason. | parse | G6 decision | Archive import tests; a root-files corpus case cannot observe archive layout. |
| F-06 | A valid Info-ZIP Unicode Path extra field (0x7075, with matching name CRC) supplies the file name. Otherwise read valid UTF-8 as UTF-8 and invalid UTF-8 as CP949, regardless of the UTF-8 flag. Other legacy encodings are not guessed. | parse | G6 decision | Android PackArchive/LegacyText, iOS UniPackImporter.decodeEntryName, web parser.decodeFileName and JSZip; current text fallback is CP949, not general Windows encoding detection. |
| F-07 | Only the files directly inside the `keyLED` folder are LED files (files in sub folders are not read). | parse | apps agree | web `parser.ts` parseKeyLed comment, the Android and iOS folder listings |

### T. Text files: encoding, lines, columns (9)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| T-01 | A text file is read as UTF-8, and a UTF-8 byte order mark at its start is dropped. | parse | apps agree | key-sound.mdx "The file is UTF-8". The byte order mark of info, keyLED and autoPlay is T-03. |
| T-02 | A UTF-16 keySound (little or big endian) that starts with a byte order mark is read. | parse | doc | key-sound.mdx first paragraph |
| T-03 | The encoding rules of T-01 and T-02 hold for info, keyLED and autoPlay as well. | parse | G1 decision | The docs speak of keySound only. Android `UniPackFolder.kt` 29-53 and iOS `UniPackFolder.swift` 603-632 read every text file with the same function. Decided: there is no reason for the files of one pack to follow different encoding rules. |
| T-04 | A text file that is neither UTF-8 nor UTF-16 with a byte order mark is read as CP949 (which includes EUC-KR). Other legacy encodings are not detected and may produce unreadable text. | parse | G1 decision | All three now use UTF-8/BOM-marked UTF-16, then CP949 (Android LegacyText, iOS UniPackFolder, web parser). |
| T-05 | A line ends with LF, CRLF or a lone CR, and the last line needs no line end. | parse | apps agree | cases.mjs WHITESPACE (unipad-android 22a45925) |
| T-06 | Columns are split on runs of spaces and tabs, and spaces around a line are ignored, so a file name cannot contain a space. | parse | apps agree | cases.mjs WHITESPACE |
| T-07 | Blank lines are ignored. | parse | doc | key-sound.mdx validation |
| T-08 | There is no comment syntax. A line starting with `#` is handled by the file's usual rules (ignored when it has too few columns, a format warning when its command is unknown). | parse | apps agree | cases.mjs AGREED |

| T-09 | Numeric fields in keySound lines, keyLED file names and events, and autoPlay lines are signed decimal 32-bit integers (-2147483648..2147483647), using only ASCII digits 0-9 and an optional ASCII sign. Out-of-range numbers or non-ASCII digits are format errors: skip only the line (or the file for a keyLED name). In-range values follow each field's range rules; delays and the velocity after hex are kept as written. Every zero-based field stores the written value minus one exactly, including -2147483649 for -2147483648. | parse | G6 decision | No saturation, wraparound, tolerance or platform exception. KS-B08 and KL-BE10 remain failures on an app storing -2147483648. |

### I. info (11)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| I-01 | One `key=value` per line, split at the first `=`, spaces around both sides dropped. Unknown keys are ignored. | parse | doc | info.mdx first paragraph |
| I-02 | A line without `=` is ignored, without a warning. | parse | doc | info.mdx first paragraph |
| I-03 | A missing or empty `title` or `producerName` only warns; the pack opens. | parse | doc | info.mdx validation |
| I-04 | A missing `buttonX` or `buttonY`, or a value that is not an ASCII integer, refuses the pack. An explicitly written 0 follows I-05. | parse | G6 decision | info.mdx required keys and validation; missing keys do not mean an explicit zero. |
| I-05 | A `buttonX` or `buttonY` of 0 warns, and every pad in that direction is out of range. | parse | doc | info.mdx validation |
| I-06 | A negative `buttonX` or `buttonY`, or one above 64, refuses the pack. | parse | apps agree | info.mdx says "1 or more" only; all three apps accept 0..64 (cases.mjs AGREED). The docs should state the upper bound. |
| I-07 | `chain` is 1 to 24. Outside that, or not a number, refuses the pack. | parse | doc | info.mdx properties table and validation |
| I-08 | Without `squareButton` the buttons are square (true). False changes shape only, not whether the pack has lights. | parse | G6 decision | info.mdx; lights and press feedback require play-screen tests, beyond this parse item. |
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
| S-05 | loop: left out, 1 or any negative number plays once; 0 endlessly; N (2 or more) N times in all. Stored minus one (-1 endless, 0 once); a negative written value stays below -1 and is not stopped on release. | parse | G6 decision | key-sound.mdx Loop Values; preserves existing playback for negative repeats. |
| S-06 | wormhole: the sixth column, the chain a press of that sound moves to. Omitted or 0 means no chain change and no warning. | parse | G6 decision | key-sound.mdx; preserves the existing zero sentinel in all three apps. |
| S-07 | Except for the no-wormhole value 0, a destination outside the pack is clamped to its nearest chain (first or last), with a range warning. Check it before chain, x, y and sound existence: a line skipped for S-02 or S-10 still records this warning first. | output | G6 decision | All three parser and chain observer paths; a written -1 still warns and selects chain 1. |
| S-08 | Columns after the sixth are ignored. | parse | apps agree | The three apps' code (not in the docs) |
| S-09 | Several sounds on one pad form a queue in the order of the file. | parse | doc | key-sound.mdx Circular Queue |
| S-10 | A line naming a sound file that is not under `sounds/` is skipped with a missing-sound warning. | parse | doc | key-sound.mdx validation |
| S-11 | A sound name is relative to `sounds/`. Replace backslashes with slashes, remove leading slashes and `.` components, and collapse repeated slashes before looking it up. Never escape `sounds/` through `..`. Subfolders are supported. | parse | G6 decision | sounds.mdx; path normalization precedes the matching order in S-12. |
| S-12 | Find a sound by exact normalized path first, then NFC-equivalent path, then NFC and lower-case path. At each fallback, choose the first full stored relative path in UTF-16 code-unit order. Compare whole paths, not one folder at a time. A folder is not a sound; report the stored file name. Canonically equivalent duplicate paths are outside this rule. | parse | G6 decision | sounds.mdx; composed and decomposed names refer to the same intended sound; deterministic full-path matching preserves Android ordering. |

### A. Sound file formats (7)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| A-01 | A WAV (PCM) sound plays. | output | doc | sounds.mdx supported formats |
| A-02 | An MP3 sound plays. | output | doc | sounds.mdx supported formats |
| A-03 | An OGG Vorbis sound plays. | output | doc | sounds.mdx supported formats ("recommended"). iOS decodes OGG Vorbis, and `SoundEngineDecodingTests/anOggVorbisSoundPlays()` measures the sound played by the real engine. |
| A-04 | An M4A (AAC) sound plays. | output | G1 decision | Not in the docs. Real packs use it. Decided: a format real packs use belongs in the grammar and the docs. |
| A-05 | A sound whose extension does not match its content (named `.wav`, MP3 inside) is decoded by its content and plays. | output | G1 decision | Not in the docs. Packs in the official store do this. Decided: the sound the author meant is clear. |
| A-06 | A sound that cannot be decoded is silent in its slot only: its queue advances and its wormhole still applies. Refuse the pack only when no sound can be decoded. | output | G1 decision | All three now advance the queue independently of decoding; RUN-S-007 and app decoding tests. |
| A-07 | An OGG Opus sound plays. | output | G6 decision | Preserve playback already available on Android and web; iOS decoding support is pending. Requires a real decoded-output test, not the recorder. |

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
| E-02 | A colour is one to six ASCII hex digits (0-9, A-F, a-f), without `#`. Longer values, non-ASCII hex lookalikes or other characters skip the line with a format warning. | parse | G6 decision | key-led.mdx; a bare `a` is hex 00000A, with Launchpad velocity 4. |
| E-03 | A hex colour alone carries velocity 4. A velocity after a hex colour (0..127) is what goes to the Launchpad; a value above 127 is kept as written. | parse | apps agree | cases.mjs VEL4, KL-020 (the docs give no default) |
| E-04 | `auto`/`a` followed by a velocity 0..127 selects the palette colour (C-01). An out-of-range or malformed velocity is a format warning. With no velocity, `auto` is a format warning but `a` is the hex colour 00000A (E-02), for pad, round and logo lights. | parse | G6 decision | key-led.mdx; preserves the current bare-a light. |
| E-05 | `*` or `mc` followed by 1..32 addresses round lights. Numeric `on 0 n` / `off 0 n` retain (-1,n-1) and follow E-14. For token addresses, check column count first (E-11); only then silently skip an out-of-range index. A non-integer index is a format warning. | parse | G6 decision | key-led.mdx; malformed column count takes precedence over out-of-range round index. |
| E-06 | `l` is the logo light (the 33rd round button position). `o l colour`, `o l auto v`, `o l _ colour` and `f l` are read; a malformed logo line is a format warning. | parse | G1 decision | key-led.mdx says "not supported, ignored"; all three apps light it (cases.mjs LOGO). Decided: keep the apps, correct the docs. |
| E-07 | `off x y` with too few coordinates, or letters, is a format warning. | parse | apps agree | cases.mjs KL-M08 to M10 |
| E-08 | `delay ms` that is not an integer, or has no value, is a format warning. | parse | apps agree | cases.mjs KL-M20 to M22 |
| E-09 | A delay moves the next event to the sum of all delays before it. `delay 0` does not wait. A negative delay is added as written too, but an event never comes before the one above it: time already waited is not taken back, only the waits after it get shorter. Example: `d 100`, `d -60`, `f 1 1`, `d 100`, `o 2 1` turns the light off at 100 ms and on at 140 ms. | output | apps agree | key-led.mdx "Waits the specified milliseconds before the next event" (negative values are not mentioned). Android `LedRunner.kt`, iOS `LedRunner.swift` and web `LedRunner.ts` take the next event only once `delay <= currTime`. |
| E-10 | `chain N` that is not an integer, or has no value, is a format warning. A chain number the pack does not have is kept as written. | parse | apps agree | cases.mjs KL-M23, M24, KL-023 |
| E-11 | The columns of an `on` line: `on x y colour`, `on x y colour v` or `on x y auto v` only. Too few, too many, or a velocity in letters is a format warning. | parse | doc | key-led.mdx validation ("4 tokens / 5 tokens") |
| E-12 | A line with an unknown command is skipped with a format warning. | parse | doc | key-led.mdx validation ("skipped") |
| E-13 | Letters mixed into a coordinate (`1b`) are a format warning. | parse | apps agree | cases.mjs KL-M04 to M06 |
| E-14 | Numeric `on` or `off` coordinates are kept after subtracting one from each, without a warning. First coordinate 0 becomes the circular address -1 (E-05); the runner accepts circular indices 0..35, including logo index 32. Other coordinates outside the pad grid (a zero second coordinate, negatives, or beyond buttonX/buttonY) and circular indices outside 0..35 are skipped when lit (RL-12). | parse | G1 decision | cases.mjs KL-024 (a maintainers' decision). G5: Android UniPackFolder.zeroBased/LedRunner and iOS UniPackFolder/LedRunner agree. `on 8 0` stays a pad event at (7,-1); it is not a round-light alias. |
| E-15 | An empty LED file still counts as one animation of its pad. | parse | apps agree | cases.mjs KL-021 |

### P. autoPlay commands (8)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| P-01 | The commands `on`/`o`, `off`/`f`, `touch`/`t`, `chain`/`c` and `delay`/`d`. | parse | doc | auto-play.mdx Commands |
| P-02 | `on` and `touch` advance the pad's sound queue number by one, and `chain` sets every pad's number back to 0. | parse | doc | auto-play.mdx Behavior |
| P-03 | When the sound an `on` plays has a wormhole, the chain becomes that chain from there on and the numbers go back to 0. | parse | doc | auto-play.mdx Behavior |
| P-04 | `touch` is `on` + `off`; a touched sound with a wormhole switches the parsed chain as in P-03. | parse | doc | AP-006; Android UniPackFolder, iOS UniPackFolder and web parser now all emit on, off, chain. |
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
| RS-05 | Releasing an input stops only an endless sound owned by that press; finite sounds finish. Several player inputs holding one pad keep its current endless sound until the last release. Manual and autoPlay presses have separate ownership: one release never cancels the other source's current sound. | output | G6 decision | key-sound.mdx; screen input tests must exercise distinct identities, not a recorder that substitutes one player input. |
| RS-06 | When the chain changes while a pad is held, its release still stops the endless sound its press started. | output | apps agree | Not in the docs. |
| RS-07 | Pressing the same pad in the same chain again replaces its previous sound with the next one. Sounds from different pads or different chains may overlap. | output | G6 decision | key-sound.mdx; the voice key is (chain,x,y), preserving chain transition sounds. |
| RS-08 | Pressing a sound with a wormhole switches to that chain, and the next press plays a sound of the new chain. | output | doc | key-sound.mdx syntax and example |
| RS-09 | A manually pressed sound's wormhole switches the chain 100 ms after its press unless the player directly selects a chain on screen, by keyboard or on a Launchpad during that wait. That later choice cancels the pending switch and stays selected. Closing the play screen also cancels pending manual wormholes. AutoPlay applies its parsed wormhole immediately instead, without a second delayed switch (RA-04); LED chain commands keep their own rules. | output | G6 decision | Revised 2026-10-23; key-sound.mdx and auto-play.mdx; a later explicit player selection takes precedence over an earlier press. |
| RS-10 | Every change of chain (by the user, a wormhole, a light or autoPlay, even to the same chain) sets the sound and light queues of every pad of that chain back to their first entry. | output | G1 decision | auto-play.mdx speaks of the autoPlay `chain` only. The three play screens do it on every change (Android `PlayActivityViewModel.kt` 454-462, iOS `PlayViewModel.swift` 476-487, web `useUniPadEngine.ts` 358-381). Decided: the three apps' behaviour becomes the grammar. |

### RL. Running: lights (12)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| RL-01 | The on, delay and off of an LED file come out at the times written. | output | doc | key-led.mdx Full Example |
| RL-02 | An animation with loop N plays N times and stays dark afterwards. | output | doc | key-led.mdx file naming |
| RL-03 | Releasing a press stops its endless (loop 0) animation and turns its lights off, even after the chain changes. Several player inputs on one pad hold it until the last release. A manual release cannot end autoPlay's animation, or conversely. | output | G6 decision | key-led.mdx; ownership follows the press, not the current chain or every animation at the same coordinate. |
| RL-04 | An animation played once or N times plays to its end after the pad is released. | output | apps agree | The three apps agree (Android `LedRunner.kt` 285-296, iOS 297-307, web 261-268) |
| RL-05 | An LED `chain` event switches immediately; an out-of-pack destination clamps to the nearest chain. | output | doc | key-led.mdx; run cases check destinations below and above the pack range. |
| RL-06 | The logo light lights and goes off on time. | output | G1 decision | E-06 |
| RL-07 | A round button light lights and goes off. | output | doc | key-led.mdx Special Coordinates |
| RL-08 | Leaving the play screen turns every lit light off, and no light follows. | output | apps agree | the basis of cases.mjs RUN-L-006 |
| RL-09 | Pressing a pad again during its animation turns that animation's lights off and starts the next animation from its beginning. | output | apps agree | cases.mjs RUN-L-008 (AGREED) |
| RL-10 | Several animations on one pad play in turn, one per press. | output | doc | key-led.mdx "circular queue" |
| RL-11 | When two animations light the same light, the later one owns it, and the other animation's `off` does not turn it off. | output | apps agree | Not in the docs. The three apps agree (Android `LedRunner.kt` 134-157, iOS 169 and 185, web 140, 151 and 177) |
| RL-12 | A light event outside the pad grid is skipped when lit, except a numeric first coordinate of 0, which selects the circular table (E-05/E-14). Circular indices outside 0..35 are skipped too. The other events of the same file come out as written. | output | G1 decision | E-14 |

### RA. Running: autoPlay (4)

| Item | Rule | Kind | Basis | Where |
|---|---|---|---|---|
| RA-01 | autoPlay presses and releases from top to bottom, waiting for each `delay`. Commands without a delay between them come out at the same time. | output | doc | auto-play.mdx Behavior and Notes |
| RA-02 | autoPlay's presses and releases sound and light as if pressed by hand. | output | doc | auto-play.mdx ("play sound + start LED") |
| RA-03 | Leaving the play screen stops autoPlay, and no press follows. | output | apps agree | the basis of cases.mjs RUN-A-002 |
| RA-04 | AutoPlay's parsed chain and wormholes switch at their scripted time. Do not also schedule the sound's 100 ms manual wormhole, and cancel pending autoPlay changes when stopped. Before each scripted press or release restore the parsed chain; an LED or user chain change lasts only until that event. Queue numbers come from parsing. | output | G6 decision | auto-play.mdx; chain and sound event ordering must be observed at each checkpoint. |

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
| autoPlay text written by the recorder | A file the app makes. Reading it follows the P items. |
