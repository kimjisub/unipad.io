"""Checks that unverified rows, weak evidence, duplicate combinations, unrelated denominators and edited
snapshots cannot leak into the "works" numbers. Run from meta/compatibility: python3 -m unittest discover -s scripts

Three groups: the stored data as it is, single rules on in-memory copies, and tampering with a copy of the
whole directory followed by the documented commands.
"""
from __future__ import annotations

import copy
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from build_tables import derived_problems
from compat import BUCKETS, FEATURES, ROOT, compute_coverage, load_all, read_csv, read_jsonl, row_bucket, split_ids, write_csv
from compute_coverage import problems_of, render_summary
from rules import block_problems, is_passing_run, table_problems, validate
from source_tables import declared_tables, read_statcounter_cells

SERIES = "statcounter_android_version_mobile_ww"


def fake_data() -> dict:
    """A tiny self-contained data set so the counting rules are tested apart from the real numbers."""
    base = load_all()
    data = copy.deepcopy(base)
    data["combos"] = [c for c in base["combos"] if c["combo_id"] in ("AND-PH-35", "AND-PH-29-34")]
    data["matrix"] = [r for r in base["matrix"] if r["combo_id"] in ("AND-PH-35", "AND-PH-29-34")]
    data["series"] = [s for s in base["series"] if s["series_id"] == SERIES]
    data["tables"] = [
        {"series_id": SERIES, "category": "android_version", "label": label, "value": value, "unit": "%", "reference_period": "test"}
        for label, value in (("15.0", "40.0"), ("14.0", "30.0"), ("Other", "30.0"))
    ]
    data["mapping"] = [
        {"series_id": SERIES, "category": "android_version", "label": "15.0", "combo_id": "AND-PH-35", "note": ""},
        {"series_id": SERIES, "category": "android_version", "label": "14.0", "combo_id": "AND-PH-29-34", "note": ""},
        {"series_id": SERIES, "category": "android_version", "label": "Other", "combo_id": "", "note": ""},
    ]
    return data


def find(data: dict, row_id: str) -> dict:
    return next(r for r in data["matrix"] if r["row_id"] == row_id)


def evidence_of(data: dict, evidence_id: str) -> dict:
    return next(e for e in data["evidence"] if e["evidence_id"] == evidence_id)


def block(cov: dict, feature: str) -> dict:
    return next(b for b in cov["blocks"] if b["feature"] == feature)


def verified_share(buckets: dict) -> float:
    return sum(v for k, v in buckets.items() if k.startswith("verified_"))


class StoredDataTest(unittest.TestCase):
    def test_stored_data_breaks_no_rule(self) -> None:
        data = load_all()
        problems, coverage = problems_of(data)
        self.assertEqual(problems, [])
        self.assertIsNotNone(coverage)

    def test_every_combo_has_a_row_for_every_feature(self) -> None:
        data = load_all()
        for combo in data["combos"]:
            features = {r["feature"] for r in data["matrix"] if r["combo_id"] == combo["combo_id"]}
            self.assertEqual(features, set(FEATURES), combo["combo_id"])

    def test_no_world_device_share_is_claimed(self) -> None:
        cov = compute_coverage(load_all())
        self.assertIsNone(cov["world_installed_device_share"])
        self.assertTrue(cov["world_installed_device_share_reason"])
        for b in cov["blocks"]:
            self.assertNotIn("world", " ".join(k for k in b if k != "population"))

    def test_each_block_is_one_table_of_one_series(self) -> None:
        data = load_all()
        cov = compute_coverage(data)
        tables = {(t["series_id"], t["category"]) for t in data["tables"]}
        self.assertEqual(len(cov["blocks"]), len(tables) * len(FEATURES))
        for b in cov["blocks"]:
            rows = [t for t in data["tables"] if (t["series_id"], t["category"]) == (b["series_id"], b["category"])]
            self.assertAlmostEqual(b["table_total_percent"], sum(float(t["value"]) for t in rows), places=4)
            self.assertEqual(set(b["buckets_percent"]), set(BUCKETS))
            self.assertAlmostEqual(sum(b["buckets_percent"].values()), b["table_total_percent"], places=2)

    def test_a_physical_share_needs_a_physical_run(self) -> None:
        data = load_all()
        physical = {r["combo_id"] for r in data["matrix"] if r["verification_status"] == "verified_run" and r["device_reality"] == "physical"}
        for b in compute_coverage(data)["blocks"]:
            combos = {c for label in b["labels"] for c in label["combos"]}
            if not combos & physical:
                self.assertEqual(b["buckets_percent"]["verified_physical"], 0.0)

    def test_a_monthly_value_shows_its_month_and_the_full_population(self) -> None:
        data = load_all()
        cov = compute_coverage(data)
        summary = render_summary(cov, data)
        for b in cov["blocks"]:
            if b["series_id"].startswith("statcounter_"):
                self.assertIn("2026-08-01 to 2026-08-31", b["reference_period"])
                self.assertNotIn("2025-08", b["reference_period"])
            self.assertIn(f"- Population: {b['population']}\n", summary)
        self.assertIn("not a census of devices or of people", summary)


class CountingRuleTest(unittest.TestCase):
    def test_only_verified_runs_are_counted(self) -> None:
        row = find(fake_data(), "AND-PH-35:led")
        for status in ("partial_run", "viewport_only", "source_only", "unverified", "failed"):
            self.assertFalse(row_bucket(dict(row, verification_status=status)).startswith("verified_"), status)
        self.assertEqual(row_bucket(dict(row, in_sold_app="yes")), "verified_emulated_sold")
        self.assertEqual(row_bucket(dict(row, in_sold_app="no")), "verified_emulated_unsold")
        self.assertEqual(row_bucket(dict(row, in_sold_app="unknown")), "verified_emulated_unsold")
        self.assertEqual(row_bucket(dict(row, device_reality="physical")), "verified_physical")

    def test_unverified_rows_do_not_raise_the_verified_share(self) -> None:
        data = fake_data()
        for r in data["matrix"]:
            if r["feature"] == "led":
                r["verification_status"], r["device_reality"], r["evidence_ids"] = "unverified", "none", "none"
        self.assertEqual(verified_share(block(compute_coverage(data), "led")["buckets_percent"]), 0.0)

    def test_unmapped_label_is_not_counted_as_supported(self) -> None:
        self.assertEqual(block(compute_coverage(fake_data()), "open_pack")["buckets_percent"]["unmapped_label"], 30.0)

    def test_same_label_through_app_and_web_counts_once(self) -> None:
        data = fake_data()
        for feature in FEATURES:
            data["matrix"].append(dict(find(data, f"AND-PH-35:{feature}"), combo_id="WEB-X", row_id=f"WEB-X:{feature}",
                                       verification_status="unverified", device_reality="none"))
        data["mapping"].append({"series_id": SERIES, "category": "android_version", "label": "15.0", "combo_id": "WEB-X", "note": ""})
        buckets = block(compute_coverage(data), "led")["buckets_percent"]
        self.assertAlmostEqual(sum(buckets.values()), 100.0, places=2)
        self.assertEqual(verified_share(buckets), 40.0, "the best status wins; the label is not added twice")


class DenominatorRuleTest(unittest.TestCase):
    def test_a_block_holding_two_denominators_is_rejected(self) -> None:
        data = load_all()
        cov = compute_coverage(data)
        keep, merged = [], {}
        for b in cov["blocks"]:
            if b["series_id"] == "steam_hwsurvey_os_2026_08":
                merged[b["feature"]] = b
            else:
                keep.append(b)
        for b in keep:
            if b["series_id"] == "statcounter_os_desktop_ww":
                other = merged[b["feature"]]
                b["labels"] += [dict(label, label=label["label"] + "|steam") for label in other["labels"]]
                b["table_total_percent"] = round(b["table_total_percent"] + other["table_total_percent"], 4)
                b["buckets_percent"] = {k: round(v + other["buckets_percent"][k], 4) for k, v in b["buckets_percent"].items()}
        problems = block_problems(data, dict(cov, blocks=keep))
        self.assertTrue(any("blocks, expected" in p for p in problems))
        self.assertTrue(any("differs from the table's own total" in p for p in problems))
        self.assertTrue(any("another denominator mixed in" in p for p in problems))

    def test_a_missing_or_duplicated_feature_block_is_rejected(self) -> None:
        data = load_all()
        cov = compute_coverage(data)
        self.assertTrue(block_problems(data, dict(cov, blocks=cov["blocks"][1:])))
        self.assertTrue(any("duplicate block" in p for p in block_problems(data, dict(cov, blocks=cov["blocks"] + cov["blocks"][:1]))))

    def test_a_table_with_two_periods_is_rejected(self) -> None:
        data = load_all()
        data["tables"][0] = dict(data["tables"][0], reference_period="2025-08 to 2026-09")
        self.assertTrue(any("more than one period" in p for p in block_problems(data, compute_coverage(data))))

    def test_a_claimed_world_share_is_rejected(self) -> None:
        data = load_all()
        cov = dict(compute_coverage(data), world_installed_device_share=90.0)
        self.assertTrue(any("world device share" in p for p in block_problems(data, cov)))


class EvidenceRuleTest(unittest.TestCase):
    """A `verified_run` stands only on a passing run of that feature, on that device class and OS or browser."""

    def assert_rejected(self, data: dict, row_id: str, fragment: str) -> None:
        problems = [p for p in validate(data) if p.startswith(row_id)]
        self.assertTrue(any(fragment in p for p in problems), f"{row_id}: expected '{fragment}' in {problems}")

    def claim_run(self, row_id: str, evidence_id: str, reality: str) -> dict:
        data = load_all()
        find(data, row_id).update(verification_status="verified_run", device_reality=reality, evidence_ids=evidence_id)
        return data

    def test_blocked_run_cannot_verify(self) -> None:
        self.assert_rejected(self.claim_run("IOS-PH-17:install", "EV-I17-9532e26d-0925-blocked", "simulator"), "IOS-PH-17:install", "needs a passing run")

    def test_failed_run_cannot_verify(self) -> None:
        self.assert_rejected(self.claim_run("AND-PH-36:led", "EV-A35-8f66f8fb-0926", "emulator"), "AND-PH-36:led", "needs a passing run")

    def test_source_reading_cannot_verify(self) -> None:
        self.assert_rejected(self.claim_run("AND-PH-29-34:sound", "SRC-AND-GRADLE", "emulator"), "AND-PH-29-34:sound", "needs a passing run")

    def test_a_run_on_another_os_version_cannot_verify(self) -> None:
        self.assert_rejected(self.claim_run("AND-PH-36:open_pack", "EV-A35-9f4173ac-0925", "emulator"), "AND-PH-36:open_pack", "needs a passing run")

    def test_a_run_with_no_recorded_os_cannot_verify(self) -> None:
        self.assert_rejected(self.claim_run("AND-PH-35:sound", "EV-AND-ceb82bd6-0924", "emulator"), "AND-PH-35:sound", "needs a passing run")

    def test_a_phone_run_cannot_verify_a_tablet(self) -> None:
        self.assert_rejected(self.claim_run("AND-TB-35:open_pack", "EV-A35-9f4173ac-0925", "emulator"), "AND-TB-35:open_pack", "needs a passing run")

    def test_a_feature_the_run_did_not_pass_cannot_be_verified(self) -> None:
        self.assert_rejected(self.claim_run("AND-PH-35:external_connect", "EV-A35-9f4173ac-0925", "emulator"), "AND-PH-35:external_connect", "needs a passing run")

    def test_a_sideloaded_build_is_not_a_store_install(self) -> None:
        for row_id, evidence_id, reality in (("AND-PH-35:install", "EV-A35-9f4173ac-0925", "emulator"),
                                             ("IOS-PH-26:install", "EV-I263-9532e26d-0925", "simulator")):
            self.assert_rejected(self.claim_run(row_id, evidence_id, reality), row_id, "needs a passing run")

    def test_headless_chromium_is_not_chrome_or_an_operating_system(self) -> None:
        for row_id in ("WEB-DT-CHROME:sound", "WEB-DT-MAC:sound", "WEB-DT-WIN:sound"):
            self.assert_rejected(self.claim_run(row_id, "EV-WEB-20260930-desktop-1280x800", "browser"), row_id, "needs a passing run")

    def test_mocked_width_cannot_stand_in_for_a_tablet(self) -> None:
        data = load_all()
        find(data, "WEB-TB-CHROME:sound").update(device_reality="browser")
        self.assert_rejected(data, "WEB-TB-CHROME:sound", "viewport_only needs a cited run")
        self.assert_rejected(self.claim_run("WEB-TB-CHROME:sound", "EV-WEB-20260930-tablet-1024x768", "browser"), "WEB-TB-CHROME:sound", "needs a passing run")

    def test_relabelling_the_evidence_does_not_help(self) -> None:
        # Calling the mocked-width run a real tablet in the evidence table contradicts the stored results file.
        data = self.claim_run("WEB-TB-CHROME:sound", "EV-WEB-20260930-tablet-1024x768", "browser")
        evidence_of(data, "EV-WEB-20260930-tablet-1024x768").update(run_target="browser", browser="chrome", os_family="android")
        self.assertTrue(any("tablet-width profile is viewport/tablet" in p for p in validate(data)))
        # Calling an emulator record a physical phone contradicts the device-record index.
        data = load_all()
        evidence_of(data, "EV-A35-9f4173ac-0925")["run_target"] = "physical"
        self.assertTrue(any("device kind or result differs from the index" in p for p in validate(data)))
        # A failed record cannot be relabelled as passed either.
        data = load_all()
        evidence_of(data, "EV-A35-8f66f8fb-0926").update(result="pass", features_passed="led")
        self.assertTrue(any("device kind or result differs from the index" in p for p in validate(data)))

    def test_a_browser_result_cannot_claim_more_than_it_recorded(self) -> None:
        data = load_all()
        evidence_of(data, "EV-WEB-20260930-desktop-1280x800")["features_passed"] = "open_pack;sound;led;rotation"
        self.assertTrue(any("not in the recorded result" in p for p in validate(data)))

    def test_device_kind_comes_from_the_evidence(self) -> None:
        data = load_all()
        find(data, "AND-PH-35:led")["device_reality"] = "physical"
        self.assert_rejected(data, "AND-PH-35:led", "is not what the evidence ran on")

    def test_sold_build_flag_comes_from_the_evidence(self) -> None:
        data = load_all()
        find(data, "AND-PH-35:rotation")["in_sold_app"] = "yes"
        self.assert_rejected(data, "AND-PH-35:rotation", "in_sold_app should be no")
        data = load_all()
        evidence_of(data, "EV-A35-81d4c0c2-0928")["in_sold_app"] = "yes"
        self.assertTrue(any("does not follow from commit and tree state" in p for p in validate(data)))

    def test_a_later_failure_blocks_a_verified_run(self) -> None:
        data = load_all()
        failure = evidence_of(data, "EV-A35-8f66f8fb-0926")
        failure.update(features_failed="led", recorded_utc="2026-09-29T00:00:00Z")
        self.assert_rejected(data, "AND-PH-35:led", "failed led after the last passing run")

    def test_a_recorded_failure_cannot_be_dropped(self) -> None:
        data = load_all()
        for row in data["matrix"]:
            row["evidence_ids"] = ";".join(i for i in row["evidence_ids"].split(";") if i != "EV-A35-efbd9d5c-0923") or "none"
        self.assertTrue(any("a failed run must be cited" in p for p in validate(data)))
        data = load_all()
        next(e for e in data["index"] if e["record_id"] == "a11a6324/20260928T081655Z" and e["result"] == "fail")["linked_evidence_ids"] = ""
        self.assertTrue(any("a failed record must be linked" in p for p in validate(data)))

    def test_all_four_failed_records_are_linked_and_cited(self) -> None:
        data = load_all()
        failed = [e for e in data["index"] if e["result"] == "fail"]
        self.assertEqual(len(failed), 4)
        cited = {i for row in data["matrix"] for i in row["evidence_ids"].split(";")}
        for entry in failed:
            self.assertIn(entry["linked_evidence_ids"], cited)
            self.assertEqual(evidence_of(data, entry["linked_evidence_ids"])["result"], "fail")


class TableRuleTest(unittest.TestCase):
    def test_mapping_a_label_twice_to_the_same_combo_is_rejected(self) -> None:
        data = load_all()
        data["mapping"].append(dict(data["mapping"][0]))
        self.assertTrue(any("duplicate" in p for p in validate(data)))

    def test_duplicate_combo_feature_rows_are_rejected(self) -> None:
        data = load_all()
        data["matrix"].append(dict(data["matrix"][0], row_id="clone"))
        self.assertTrue(any("duplicate (combo, feature)" in p for p in validate(data)))

    def test_unrun_row_without_todo_is_rejected(self) -> None:
        data = load_all()
        next(r for r in data["matrix"] if r["verification_status"] == "unverified")["remaining_limits"] = "nothing to add"
        self.assertTrue(any("needs a TODO" in p for p in validate(data)))

    def test_every_row_states_what_was_confirmed(self) -> None:
        data = load_all()
        data["matrix"][0]["confirmed_scope"] = ""
        self.assertTrue(any("empty field confirmed_scope" in p for p in validate(data)))

    def test_verified_run_without_evidence_is_rejected(self) -> None:
        data = load_all()
        next(r for r in data["matrix"] if r["verification_status"] == "verified_run")["evidence_ids"] = "none"
        self.assertTrue(any("without evidence" in p for p in validate(data)))

    def test_unknown_evidence_id_is_rejected(self) -> None:
        data = load_all()
        data["matrix"][0]["evidence_ids"] = "EV-DOES-NOT-EXIST"
        self.assertTrue(any("unknown evidence" in p for p in validate(data)))


def merged_tables(data: dict, source: str, target: str, suffix: str) -> dict:
    """Rows of table `source` moved into table `target`, as code that adds two denominators would leave them."""
    data = copy.deepcopy(data)
    destination = next(t for t in data["tables"] if t["series_id"] == target)
    for rows in (data["tables"], data["mapping"]):
        for r in rows:
            if r["series_id"] == source:
                r.update(series_id=target, category=destination["category"], label=r["label"] + suffix)
                if "reference_period" in r:
                    r.update(reference_period=destination["reference_period"], unit=destination["unit"])
    return data


def table_rule_problems(data: dict) -> list[str]:
    return table_problems(ROOT, data["series"], data["tables"], data["mapping"])


class TableContractTest(unittest.TestCase):
    """A table is exactly one source file of one series, whatever code built tables.csv."""

    def test_stored_tables_are_the_declared_ones(self) -> None:
        data = load_all()
        self.assertEqual(table_rule_problems(data), [])
        self.assertEqual(len(declared_tables(data["series"])), 13)
        self.assertEqual({(s, c) for s, c, _ in declared_tables(data["series"])}, {(t["series_id"], t["category"]) for t in data["tables"]})

    def test_labels_are_the_header_of_one_raw_file(self) -> None:
        data = load_all()
        for series in data["series"]:
            if not series.get("raw_file") or not series.get("tables"):
                continue
            header = read_statcounter_cells(ROOT / "sources" / series["raw_file"], series["table_month"])
            labels = [t["label"] for t in data["tables"] if t["series_id"] == series["series_id"]]
            self.assertEqual(labels, list(header), series["series_id"])

    def test_each_table_adds_to_100_within_the_rounding_of_its_source(self) -> None:
        data = load_all()
        series = {s["series_id"]: s for s in data["series"]}
        for sid, category, count in declared_tables(data["series"]):
            values = [float(t["value"]) for t in data["tables"] if (t["series_id"], t["category"]) == (sid, category)]
            bound = count * 0.5 * 10 ** -series[sid]["value_decimals"]
            self.assertEqual(len(values), count)
            self.assertLessEqual(abs(sum(values) - 100.0), bound + 1e-9, f"{sid}/{category}")

    def test_mobile_and_tablet_browser_tables_cannot_be_added(self) -> None:
        data = merged_tables(load_all(), "statcounter_browser_tablet_ww", "statcounter_browser_mobile_ww", " [tablet]")
        problems = table_rule_problems(data)
        self.assertTrue(any("statcounter_browser_mobile_ww/browser: rows differ from the one source file" in p for p in problems), problems)
        self.assertTrue(any("statcounter_browser_mobile_ww/browser: values add to 20" in p for p in problems), problems)
        self.assertTrue(any("statcounter_browser_tablet_ww/browser: declared in series.jsonl but missing" in p for p in problems), problems)

    def test_steam_and_statcounter_desktop_tables_cannot_be_added(self) -> None:
        data = merged_tables(load_all(), "steam_hwsurvey_os_2026_08", "statcounter_os_desktop_ww", " [steam]")
        problems = table_rule_problems(data)
        self.assertTrue(any("statcounter_os_desktop_ww/desktop_os: values add to 19" in p for p in problems), problems)
        self.assertTrue(any("steam_hwsurvey_os_2026_08/desktop_os: declared in series.jsonl but missing" in p for p in problems), problems)
        self.assertTrue(any("statcounter_os_desktop_ww/desktop_os: rows differ from the one source file" in p for p in problems), problems)
        self.assertTrue(any("statcounter_os_desktop_ww/desktop_os: period or unit differs" in p for p in table_rule_problems(
            dict(data, tables=[dict(t, reference_period="merged") if t["series_id"] == "statcounter_os_desktop_ww" else t for t in data["tables"]]))))

    def test_a_table_that_no_series_declares_is_rejected(self) -> None:
        data = load_all()
        data["tables"] += [dict(t, series_id="invented_series") for t in data["tables"] if t["series_id"] == "steam_hwsurvey_os_2026_08"]
        self.assertTrue(any("invented_series/desktop_os: not declared in series.jsonl" in p for p in table_rule_problems(data)))

    def test_the_declared_label_count_and_values_come_from_the_source(self) -> None:
        data = load_all()
        for s in data["series"]:
            if s["series_id"] == SERIES:
                s["tables"][0]["labels"] += 1
        self.assertTrue(any("series.jsonl declares 22" in p for p in table_rule_problems(data)))
        data = load_all()
        next(t for t in data["tables"] if t["series_id"] == SERIES and t["label"] == "15.0")["value"] = "17.5"
        self.assertTrue(any(f"{SERIES}/android_version: rows differ from the one source file" in p for p in table_rule_problems(data)))

    def test_the_block_count_follows_the_declared_tables(self) -> None:
        data = load_all()
        cov = compute_coverage(data)
        data["series"] = [dict(s, tables=[]) if s["series_id"] == "steam_hwsurvey_os_2026_08" else s for s in data["series"]]
        self.assertTrue(any("expected 12 tables declared in series.jsonl" in p for p in block_problems(data, cov)))


class BasisRuleTest(unittest.TestCase):
    """Runs must agree with what their source record confirms, not only with the hand-written tables."""

    def problems_with(self, data: dict) -> list[str]:
        return validate(data)

    def assert_rejected(self, data: dict, fragment: str) -> None:
        problems = self.problems_with(data)
        self.assertTrue(any(fragment in p for p in problems), f"expected {fragment!r} in {problems}")

    def test_every_run_has_a_basis_line_with_its_record_lines(self) -> None:
        data = load_all()
        runs = {e["evidence_id"] for e in data["evidence"] if e["kind"] in ("device_run", "web_run")}
        self.assertEqual({b["evidence_id"] for b in data["basis"]}, runs)
        for b in data["basis"]:
            self.assertRegex(b["source_sha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(b["source_lines"])

    def test_a_browser_run_names_its_profile(self) -> None:
        data = load_all()
        evidence_of(data, "EV-WEB-20260930-tablet-1024x768")["record_id"] = "evidence/web-2026-09-30/results.json"
        self.assert_rejected(data, "names a results file and one profile")

    def test_headless_chromium_is_not_named_chrome(self) -> None:
        data = load_all()
        evidence_of(data, "EV-WEB-20260930-desktop-1280x800")["browser"] = "chrome"
        self.assert_rejected(data, "the results file recorded 'Chromium 153.0.8010.12 headless")

    def test_the_host_system_comes_from_the_results_file(self) -> None:
        data = load_all()
        evidence_of(data, "EV-WEB-20260930-desktop-1280x800")["os_family"] = "windows"
        self.assert_rejected(data, "results file recorded host platform 'darwin'")

    def test_a_mocked_width_with_a_real_tablet_browser_is_rejected(self) -> None:
        data = load_all()
        evidence_of(data, "EV-WEB-20260930-tablet-1024x768").update(run_target="browser", browser="chrome", os_family="android")
        self.assert_rejected(data, "tablet-width profile is viewport/tablet")
        self.assert_rejected(data, "the results file recorded 'Chromium")

    def test_a_device_class_the_record_does_not_state_cannot_be_written_in(self) -> None:
        data = load_all()
        evidence_of(data, "EV-A35-9f4173ac-0925")["form_factor"] = "phone"
        self.assert_rejected(data, "form_factor 'phone' is not what the source record confirms ('unknown'; L1;L2;L16;L21;L63 of device-log:9f4173ac/20260925T053540Z)")
        self.assert_rejected(data, "device class 'phone', but the index line of 9f4173ac/20260925T053540Z says 'unknown'")

    def test_other_os_version_device_class_or_features_than_the_record_are_rejected(self) -> None:
        data = load_all()
        evidence_of(data, "EV-A35-81d4c0c2-0928")["os_version"] = "36"
        self.assert_rejected(data, "os_version '36' is not what the source record confirms ('35'")
        self.assert_rejected(data, "OS version '36', but the index line of 81d4c0c2/20260928T050633Z says 'Android 15 (API 35)'")
        data = load_all()
        evidence_of(data, "EV-A35-81d4c0c2-0928")["form_factor"] = "tablet"
        self.assert_rejected(data, "form_factor 'tablet' is not what the source record confirms ('phone'")
        data = load_all()
        evidence_of(data, "EV-I27-347a6e7b-0927")["features_passed"] = "install;open_pack;rotation;sound"
        self.assert_rejected(data, "features ['sound'] passed, but the source record confirms only")
        self.assert_rejected(data, "features ['sound'] passed, but the index line of 347a6e7b/20260927T065145Z does not list them")

    def test_editing_the_index_together_with_the_evidence_still_contradicts_the_record(self) -> None:
        data = load_all()
        evidence_of(data, "EV-A35-81d4c0c2-0928")["form_factor"] = "tablet"
        for entry in data["index"]:
            if entry["record_id"].startswith("81d4c0c2/"):
                entry["form_factor"] = "tablet"
        self.assert_rejected(data, "form_factor 'tablet' is not what the source record confirms ('phone'")

    def test_a_pack_put_on_the_device_is_not_an_import(self) -> None:
        data = load_all()
        for eid in ("EV-A35-9f4173ac-0925", "EV-A35-81d4c0c2-0928", "EV-I27-3829863e-0928"):
            passed = evidence_of(data, eid)
            passed["features_passed"] = passed["features_passed"] + ";open_pack"
            self.assert_rejected(data, f"{eid}: open_pack passed, but the source record shows the pack")

    def test_the_screenshot_count_is_the_one_in_the_record(self) -> None:
        data = load_all()
        evidence_of(data, "EV-I27-3829863e-0928")["captures"] = "34 screenshots, kept elsewhere"
        self.assert_rejected(data, "EV-I27-3829863e-0928: 34 screenshots, but the source record says 74")

    def test_a_run_without_screenshots_carries_no_verified_row(self) -> None:
        data = load_all()
        run = evidence_of(data, "EV-A35-81d4c0c2-0928")
        self.assertTrue(is_passing_run(run, "led"))
        self.assertFalse(is_passing_run(dict(run, captures="no screenshots were saved"), "led"))
        failed_to_save = evidence_of(data, "EV-A35-5a6e45ad-0925")
        self.assertEqual((failed_to_save["result"], failed_to_save["features_failed"]), ("pass", "none"))
        self.assertTrue(failed_to_save["captures"].startswith("no screenshots were saved"))
        self.assertFalse(any(e["evidence_id"] == "EV-A35-5a6e45ad-0925" for row in data["matrix"] if row["verification_status"] == "failed"
                             for e in [evidence_of(data, i) for i in split_ids(row["evidence_ids"])]))

    def test_an_edited_results_file_no_longer_matches_its_stored_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "compatibility"
            shutil.copytree(ROOT, root, ignore=shutil.ignore_patterns("__pycache__"))
            results = root / "evidence/web-2026-09-30/results.json"
            results.write_text(results.read_text(encoding="utf-8").replace("Chromium 153.0.8010.12 headless", "Google Chrome 153.0.8010.12"), encoding="utf-8")
            data = load_all(root)
            evidence_of(data, "EV-WEB-20260930-desktop-1280x800")["browser"] = "chrome"
            self.assertTrue(any("results file differs from the one whose hash evidence_basis.csv stored" in p for p in validate(data)))


class RemainingEvidenceRuleTest(unittest.TestCase):
    """Source-evidence gaps and review regressions, independently of other validation errors."""

    def row_problems(self, data: dict, row_id: str) -> list[str]:
        from rules import _row_problems
        return _row_problems(find(data, row_id), {c["combo_id"]: c for c in data["combos"]},
                             {e["evidence_id"]: e for e in data["evidence"]}, data["evidence"])

    def test_device_log_browser_cannot_be_renamed_chrome(self) -> None:
        for eid in ("EV-WEB-08ce5205-0928", "EV-WEB-a11a6324-0928", "EV-WEB-a11a6324-0928-fail"):
            with self.subTest(evidence=eid):
                data = load_all()
                evidence_of(data, eid)["browser"] = "chrome"
                self.assertTrue(any(f"{eid}: browser 'chrome' is not what the source record confirms" in p
                                    for p in validate(data)))

    def test_partial_phone_or_tablet_row_needs_a_known_matching_class(self) -> None:
        for cid in ("AND-PH-35", "AND-TB-35"):
            for form in ("unknown", "desktop", "tablet" if cid == "AND-PH-35" else "phone"):
                with self.subTest(combo=cid, form=form):
                    data = load_all()
                    eid = "EV-A35-81d4c0c2-0928"
                    evidence_of(data, eid)["form_factor"] = form
                    find(data, cid + ":open_pack").update(verification_status="partial_run", device_reality="emulator",
                                                       evidence_ids=eid, in_sold_app="no")
                    self.assertTrue(self.row_problems(data, cid + ":open_pack"))

    def test_partial_app_row_needs_matching_os_and_version(self) -> None:
        for changes in ({"os_family": "unknown"}, {"os_version": "36"}, {"os_version": ""}):
            with self.subTest(changes=changes):
                data = load_all()
                evidence_of(data, "EV-A35-81d4c0c2-0928").update(changes)
                self.assertTrue(self.row_problems(data, "AND-PH-35:open_pack"))

    def test_unknown_class_cannot_supply_partial_sold_build_flag(self) -> None:
        data = load_all()
        row = find(data, "AND-PH-35:open_pack")
        row.update(evidence_ids="EV-A35-81d4c0c2-0928;EV-A35-9f4173ac-0925", in_sold_app="yes")
        self.assertTrue(any("in_sold_app does not follow" in p for p in self.row_problems(data, row["row_id"])))
        row["in_sold_app"] = "no"
        self.assertEqual(self.row_problems(data, row["row_id"]), [])

    def test_unverified_row_cannot_claim_a_sold_run(self) -> None:
        data = load_all()
        find(data, "AND-PH-35:install").update(verification_status="unverified", device_reality="none", in_sold_app="yes")
        self.assertTrue(any("in_sold_app requires matching run evidence" in p
                            for p in self.row_problems(data, "AND-PH-35:install")))

    def test_partial_mac_row_needs_recorded_mac_host(self) -> None:
        data = load_all()
        find(data, "WEB-DT-MAC:external_connect").update(verification_status="partial_run", device_reality="browser",
                                                        in_sold_app="no")
        self.assertTrue(self.row_problems(data, "WEB-DT-MAC:external_connect"))

    def test_viewport_row_needs_matching_recorded_profile_class(self) -> None:
        for row_id in ("WEB-PH-CHROME:open_pack", "WEB-TB-CHROME:open_pack"):
            with self.subTest(row=row_id):
                data = load_all()
                for eid in split_ids(find(data, row_id)["evidence_ids"]):
                    evidence_of(data, eid)["form_factor"] = "unknown"
                self.assertTrue(self.row_problems(data, row_id))

    def test_known_chromium_and_viewport_limits_remain_partial(self) -> None:
        data = load_all()
        for row_id in ("WEB-DT-CHROME:open_pack", "WEB-DT-MAC:open_pack", "WEB-PH-CHROME:open_pack",
                       "WEB-TB-CHROME:open_pack"):
            with self.subTest(row=row_id):
                self.assertEqual(self.row_problems(data, row_id), [])
                self.assertFalse(row_bucket(find(data, row_id)).startswith("verified_"))

    def test_store_install_promotion_needs_source_install_method(self) -> None:
        data = load_all()
        run = evidence_of(data, "EV-I263-9532e26d-0925")
        run["install_method"] = "store"
        find(data, "IOS-PH-26:install").update(verification_status="verified_run", evidence_ids=run["evidence_id"],
                                                device_reality="simulator", in_sold_app=run["in_sold_app"])
        problems, coverage = problems_of(data)
        self.assertTrue(any("install_method 'store' is not what the source record confirms ('sideload'" in p for p in problems), problems)
        self.assertIsNone(coverage)

    def test_install_method_cannot_be_invented_for_any_run_kind(self) -> None:
        for eid in ("EV-I263-9532e26d-0925", "EV-WEB-a11a6324-0928-fail", "EV-WEB-20260930-desktop-1280x800"):
            with self.subTest(evidence=eid):
                data = load_all()
                evidence_of(data, eid)["install_method"] = "store"
                self.assertTrue(any(f"{eid}: install_method 'store' is not what the source record confirms" in p
                                    for p in validate(data)))

    def test_desktop_failure_cannot_mark_an_ipad_as_failed(self) -> None:
        data = load_all()
        find(data, "IOS-PAD-26:external_connect").update(verification_status="failed", device_reality="browser",
                                                       evidence_ids="EV-WEB-a11a6324-0928-fail", in_sold_app="no")
        problems, coverage = problems_of(data)
        self.assertTrue(any("IOS-PAD-26:external_connect: failed needs a cited failed run" in p for p in problems), problems)
        self.assertIsNone(coverage)

    def test_failed_app_row_needs_matching_device_os_version_and_target(self) -> None:
        variants = ({"form_factor": "unknown"}, {"form_factor": "tablet"}, {"os_family": "ipados"},
                    {"os_version": "27"}, {"os_version": ""}, {"run_target": "unknown"},
                    {"run_target": "viewport"}, {"result": "pass"}, {"kind": "source_read"},
                    {"features_failed": "sound"})
        for changes in variants:
            with self.subTest(changes=changes):
                data = load_all()
                run = evidence_of(data, "EV-I263-9532e26d-0925")
                run.update(result="fail", features_passed="none", features_failed="external_connect")
                row = find(data, "IOS-PH-26:external_connect")
                row.update(verification_status="failed", device_reality="simulator", evidence_ids=run["evidence_id"],
                           in_sold_app="yes")
                self.assertEqual(self.row_problems(data, row["row_id"]), [])
                run.update(changes)
                self.assertTrue(self.row_problems(data, row["row_id"]))

    def test_failed_web_row_needs_named_browser_and_host_os(self) -> None:
        for cid in ("WEB-DT-CHROME", "WEB-DT-MAC"):
            variants = ({"form_factor": "phone"}, {"form_factor": "unknown"}, {"browser": "unknown"}) + (
                ({"browser": "firefox"}, {"browser": "chromium_headless"}) if cid == "WEB-DT-CHROME"
                else ({"os_family": "windows"}, {"os_family": "unknown"}))
            for changes in variants:
                with self.subTest(combo=cid, changes=changes):
                    data = load_all()
                    run = evidence_of(data, "EV-WEB-a11a6324-0928-fail")
                    run.update(browser="chrome", os_family="macos")
                    row = find(data, cid + ":external_connect")
                    row.update(verification_status="failed", device_reality="browser", evidence_ids=run["evidence_id"],
                               in_sold_app="no")
                    # Name the browser to isolate the host-OS rule; an any-browser row is not settled by one run.
                    next(c for c in data["combos"] if c["combo_id"] == cid)["browser"] = "chrome"
                    self.assertEqual(self.row_problems(data, row["row_id"]), [])
                    run.update(changes)
                    self.assertTrue(self.row_problems(data, row["row_id"]))

    def test_one_browser_failure_cannot_settle_an_any_browser_row(self) -> None:
        data = load_all()
        run = evidence_of(data, "EV-WEB-a11a6324-0928-fail")
        run.update(browser="chrome", os_family="macos")
        row = find(data, "WEB-DT-MAC:external_connect")
        row.update(verification_status="failed", device_reality="browser", evidence_ids=run["evidence_id"],
                   in_sold_app="no")
        self.assertTrue(self.row_problems(data, row["row_id"]))

    def test_failed_row_target_and_sold_flag_follow_matching_failure(self) -> None:
        data = load_all()
        run = evidence_of(data, "EV-I263-9532e26d-0925")
        run.update(result="fail", features_passed="none", features_failed="external_connect")
        row = find(data, "IOS-PH-26:external_connect")
        row.update(verification_status="failed", device_reality="simulator", evidence_ids=run["evidence_id"],
                   in_sold_app="yes")
        self.assertEqual(self.row_problems(data, row["row_id"]), [])
        for changes in ({"device_reality": "browser"}, {"in_sold_app": "no"}):
            with self.subTest(changes=changes):
                original = dict(row)
                row.update(changes)
                self.assertTrue(self.row_problems(data, row["row_id"]))
                row.update(original)


class CorrectedStateTest(unittest.TestCase):
    def test_android_open_pack_is_partial_and_says_the_import_was_not_seen(self) -> None:
        data = load_all()
        row = find(data, "AND-PH-35:open_pack")
        self.assertEqual(row["verification_status"], "partial_run")
        self.assertIn("Importing the pack through the app was not seen", row["confirmed_scope"])
        self.assertIn("TODO: import a pack through the app's own import path", row["remaining_limits"])
        self.assertEqual(row_bucket(row), "partly_run")

    def test_unknown_device_and_host_rows_are_unverified(self) -> None:
        data = load_all()
        for row_id in ("AND-PH-35:install", "AND-PH-35:sound", "WEB-DT-MAC:external_connect"):
            with self.subTest(row=row_id):
                row = find(data, row_id)
                self.assertEqual((row["verification_status"], row["device_reality"], row["in_sold_app"]),
                                 ("unverified", "none", "unknown"))
        self.assertEqual(find(data, "AND-PH-35:open_pack")["in_sold_app"], "no")

    def test_no_verified_open_pack_rests_on_a_pack_put_there_beforehand(self) -> None:
        data = load_all()
        basis = {b["evidence_id"]: b for b in data["basis"]}
        from rules import qualifying_evidence
        combos = {c["combo_id"]: c for c in data["combos"]}
        for row in data["matrix"]:
            if row["verification_status"] == "verified_run" and row["feature"] == "open_pack":
                for e in qualifying_evidence(row, combos[row["combo_id"]], {e["evidence_id"]: e for e in data["evidence"]}):
                    self.assertEqual(basis[e["evidence_id"]]["pack_entry"], "app", row["row_id"])

    def test_a_verified_device_row_rests_on_a_stated_device_class(self) -> None:
        data = load_all()
        from rules import qualifying_evidence
        combos = {c["combo_id"]: c for c in data["combos"]}
        for row in data["matrix"]:
            if row["verification_status"] == "verified_run":
                for e in qualifying_evidence(row, combos[row["combo_id"]], {e["evidence_id"]: e for e in data["evidence"]}):
                    self.assertIn(e["form_factor"], ("phone", "tablet", "desktop"), row["row_id"])
        self.assertEqual(find(data, "AND-PH-35:led")["in_sold_app"], "no")

    def test_the_ios_record_with_the_grid_over_the_home_indicator_is_not_a_safe_area_pass(self) -> None:
        data = load_all()
        for text in (find(data, "IOS-PH-27:rotation")["confirmed_scope"], evidence_of(data, "EV-I27-3829863e-0928")["scope"]):
            self.assertIn("not a safe-area pass", text)
            self.assertNotIn("pads, menu button and logo inside the safe area", text)
            self.assertNotIn("pad grid, menu button and logo measured inside the safe area", text)
        self.assertIn("L57", next(b for b in data["basis"] if b["evidence_id"] == "EV-I27-3829863e-0928")["source_lines"])

    def test_the_pack_open_sentence_of_the_small_screen_record_matches_its_record(self) -> None:
        scope = evidence_of(load_all(), "EV-I27-ca9f5907-0929")["scope"]
        self.assertNotIn("does not describe the pack-open step", scope)
        self.assertIn("Pack selection through to the play screen was seen", scope)

    def test_a_major_version_row_is_not_a_check_of_every_minor_version(self) -> None:
        data = load_all()
        summary = render_summary(compute_coverage(data), data)
        self.assertIn("is not a check of the whole major version", summary)
        self.assertEqual(find(data, "IOS-PH-26:open_pack")["verification_status"], "verified_run")


class ReviewEvidenceTest(unittest.TestCase):
    def test_sold_flag_cannot_override_the_device_index(self) -> None:
        data = load_all()
        eid = "EV-A35-81d4c0c2-0928"
        evidence_of(data, eid).update(tree_state="clean", in_release_commit="yes", in_sold_app="yes")
        for row in data["matrix"]:
            if eid in split_ids(row["evidence_ids"]) and row["verification_status"] in {"verified_run", "partial_run"}:
                row["in_sold_app"] = "yes"
        errors, coverage = problems_of(data)
        self.assertTrue(any("index" in p and "sold" in p for p in errors), errors)
        self.assertIsNone(coverage)

    def test_recorded_commit_and_dirty_tree_must_match(self) -> None:
        for field, value, message in (("source_commit", "unipad-ios deadbeef", "commit"),
                                      ("tree_state", "clean", "uncommitted")):
            with self.subTest(field=field):
                data = load_all()
                eid = "EV-I263-9532e26d-0925" if field == "source_commit" else "EV-A35-81d4c0c2-0928"
                evidence_of(data, eid)[field] = value
                self.assertTrue(any("index" in p and message in p for p in validate(data)))

    def test_zero_capture_counts_do_not_carry_verified_rows(self) -> None:
        for count in ("0", "00", "000"):
            with self.subTest(count=count):
                data = load_all()
                eid = "EV-I263-9532e26d-0925"
                evidence_of(data, eid)["captures"] = count + " screenshots"
                next(b for b in data["basis"] if b["evidence_id"] == eid)["captures"] = "0"
                find(data, "IOS-PH-26:open_pack")["evidence_ids"] = eid
                errors, coverage = problems_of(data)
                self.assertTrue(any("verified_run needs a passing run" in p for p in errors), errors)
                self.assertIsNone(coverage)

    def test_capture_check_uses_counts_and_actual_files(self) -> None:
        from rules import has_captures
        for text in ("00 screenshots", "no screenshots", "unknown", "1 screenshotsMissing"):
            with self.subTest(text=text):
                self.assertFalse(has_captures({"kind": "device_run", "captures": text}))
        self.assertTrue(has_captures({"kind": "device_run", "captures": "01 screenshots, saved"}))
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            run = {"kind": "web_run", "captures": "*.png"}
            self.assertFalse(has_captures(run, root))
            (root / "directory.png").mkdir()
            self.assertFalse(has_captures(run, root))
            (root / "capture.png").write_bytes(b"capture")
            self.assertTrue(has_captures(run, root))


class PublicBoundaryTest(unittest.TestCase):
    """What is published here carries no private path, address, tool name or working note."""

    FORBIDDEN = re.compile(r"/Users/|/home/|/private/|/tmp/|\.ts\.net|gstack|hermes|Jisub|production Firebase|production app ID|(?<!com\.)kimjisub|"
                           r"[\w.+-]+@[\w-]+\.(?:com|kr|net|io)\b|[\u3131-\uD7A3]")

    def test_text_files_hold_no_private_reference(self) -> None:
        names = [p for p in ROOT.rglob("*") if p.is_file() and p.suffix in (".csv", ".md", ".jsonl", ".py", ".mjs")
                 and "raw" not in p.relative_to(ROOT).parts and "__pycache__" not in p.parts]
        self.assertTrue(names)
        for path in names:
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if path.name == "test_compat.py" and "FORBIDDEN" in line:
                    continue
                self.assertIsNone(self.FORBIDDEN.search(line), f"{path.relative_to(ROOT)}:{number}")

    def test_withheld_sources_leave_their_facts_and_the_hash_of_the_original(self) -> None:
        data = load_all()
        withheld = [s for s in data["series"] if s.get("raw_withheld")]
        self.assertGreaterEqual(len(withheld), 10)
        for s in withheld:
            self.assertIsNone(s["raw_file"])
            self.assertRegex(s["raw_sha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(s["url"] or s["status"] == "unavailable")
        for name in ("apple_ios_ipados_usage_2026_06_07", "steam_hwsurvey_os_2026_08"):
            s = next(s for s in data["series"] if s["series_id"] == name)
            self.assertTrue((ROOT / "sources" / s["facts_file"]).exists())
        self.assertEqual(sorted(p.name for p in (ROOT / "sources" / "raw").iterdir() if not p.name.startswith("statcounter_")), [])


class TamperingTest(unittest.TestCase):
    """Edits a copy of the whole directory, then runs the documented commands against the copy."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "compatibility"
        shutil.copytree(ROOT, self.root, ignore=shutil.ignore_patterns("__pycache__"))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_script(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, *args], cwd=self.root, capture_output=True, text=True)

    def check(self) -> subprocess.CompletedProcess:
        return self.run_script("scripts/compute_coverage.py", "--check")

    def edit_csv(self, relative: str, edit) -> None:
        path = self.root / relative
        rows = read_csv(path)
        edit(rows)
        write_csv(path, tuple(rows[0].keys()), rows)

    def test_untouched_copy_passes(self) -> None:
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_device_log_chromium_promotion_is_rejected_before_output_write(self) -> None:
        self.edit_csv("data/evidence.csv", lambda rows: next(e for e in rows if e["evidence_id"] == "EV-WEB-08ce5205-0928").update(browser="chrome"))
        self.edit_csv("data/support_matrix.csv", lambda rows: next(r for r in rows if r["row_id"] == "WEB-DT-CHROME:open_pack").update(
            verification_status="verified_run", device_reality="browser", evidence_ids="EV-WEB-08ce5205-0928", in_sold_app="no"))
        before = (self.root / "output/coverage.json").read_bytes()
        for result in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(result.returncode, 1, result.stdout)
            self.assertIn("browser 'chrome' is not what the source record confirms", result.stdout)
        self.assertEqual((self.root / "output/coverage.json").read_bytes(), before)

    def test_sideload_promotion_is_rejected_before_output_write(self) -> None:
        self.edit_csv("data/evidence.csv", lambda rows: next(e for e in rows if e["evidence_id"] == "EV-I263-9532e26d-0925").update(install_method="store"))
        self.edit_csv("data/support_matrix.csv", lambda rows: next(r for r in rows if r["row_id"] == "IOS-PH-26:install").update(
            verification_status="verified_run", device_reality="simulator", evidence_ids="EV-I263-9532e26d-0925", in_sold_app="yes"))
        before = {p.name: p.read_bytes() for p in (self.root / "output").iterdir() if p.is_file()}
        for result in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(result.returncode, 1, result.stdout)
            self.assertIn("install_method 'store' is not what the source record confirms ('sideload'", result.stdout)
        self.assertEqual({p.name: p.read_bytes() for p in (self.root / "output").iterdir() if p.is_file()}, before)

    def test_unrelated_failure_is_rejected_before_output_write(self) -> None:
        self.edit_csv("data/support_matrix.csv", lambda rows: next(r for r in rows if r["row_id"] == "IOS-PAD-26:external_connect").update(
            verification_status="failed", device_reality="browser", evidence_ids="EV-WEB-a11a6324-0928-fail", in_sold_app="no"))
        before = {p.name: p.read_bytes() for p in (self.root / "output").iterdir() if p.is_file()}
        for result in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(result.returncode, 1, result.stdout)
            self.assertIn("IOS-PAD-26:external_connect: failed needs a cited failed run", result.stdout)
        self.assertEqual({p.name: p.read_bytes() for p in (self.root / "output").iterdir() if p.is_file()}, before)

    def test_sold_promotion_is_rejected_before_output_write(self) -> None:
        eid = "EV-A35-81d4c0c2-0928"
        self.edit_csv("data/evidence.csv", lambda rows: next(e for e in rows if e["evidence_id"] == eid).update(
            tree_state="clean", in_release_commit="yes", in_sold_app="yes"))
        self.edit_csv("data/support_matrix.csv", lambda rows: [r.update(in_sold_app="yes") for r in rows
            if eid in split_ids(r["evidence_ids"]) and r["verification_status"] in {"verified_run", "partial_run"}])
        before = {p.name: p.read_bytes() for p in (self.root / "output").iterdir() if p.is_file()}
        for result in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(result.returncode, 1, result.stdout)
            self.assertIn("index", result.stdout)
        self.assertEqual({p.name: p.read_bytes() for p in (self.root / "output").iterdir() if p.is_file()}, before)

    def test_zero_captures_are_rejected_before_output_write(self) -> None:
        eid = "EV-I263-9532e26d-0925"
        self.edit_csv("data/evidence.csv", lambda rows: next(e for e in rows if e["evidence_id"] == eid).update(captures="00 screenshots"))
        self.edit_csv("data/evidence_basis.csv", lambda rows: next(e for e in rows if e["evidence_id"] == eid).update(captures="0"))
        self.edit_csv("data/support_matrix.csv", lambda rows: next(r for r in rows if r["row_id"] == "IOS-PH-26:open_pack").update(evidence_ids=eid))
        before = {p.name: p.read_bytes() for p in (self.root / "output").iterdir() if p.is_file()}
        for result in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(result.returncode, 1, result.stdout)
            self.assertIn("verified_run needs a passing run", result.stdout)
        self.assertEqual({p.name: p.read_bytes() for p in (self.root / "output").iterdir() if p.is_file()}, before)

    def test_unknown_class_cannot_restore_partial_phone_rows(self) -> None:
        for row_id in ("AND-PH-35:install", "AND-PH-35:sound"):
            self.edit_csv("data/support_matrix.csv", lambda rows: next(r for r in rows if r["row_id"] == row_id).update(
                verification_status="partial_run", device_reality="emulator", in_sold_app="yes"))
        for result in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(result.returncode, 1, result.stdout)
            self.assertIn("AND-PH-35:install: partial_run needs a cited run", result.stdout)
            self.assertIn("AND-PH-35:sound: partial_run needs a cited run", result.stdout)

    def test_unknown_class_cannot_restore_partial_phone_sold_flag(self) -> None:
        self.edit_csv("data/support_matrix.csv", lambda rows: next(r for r in rows if r["row_id"] == "AND-PH-35:open_pack").update(in_sold_app="yes"))
        for result in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(result.returncode, 1, result.stdout)
            self.assertIn("AND-PH-35:open_pack: in_sold_app does not follow", result.stdout)

    def test_changed_raw_snapshot_stops_the_rebuild_and_the_check(self) -> None:
        raw = self.root / "sources/raw/statcounter_android_version_mobile_ww.csv"
        raw.write_text(raw.read_text(encoding="utf-8").replace("17.15", "71.15", 1), encoding="utf-8")
        stored = (self.root / "sources/series.jsonl").read_text(encoding="utf-8")
        rebuild = self.run_script("scripts/build_tables.py")
        self.assertEqual(rebuild.returncode, 1, rebuild.stdout)
        self.assertIn("raw file hash differs", rebuild.stdout)
        self.assertEqual((self.root / "sources/series.jsonl").read_text(encoding="utf-8"), stored, "a rebuild never rewrites a hash")
        self.assertNotIn("71.15", (self.root / "sources/tables.csv").read_text(encoding="utf-8"))
        for command in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(command.returncode, 1)
            self.assertIn("raw file hash differs", command.stdout)

    def test_a_refetched_snapshot_is_accepted_only_by_name(self) -> None:
        raw = self.root / "sources/raw/statcounter_android_version_mobile_ww.csv"
        raw.write_text(raw.read_text(encoding="utf-8").replace("17.15", "17.16", 1), encoding="utf-8")
        self.assertEqual(self.run_script("scripts/build_tables.py", "--accept-raw", "no_such_series").returncode, 2)
        self.assertEqual(self.run_script("scripts/build_tables.py", "--accept-raw", SERIES).returncode, 0)
        others = [s for s in read_jsonl(self.root / "sources/series.jsonl") if s["series_id"] != SERIES]
        self.assertEqual(others, [s for s in read_jsonl(ROOT / "sources/series.jsonl") if s["series_id"] != SERIES])
        # The tables are still the old ones, so the check fails until they are rebuilt and recomputed.
        self.assertEqual(self.check().returncode, 1)
        self.assertEqual(self.run_script("scripts/build_tables.py").returncode, 0)
        self.assertEqual(self.run_script("scripts/compute_coverage.py").returncode, 0)
        self.assertEqual(self.check().returncode, 0)

    def test_edited_table_value_is_rejected(self) -> None:
        def edit(rows):
            next(r for r in rows if r["series_id"] == SERIES and r["label"] == "15.0")["value"] = "90.0"
        self.edit_csv("sources/tables.csv", edit)
        for command in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(command.returncode, 1)
            self.assertIn("tables.csv differs", command.stdout)

    def test_edited_browser_mapping_is_rejected(self) -> None:
        def edit(rows):
            next(r for r in rows if r["series_id"] == "statcounter_browser_desktop_ww" and r["label"] == "Edge").update(combo_id="WEB-DT-CHROME", note="")
        self.edit_csv("data/series_mapping.csv", edit)
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("series_mapping.csv differs", result.stdout)

    def test_code_that_merges_two_series_into_one_block_is_rejected(self) -> None:
        path = self.root / "scripts/compat.py"
        text = path.read_text(encoding="utf-8")
        old = '        tables[(t["series_id"], t["category"])][t["label"]] = float(t["value"])\n'
        new = ('        steam = t["series_id"] == "steam_hwsurvey_os_2026_08"\n'
               '        tables[("statcounter_os_desktop_ww" if steam else t["series_id"], t["category"])]'
               '[t["label"] + ("|steam" if steam else "")] = float(t["value"])\n')
        self.assertIn(old, text)
        path.write_text(text.replace(old, new), encoding="utf-8")
        for command in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(command.returncode, 1, command.stdout)
            self.assertIn("differs from the table's own total", command.stdout)


    MERGE_SHIM = """
_unmerged_build_from_raw = build_from_raw
def build_from_raw(root=ROOT):
    tables, mapping = _unmerged_build_from_raw(root)
    target = next(t for t in tables if t["series_id"] == "{target}")
    for rows in (tables, mapping):
        for r in rows:
            if r["series_id"] == "{source}":
                r.update(series_id="{target}", category=target["category"], label=r["label"] + "{suffix}")
                if "reference_period" in r:
                    r.update(reference_period=target["reference_period"], unit=target["unit"])
    return tables, mapping

"""

    def merge_in_build_code(self, source: str, target: str, suffix: str) -> None:
        path = self.root / "scripts/build_tables.py"
        text = path.read_text(encoding="utf-8")
        marker = 'if __name__ == "__main__":'
        path.write_text(text.replace(marker, self.MERGE_SHIM.format(source=source, target=target, suffix=suffix) + marker), encoding="utf-8")

    def assert_every_command_names_the_table_rule(self, fragment: str) -> None:
        stored = (self.root / "sources/tables.csv").read_text(encoding="utf-8")
        rebuild = self.run_script("scripts/build_tables.py")
        self.assertEqual(rebuild.returncode, 1, rebuild.stdout)
        self.assertIn(fragment, rebuild.stdout)
        self.assertIn("not rebuilt", rebuild.stdout)
        self.assertEqual((self.root / "sources/tables.csv").read_text(encoding="utf-8"), stored, "a refused rebuild writes nothing")
        for command in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(command.returncode, 1, command.stdout)
            self.assertIn(fragment, command.stdout)
            self.assertNotIn("Traceback", command.stdout + command.stderr)

    def test_build_code_that_adds_mobile_and_tablet_browsers_is_refused_everywhere(self) -> None:
        self.merge_in_build_code("statcounter_browser_tablet_ww", "statcounter_browser_mobile_ww", " [tablet]")
        self.assert_every_command_names_the_table_rule("statcounter_browser_mobile_ww/browser: rows differ from the one source file")
        self.assertIn("values add to 200", self.run_script("scripts/build_tables.py").stdout)

    def test_build_code_that_adds_steam_to_statcounter_is_refused_everywhere(self) -> None:
        self.merge_in_build_code("steam_hwsurvey_os_2026_08", "statcounter_os_desktop_ww", " [steam]")
        self.assert_every_command_names_the_table_rule("statcounter_os_desktop_ww/desktop_os: rows differ from the one source file")
        self.assertIn("values add to 199.99", self.run_script("scripts/build_tables.py").stdout)

    def test_stored_tables_that_add_two_denominators_are_rejected(self) -> None:
        data = merged_tables(load_all(self.root), "statcounter_browser_tablet_ww", "statcounter_browser_mobile_ww", " [tablet]")
        write_csv(self.root / "sources/tables.csv", tuple(data["tables"][0].keys()), data["tables"])
        write_csv(self.root / "data/series_mapping.csv", tuple(data["mapping"][0].keys()), data["mapping"])
        for command in (self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(command.returncode, 1, command.stdout)
            self.assertIn("statcounter_browser_mobile_ww/browser: rows differ from the one source file", command.stdout)

    def test_an_edited_facts_file_is_rejected_by_its_hash(self) -> None:
        facts = self.root / "sources/facts/steam_hwsurvey_os_2026_08.csv"
        facts.write_text(facts.read_text(encoding="utf-8").replace("93.95", "83.95"), encoding="utf-8")
        for command in (self.run_script("scripts/build_tables.py"), self.run_script("scripts/compute_coverage.py"), self.check()):
            self.assertEqual(command.returncode, 1, command.stdout)
            self.assertIn("facts file hash differs from the stored one", command.stdout)

    def test_stored_data_matches_the_raw_snapshots(self) -> None:
        self.assertEqual(derived_problems(self.root), [])


if __name__ == "__main__":
    unittest.main()
