"""Per-clause comparison. Synthetic features only; not the 2026-11-20 market."""

import json
from pathlib import Path

from jp_us_screener.compare import (
    COVERAGE_FULL,
    COVERAGE_HIT_UNION,
    RANK_MODE_REFERENCE,
    RANK_MODE_UNAVAILABLE,
    Candidate,
    ReferenceMember,
    compare_scan,
    public_document,
)
from jp_us_screener.models import Feature
from tests.support import security


def feature(**overrides) -> Feature:
    payload = dict(
        index=250,
        date="2026-11-20",
        open=10,
        high=11,
        low=9,
        close=10,
        volume=200_000,
        plus_di14=40,
        minus_di14=10,
        adx14=30,
        roc3=12,
        roc20=25,
        roc90=25,
        sma3_volume=400_000,
        sma20_volume=400_000,
        sma50_volume=100_000,
        sma200_close=8,
        sma200_close_lag20=7,
        ulcer10=4,
        bb_upper=11,
        bb_lower=9,
        bb_width=4,
        bb_width_min63=4,
        kc_upper=12,
        kc_lower=8,
        prev25_max_plus_di=20,
        prev25_min_plus_di=15,
        low_is_min20=True,
        turtle_prior_low=True,
        yday_min20_low=9.9,
    )
    payload.update(overrides)
    return Feature(**payload)


def test_confirmed_roc_failure_names_threshold_and_value():
    report = compare_scan(
        scan_id="pullback",
        session_date="2026-11-20",
        candidates=[Candidate(security(symbol="WING", market_cap_as_of="2026-11-20"), feature(roc20=10.5, plus_di14=35))],
        reference=[ReferenceMember("WING", "Wingstop Inc.", "NASD", "Consumer Discretionary", "Restaurants & Bars", 78.9, "mid")],
        rank_mode=RANK_MODE_REFERENCE,
        candidate_coverage=COVERAGE_HIT_UNION,
    )
    row = report["rows"][0]
    assert row["membership"] == "missing"
    assert row["decision"] == "confirmed_failed_condition"
    failed = {item["id"]: item for item in row["confirmed_failed"]}
    assert failed["pb-roc20"]["status"] == "fail"
    assert "10.5" in failed["pb-roc20"]["detail"]
    assert "20" in failed["pb-roc20"]["detail"]
    assert row["reference_sctr"] == 78.9
    assert report["rank_mode_label"] == "診斷用參考 SCTR，不是本地族群排名"
    published = public_document({**report, "close": 151.53, "volume": 674604})
    assert "close" not in published
    assert "volume" not in published


def test_missing_market_cap_is_indeterminate_not_a_proven_fail():
    report = compare_scan(
        scan_id="squeeze",
        session_date="2026-11-20",
        candidates=[
            Candidate(
                security(symbol="ALRM", market_cap=None, market_cap_currency="", market_cap_as_of=""),
                feature(plus_di14=10, minus_di14=10),
            )
        ],
        reference=[ReferenceMember("ALRM", universe="mid", sctr=40)],
        rank_mode=RANK_MODE_REFERENCE,
        candidate_coverage=COVERAGE_HIT_UNION,
    )
    row = report["rows"][0]
    assert row["decision"] == "indeterminate"
    assert row["membership"] == "indeterminate"
    assert row["confirmed_failed"] == []
    codes = {item["code"] for item in row["unresolved"]}
    assert "missing_market_cap" in codes


def test_market_cap_from_another_date_stays_unresolved():
    report = compare_scan(
        scan_id="weak",
        session_date="2026-11-20",
        candidates=[
            Candidate(
                security(symbol="AFRM", cohort="mid", market_cap=50_000_000_000, market_cap_as_of="2026-11-21"),
                feature(adx14=10, plus_di14=5, prev25_min_plus_di=12, volume=200_000),
            )
        ],
        reference=[ReferenceMember("AFRM", sctr=10, universe="mid")],
        rank_mode=RANK_MODE_REFERENCE,
        candidate_coverage=COVERAGE_FULL,
    )
    row = report["rows"][0]
    codes = {item["code"] for item in row["unresolved"]}
    assert "market_cap_as_of_not_session" in codes
    assert row["decision"] != "engine_pass"
    assert not any(item["id"] == "wk-cap" and item["status"] == "fail" for item in row["confirmed_failed"])


def test_non_usd_cap_is_not_converted():
    report = compare_scan(
        scan_id="squeeze",
        session_date="2026-11-20",
        candidates=[
            Candidate(
                security(
                    symbol="7203",
                    market="JP",
                    currency="JPY",
                    market_cap=2_000_000_000_000,
                    market_cap_currency="JPY",
                    market_cap_as_of="2026-11-20",
                ),
                feature(close=3000, plus_di14=10, minus_di14=10),
            )
        ],
        reference=[ReferenceMember("7203")],
        rank_mode=RANK_MODE_UNAVAILABLE,
        candidate_coverage=COVERAGE_FULL,
    )
    row = report["rows"][0]
    assert row["decision"] == "indeterminate"
    assert row["unresolved"][0]["code"] == "blocked_needs_jp_parameters"
    assert row["confirmed_failed"] == []


def test_ungrouped_or_is_exposed_when_the_two_readings_disagree():
    report = compare_scan(
        scan_id="adx",
        session_date="2026-11-20",
        candidates=[
            Candidate(
                security(symbol="BIG", cohort="large", market_cap_as_of="2026-11-20"),
                feature(roc90=1, plus_di14=40, prev25_max_plus_di=20, volume=200_000),
            )
        ],
        reference=[ReferenceMember("BIG", sctr=80, universe="lrg")],
        rank_mode=RANK_MODE_REFERENCE,
        candidate_coverage=COVERAGE_FULL,
    )
    row = report["rows"][0]
    assert row["grouping_causal"] is True
    assert row["engine_outcome"] == "no_match"
    assert row["alternate_outcome"] == "match"
    assert row["membership"] == "indeterminate"
    assert any(item["id"] == "adx-roc90" for item in row["confirmed_failed"])


def test_zero_reference_is_not_validated_by_an_empty_hit_sample():
    report = compare_scan(
        scan_id="adx",
        session_date="2026-11-20",
        candidates=[Candidate(security(symbol="WING", market_cap_as_of="2026-11-20"), feature())],
        reference=[],
        rank_mode=RANK_MODE_REFERENCE,
        candidate_coverage=COVERAGE_HIT_UNION,
    )
    assert report["counts"]["reference"] == 0
    assert report["zero_reference_validated"] is False
    assert report["full_market_extra_computed"] is False
    assert any("沒有基準代號" in item for item in report["blockers"])
    assert report["rows"][0]["membership"] == "indeterminate"


def test_full_market_zero_can_be_validated():
    report = compare_scan(
        scan_id="squeeze",
        session_date="2026-11-20",
        candidates=[],
        reference=[],
        rank_mode=RANK_MODE_UNAVAILABLE,
        candidate_coverage=COVERAGE_FULL,
    )
    assert report["zero_reference_validated"] is True
    assert report["full_market_missing_computed"] is True


def test_missing_security_type_is_not_a_confirmed_failure():
    report = compare_scan(
        scan_id="pullback",
        session_date="2026-11-20",
        candidates=[
            Candidate(
                security(symbol="WING", market_cap_as_of="2026-11-20", security_type="unresolved"),
                feature(roc20=25, plus_di14=35),
                withhold={"pb-type": ("security_type_not_in_export", "結果表沒有類型欄")},
            )
        ],
        reference=[ReferenceMember("WING", sctr=78.9, universe="mid")],
        rank_mode=RANK_MODE_REFERENCE,
        candidate_coverage=COVERAGE_HIT_UNION,
    )
    row = report["rows"][0]
    assert row["decision"] != "engine_pass"
    assert row["confirmed_failed"] == []
    assert row["block_kind"] == "classification_unresolved"
    assert any(item["code"] == "security_type_not_in_export" for item in row["unresolved"])


def test_small_universe_fails_large_or_mid_gate():
    report = compare_scan(
        scan_id="pullback",
        session_date="2026-11-20",
        candidates=[Candidate(security(symbol="AMSC", cohort="small", market_cap_as_of="2026-11-20"), feature(roc20=30, plus_di14=40))],
        reference=[ReferenceMember("AMSC", sctr=80, universe="sml")],
        rank_mode=RANK_MODE_REFERENCE,
        candidate_coverage=COVERAGE_FULL,
    )
    row = report["rows"][0]
    assert row["decision"] == "confirmed_failed_condition"
    assert any(item["id"] == "pb-gate" or item["code"] == "not_in_cohort" or "族群" in item["label"] for item in row["confirmed_failed"])


def test_null_target_close_is_not_a_failed_scan():
    report = compare_scan(
        scan_id="turtle",
        session_date="2026-11-20",
        candidates=[
            Candidate(
                security(symbol="SNDK"),
                input_block={
                    "id": "target-close-null",
                    "label": "目標日調整收市是空的",
                    "code": "target_close_null",
                    "detail": "沒有用其他收市價填入",
                },
            )
        ],
        reference=[ReferenceMember("SNDK", sctr=0.3, universe="lrg")],
        rank_mode=RANK_MODE_REFERENCE,
        candidate_coverage=COVERAGE_HIT_UNION,
    )
    row = report["rows"][0]
    assert row["membership"] == "indeterminate"
    assert row["confirmed_failed"] == []
    assert row["unresolved"][0]["code"] == "target_close_null"
    assert "79.240" not in json.dumps(row)


def test_hit_sample_is_not_called_a_local_sctr():
    report = compare_scan(
        scan_id="young",
        session_date="2026-11-20",
        candidates=[Candidate(security(symbol="TU", cohort="large", market_cap_as_of="2026-11-20"), feature(roc3=12))],
        reference=[ReferenceMember("TU", sctr=90, universe="large")],
        rank_mode=RANK_MODE_UNAVAILABLE,
        candidate_coverage=COVERAGE_HIT_UNION,
    )
    row = report["rows"][0]
    assert row["decision"] == "indeterminate"
    assert any(item["code"] == "unmet_dependency" or item["status"] == "unavailable" for item in row["unresolved"])
    assert report["rank_mode"] == RANK_MODE_UNAVAILABLE
    assert "完整 SCTR" in " ".join(report["blockers"])


def test_six_routes_stay_sparse_and_market_scoped():
    page = Path("web/src/ScanResults.tsx").read_text(encoding="utf-8")
    app = Path("web/src/App.tsx").read_text(encoding="utf-8")
    for route in ("adx", "pullback", "squeeze", "turtle", "weak", "young"):
        assert f'id: "{route}"' in page
    assert '|| "pullback"' in app
    assert "ScanResults" in app
    assert "日股" in page and "美股" in page
    assert "港股" not in page and "澳股" not in page
    assert "比較詳情" in page
    assert "尚未產生日股結果" in page
    assert ">代號</button>" in page
    assert ">名稱</button>" in page
    assert ">成交量</button>" in page
    assert ">SCTR</button>" in page
    assert "in_reference" in page
