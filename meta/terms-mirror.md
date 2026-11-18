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
| List of both | https://unipad.io/docs/terms | https://kimjisub.github.io/unipad.io/docs/terms/ (Korean: `/ko/docs/terms/`) |

Every copy address is the site address with `https://unipad.io` replaced by
`https://kimjisub.github.io/unipad.io` (plus `/ko` for the Korean pages).

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

## First-time setup (once, before the first publish)

Done once by someone with admin access to the repository, with the existing `gh` login (no new
sign-in, payment or domain change). Publishing goes through the `github-pages` environment, and
GitHub lets only the default branch (`main`) deploy to it unless told otherwise, while this copy
publishes from `prod`. So `prod` is allowed in the same step that turns Pages on:

```sh
# 1. Turn Pages on, published by the workflow.
gh api -X POST repos/kimjisub/unipad.io/pages -f build_type=workflow
# 2. Let only listed branches deploy to github-pages, and list prod.
gh api -X PUT repos/kimjisub/unipad.io/environments/github-pages \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/kimjisub/unipad.io/environments/github-pages/deployment-branch-policies \
  -f name=prod -f type=branch
# 3. Check: prod is in the list (main may be listed too; the workflow only runs on prod).
gh api repos/kimjisub/unipad.io/environments/github-pages/deployment-branch-policies --jq '.branch_policies[].name'
# 4. Publish the current prod and confirm the four addresses above open.
gh workflow run terms-mirror.yml --repo kimjisub/unipad.io --ref prod
```

To undo, in reverse order: turn Pages off, then let every branch deploy to the environment again
(how it was before):

```sh
gh api -X DELETE repos/kimjisub/unipad.io/pages
echo '{"deployment_branch_policy":null}' | gh api -X PUT repos/kimjisub/unipad.io/environments/github-pages --input -
```

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
