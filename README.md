# UniPad - unipad.io

스마트폰으로 Launchpad를 연주할 수 있는 앱, [UniPad](https://play.google.com/store/apps/details?id=com.kimjisub.launchpad)의 공식 웹사이트입니다.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript, React 19
- **Styling**: Tailwind CSS, Radix UI
- **Animation**: Framer Motion
- **i18n**: next-intl (한국어 / English)

## Getting Started

```bash
pnpm install
pnpm dev
```

## Environment Variables

Store download proxy allowlist can be extended by setting:

```bash
STORE_DOWNLOAD_ALLOWED_HOSTS=example.com,cdn.example.com,*.googleusercontent.com
# note: *.unipad.io is allowed by default
```

Firebase web config should be provided in `.env.local` with `NEXT_PUBLIC_FIREBASE_*` keys.

## Project Structure

```
src/
├── app/[locale]/(with-layout)/
│   ├── page.tsx          # 홈
│   ├── docs/             # UniPack 문서, 이용약관
│   └── notices/          # 공지사항
├── components/           # UI 컴포넌트
├── data/                 # 공지사항 데이터
└── i18n/                 # 다국어 설정 및 번역 파일
```

## Links

- [Google Play](https://play.google.com/store/apps/details?id=com.kimjisub.launchpad)
- [Discord](https://discord.gg/ESDgyNs)
- [Facebook](https://www.facebook.com/playunipad)

## Verification

Use Node.js **24.15.0** and pnpm **9.11.0**, matching GitHub Actions
(`corepack enable pnpm` sets up the pnpm version pinned in `package.json`):

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

`pnpm test` runs every existing `src/**/*.test.ts`, `src/**/*.test.tsx`, and
`src/**/*.test.mjs` test, plus the tooling checks in `scripts/*.test.mjs`.
TypeScript tests are compiled first so LED hang checks can run the real player
in worker threads; `tsx` loads TypeScript imports in the existing `.mjs` tests.
`pnpm test:unipack` remains available for a focused parser/player check.

Every pull request (including drafts) runs the fixed **Web checks** job in
**Web CI**: install, type check, lint, unit tests and build. The browser tests
(`pnpm test:e2e`) do not run in CI; run them locally before pushing. It also runs after a merge to `main`. GitHub records each step's
duration; the job summary records elapsed time from setup through verification.
Required-check configuration is a separate step after this workflow is merged.
Vercel deployment settings are unchanged.

The workflow uses deliberately fake Firebase public configuration with `.invalid`
hosts and `FAKE_CI_KEY_DO_NOT_USE`; it reads no GitHub secrets. To reproduce that
build locally, override any local public Firebase configuration in your shell:

```bash
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_FIREBASE_API_KEY=FAKE_CI_KEY_DO_NOT_USE
export NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=unipad-ci.invalid
export NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://unipad-ci.invalid
export NEXT_PUBLIC_FIREBASE_PROJECT_ID=unipad-ci-placeholder
export NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=unipad-ci.invalid
export NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
export NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:fake-ci-placeholder
export NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-FAKE-CI
pnpm build
```

### Browser playback checks

`pnpm test:e2e` starts the production build on `localhost:3184`, runs the
headless browser tests, then stops its server. Build first with the fake
Firebase configuration above. The suite supplies inert responses for Firebase analytics configuration and
installation, blocks all other non-local HTTP requests and WebSocket
connections, and never needs the store or analytics servers.

The committed `e2e/fixtures/basic.uni` is an original 8×8, one-chain synthetic
pack with a 100 ms PCM tone, two looping sound mappings, two LED scripts and
a short auto-play sequence. `e2e/fixtures/multi-touch.uni` uses the same tone
on all 64 pads, each looping until released and without LED scripts, so every
held finger shows as a lit pad and a started-but-not-stopped sound. Regenerate
both with `node e2e/fixtures/generate.mjs`. There are no downloaded songs or assets.

| Feature | Coverage | What is checked |
| --- | --- | --- |
| Import and local persistence | Automatic | File input, 64 pads, successful real WAV decoding, local pack URL and reload restore, no warnings or automatic sound |
| Basic feature 3: pointer input and multiple contacts | Automatic | Press/release; two simultaneous screen contacts; second-finger chain selection; partial release; delayed chain move; cancellation, late duplicate release and repress |
| Multi-touch play A–I | Automatic (synthetic touch) | Two and five pads together; taps beside a held pad; dragging one and two fingers across pads; lifting one of two fingers; touch cancel, hidden tab and lost window focus; loop held through a chain change (CR tests); a finger resting on the edge |
| Keyboard input | Automatic | Physical Q key mapping, release and repeat suppression |
| keyLed | Automatic | Red/green overlays on a different pad and timed removal |
| Auto-play | Automatic | Start, pause with frozen progress/no new notes, resume, stop and loop-source cleanup |
| Web MIDI | Partial | Fake `requestMIDIAccess`, input/output names, auto-detected X profile, init SysEx, note input/release, exact LED on/off bytes, disconnect/reconnect |
| Audible sound quality | Unavailable in headless CI | Real decode, buffer duration and original Web Audio start/stop calls are observed; Chromium output is muted. Speaker output, latency and perceived quality require listening |
| Physical USB MIDI | Unavailable in headless CI | A fake browser MIDI access object replaces hardware; cable/driver/permission prompts and real hardware LEDs need a physical device |

No test-only application hooks are added.
The browser probes wrap native Web Audio calls without changing their behavior.
Auto-play checks wait across the fixture's next-note deadline to prove that
pause and stop produce no further playback requests.
Each test uses fresh browser storage. Uncaught page errors fail the suite.
Tests have zero retries and `test.only` is forbidden.

On failure, traces and screenshots remain in `test-results/` and the HTML
report is in `playwright-report/`. Open a trace with
`pnpm exec playwright show-trace <trace.zip>`.

### Chain-release regression checks (basic feature 3)

`src/lib/unipack/SoundEngine.test.ts` imports the committed
[`chain-release-v1` packs and expectations](meta/unipack-conformance/chain-release-v1/README.md)
and checks all six groups against the real `SoundEngine`, with a fake audio device
and a logical clock. It checks the exact started buffer, infinite/finite duration,
release-stop requests, natural ends and remaining playback after every step. Held
input IDs in this unit adapter model the existing pointer lifetime filtering;
they are not screen-feedback evidence. A late `onended` check protects the newer
source registered at the same pad. Run it with `pnpm test` or `pnpm test:unipack`.

`e2e/chain-release.spec.ts` is included in `pnpm test:e2e`. It uses the same
`packs/manual.uni` and `packs/delayed.uni`, through normal file import, then
Chromium's native touch dispatch for two simultaneous contacts, another contact
on the chain button, and partial release (CR-001/002/003). CR-004 sends synthetic
pointer cancel, up and lost-capture events through the actual `PadGrid` listeners
to cancel only one contact and inject a late duplicate after repress. The unit
suite additionally covers the unchanged single/three-play sound sequence and
no-chain-change baseline (CR-005/006). No app-only test hooks are used.

The CR-001 browser test attaches screenshots and real Web Audio start/stop call
records before and after partial release. These are program input and playback
request evidence. Audio is muted; no physical fingers, MIDI hardware, speaker
quality, audible stop or latency is certified. The exact 99/100 ms delayed move
and finite-play deadlines are checked only by the logical-clock unit suite.

The common corpus bytes/expectations and their SHA-256 manifest stay unchanged.
These new results remain separate from the 124 historical parser cases, KS-003,
and the 60 preserved result rows. Same-coordinate simultaneous ownership remains
outside this change; existing input filtering and visual release rules are kept.

### Multi-touch play checks (A–I)

`e2e/multi-touch.spec.ts` imports `multi-touch.uni` and sends several touch
contacts at once through Chromium's native touch dispatch, so the browser's own
pointer events reach the `PadGrid` listeners. Each item is one test named after
its letter (A–G, I); item H is the CR tests above. Both files run on a landscape
phone (844×390) and a landscape tablet (1180×820) screen; `e2e/touch.ts` holds
the shared touch helpers. Headless Chromium never hides the tab or blurs the
window by itself, so test G sends the `visibilitychange` and `blur` events a
browser sends when the notification shade or another app takes over. These are
synthetic-input results; real fingers on a physical device are not certified.
