"""Reads one denominator table straight from its source file, without the label-to-combination rules.

`sources/series.jsonl` names, for every series that feeds a table, the tables it yields (`tables`), the period
and unit those tables carry, and where the numbers come from: a StatCounter CSV under `sources/raw/` (the
row of `table_month`) or a facts file under `sources/facts/` (label and value per category, for sources whose
own page is not kept here). `rules.table_problems` compares the derived `sources/tables.csv` with what this
module reads, so a table cannot be rebuilt from anything but its own series.
"""
from __future__ import annotations

import csv
from pathlib import Path

from compat import read_csv, sha256_of


def read_statcounter_cells(path: Path, month: str) -> dict[str, str]:
    """The published text per header label in the row of `month`."""
    with path.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.reader(fh))
    header = rows[0]
    row = next(r for r in rows[1:] if r[0] == month)
    return {header[i]: row[i] for i in range(1, len(header))}


def read_facts_cells(path: Path) -> dict[str, dict[str, str]]:
    """Category -> label -> published text, in file order."""
    found: dict[str, dict[str, str]] = {}
    for row in read_csv(path):
        found.setdefault(row["category"], {})[row["label"]] = row["value"]
    return found


def read_statcounter(path: Path, month: str) -> dict[str, float]:
    return {label: float(cell) for label, cell in read_statcounter_cells(path, month).items()}


def read_facts(path: Path) -> dict[str, dict[str, float]]:
    return {category: {label: float(cell) for label, cell in cells.items()} for category, cells in read_facts_cells(path).items()}


def declared_tables(series: list[dict]) -> list[tuple[str, str, int]]:
    """(series id, category, label count) for every table the series records declare."""
    return [(s["series_id"], t["category"], t["labels"]) for s in series for t in s.get("tables") or []]


def source_cells(root: Path, series: dict, category: str) -> dict[str, str]:
    """The published text of one declared table, read from the one file its series names."""
    if series.get("facts_file"):
        return read_facts_cells(root / "sources" / series["facts_file"])[category]
    return read_statcounter_cells(root / "sources" / series["raw_file"], series["table_month"])


def decimals(text: str) -> int:
    return len(text.split(".", 1)[1]) if "." in text else 0


def source_hash_problems(root: Path, series: list[dict]) -> list[str]:
    """Source files whose content no longer matches the hash stored when they were made."""
    problems = []
    for s in series:
        for file_key, hash_key, what in (("raw_file", "raw_sha256", "raw file"), ("facts_file", "facts_sha256", "facts file")):
            name = s.get(file_key)
            if not name:
                continue
            path = root / "sources" / name
            if not path.exists():
                problems.append(f"series {s['series_id']}: {what} {name} missing")
            elif s.get(hash_key) != sha256_of(path):
                problems.append(f"series {s['series_id']}: {what} hash differs from the stored one")
    return problems
