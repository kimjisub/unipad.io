"""Rules the stored data must satisfy before any coverage number is written.

`validate` checks the hand-maintained tables (combinations, matrix rows, evidence, device-record index,
series) and the derived tables against the series records; the raw snapshots and the files derived from them
are checked by `build_tables.derived_problems`. `table_problems` compares every table with the one source file
its series names, so a table whose rows come from more than one denominator cannot pass whatever code built it.
`block_problems` checks a computed coverage against those declared tables.

A `verified_run` row is accepted only when the evidence itself says so: a passing run of that feature, on
that device class, operating system version (or named browser), not on a mocked screen width, with screenshots.
The evidence in turn must agree with where it was confirmed: a browser run with its stored `results.json`
(profile, browser, operating system, features), a device run with its line in `data/evidence_basis.csv` (what the
source record states, at which lines) and with the device-record index.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict

from compat import (
    BASIS_FIELDS, BUCKETS, COMBO_FIELDS, COUNTED, EVIDENCE_FIELDS, FEATURES, INDEX_FIELDS, MAPPING_FIELDS, MATRIX_FIELDS, ROOT,
    TABLE_FIELDS, sha256_of, split_ids,
)
from source_tables import declared_tables, decimals, source_cells

DECLARATIONS = {"declared_supported", "declared_unsupported", "not_declared", "not_applicable"}
VERIFICATIONS = {"verified_run", "partial_run", "viewport_only", "source_only", "unverified", "failed", "not_applicable"}
REALITIES = {"physical", "emulator", "simulator", "browser", "viewport", "none"}
IN_SOLD = {"yes", "no", "unknown"}

RUN_KINDS = {"device_run", "web_run"}
READ_KINDS = {"source_read", "feature_facts", "store_snapshot"}
RESULTS = {"pass", "fail", "blocked", "partial", "read_only"}
RUN_TARGETS = {"physical", "emulator", "simulator", "browser", "viewport", "unknown", "none"}
# Targets that can carry a verified run. A mocked screen width (`viewport`) and an unrecorded device cannot.
REAL_TARGETS = {"physical", "emulator", "simulator", "browser"}
INSTALL_METHODS = {"store", "sideload", "none"}
TREE_STATES = {"clean", "dirty", "unknown", "not_applicable"}
RELEASE_STATES = {"yes", "no", "unknown", "not_applicable"}
EVIDENCE_SOLD = IN_SOLD | {"not_applicable"}
# How the device-record index names a device, and which evidence targets that may stand for.
INDEX_KIND_TARGETS = {
    "emulator": {"emulator"}, "simulator": {"simulator"}, "physical": {"physical"},
    "browser-viewport": {"browser", "viewport"}, "unknown": {"unknown"},
}
WEB_PROFILE_TARGETS = {"desktop": ("browser", "desktop"), "tablet-width": ("viewport", "tablet"), "phone-width": ("viewport", "phone")}
_SOLD_RANK = {"yes": 0, "unknown": 1, "no": 2}
# How the source record shows the pack getting into the app. `open_pack` passes only for `app`: a pack put on the device
# beforehand, or one whose entry the record does not state, shows the pad grid but not the import.
PACK_ENTRIES = {"app", "placed", "unstated", "not_applicable"}
VERDICTS = {"pass", "fail", "blocked", "partial"}
OS_OF_PLATFORM = {"darwin": "macos", "win32": "windows", "linux": "linux"}
ANDROID_API_OF_RELEASE = {"16": "36", "15": "35", "14": "34", "13": "33", "12": "31", "11": "30", "10": "29"}
INDEX_FEATURE_OF_TOKEN = {"install": "install", "open_pack": "open_pack", "led_or_light": "led", "rotation": "rotation",
                          "external_midi": "external_connect", "sound": "sound"}


def _version(text: str) -> tuple[int, ...] | None:
    return tuple(int(part) for part in text.split(".")) if re.fullmatch(r"\d+(\.\d+)*", text or "") else None


def version_in_range(version: str, lowest: str, highest: str) -> bool:
    """`highest` bounds the leading parts only, so 26.3.1 is inside a range that ends at 26."""
    parsed = _version(version)
    if parsed is None:
        return False
    low, high = _version(lowest), _version(highest)
    if low is not None and parsed < low:
        return False
    return high is None or parsed[:len(high)] <= high


def evidence_matches_combo(evidence: dict[str, str], combo: dict[str, str], *, partial: bool = False) -> bool:
    """Match the device class and OS/browser; partial web observations retain explicit engine and viewport limits."""
    if evidence["form_factor"] == "unknown" or evidence["form_factor"] != combo["device_category"]:
        return False
    if combo["surface"] == "web":
        # A row that means "any browser" cannot be settled by a single browser, and an engine build
        # (headless Chromium) is not the consumer browser the row names.
        browser_matches = combo["browser"] != "any" and evidence["browser"] == combo["browser"]
        if partial:
            # Preserve explicitly partial engine/any-browser observations; neither proves the named browser.
            browser_matches |= evidence["browser"] not in {"none", "unknown"} and (
                combo["browser"] == "any" or (combo["browser"] == "chrome" and evidence["browser"] == "chromium_headless"))
        if not browser_matches:
            return False
        # A viewport row records a desktop host at a named mocked width, not the phone/tablet OS.
        if partial and evidence["run_target"] == "viewport":
            return True
        return combo["os_family"] == "any" or evidence["os_family"] == combo["os_family"]
    if evidence["os_family"] != combo["os_family"]:
        return False
    return version_in_range(evidence["os_version"], combo["version_min"], combo["version_max"])


def capture_count(evidence: dict[str, str], root=ROOT) -> int:
    """Device records state a count; browser patterns must resolve to actual screenshot files."""
    if evidence.get("kind") == "web_run":
        return sum(p.is_file() for p in root.glob(evidence["captures"]) if p.suffix.lower() == ".png")
    counted = re.match(r"(\d+|no) screenshots\b", evidence["captures"])
    return int(counted.group(1)) if counted and counted.group(1) != "no" else 0


def has_captures(evidence: dict[str, str], root=ROOT) -> bool:
    """A verified run needs at least one saved screenshot, never just a nonempty pattern."""
    return capture_count(evidence, root) > 0


def is_passing_run(evidence: dict[str, str], feature: str, root=ROOT) -> bool:
    if evidence["kind"] not in RUN_KINDS or evidence["result"] != "pass" or not has_captures(evidence, root):
        return False
    if feature not in split_ids(evidence["features_passed"]) or evidence["run_target"] not in REAL_TARGETS:
        return False
    # Putting a build on a device with a developer tool shows the package installs, not that the store delivers it.
    return feature != "install" or evidence["install_method"] == "store"


def qualifying_evidence(row: dict[str, str], combo: dict[str, str], evidence: dict[str, dict], root=ROOT) -> list[dict]:
    """Cited evidence that can carry a `verified_run` for this row."""
    cited = [evidence[i] for i in split_ids(row["evidence_ids"]) if i in evidence]
    return [e for e in cited if is_passing_run(e, row["feature"], root) and evidence_matches_combo(e, combo)]


def supporting_evidence(row: dict[str, str], combo: dict[str, str], evidence: dict[str, dict]) -> list[dict]:
    """Cited partial observations of this device class and OS, with explicit web engine/viewport limits."""
    cited = [evidence[i] for i in split_ids(row["evidence_ids"]) if i in evidence]
    return [e for e in cited if e["kind"] in RUN_KINDS and e["result"] in {"pass", "partial"}
            and row["feature"] in split_ids(e["features_passed"]) + split_ids(e["features_partial"])
            and evidence_matches_combo(e, combo, partial=True)]


def _sold_of(evidences: list[dict]) -> str:
    return min((e["in_sold_app"] for e in evidences if e["in_sold_app"] in _SOLD_RANK), key=_SOLD_RANK.__getitem__, default="unknown")


def _has_fields(name: str, rows: list[dict], fields: tuple[str, ...]) -> list[str]:
    if rows and tuple(rows[0].keys()) != fields:
        return [f"{name}: columns differ from {fields}"]
    return []


def _combo_problems(data: dict) -> list[str]:
    problems = _has_fields("combos.csv", data["combos"], COMBO_FIELDS)
    ids = [c["combo_id"] for c in data["combos"]]
    if len(set(ids)) != len(ids):
        problems.append("combos.csv: duplicate combo_id")
    for c in data["combos"]:
        for bound in ("version_min", "version_max"):
            if c[bound] and _version(c[bound]) is None:
                problems.append(f"{c['combo_id']}: {bound} is not a version")
        if c["surface"] == "web" and not c["browser"]:
            problems.append(f"{c['combo_id']}: a web combination needs a browser")
    return problems


def _evidence_problems(data: dict) -> list[str]:
    problems = _has_fields("evidence.csv", data["evidence"], EVIDENCE_FIELDS)
    ids = [e["evidence_id"] for e in data["evidence"]]
    if len(set(ids)) != len(ids):
        problems.append("evidence.csv: duplicate evidence_id")
    for e in data["evidence"]:
        eid = e["evidence_id"]
        for field, allowed in (("result", RESULTS), ("run_target", RUN_TARGETS), ("install_method", INSTALL_METHODS),
                               ("tree_state", TREE_STATES), ("in_release_commit", RELEASE_STATES), ("in_sold_app", EVIDENCE_SOLD)):
            if e[field] not in allowed:
                problems.append(f"{eid}: bad {field} {e[field]!r}")
        if e["kind"] not in RUN_KINDS | READ_KINDS:
            problems.append(f"{eid}: bad kind {e['kind']!r}")
        for field in ("features_passed", "features_partial", "features_failed"):
            for feature in split_ids(e[field]):
                if feature not in FEATURES:
                    problems.append(f"{eid}: unknown feature {feature!r} in {field}")
        if not e["scope"].strip() or not e["record_id"].strip() or not e["recorded_utc"].strip():
            problems.append(f"{eid}: scope, record_id and recorded_utc are required")
        if e["kind"] in READ_KINDS:
            # Reading code, facts or a store listing never observes a feature running.
            if e["result"] != "read_only" or e["run_target"] != "none" or split_ids(e["features_passed"]) or split_ids(e["features_partial"]):
                problems.append(f"{eid}: {e['kind']} cannot claim a run")
        elif e["result"] == "read_only" or e["run_target"] == "none":
            problems.append(f"{eid}: a run needs a result and a run target")
        if e["result"] == "blocked" and split_ids(e["features_passed"]):
            problems.append(f"{eid}: a blocked run cannot list passed features")
        # Sold-build membership follows from the commit and the state of the tree, not from a label.
        expected = ("not_applicable" if e["in_release_commit"] == "not_applicable"
                    else "yes" if e["in_release_commit"] == "yes" and e["tree_state"] == "clean"
                    else "no" if e["in_release_commit"] == "no" or e["tree_state"] == "dirty"
                    else "unknown")
        if e["in_sold_app"] == "yes" and not re.search(r"\b[0-9a-f]{7,40}\b", e["source_commit"]):
            problems.append(f"{eid}: sold-build confirmation requires a recorded tested commit")
        if e["in_sold_app"] != expected:
            problems.append(f"{eid}: in_sold_app {e['in_sold_app']!r} does not follow from commit and tree state ({expected})")
    return problems


def _web_profile_features(result: dict) -> set[str]:
    """The features one profile of `web_check.mjs` passed, as the script recorded them."""
    return {feature for feature, passed in (result.get("checks") or {}).items() if passed is True}


def browser_id(recorded: str) -> str:
    """The browser a results file names. An engine build (headless Chromium) is not the consumer browser of its family."""
    name = recorded.lower()
    if name.startswith("chromium") and "headless" in name:
        return "chromium_headless"
    if name.startswith("google chrome") and "headless" not in name:
        return "chrome"
    return "unknown"


def _web_run_problems(data: dict) -> list[str]:
    """Browser-check evidence must not claim more than the stored results file shows, and must name its profile."""
    problems: list[str] = []
    for e in data["evidence"]:
        if e["kind"] != "web_run":
            continue
        eid = e["evidence_id"]
        if "#" not in e["record_id"]:
            problems.append(f"{eid}: a web_run names a results file and one profile in it (path#profile); without the profile nothing ties it to a recorded run")
            continue
        path, profile = e["record_id"].split("#", 1)
        file = data["root"] / path
        if not file.exists():
            problems.append(f"{eid}: results file {path} missing")
            continue
        summary = json.loads(file.read_text(encoding="utf-8"))
        result = next((r for r in summary["results"] if r["profile"] == profile), None)
        if result is None or "error" in result:
            problems.append(f"{eid}: profile {profile} has no successful result in {path}")
            continue
        target, form = WEB_PROFILE_TARGETS[result["kind"]]
        if (e["run_target"], e["form_factor"]) != (target, form):
            problems.append(f"{eid}: a {result['kind']} profile is {target}/{form}, not {e['run_target']}/{e['form_factor']}")
        if e["browser"] != browser_id(summary.get("browser", "")):
            problems.append(f"{eid}: browser {e['browser']!r}, but the results file recorded {summary.get('browser')!r} ({browser_id(summary.get('browser', ''))})")
        host_os = OS_OF_PLATFORM.get((summary.get("host") or {}).get("platform"), "unknown")
        if e["os_family"] != host_os:
            problems.append(f"{eid}: operating system {e['os_family']!r}, but the results file recorded host platform {(summary.get('host') or {}).get('platform')!r} ({host_os})")
        claimed = set(split_ids(e["features_passed"]) + split_ids(e["features_partial"]))
        extra = claimed - _web_profile_features(result)
        if extra:
            problems.append(f"{eid}: features {sorted(extra)} are not in the recorded result")
    return problems


def _basis_problems(data: dict) -> list[str]:
    """Each run's OS, device class, verdict, features, pack entry and screenshot count equal what its source record confirms.

    `evidence_basis.csv` says, per run, what the source record states and at which lines, with the hash of that
    record (a browser run: of its `results.json`, checked here). Evidence may claim less than the basis, never more.
    """
    problems = _has_fields("evidence_basis.csv", data["basis"], BASIS_FIELDS)
    basis: dict[str, dict] = {}
    for b in data["basis"]:
        if b["evidence_id"] in basis:
            problems.append(f"evidence_basis.csv: duplicate evidence_id {b['evidence_id']}")
        basis[b["evidence_id"]] = b
        if b["pack_entry"] not in PACK_ENTRIES or b["run_verdict"] not in VERDICTS or not re.fullmatch(r"\d+", b["captures"]):
            problems.append(f"{b['evidence_id']}: bad pack_entry, run_verdict or captures in evidence_basis.csv")
        if b.get("install_method") not in INSTALL_METHODS:
            problems.append(f"{b['evidence_id']}: bad install_method in evidence_basis.csv")
        if not re.fullmatch(r"[0-9a-f]{64}", b["source_sha256"]) or not b["source_lines"].strip():
            problems.append(f"{b['evidence_id']}: evidence_basis.csv needs the hash of the source record and the lines that confirm the run")
    runs = [e for e in data["evidence"] if e["kind"] in RUN_KINDS]
    for eid in sorted(basis.keys() - {e["evidence_id"] for e in runs}):
        problems.append(f"{eid}: a line in evidence_basis.csv for evidence that is not a run")
    for e in runs:
        eid, b = e["evidence_id"], basis.get(e["evidence_id"])
        if b is None:
            problems.append(f"{eid}: no line in evidence_basis.csv saying where the source record confirms the run")
            continue
        where = f"{b['source_lines']} of {e['record_id']}"
        if b["record_id"] != e["record_id"]:
            problems.append(f"{eid}: evidence_basis.csv names record {b['record_id']}, the evidence names {e['record_id']}")
        for field, basis_field in (("os_family", "os_family"), ("os_version", "os_version"), ("form_factor", "device_category"), ("browser", "browser"), ("result", "run_verdict"), ("install_method", "install_method")):
            if e[field] != b.get(basis_field):
                problems.append(f"{eid}: {field} {e[field]!r} is not what the source record confirms ({b.get(basis_field)!r}; {where})")
        passed, partial, failed = (set(split_ids(e[f])) for f in ("features_passed", "features_partial", "features_failed"))
        confirmed = {f: set(split_ids(b[f])) for f in ("features_passed", "features_partial", "features_failed")}
        if not passed <= confirmed["features_passed"]:
            problems.append(f"{eid}: features {sorted(passed - confirmed['features_passed'])} passed, but the source record confirms only {sorted(confirmed['features_passed'])} ({where})")
        if not partial <= confirmed["features_passed"] | confirmed["features_partial"]:
            problems.append(f"{eid}: features {sorted(partial - confirmed['features_passed'] - confirmed['features_partial'])} partly passed, which the source record does not confirm ({where})")
        if not failed <= confirmed["features_failed"]:
            problems.append(f"{eid}: features {sorted(failed - confirmed['features_failed'])} failed, which the source record does not say ({where})")
        if "open_pack" in passed and b["pack_entry"] != "app":
            problems.append(f"{eid}: open_pack passed, but the source record shows the pack {b['pack_entry']!r}, not imported through the app ({where})")
        if e["kind"] == "web_run":
            results = data["root"] / e["record_id"].split("#", 1)[0]
            if results.exists() and sha256_of(results) != b["source_sha256"]:
                problems.append(f"{eid}: the results file differs from the one whose hash evidence_basis.csv stored")
            shots = capture_count(e, data["root"])
        else:
            counted = re.match(r"(\d+|no) screenshots\b", e["captures"])
            if not counted or not re.fullmatch(r"L\d+(;L\d+)*", b["source_lines"]):
                problems.append(f"{eid}: captures must start with the screenshot count of the record, and the basis lines must be L<number> lines")
                continue
            shots = capture_count(e, data["root"])
        if shots != int(b["captures"]):
            problems.append(f"{eid}: {shots} screenshots, but the source record says {b['captures']}")
    return problems


def _index_os_version(entry: dict[str, str]) -> str:
    """The OS version an index line names, as the evidence table writes it (Android API level, iOS version); empty when not recorded."""
    text = entry["os_version"]
    if entry["platform"] == "android":
        api = re.search(r"API (\d+)", text)
        release = re.search(r"Android (\d+)", text)
        return api.group(1) if api else ANDROID_API_OF_RELEASE.get(release.group(1), "") if release else ""
    match = re.search(r"iOS (\d+(?:\.\d+)*)", text)
    return match.group(1) if match else ""


def _index_problems(data: dict) -> list[str]:
    """The device-record index and the evidence table must tell the same story about device and result."""
    problems = _has_fields("device_report_index.csv", data["index"], INDEX_FIELDS)
    evidence = {e["evidence_id"]: e for e in data["evidence"]}
    by_record: dict[str, list[dict]] = defaultdict(list)
    for entry in data["index"]:
        by_record[entry["record_id"]].append(entry)
        linked = split_ids(entry["linked_evidence_ids"])
        for eid in linked:
            if eid not in evidence:
                problems.append(f"index {entry['record_id']}: unknown evidence {eid}")
        if entry["result"] == "fail" and not any(evidence.get(eid, {}).get("result") == "fail" for eid in linked):
            problems.append(f"index {entry['record_id']}: a failed record must be linked to evidence with result fail")
    for e in data["evidence"]:
        if e["kind"] != "device_run":
            continue
        record = e["record_id"].removeprefix("device-log:")
        entries = [entry for entry in by_record.get(record, []) if e["evidence_id"] in split_ids(entry["linked_evidence_ids"])]
        if not entries:
            problems.append(f"{e['evidence_id']}: no index line for record {record} links back to it")
            continue
        if not any(e["run_target"] in INDEX_KIND_TARGETS.get(entry["device_kind"], set()) and entry["result"] == e["result"]
                   for entry in entries):
            problems.append(f"{e['evidence_id']}: device kind or result differs from the index line of {record}")
        checked: set[str] = set()
        for entry in entries:
            if entry["form_factor"] != e["form_factor"]:
                problems.append(f"{e['evidence_id']}: device class {e['form_factor']!r}, but the index line of {record} says {entry['form_factor']!r}")
            if entry["platform"] in ("android", "ios") and _index_os_version(entry) != e["os_version"]:
                problems.append(f"{e['evidence_id']}: OS version {e['os_version']!r}, but the index line of {record} says {entry['os_version']!r}")
            if entry["in_sold_app"] in {"yes", "no"} and entry["in_sold_app"] != e["in_sold_app"]:
                problems.append(f"{e['evidence_id']}: sold-build flag differs from the index line of {record}")
            if "uncommitted" in entry["source_commit"] and e["tree_state"] != "dirty":
                problems.append(f"{e['evidence_id']}: the index line of {record} records uncommitted changes, not tree state {e['tree_state']!r}")
            # Index descriptions may name a short hash or a merge parent alongside the tested commit.
            recorded_commits = re.findall(r"\b[0-9a-f]{7,40}\b", entry["source_commit"])
            claimed_commits = re.findall(r"\b[0-9a-f]{7,40}\b", e["source_commit"])
            if e["in_sold_app"] == "yes" and (not recorded_commits or entry["in_sold_app"] != "yes"):
                problems.append(f"{e['evidence_id']}: sold-build confirmation requires a recorded tested commit and confirmed release membership in the index line of {record}")
            if any(not any(a.startswith(b) or b.startswith(a) for b in claimed_commits) for a in recorded_commits):
                problems.append(f"{e['evidence_id']}: source commit differs from the index line of {record}")
            checked |= {INDEX_FEATURE_OF_TOKEN[t] for t in (token.strip() for token in entry["features_checked"].split("|")) if t in INDEX_FEATURE_OF_TOKEN}
        # A developer-tool install is a precondition of a run, so the index need not list it; it never counts as a store install.
        unchecked = set(split_ids(e["features_passed"])) - checked - {"install"}
        if unchecked:
            problems.append(f"{e['evidence_id']}: features {sorted(unchecked)} passed, but the index line of {record} does not list them as checked")
    return problems


def _row_problems(row: dict[str, str], combos: dict[str, dict], evidence: dict[str, dict], all_evidence: list[dict], root=ROOT) -> list[str]:
    rid, status, feature = row["row_id"], row["verification_status"], row["feature"]
    problems = [f"{rid}: empty field {field}" for field in MATRIX_FIELDS if not (row.get(field) or "").strip()]
    for field, allowed in (("support_declaration", DECLARATIONS), ("verification_status", VERIFICATIONS),
                           ("device_reality", REALITIES), ("in_sold_app", IN_SOLD)):
        if row[field] not in allowed:
            problems.append(f"{rid}: bad {field} {row[field]}")
    if feature not in FEATURES:
        problems.append(f"{rid}: unknown feature {feature}")
    combo = combos.get(row["combo_id"])
    if combo is None:
        return problems + [f"{rid}: unknown combo {row['combo_id']}"]
    cited_ids = split_ids(row["evidence_ids"])
    problems += [f"{rid}: unknown evidence {eid}" for eid in cited_ids if eid not in evidence]
    cited = [evidence[eid] for eid in cited_ids if eid in evidence]
    # Anything not fully run must leave a visible TODO.
    if status not in COUNTED and status != "not_applicable" and "TODO:" not in row["remaining_limits"]:
        problems.append(f"{rid}: status {status} needs a TODO: in remaining_limits")

    supporting = supporting_evidence(row, combo, evidence)
    if status == "verified_run":
        qualifying = qualifying_evidence(row, combo, evidence, root)
        if not cited:
            problems.append(f"{rid}: verified_run without evidence")
        elif not qualifying:
            problems.append(f"{rid}: verified_run needs a passing run of {feature} on this device class, OS version or browser; "
                            "failed, blocked, source-read, mocked-width and other-device evidence does not count")
        else:
            targets = {e["run_target"] for e in qualifying}
            best = "physical" if "physical" in targets else row["device_reality"]
            if row["device_reality"] not in targets or row["device_reality"] != best:
                problems.append(f"{rid}: device_reality {row['device_reality']} is not what the evidence ran on ({sorted(targets)})")
            matching_target = [e for e in qualifying if e["run_target"] == row["device_reality"]]
            if row["in_sold_app"] != _sold_of(matching_target):
                problems.append(f"{rid}: in_sold_app should be {_sold_of(matching_target)} according to the evidence")
            last_pass = max(e["recorded_utc"] for e in qualifying)
            for e in all_evidence:
                if feature in split_ids(e["features_failed"]) and e["recorded_utc"] > last_pass \
                        and (e["evidence_id"] in cited_ids or evidence_matches_combo(e, combo)):
                    problems.append(f"{rid}: {e['evidence_id']} failed {feature} after the last passing run")
    elif status in {"partial_run", "viewport_only"}:
        wanted = {e["run_target"] for e in supporting if (e["run_target"] == "viewport") == (status == "viewport_only")}
        if row["device_reality"] not in wanted:
            problems.append(f"{rid}: {status} needs a cited run of {feature} whose target is {row['device_reality']}")
        elif row["in_sold_app"] != _sold_of([e for e in supporting if e["run_target"] == row["device_reality"]]):
            problems.append(f"{rid}: in_sold_app does not follow from the cited runs")
    elif status == "failed":
        failures = [e for e in cited if e["kind"] in RUN_KINDS and e["result"] == "fail"
                    and e["run_target"] in REAL_TARGETS and feature in split_ids(e["features_failed"])
                    and evidence_matches_combo(e, combo)]
        matching_target = [e for e in failures if e["run_target"] == row["device_reality"]]
        if not matching_target:
            problems.append(f"{rid}: failed needs a cited failed run of {feature} on this device class, OS version or browser "
                            f"whose target is {row['device_reality']}")
        elif row["in_sold_app"] != _sold_of(matching_target):
            problems.append(f"{rid}: in_sold_app does not follow from the cited failed runs")
    else:
        if row["in_sold_app"] != "unknown":
            problems.append(f"{rid}: in_sold_app requires matching run evidence; status {status} must leave it unknown")
        if row["device_reality"] != "none":
            problems.append(f"{rid}: status {status} must have device_reality none")
        if status == "source_only" and not any(e["kind"] in READ_KINDS for e in cited):
            problems.append(f"{rid}: source_only needs cited source or fact evidence")
    return problems


def _matrix_problems(data: dict) -> list[str]:
    problems = _has_fields("support_matrix.csv", data["matrix"], MATRIX_FIELDS)
    combos = {c["combo_id"]: c for c in data["combos"]}
    evidence = {e["evidence_id"]: e for e in data["evidence"]}
    seen_rows: set[str] = set()
    seen_keys: set[tuple[str, str]] = set()
    cited_anywhere: set[str] = set()
    for row in data["matrix"]:
        rid = row["row_id"]
        if rid in seen_rows:
            problems.append(f"{rid}: duplicate row_id")
        seen_rows.add(rid)
        key = (row["combo_id"], row["feature"])
        if key in seen_keys:
            problems.append(f"{rid}: duplicate (combo, feature) {key}")
        seen_keys.add(key)
        cited_anywhere.update(split_ids(row["evidence_ids"]))
        problems += _row_problems(row, combos, evidence, data["evidence"], data["root"])
    for combo_id in combos:
        have = {r["feature"] for r in data["matrix"] if r["combo_id"] == combo_id}
        missing = [f for f in FEATURES if f not in have]
        if missing:
            problems.append(f"{combo_id}: no row for features {missing}")
    # A recorded failure may not drop out of sight.
    for e in data["evidence"]:
        if e["result"] == "fail" and e["evidence_id"] not in cited_anywhere:
            problems.append(f"{e['evidence_id']}: a failed run must be cited by at least one matrix row")
    return problems


def _series_problems(data: dict) -> list[str]:
    problems: list[str] = []
    series = {s["series_id"]: s for s in data["series"]}
    if len(series) != len(data["series"]):
        problems.append("series.jsonl: duplicate series_id")
    for sid, s in series.items():
        # A series that could not be fetched keeps only its identity and the reason it is missing.
        required = ("publisher", "url", "fetched_utc", "reference_period", "population", "unit", "region") if s.get("status") == "ok" else ("publisher", "population", "notes")
        for field in required:
            if not str(s.get(field) or "").strip():
                problems.append(f"series {sid}: empty {field}")
    combos = {c["combo_id"] for c in data["combos"]}
    problems += _has_fields("series_mapping.csv", data["mapping"], MAPPING_FIELDS)
    seen_map: set[tuple[str, str, str, str]] = set()
    for m in data["mapping"]:
        if m["series_id"] not in series:
            problems.append(f"mapping: unknown series {m['series_id']}")
        if m["combo_id"] and m["combo_id"] not in combos:
            problems.append(f"mapping: unknown combo {m['combo_id']} for {m['label']}")
        key = (m["series_id"], m["category"], m["label"], m["combo_id"])
        if key in seen_map:
            problems.append(f"mapping: duplicate {key}")
        seen_map.add(key)
    return problems


TABLE_TOTAL = 100.0


def table_problems(root, series: list[dict], tables: list[dict], mapping: list[dict]) -> list[str]:
    """Every declared table equals the one source file of its series, and `tables.csv` holds nothing else.

    A percentage table adds to 100 up to the rounding of its published values: each of its n labels is rounded to
    `value_decimals`, so the sum can be off by at most n x 0.5 x 10^-value_decimals. Two tables added into one
    (page views of two device classes, StatCounter and Steam) come to about 200 and are far outside that.
    """
    problems = _has_fields("tables.csv", tables, TABLE_FIELDS)
    by_id = {s["series_id"]: s for s in series}
    declared = declared_tables(series)
    keys = {(sid, category) for sid, category, _ in declared}
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for t in tables:
        groups[(t["series_id"], t["category"])].append(t)
    for sid, category in sorted(groups.keys() - keys):
        problems.append(f"table {sid}/{category}: not declared in series.jsonl; a table cannot be added to, or merged into, another series")
    labels_of: dict[tuple[str, str], list[str]] = {}
    for sid, category, count in declared:
        name, s = f"table {sid}/{category}", by_id[sid]
        rows = groups.get((sid, category))
        if s.get("status") != "ok":
            problems.append(f"{name}: not a usable series")
        if not rows:
            problems.append(f"{name}: declared in series.jsonl but missing from tables.csv")
            continue
        labels_of[(sid, category)] = [r["label"] for r in rows]
        try:
            cells = source_cells(root, s, category)
            values = [float(r["value"]) for r in rows]
        except (OSError, KeyError, StopIteration, ValueError) as err:
            problems.append(f"{name}: cannot compare with its source file ({type(err).__name__}: {err})")
            continue
        if labels_of[(sid, category)] != list(cells) or values != [float(c) for c in cells.values()]:
            problems.append(f"{name}: rows differ from the one source file of its series ({len(rows)} rows against {len(cells)} labels there)")
        if len(cells) != count:
            problems.append(f"{name}: the source has {len(cells)} labels, series.jsonl declares {count}")
        places = s["value_decimals"]
        if max(map(decimals, cells.values()), default=0) > places:
            problems.append(f"{name}: the source publishes more decimals than the value_decimals {places} that the rounding bound rests on")
        bound = len(cells) * 0.5 * 10 ** -places
        if abs(sum(values) - TABLE_TOTAL) > bound + 1e-9:
            problems.append(f"{name}: values add to {round(sum(values), 4)}, not 100 within the rounding of {len(cells)} labels ({round(bound, 4)}); "
                            "one table must hold one denominator")
        if {r["reference_period"] for r in rows} != {s["table_period"]} or {r["unit"] for r in rows} != {s["table_unit"]}:
            problems.append(f"{name}: period or unit differs from the one series.jsonl declares")
    if mapping is not None:
        mapped: dict[tuple[str, str], set[str]] = defaultdict(set)
        for m in mapping:
            mapped[(m["series_id"], m["category"])].add(m["label"])
        for key, labels in labels_of.items():
            if mapped.get(key, set()) != set(labels):
                problems.append(f"mapping {key[0]}/{key[1]}: labels differ from the table's own labels")
        for key in sorted(mapped.keys() - keys):
            problems.append(f"mapping {key[0]}/{key[1]}: maps a table that is not declared")
    return problems


def validate(data: dict) -> list[str]:
    """Returns human-readable problems; an empty list means the stored data is consistent."""
    return (_combo_problems(data) + _evidence_problems(data) + _web_run_problems(data) + _basis_problems(data) + _index_problems(data)
            + _matrix_problems(data) + _series_problems(data)
            + table_problems(data["root"], data["series"], data["tables"], data["mapping"]))


def block_problems(data: dict, coverage: dict) -> list[str]:
    """Each block must be exactly one table of one series: same labels, same total, one period, one unit."""
    problems = _has_fields("tables.csv", data["tables"], TABLE_FIELDS)
    series = {s["series_id"]: s for s in data["series"]}
    declared = declared_tables(data["series"])
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for t in data["tables"]:
        groups[(t["series_id"], t["category"])].append(t)
    for (sid, category), rows in groups.items():
        name = f"table {sid}/{category}"
        if sid not in series or series[sid].get("status") != "ok":
            problems.append(f"{name}: not a usable series")
        if len({r["label"] for r in rows}) != len(rows):
            problems.append(f"{name}: a label appears twice")
        if len({r["reference_period"] for r in rows}) != 1 or len({r["unit"] for r in rows}) != 1:
            problems.append(f"{name}: more than one period or unit")

    if len(coverage["blocks"]) != len(declared) * len(FEATURES) or len(groups) != len(declared):
        problems.append(f"coverage: {len(coverage['blocks'])} blocks, expected {len(declared)} tables declared in series.jsonl x {len(FEATURES)} features "
                        f"({len(groups)} tables in tables.csv)")
    seen: set[tuple[str, str, str]] = set()
    for b in coverage["blocks"]:
        key = (b["series_id"], b["category"], b["feature"])
        name = "block " + "/".join(key)
        if key in seen:
            problems.append(f"{name}: duplicate block")
        seen.add(key)
        rows = groups.get(key[:2])
        if rows is None or b["feature"] not in FEATURES:
            problems.append(f"{name}: no such table or feature")
            continue
        expected_total = round(sum(float(r["value"]) for r in rows), 4)
        if abs(b["table_total_percent"] - expected_total) > 1e-6:
            problems.append(f"{name}: total {b['table_total_percent']} differs from the table's own total {expected_total}")
        if sorted((l["label"], l["value"]) for l in b["labels"]) != sorted((r["label"], float(r["value"])) for r in rows):
            problems.append(f"{name}: labels differ from the table (another denominator mixed in or labels lost)")
        if set(b["buckets_percent"]) != set(BUCKETS) or abs(sum(b["buckets_percent"].values()) - expected_total) > 0.01:
            problems.append(f"{name}: buckets do not add up to the table total")
        meta = series.get(key[0], {})
        if (b["unit"], b["population"], b["reference_period"]) != (meta.get("unit"), meta.get("population"), rows[0]["reference_period"]):
            problems.append(f"{name}: unit, population or period is not the table's own")
    if coverage.get("world_installed_device_share") is not None:
        problems.append("coverage: a world device share is claimed without a joint distribution")
    return problems
