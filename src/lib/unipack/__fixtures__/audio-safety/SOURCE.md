# Shared admission inputs

The third revision of the generated audio admission inputs was copied byte for byte from
[unipad-android at cab0f17c373e6830c750c6f289d059c40907f4eb](https://github.com/kimjisub/unipad-android/tree/cab0f17c373e6830c750c6f289d059c40907f4eb/app/src/sharedTest/assets/audio-safety)
(manifest SHA-256 `b16e4f635d671b3ab2d20222cea55bec72cce91e496d6b2ea87ccf6525c193c4`).
This directory holds the fourth revision, which adds nine `INVALID_FORMAT` inputs: AIFF, AIFF-C and
CAF files, an AIFF named `.mp3`, and an MP3 behind a chain of false frame headers. Expectations of
the earlier inputs are unchanged. The Android and iOS copies follow from this directory.
The manifest SHA-256 is `08e51f9cf9ae53de55080e9bd560d1a3395f76fb544d7e24bd83ab6b6d3e1d76`.
The web tests check the manifest and each binary hash without changing expectations.
These inputs are separate from the historical parser conformance corpus.

`audioSafety.ts` and the structural readers follow the same integer admission and
codec inspection rules as the source implementation. Browser inputs are existing
`ArrayBuffer` or `Uint8Array` views; inspection does not copy the entire input or
allocate PCM. MP4 chunk extents use two bounded numeric typed arrays. Claimed
64-bit sizes and arithmetic outside exact integer bounds are rejected before
conversion or allocation. Frame counts, timeline arithmetic, and admission costs
use exact large integers.

Run `node --import tsx --test src/lib/unipack/audioSafety.test.mjs` or `pnpm test`.
The eight large WAV recipes are generated one at a time in the test process;
production inspection skips their PCM bytes and counts complete physical frames.

The inspector is intentionally not connected to `SoundEngine.load` yet.
It certifies neither successful decoding nor identical audible duration or peak
browser memory. Native decoder delay, trim, malformed codec payloads, physical
device memory limits, output devices, and failure messages need separate playback
verification. In particular, ALAC reads the first channel element's output count,
as in the shared implementation; entropy decoding and the remaining channel
elements are not certified by this structural pass. The existing playback format cases (WAV, MP3, MP3 with a misleading extension,
M4A AAC, and Ogg Vorbis) all have structural readers, along with raw AAC, FLAC,
ALAC, and Opus inputs from the common corpus. Decoder support still depends on
the browser and must be assessed when connecting this module to loading.
