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

Use Node.js **24.15.0** and pnpm **9.11.0**, matching GitHub Actions:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install --with-deps chromium webkit firefox
pnpm test:e2e
```

`pnpm test` runs every existing `src/**/*.test.ts`, `src/**/*.test.tsx`, and
`src/**/*.test.mjs` test, plus the tooling checks in `scripts/*.test.mjs`.
TypeScript tests are compiled first so LED hang checks can run the real player
in worker threads; `tsx` loads TypeScript imports in the existing `.mjs` tests.
`pnpm test:unipack` remains available for a focused parser/player check.

Every pull request (including drafts) runs the fixed **Web checks** job in
**Web CI**: install, type check, lint, unit tests and build. A separate
**Browser playback tests** job builds with the browser-test configuration below and
runs `e2e/play.spec.ts` and `e2e/offline-play.spec.ts` in Chromium; on failure it
uploads the Playwright report and traces as an artifact. A separate **Windows playback**
workflow runs only `e2e/play.spec.ts` on Windows 2025 with Chromium and the installed
Chrome and Edge channels; failures fail their jobs, with no retries. None of these
browser jobs is a required check yet. The other browser tests do not run in CI; run
`pnpm test:e2e` locally before pushing. Every job also runs after a merge to `main`.
GitHub records each step's duration; each job summary records elapsed time from setup
through verification. Required-check configuration is a separate step after these
workflows are merged.
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

`pnpm test:e2e` starts the production build on a free `localhost` port between
20000 and 32767 (below the operating systems' ephemeral port ranges; a taken port
is retried with another, up to 10 times), reads the address from that server's own
output, runs the headless browser tests against it, then stops only that server.
Before reporting ready, the launcher binds the other localhost loopback address
and forwards its TCP connections to Next, so both IPv4 and IPv6 reach this run's
server. A conflict on either address retries the port (or fails a pinned port);
an unavailable address family is logged and skipped. The relay and its connections
close along with the server.
Several runs can share one machine; set `E2E_PORT=<port>` to pin the port instead
(the run fails at start if the port is taken). Use the fake Firebase configuration
above, with a syntactically valid, unused database hostname for these tests:

```bash
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://unipad-browser-test.firebaseio.com pnpm build
pnpm test:e2e
```

The database hostname lets the SDK initialize a database client; all connections
are intercepted locally. Each offline test first requires a working database
subscription, then imports a pack through the normal file input before blocking
external requests and reopening the saved list. A build with the CI-only
`https://unipad-ci.invalid` database URL fails these checks with a message
pointing to the browser-build command above; it cannot silently pass as offline.
The offline tests abort every external HTTP request and
WebSocket, open a saved pack within five seconds, and check real audio start/stop
calls. Separate tests supply realtime database messages to check the cached
store badge is refreshed, and that the first delayed count does not announce
old items after a store visit while a later increase still does.
The suite supplies inert responses for Firebase analytics configuration and
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
| Web MIDI | Native API capability check; explicitly skipped as not applicable when absent | Fake `requestMIDIAccess`, input/output names, auto-detected X profile, init SysEx, note input/release, exact LED on/off bytes, disconnect/reconnect |
| Audio output signal | Automatic on all three engines and Windows channels | An analyser after the application output gain measures nonzero RMS on a held pad, silence after release, and silence at zero volume despite a running source |
| Audible sound quality | Unverified | No person listened. Speaker output, latency and perceived quality are not established by the signal measurement |
| Physical USB MIDI | Unavailable in headless CI | A fake browser MIDI access object replaces hardware; cable/driver/permission prompts and real hardware LEDs need a physical device |

`e2e/store-connection.spec.ts` keeps the real Firebase SDK and checks stalled
responses, refused HTTP/WebSocket connections, cached lists and manual retries.
It also checks a pending Firebase initialization, shared-link install confirmation
on the pack list, successful install/playback and a stalled download with retry.
Store lookup returns cached items or a connection message within five seconds;
downloads stop after five seconds without incoming data, so longer transfers can
continue while chunks arrive. Unit tests cover stalled headers, bodies and direct
fallbacks, progress across that idle limit, and cancellation.
Store loading, connection errors and completed results replace one another immediately;
these network states do not wait for an exit animation. A regression test holds
real database replies until the loading view is shown, pauses only its native
exit animation, then requires the completed list within the same 6.5-second
limit. The clocks remain real. Transition attachments record both clocks and
native animation creation, finish and cancellation for the reconnect tests.
The cached and uncached store-list reconnect tests wait for an actual stalled SDK
request, then wait on the real clock for the five-second request deadline and
require fresh server data. Reload readiness and the completed list are checked
concurrently within one 6.5-second limit. The shared-link retry test also uses
the real clock.

No test-only application hooks are added.
The browser probes observe native decoding and start/stop calls, and insert a
transparent analyser between the application output gain and the native destination.
No audio mock or forced context resume is used. Device output stays silent where the
engine allows it without touching the graph: Chromium keeps its default headless
`--mute-audio`, and Firefox sets `media.volume_scale` to 0, which scales only the
device stream. Playwright mutes Chromium only in headless runs, so `--headed` and
`--ui` runs play pad sound. WebKit has no such switch, so its pad sound can reach the
speakers. The signal test
attaches its measured RMS with `humanListening: false`. Web MIDI is mocked only
when the native API exists; unsupported engines keep their real unsupported path.
Auto-play checks wait across the fixture's next-note deadline to prove that
pause and stop produce no further playback requests.
Each test uses fresh browser storage. Uncaught page errors fail the suite.
Tests have zero retries and `test.only` is forbidden.

`play.spec.ts` covers import/reload, pointer and keyboard input, keyLed, chain
changes while holding a loop, auto-play, quitting, MIDI capability and audio RMS.
It runs on Chromium, WebKit and Firefox locally. Chromium runs the full suite;
WebKit also runs the existing portable page/layout tests. Firefox is scoped to
playback; exploratory page failures are investigated separately. Firefox allows
90 seconds overall for page setup and playback. Pack-open assertions use the
shared 15-second state limit from `expectPads`, including import and reload.
A missing saved pack fails the pad-count assertion with the observed value,
rather than waiting for a successful screen until the entire test times out.
Restoration can briefly show the pack list while a local pack URL is still pending;
a held native storage response covers that transition. A deliberately delayed native
decode checks that opening still works beyond the former five-second assertion.
Native multi-touch CDP tests remain Chromium-only.
On Windows, reproduce the smoke jobs with:

```bash
pnpm exec playwright test e2e/play.spec.ts --project=chromium --project=chrome --project=msedge
node scripts/playback-summary.mjs
```

The list/HTML reports and `test-results/results.json` retain skip counts and
reasons. The summary separates intentional skips from interrupted and unrun tests,
and fails on incomplete execution. Windows uploads them, signal attachments and failure traces for 14 days,
and writes counts and measurement limits to the job summary.

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
request evidence. Audio output is checked separately by the RMS test; no physical
fingers, MIDI hardware, speaker quality, audible stop or latency is certified.
The exact 99/100 ms delayed move and finite-play deadlines are checked only by the logical-clock unit suite.

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

### Held resize and input boundary checks

`e2e/input-boundaries.spec.ts` runs in the default local `pnpm test:e2e`
suite. `input-fixture.ts` builds a two-chain looping pack automatically from
`multi-touch.uni`'s original PCM tone. Every pad and chain has a different
buffer duration, so an unexpected playback request identifies the wrong mapping.
The unchanged press overlay distinguishes held and released pads.

The resize tests first prove a pad is sounding and lit at the laptop size, keep
the input down from there through phone portrait (390×844), phone landscape
(844×390), tablet (1180×820), back to laptop (1280×800) and on to phone
landscape, then release in that different layout and play another pad.
The existing grid remains mounted beneath the portrait overlay. These are
viewport changes, not a physical device rotation test. Mouse dragging and chain
clicks run in both Chromium and WebKit. Chromium additionally runs native CDP
touch resizing and both mouse/touch hold orders: both inputs must succeed and
remain active together, and releasing the second must preserve the first.

WebKit's public Playwright touchscreen API only supports `tap()`; creating a
CDP session fails because CDP is Chromium-only. Held touch resizing and mixed
input in WebKit are explicitly skipped as unverified, not counted as passes.
Screenshots and playback request records are attached during held and released
states. No engine methods or app test hooks are used to inject these inputs.
Physical fingers, physical rotation, speaker quality and latency remain outside
these automated checks.

The margin tests keep a browser-native background touch down while another
finger selects chain 2 exactly once, then verify the new chain's pad mapping
and complete cleanup. The background finger must produce one trusted touch
`pointerdown` outside every pad and control, and no `pointerup`,
`pointercancel` or `lostpointercapture` for that finger until the last
`touchEnd`. They run at the existing phone and tablet sizes in Chromium;
WebKit's two-contact margin case remains unverified for the same API
limitation. Pointer records observe browser events, including their trusted
flag and input type; they do not call input handlers.

`squareButton=true` and `false` packs, in 4-column/3-row and 8×8 shapes, are
covered by `rectangular-pad-layout.spec.ts`: every cell fits the screen and
the bottom and right edges play the mapped pad at four screen sizes.

Focused command: `pnpm test:e2e e2e/input-boundaries.spec.ts` after the build.
The default suite includes all these cases; the GitHub workflow is unchanged.
