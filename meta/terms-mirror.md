# Second copy of the privacy policy and usage notice

Google Play and the App Store link to `https://unipad.io/docs/terms/privacy`. Google requires
that address to be live and publicly reachable; when the main site's host stops serving, both
store listings point at a page that does not open. A static copy of the documents is therefore
published on GitHub Pages as well.

## Addresses

| Document | Main site | Copy |
|---|---|---|
| Privacy policy (English) | https://unipad.io/docs/terms/privacy | https://kimjisub.github.io/unipad.io/docs/terms/privacy/ |
| Privacy policy (Korean page) | same address, Korean browsers | https://kimjisub.github.io/unipad.io/ko/docs/terms/privacy/ |
| App usage notice (English) | https://unipad.io/docs/terms/usage | https://kimjisub.github.io/unipad.io/docs/terms/usage/ |
| App usage notice (Korean) | same address, Korean browsers | https://kimjisub.github.io/unipad.io/ko/docs/terms/usage/ |

The Korean privacy page shows the English policy under the Korean title, exactly as the site
does, because there is no Korean policy text yet.

## How the copy stays the same as the site

- `scripts/terms-mirror.mts` renders the same files the site renders: `content/docs/<locale>/terms/*.mdx`
  for the text and `src/i18n/messages/<locale>.json` for the titles and the effective date.
  There is no second source to edit.
- `.github/workflows/terms-mirror.yml` builds and publishes it on every push to `prod`, the branch
  the site is built from, so the copy changes when the site does and never runs ahead of it.
- `e2e/terms-mirror.spec.ts` compares the title, date line and body text of the copy with the
  site's pages; `scripts/terms-mirror.test.mjs` checks the pages, links and language versions.
- The copy has no scripts and no analytics, and each page names the main address as canonical.

Why GitHub Pages: it is free for a public repository, needs no new account, sign-in, payment or
domain change, and does not depend on the main site's host. Firebase Hosting would need a deploy
credential stored in CI and its own deploy step.

Pages has to be turned on once, with the repository's existing admin access (no sign-in):

```sh
gh api -X POST repos/kimjisub/unipad.io/pages -f build_type=workflow
gh workflow run terms-mirror.yml --repo kimjisub/unipad.io --ref prod
```

If the publish job then reports that `prod` may not deploy to `github-pages`, allow it in that
environment's deployment branches (Settings → Environments → github-pages). Turning Pages off
again: `gh api -X DELETE repos/kimjisub/unipad.io/pages`.

## Switching the store address when the main site is down

Before switching, open the copy's privacy address in a private browser window and confirm it
loads. The account holder of each developer account makes the change.

- **Google Play:** Play Console → UniPad → Policy → App content → Privacy policy → Manage, enter
  `https://kimjisub.github.io/unipad.io/docs/terms/privacy/`, Save. Play has one address for all
  languages, so use the English page.
- **App Store:** App Store Connect → UniPad → App Information → Privacy Policy URL, for each
  localization (Korean: the `/ko/` address, the others: the English one), Save. Apple allows this
  only while the app's status permits editing app information; if the field is locked, it waits
  for the next version.

To undo, put `https://unipad.io/docs/terms/privacy` back in the same fields once the main site
answers again. Neither change needs a new app build; nothing inside the apps changes.
