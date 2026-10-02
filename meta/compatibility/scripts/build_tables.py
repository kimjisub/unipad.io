"""Derives `sources/tables.csv` and `data/series_mapping.csv` from the stored raw snapshots.

Reads only `sources/raw/` and `sources/facts/`; nothing is fetched. A source file is used only while its SHA-256
equals the one stored in `sources/series.jsonl`, so a changed snapshot stops the rebuild instead of flowing into
the tables. The tables a series yields, their period and their label count are declared in `sources/series.jsonl`;
a rebuild that does not give exactly those tables, each equal to its own source file, is refused (`rules.table_problems`).

Usage (from meta/compatibility):
  python3 scripts/build_tables.py                      rewrite the two derived files from the raw snapshots
  python3 scripts/build_tables.py --accept-raw ID ...  after fetching a source again: store the new hash of
                                                       the named series' raw file (nothing else is touched)

Each table keeps its own series and category. A label is mapped to the support combinations
(`data/combos.csv`) that cover it, or to nothing when the label cannot be tied to a combination.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from compat import MAPPING_FIELDS, ROOT, TABLE_FIELDS, read_csv, read_jsonl, sha256_of, write_csv
from rules import table_problems
from source_tables import read_facts, read_statcounter, source_hash_problems


# --- label -> combination rules -------------------------------------------------

ANDROID_API = {"17.0": 37, "16.0": 36, "15.0": 35, "14.0": 34, "13.0": 33, "12.0": 31, "11.0": 30, "10.0": 29,
               "9.0 Pie": 28, "8.1 Oreo": 27, "8.0 Oreo": 26, "7.1 Nougat": 25, "7.0 Nougat": 24,
               "6.0 Marshmallow": 23, "5.1 Lollipop": 22, "5.0 Lollipop": 21, "4.4 KitKat": 19, "4.3 Jelly Bean": 18,
               "4.2 Jelly Bean": 17, "4.1 Jelly Bean": 16, "4.0 Ice Cream Sandwich": 15}


def android_combo(label: str, cat: str) -> str | None:
    api = ANDROID_API.get(label)
    if api is None:
        return None  # "Other" and labels that name no Android release ("25.8", "11.1") cannot be tied to an API level
    group = "LE22" if api <= 22 else "23" if api == 23 else "24-28" if api <= 28 else "29-34" if api <= 34 else str(api)
    return f"AND-{cat}-{group}"


def ios_combo(label: str, cat: str) -> str | None:
    m = re.fullmatch(r"iOS (\d+)(?:\.\d+)?", label)
    if not m:
        return None
    major = int(m.group(1))
    group = "LE16" if major <= 16 else str(major) if major in (17, 18, 26, 27) else None
    return f"IOS-{cat}-{group}" if group else None


def desktop_os_combos(label: str) -> list[str]:
    if label == "Windows":
        return ["WEB-DT-WIN"]
    if label in ("macOS", "OS X", "OSX"):
        # The iOS project also lists a Mac build for macOS 26.2 and later, but these labels carry no macOS
        # version, so that combination is not tied to them.
        return ["WEB-DT-MAC"]
    if label == "Linux":
        return ["WEB-DT-LINUX"]
    return []


def browser_combos(label: str, device: str) -> list[str]:
    """Family-level mapping; a family is only mapped where its rendering engine is known."""
    if device == "DT":
        # Edge, Opera and Brave share the Chromium engine but are separate products, so they stay unmapped.
        return {"Chrome": ["WEB-DT-CHROME"], "Firefox": ["WEB-DT-FIREFOX"], "Safari": ["WEB-DT-SAFARI"]}.get(label, [])
    return {"Chrome": [f"WEB-{device}-CHROME"], "Safari": [f"WEB-{device}-SAFARI"],
            "Samsung Internet": [f"WEB-{device}-SAMSUNG"], "Firefox": [f"WEB-{device}-FIREFOX"]}.get(label, [])


def apple_combos(label: str, device_key: str) -> list[str]:
    major = re.sub(r"\D", "", label.split()[-1]) if label != "Earlier" else "EARLIER"
    return [f"IOS-{device_key}-{major}"]


# --- raw snapshots -> rows --------------------------------------------------------

def raw_problems(root: Path = ROOT) -> list[str]:
    """Source files whose content no longer matches the hash stored when they were made."""
    return source_hash_problems(root, read_jsonl(root / "sources" / "series.jsonl"))


def build_from_raw(root: Path = ROOT) -> tuple[list[dict], list[dict]]:
    """The normalized table rows and the label mapping, computed from the source files alone."""
    tables: list[dict] = []
    mapping: list[dict] = []
    series = {s["series_id"]: s for s in read_jsonl(root / "sources" / "series.jsonl")}

    def add(series_id: str, category: str, values: dict[str, float], combos_for) -> None:
        meta = series[series_id]
        for label, value in values.items():
            tables.append({"series_id": series_id, "category": category, "label": label, "value": str(value),
                           "unit": meta["table_unit"], "reference_period": meta["table_period"]})
            targets = combos_for(label)
            if not targets:
                mapping.append({"series_id": series_id, "category": category, "label": label, "combo_id": "",
                                "note": "not tied to a support combination"})
            for combo in targets:
                mapping.append({"series_id": series_id, "category": category, "label": label, "combo_id": combo, "note": ""})

    def statcounter(series_id: str) -> dict[str, float]:
        return read_statcounter(root / "sources" / series[series_id]["raw_file"], series[series_id]["table_month"])

    for device, key in (("mobile", "PH"), ("tablet", "TB")):
        sid = f"statcounter_android_version_{device}_ww"
        add(sid, "android_version", statcounter(sid), lambda label, key=key: [c] if (c := android_combo(label, key)) else [])
    for device, key in (("mobile", "PH"), ("tablet", "PAD")):
        sid = f"statcounter_ios_version_{device}_ww"
        add(sid, "ios_version", statcounter(sid), lambda label, key=key: [c] if (c := ios_combo(label, key)) else [])
    add("statcounter_os_desktop_ww", "desktop_os", statcounter("statcounter_os_desktop_ww"), desktop_os_combos)
    for device, key in (("desktop", "DT"), ("mobile", "PH"), ("tablet", "TB")):
        sid = f"statcounter_browser_{device}_ww"
        add(sid, "browser", statcounter(sid), lambda label, key=key: browser_combos(label, key))

    apple = "apple_ios_ipados_usage_2026_06_07"
    for category, values in read_facts(root / "sources" / series[apple]["facts_file"]).items():
        device_key = "PH" if category.startswith("iphone") else "PAD"
        add(apple, category, values, lambda label, device_key=device_key: apple_combos(label, device_key))
    steam = "steam_hwsurvey_os_2026_08"
    for category, values in read_facts(root / "sources" / series[steam]["facts_file"]).items():
        add(steam, category, values, desktop_os_combos)
    return tables, mapping


def derived_problems(root: Path = ROOT) -> list[str]:
    """Differences between the stored derived files and what the source files give now."""
    problems = raw_problems(root)
    if problems:
        return problems
    tables, mapping = build_from_raw(root)
    problems = table_problems(root, read_jsonl(root / "sources" / "series.jsonl"), tables, mapping)
    if problems:
        return [f"rebuild: {p}" for p in problems]
    stored_tables = read_csv(root / "sources" / "tables.csv")
    stored_mapping = read_csv(root / "data" / "series_mapping.csv")
    if [{f: r.get(f, "") for f in TABLE_FIELDS} for r in stored_tables] != tables or (stored_tables and tuple(stored_tables[0]) != TABLE_FIELDS):
        problems.append("sources/tables.csv differs from the tables rebuilt from the source files")
    if [{f: r.get(f, "") for f in MAPPING_FIELDS} for r in stored_mapping] != mapping or (stored_mapping and tuple(stored_mapping[0]) != MAPPING_FIELDS):
        problems.append("data/series_mapping.csv differs from the mapping rebuilt from the source files")
    return problems


def accept_raw(series_ids: list[str], root: Path = ROOT) -> int:
    """Stores the current hash of the named series' raw files. The only place a stored hash changes."""
    path = root / "sources" / "series.jsonl"
    series = read_jsonl(path)
    known = {s["series_id"] for s in series if s.get("raw_file")}
    unknown = [sid for sid in series_ids if sid not in known]
    if unknown or not series_ids:
        print("unknown series or no raw file: " + ", ".join(unknown or ["(none given)"]))
        return 2
    for s in series:
        if s["series_id"] in series_ids:
            new = sha256_of(root / "sources" / s["raw_file"])
            print(f"{s['series_id']}: {s.get('raw_sha256')} -> {new}")
            s["raw_sha256"] = new
    path.write_text("".join(json.dumps(s, ensure_ascii=False) + "\n" for s in series), encoding="utf-8")
    print("hash stored; also update fetched_utc (and the period, if it changed) in sources/series.jsonl by hand")
    return 0


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--accept-raw":
        return accept_raw(argv[1:])
    if argv:
        print(__doc__)
        return 2
    problems = raw_problems()
    if problems:
        print("\n".join(problems))
        print("not rebuilt: a raw snapshot changed. If it was fetched again on purpose, run --accept-raw <series_id> first.")
        return 1
    tables, mapping = build_from_raw()
    problems = table_problems(ROOT, read_jsonl(ROOT / "sources" / "series.jsonl"), tables, mapping)
    if problems:
        print("\n".join(problems))
        print("not rebuilt: the rebuilt tables are not the tables the series records declare, each equal to its own source file.")
        return 1
    write_csv(ROOT / "sources" / "tables.csv", TABLE_FIELDS, tables)
    write_csv(ROOT / "data" / "series_mapping.csv", MAPPING_FIELDS, mapping)
    print(f"tables.csv: {len(tables)} rows, series_mapping.csv: {len(mapping)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
