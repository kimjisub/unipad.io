# Archive and native audio checks

These app tests supplement the common corpus; they do not change its grammar,
limitations, fixtures or counters. G2 names the second grammar baseline; F item
identifiers cover archive handling and A identifiers cover audio content. The
table states the expectations used here without requiring a separate document.

| Item | Mapped tests | Same expectation |
| --- | --- | --- |
| F-05 | `parser.test.ts`: single top folder; nested folders and archive sidecars | A unique pack opens from ZIP bytes with the same title, sound mappings and bytes, lights and auto-play. Nested wrappers, adjacent files, dot files and `__MACOSX` do not change it. |
| F-06 | `parser.test.ts`: marked UTF-8; unmarked valid UTF-8 (including bytes also valid as CP949); unmarked CP949 | Names use UTF-8 when marked or valid; only invalid unmarked UTF-8 falls back to CP949. The named sound resolves. |
| A-01 | `sound-formats.spec.ts`: WAV PCM | Native decode of the expected encoded bytes; its pad starts that buffer and produces nonzero post-volume RMS. |
| A-02 | Same file: MP3 | Same native decode, buffer identity and output checks. |
| A-03 | Same file: OGG Vorbis | Same native decode, buffer identity and output checks. |
| A-04 | Same file: M4A AAC | Same native decode, buffer identity and output checks. |
| A-05 | Same file: MP3 named `.wav` | Same checks using a distinct 660 Hz MP3 despite its WAV extension; it must not play the A-02 MP3 buffer. |

The audio tests import all five sounds together, then exercise each mapped pad
in a separate test. All five encoded inputs must have distinct SHA-256 hashes,
including the two MP3 files, so the expected hash identifies one buffer only.
The probe fingerprints the bytes passed to native
`decodeAudioData` and tracks the returned buffer by identity through native
`AudioBufferSourceNode.start`. It observes rather than replaces decoding or
playback. Infinite playback permits sampling after the application gain;
release must return the output to silence. No person listened, and speaker
quality and latency are unverified.

After a production browser-test build (see the repository README), run:

```sh
node scripts/grammar-results.mjs <new-output-directory> <grammar-revision>
```

The command runs the five mapped parser tests and five Chromium audio tests,
then automatically writes `items.json`. It records the checked-out commit,
dirty state and tracked patch hash, G2 and the supplied source-document revision,
test names, host and Node environment, actual browser version, commands, process
exit codes, native measurements, original reports and their SHA-256 hashes.
Pass the revision of the source grammar being checked; it is provenance rather
than a new grammar definition. Use a clean committed checkout for review evidence.

Every test mapped to an item must execute exactly once and pass. Missing,
skipped, retried, interrupted and failed tests, unknown browser environments,
parse errors and nonzero process exits cannot confirm an item. A new output
directory is mandatory to preserve earlier runs. Archive the entire output,
including Playwright traces, before running again. Keep failed runs as evidence;
later results never replace them.

This is a proposed app-result format, separate from the common runner. Only
Chromium executes these sound-format tests in the default configuration.
WebKit and Firefox remain explicitly unexecuted in this report; no compatibility
claim for those engines follows from the Chromium results. F-01 stays with the
common web checks and is not counted here.
