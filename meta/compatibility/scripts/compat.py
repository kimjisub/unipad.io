"""Loads the stored compatibility data and computes coverage per denominator series.

Everything here reads files under `meta/compatibility/` only. Nothing is fetched, so a
recomputation gives the same result from the stored snapshots.

Design rules (see ../README.md; `rules.py` enforces them on the stored data):
- A denominator series is used alone. Shares from different series are never added,
  multiplied or averaged; the result keeps one block per series, category and feature.
- Only rows whose verification is `verified_run` count as working, split into physical runs and
  emulated runs, and the emulated ones into code that is in a sold build and code that is not.
- A label counts once per (series, feature) even when an app and the web both cover it.
- The world share of devices is null unless one series carries a joint distribution.
"""
from __future__ import annotations

import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FEATURES = ("install", "open_pack", "sound", "led", "rotation", "external_connect")

COMBO_FIELDS = (
    "combo_id", "surface", "platform", "device_category", "os_or_browser", "version_scope",
    "os_family", "version_min", "version_max", "browser", "notes",
)
MATRIX_FIELDS = (
    "row_id", "combo_id", "platform", "device_category", "os_or_browser", "version_scope",
    "feature", "support_declaration", "declaration_source", "verification_status",
    "device_reality", "evidence_ids", "in_sold_app", "checked_on", "confirmed_scope", "remaining_limits",
)
EVIDENCE_FIELDS = (
    "evidence_id", "kind", "result", "run_target", "form_factor", "os_family", "os_version", "browser",
    "install_method", "features_passed", "features_partial", "features_failed", "source_commit", "tree_state",
    "in_release_commit", "in_sold_app", "recorded_utc", "device", "command", "captures", "scope", "record_id",
)
BASIS_FIELDS = (
    "evidence_id", "record_id", "source_sha256", "source_lines", "os_family", "os_version", "device_category", "browser",
    "run_verdict", "captures", "features_passed", "features_partial", "features_failed", "pack_entry", "basis_note",
)
INDEX_FIELDS = (
    "record_id", "report_utc", "platform", "device_kind", "device_name", "form_factor", "os_version",
    "source_commit", "in_sold_app", "result", "features_checked", "linked_evidence_ids",
)
TABLE_FIELDS = ("series_id", "category", "label", "value", "unit", "reference_period")
MAPPING_FIELDS = ("series_id", "category", "label", "combo_id", "note")

# Verification statuses that may be counted as "works".
COUNTED = {"verified_run"}
# verified_physical: run on a physical device. verified_emulated_*: run in an emulator or simulator (or, for
# the web, in the named browser on a computer), split by whether the tested code is in a build on sale.
# partly_run: something ran, but not the whole feature or not the named product. unmapped_label: the series
# label cannot be tied to any combination.
BUCKETS = (
    "verified_physical", "verified_emulated_sold", "verified_emulated_unsold", "partly_run", "declared_not_run",
    "unsupported_or_failed", "unknown", "unmapped_label", "not_applicable",
)
_BEST_FIRST = (
    "verified_physical", "verified_emulated_sold", "verified_emulated_unsold", "partly_run", "declared_not_run",
    "unsupported_or_failed", "unknown", "not_applicable", "unmapped_label",
)
_ORDER = {bucket: rank for rank, bucket in enumerate(_BEST_FIRST)}

WORLD_SHARE_REASON = (
    "No single publisher provides a joint distribution of installed devices by device class, "
    "operating system and version. Series use different units and populations and must not be "
    "combined; each block below stands alone as a proxy, not as a world device share."
)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def write_csv(path: Path, fields: tuple[str, ...], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def split_ids(value: str) -> list[str]:
    """A `;`-separated cell as a list; `none` and blanks mean nothing."""
    return [item.strip() for item in (value or "").split(";") if item.strip() and item.strip() != "none"]


def load_all(root: Path = ROOT) -> dict:
    return {
        "root": root,
        "combos": read_csv(root / "data" / "combos.csv"),
        "matrix": read_csv(root / "data" / "support_matrix.csv"),
        "evidence": read_csv(root / "data" / "evidence.csv"),
        "basis": read_csv(root / "data" / "evidence_basis.csv"),
        "index": read_csv(root / "data" / "device_report_index.csv"),
        "mapping": read_csv(root / "data" / "series_mapping.csv"),
        "series": read_jsonl(root / "sources" / "series.jsonl"),
        "tables": read_csv(root / "sources" / "tables.csv"),
    }


def row_bucket(row: dict[str, str]) -> str:
    status, decl = row["verification_status"], row["support_declaration"]
    if status == "not_applicable" or decl == "not_applicable":
        return "not_applicable"
    if status in COUNTED:
        if row["device_reality"] == "physical":
            return "verified_physical"
        return "verified_emulated_sold" if row["in_sold_app"] == "yes" else "verified_emulated_unsold"
    if status == "failed" or decl == "declared_unsupported":
        return "unsupported_or_failed"
    if status == "partial_run":
        return "partly_run"
    if decl == "declared_supported":
        return "declared_not_run"
    return "unknown"


def compute_coverage(data: dict) -> dict:
    """One block per denominator series, category and feature; blocks are never merged."""
    matrix_by_combo: dict[str, dict[str, dict[str, str]]] = defaultdict(dict)
    for row in data["matrix"]:
        matrix_by_combo[row["combo_id"]][row["feature"]] = row
    tables: dict[tuple[str, str], dict[str, float]] = defaultdict(dict)
    periods: dict[tuple[str, str], str] = {}
    for t in data["tables"]:
        tables[(t["series_id"], t["category"])][t["label"]] = float(t["value"])
        periods[(t["series_id"], t["category"])] = t["reference_period"]
    mapped: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for m in data["mapping"]:
        if m["combo_id"]:
            mapped[(m["series_id"], m["category"], m["label"])].append(m["combo_id"])
    series = {s["series_id"]: s for s in data["series"]}

    blocks = []
    for (sid, category), labels in sorted(tables.items()):
        meta = series[sid]
        total = round(sum(labels.values()), 4)
        for feature in FEATURES:
            sums = {b: 0.0 for b in BUCKETS}
            per_label = []
            for label, value in labels.items():
                key = (sid, category, label)
                if key not in mapped:
                    bucket = "unmapped_label"
                else:
                    # The same label reached through several surfaces (app and web) counts once,
                    # by the best status among them.
                    buckets = [row_bucket(matrix_by_combo[c][feature]) for c in mapped[key]]
                    bucket = min(buckets, key=_ORDER.__getitem__)
                sums[bucket] += value
                per_label.append({"label": label, "value": value, "bucket": bucket, "combos": mapped.get(key, [])})
            blocks.append({
                "series_id": sid,
                "category": category,
                "feature": feature,
                "unit": meta["unit"],
                "population": meta["population"],
                "region": meta["region"],
                "reference_period": periods[(sid, category)],
                "table_total_percent": total,
                "buckets_percent": {b: round(v, 4) for b, v in sums.items()},
                "labels": per_label,
                "surface_overlap": "unknown: no joint app/web distribution; a label counts once, by its best status",
            })
    return {
        "world_installed_device_share": None,
        "world_installed_device_share_reason": WORLD_SHARE_REASON,
        "blocks": blocks,
    }
