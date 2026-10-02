# Compatibility: which phones, tablets and computers UniPad runs on

A measuring method and the first evidence for the question "on what share of the world's devices and operating systems does UniPad
work?". **This directory does not answer that question with a number, and it promises no support.** The world share is unknown, for the
reason below; what is here are separate proxies, each on its own denominator, and a list of what was and was not run.

Written 2026-09-30. App code was read, never changed, at these commits of the public repositories:

| Repository | Latest development code read | Code in the build on sale |
|---|---|---|
| unipad-android | `20207d89` (main) | 4.1.3 (109): `1ac36672`. 4.1.8 (115): final release commit `7d740029`; the first 4.1.8 commit `5747542d` lacks one later fix |
| unipad-ios | `1ef848d` (main) | 4.1.6, build 7: final release commit `fe2e99c`; the first 4.1.6 commit is `eb8353d` |
| unipad.io | `1f13a4a` (main) | `8019666` (`prod`, the deployed site source; main is one commit ahead) |

Store state comes from one saved reading of the store listings at 2026-09-30T04:53:15Z: Google Play had 4.1.3 (109) fully rolled out and
4.1.8 (115) in a staged rollout; the App Store had 4.1.6 for sale. Which commit an uploaded binary was built from was not checked against the
binary itself; "in the build on sale" below always means "the tested commit is contained in the release commit".

## Result in one place

- **World share of installed devices: unknown.** No publisher gives installed devices by class (phone, tablet, computer), operating
  system and version together. What exists uses different units: StatCounter counts page views, Apple counts devices that used the App Store
  on one day, Steam counts opted-in gamers, Google, Apple, GSMA and ITU give totals without a split. `output/coverage.json` therefore holds no
  world figure and one block per series. Data that would make it computable: a Play Console "Reach and devices" export for the app, a
  first-party Microsoft figure of active Windows devices, an Apple export by device model and OS minor version (`GAPS.md` row 11).
- **What was run.** 140 device-check entries from 116 records (`data/device_report_index.csv`) and one local browser check
  (`evidence/web-2026-09-30/`). Every one is an emulator (63), a simulator (45), a browser window on a computer (22) or not described (10).
  **No physical phone, tablet or Launchpad, no tablet-class emulator or simulator, nothing on Android other than 15 (API 35), nothing on
  iOS 17 or 18.** iOS 26.3.1, 26.4 and 27.0 simulators, one Android 15 emulator and headless Chromium 153 on a Mac were run.
- **Rows.** 42 combinations x 6 features = 252 rows in `data/support_matrix.csv`: 6 `verified_run` (2 on the Android emulator, 4 on iOS
  simulators; 1 of the 6 on code that is in a build on sale), 10 `partial_run`, 8 `viewport_only`, 5 `source_only`, 203 `unverified`,
  20 `not_applicable`. No row is verified on a physical device. Android "open a pack" is `partial_run`: every cited record put the pack on the
  device with a tool, so the import was not seen. Only one Android record states a device class (a smallest width of 411 dp, phone size); the
  other Android records give a fingerprint or a pixel size, so their class is `unknown` and they carry no phone row. `output/SUPPORT_MATRIX.md` is the readable form, with the exact scope of
  every run; `GAPS.md` lists what to check next.

## Files

| Path | What it is |
|---|---|
| `data/combos.csv` | One line per platform / device category / OS or browser / version scope, with the machine-checkable range (`os_family`, `version_min`, `version_max`, `browser`). |
| `data/support_matrix.csv` | One row per combination and feature: declaration, verification status, what the run was on, evidence, sold-build flag, date, confirmed scope, remaining limits. |
| `data/evidence.csv` | Each piece of evidence: result, what it ran on, OS version or browser, how the build got onto the device, which features passed, partly passed or failed, commit and tree state, command, scope. |
| `data/evidence_basis.csv` | For every run: what its source record confirms (OS, device class, browser, verdict, features, install method, how the pack got into the app, screenshot count), the record lines that say so, and the SHA-256 of that record (for a browser run: of `results.json`). The evidence table may claim less than this, never more. |
| `data/device_report_index.csv` | Every device-check entry (140) with device, OS, commit and result, and the evidence id when a matrix row uses it. |
| `data/series_mapping.csv` | How each label of a denominator table maps to combinations. Derived; do not edit. |
| `sources/series.jsonl` | One line per distribution source: publisher, URL, fetch time, period, population, unit, region, method quote, licence, SHA-256 of the raw file; for a series that feeds tables also the tables it yields (`tables`: category and label count), their period and unit, the month read, and the decimals the source publishes. |
| `sources/raw/` | The StatCounter CSV files as fetched, unchanged (terms: CC BY-SA 3.0, recorded per series). Pages and files of other publishers are not reproduced here (their terms of reuse are not confirmed, or they are prose); `sources/series.jsonl` keeps their URL, fetch time, population and the SHA-256 of the file as fetched (`raw_sha256`, no longer checked against a file in this directory). |
| `sources/facts/` | The numbers the Apple and Steam tables need, as label and value per category, with the period and population in `sources/series.jsonl`. Each file's hash is checked. |
| `sources/tables.csv` | Normalized tables used for the proxies. Derived; do not edit. |
| `scripts/` | `build_tables.py` (sources to tables and mapping), `source_tables.py` (reads one table from its own source file), `rules.py` (the rules), `compat.py` (loading and computing), `compute_coverage.py` (validate, compute, write `output/`), `test_compat.py`, `web_check.mjs` (browser check). |
| `output/` | `coverage.json`, `COVERAGE_SUMMARY.md`, `SUPPORT_MATRIX.md`. Generated; do not edit. |
| `evidence/web-2026-09-30/` | Screenshots and `results.json` of the local browser check; `evidence/web-2026-09-30-ko/results.json` is the same run in Korean. |
| `GAPS.md` | Next checks, ordered by evidence and share. |

The device-check records behind `device-log:` ids are the maintainers' working notes and are not in this repository. Everything a number
depends on (device, OS, commit, result, features) is copied into `evidence.csv` and the index; the calculation needs nothing else.

## Definitions

**Feature** (`support_matrix.csv`):
`install` the app is installed **from the store**; `open_pack` a UniPack is imported **through the app** (file picker, open-in, URL import, or the web page's own load) and its pad grid appears, so a pack put on the device beforehand with a developer tool, or one whose entry a record does not state, is only a partial run; `sound` playback of a pad's
sound *starts* (seen in a log or by instrumentation; whether anyone can hear it is a separate limit written on the row); `led` the pad light
shows on screen; `rotation` the screen holds the orientation the player needs and survives a change; `external_connect` a Launchpad or
other MIDI device connects. A feature that does not exist for a surface (install on the web, rotation of a desktop window) is
`not_applicable`. Starting the app is not any of these.

**Support declaration:** `declared_supported` / `declared_unsupported` (from build files, manifest or site copy, named in
`declaration_source`), `not_declared` (no statement exists), `not_applicable`. A declaration is not a run, and the declared minimum version
is not the lowest version that was run.

**Verification status:**

| Status | Meaning | Counted as working |
|---|---|---|
| `verified_run` | A passing run of that feature on that device class and on that OS version or named browser. | yes |
| `partial_run` | Something ran, but not the whole feature or not what the row names: a build put on an emulator or simulator with a developer tool instead of a store install, an audio stream seen open without a pad sound start, headless Chromium instead of Chrome, one browser for an any-browser row, a fake MIDI output instead of a device. | no |
| `viewport_only` | Only a mocked screen width in a desktop browser. Never counts for a phone or a tablet. | no |
| `source_only` | Read from code or published facts, never run. | no |
| `unverified` | Nothing. | no |
| `failed` | Ran and failed. | no |

Partial app rows also require the named OS family and a version inside the row's range. Partial web rows require the
recorded device class and host OS, except `viewport_only`: those rows explicitly record a mocked phone/tablet width on a desktop
host, and prove neither the mobile OS nor a mobile device. A known Chromium engine can supply only partial evidence for Chrome;
one known browser can supply only partial evidence for an any-browser row. Unknown device class never supplies partial evidence
or a sold-build flag. Failed rows require a failed run of the named feature on the matching device class, OS/version,
named browser and real execution target; their sold-build flag follows only those matching failures. A failure on a mocked
width, headless Chromium for Chrome, or one browser for an any-browser row cannot settle a failed row.
Android phone install and sound and macOS external connection are therefore unverified; Android phone
pack opening is partial only on the later, unsold phone-size emulator run.

**Device class** (`form_factor` in the evidence): `phone` or `tablet` only where the source record says so in a word (iPhone, phone, iPad, tablet) or gives a smallest width in dp (under 600 dp is phone size); a device fingerprint or a pixel size alone is `unknown`, and `unknown` never carries a phone or tablet row. **Screenshots:** a verified row needs a positive integer count in a device record, or a browser capture pattern that resolves to actual PNG files. A zero count (including `00`) or a pattern alone cannot carry a verified row; that is recorded as a capture problem, not as a product failure.

**What a run was on** (`device_reality`, taken from the evidence): `physical`, `emulator`, `simulator`, `browser` (a real browser engine in
a window on a computer), `viewport` (a mocked width), `none`.

**Sold build** (`in_sold_app`): `yes` only when the tested commit is contained in the release commit of a build on sale and the tree had no
uncommitted files; `no` when the commit is later or the tree was dirty; `unknown` when the record does not say. It is derived per evidence
line from `in_release_commit` and `tree_state`, and per row from the evidence that carries the row. Device evidence must also agree with a known sold-build flag, recorded commit hashes (including short hashes or merge parents), and an explicit uncommitted-tree description in the device-record index. An unknown index flag adds no sold-build claim.

## Rules the checks enforce

`rules.py` rejects, and `test_compat.py` proves it rejects:

- a `verified_run` whose evidence is a failed, blocked or source-reading record, a run on another OS version, on an unrecorded OS, on another
  device class, on a mocked width, of another feature, or (for `install`) a build that was not installed from the store;
- headless Chromium standing in for a verified Chrome run, or for a verified "any browser on Windows/macOS/Linux" run,
  even when stored as `device_run`: every run's browser must match its source-basis browser;
- partial or viewport evidence of an unknown or different device class, partial app evidence of a different OS/version,
  partial desktop web evidence of a different host OS, and sold-build flags supplied by these mismatched records;
- a row whose `device_reality` or `in_sold_app` is not what its evidence says; evidence whose device kind or result contradicts the
  device-record index; browser-check evidence that claims more than the stored `results.json` recorded;
- browser-check evidence without its `results.json` profile, or whose browser (headless Chromium is not Google Chrome) or host operating
  system differs from what the results file recorded; a device run whose OS version, device class, browser, verdict, features, pack entry or screenshot
  count is more than its line in `evidence_basis.csv` confirms, or differs from the device-record index; an install method
  that differs from its source basis; a passed `open_pack` whose source record
  does not show the pack entering through the app; a `verified_run` on a record with no screenshot;
- a failed row supported by another device class, OS/version, browser, feature or execution target, or a sold-build flag
  supplied by an unrelated failure;
- a failed record that no row cites, a failed index entry without evidence, a `verified_run` with a later failure of the same feature;
- duplicate combination/feature rows, duplicate mappings, unknown evidence ids, a row without `confirmed_scope`, an unrun row without `TODO:`;
- a coverage block that is not exactly one table of one series: the block count must be the tables `series.jsonl` declares (13) x 6 features,
  and each block's labels and total must equal that table's own rows;
- a table whose rows are not exactly the one source file of its series (same labels, same values, the declared label count, the declared
  period and unit), a table that `series.jsonl` does not declare, and a percentage table that does not add to 100 within the rounding of its
  published values. Each of n labels is rounded to the decimals the source publishes (2 for StatCounter and Steam, none for Apple), so the sum
  may be off by n x 0.5 x 10^-decimals and no more; two tables added into one (two device classes, StatCounter and Steam) come to about 200.
  The check reads the source files directly, so it holds whatever code built `tables.csv`;
- a table with two periods or units, and any world share that is not `null`;
- a raw or facts file whose SHA-256 differs from the stored one, and a `tables.csv` or `series_mapping.csv` that differs from what the
  source files give when rebuilt. `build_tables.py` applies the table rules to its own result and refuses to write a table that breaks them.

A sold-build confirmation also requires a recorded tested commit. For device runs, the independently recorded
index must name that commit and confirm release membership (`in_sold_app=yes`); an unknown index value or
an unrecorded commit cannot be promoted by changing the run or its linked rows. Existing short and full
commit hashes are compared as prefixes.

**Install provenance:** each run's `install_method` must equal the independently recorded field in
`evidence_basis.csv`. `store` needs a source record of store delivery; `sideload` records a developer/test build
installed or run by local tools; `none` means no app installation was recorded or installation does not apply
(for example a browser run or a blocked runtime check). Source line references include the install/test command
or description. The existing records contain no store installs, even when the tested code is in a sold build.

What the checks cannot do: a coordinated edit of `evidence.csv`, the index and `evidence_basis.csv` (including its line numbers and record
hash) reads as consistent. The record lines are there so that a reader with the maintainers' records can compare them; the index `form_factor`
of entries that no evidence cites was not re-read against the records.

## Denominators and how they are used

`compute_coverage.py` takes each table separately (for example StatCounter Android versions on phones, August 2026) and sorts its labels by
the best status among the combinations the label maps to. It reports each table's own percentages and stops there. A label reached by both
an app and the web counts once; whether the same device is behind both is unknown, because no joint distribution exists.

What the figures are: the share of a table's page views (StatCounter), App Store devices (Apple) or survey answers (Steam) that sit on a
label for which the matrix has a verified run. That says how much of that table has been *tested*, not how many people or devices UniPad
works for. None of these tables counts installed devices.

A combination that spans a version range counts as run when a version inside the range was run (`IOS-PH-26`, iOS 26.x, stands on iOS 26.3.1 and
26.4 only). That is a check of those versions, not of the whole major version, of every device model in it, or of a physical device; the versions
that ran are named on each row.

Known limits of the mapping: Edge, Opera and Brave are not mapped to the Chrome row; Chrome on iOS uses WebKit and cannot be separated in
StatCounter's mobile table, so the mobile "Chrome" label is mapped to the Android Chrome combination as a stand-in; the macOS labels carry no
version, so the Mac build that the iOS project lists for macOS 26.2 and later is not tied to any label.

Sources not used as denominators, and why: StatCounter's macOS version table lists "macOS Catalina" 42.54 and "macOS Cheetah" 39.41 for
August 2026, which looks like user-agent freezing; `Chrome for Android` appears inside StatCounter's desktop browser-version table, so no
browser-version table is used; Google's `distributions.json` (Android versions) states neither its population nor its period; the ITU text
came through a summarising fetch tool and should be re-read in a browser before being quoted. StatCounter data is CC BY-SA 3.0 (StatCounter
Global Stats, gs.statcounter.com); its September 2026 row was a partial month and is not used. Other sources' terms are recorded per series
in `sources/series.jsonl`; where they are not confirmed the page or file is not reproduced here and only facts (URL, fetch time, hash,
population, the figures a table needs) are kept. Nothing here grants or assumes a right to redistribute a source.

## Rerun

From `meta/compatibility`, with Python 3.10 or later (run here with 3.14) and nothing else installed:

```
python3 scripts/compute_coverage.py --check   # rules, derived files against raw snapshots, stored output; non-zero on any difference
python3 -m unittest discover -s scripts       # the rules, including tampering with a copy of this directory
node --test scripts/web_rules.test.mjs scripts/web_check.test.mjs  # decisions and observation flow, without a browser
python3 scripts/build_tables.py               # raw snapshots -> sources/tables.csv, data/series_mapping.csv (refuses if a raw hash differs)
python3 scripts/compute_coverage.py           # validates, then writes output/
```

Everything reads files in this directory; nothing is fetched. Rebuilding never changes a stored hash. To refresh a StatCounter table: fetch it
again from the URL in `series.jsonl`, replace the raw file, run `python3 scripts/build_tables.py --accept-raw <series_id>` to store the new hash
on purpose, update `fetched_utc`, `table_month` and `table_period` in `series.jsonl`, then rebuild and recompute. For Apple and Steam, replace
`sources/facts/<series>.csv` and its `facts_sha256`.

### Browser check

`scripts/web_check.mjs` drives the Chromium build that comes with Playwright. Playwright is not a dependency of this repository and must be
given explicitly. One way to get the versions of the recorded run (Playwright 1.63.0, Chromium 153.0.8010.12), outside the repository:

```
mkdir -p ~/.cache/unipad-web-check && cd ~/.cache/unipad-web-check
npm init -y && npm install playwright@1.63.0 && npx playwright install chromium
export PLAYWRIGHT_MODULE=~/.cache/unipad-web-check/node_modules/playwright
```

Then, from the repository root, with any UniPack zip (the recorded run used `Faded.zip`, 8x8 with 6 chains, which is not in this repository):

```
pnpm install --frozen-lockfile
NEXT_TELEMETRY_DISABLED=1 pnpm build
pnpm exec next start --port 3688 &
node meta/compatibility/scripts/web_check.mjs http://localhost:3688 <pack.zip> meta/compatibility/evidence/<new-folder> en
```

It opens the pack at a desktop size and at two tablet and one phone window size, sweeps the pad identifiers actually present on screen until both sound and held lights have been observed
(or all pads have been tried), counts new sound starts and lit pads independently, flips the window, and aborts every request that leaves the local server and the analytics script (the aborted targets
are listed in the result). It exits 1 when a profile fails or throws and 2 on a setup error. The rotate hint is looked up in the site's own
messages, so `ko` works as well as `en`. It can only drive Chromium: it sends held touches through the Chrome DevTools Protocol, so it does
not run Firefox or WebKit. A pass is a pass for headless Chromium on that computer; it is not Chrome, not another operating system and not
a phone or tablet.

Light-only observations survive even when no pad starts a sound, including after rotation. The recorded
`ledPadId` fields identify the pad used for the strongest held-light observation separately from the
sounding pad; a new sweep after rotation repeats both checks using the current grid. Mouse and held touch
input use the same sweep.

The browser check uses `web_rules.mjs` for its decisions. A sound start counts only with an audio context in
`running` state; playback after rotation also needs a new start and the recorded state after rotation. The
request guard compares parsed URL origins, including ports, rather than string prefixes. Data URLs and blob
URLs from the local origin remain allowed. These checks can be tested without launching a browser. Existing
saved browser results are historical evidence and are not rewritten by a change to the check script.
