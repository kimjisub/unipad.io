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
```

`pnpm test` runs every existing `src/**/*.test.ts`, `src/**/*.test.tsx`, and
`src/**/*.test.mjs` test, plus the tooling checks in `scripts/*.test.mjs`.
TypeScript tests are compiled first so LED hang checks can run the real player
in worker threads; `tsx` loads TypeScript imports in the existing `.mjs` tests.
`pnpm test:unipack` remains available for a focused parser/player check.

Every pull request (including drafts) runs the fixed **Web checks** job in
**Web CI**. It also runs after a merge to `main`. GitHub records each step's
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
