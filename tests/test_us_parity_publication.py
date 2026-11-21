"""The published 2026-11-20 comparison is derived. It is not a price archive."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "web" / "public" / "comparison" / "2026-11-20.json"

BANNED_KEYS = {
    "open",
    "high",
    "low",
    "close",
    "volume",
    "adj_close",
    "adj_open",
    "adj_high",
    "adj_low",
    "name",
    "exchange",
    "sector",
    "industry",
    "last",
}


def _load():
    return json.loads(PATH.read_text(encoding="utf-8"))


def _walk(node):
    if isinstance(node, dict):
        for key, value in node.items():
            assert key not in BANNED_KEYS
            _walk(value)
    elif isinstance(node, list):
        if len(node) > 40 and node and all(isinstance(item, (int, float)) for item in node):
            raise AssertionError("numeric history published")
        for item in node:
            _walk(item)


def test_published_comparison_records_the_revised_history_and_no_prices():
    document = _load()
    version = document["data_version"]
    assert version["package"] == "cloud-input-us-parity-2026-11-20"
    assert version["symbols"] == 170
    assert version["bars"] == 202950
    assert version["warmup_at_least_200"] == 165
    assert version["bars_1291"] == 149
    assert version["target_close_null"] == ["SNDK"]
    assert version["close_compared"] == 173
    text = PATH.read_text(encoding="utf-8")
    assert "79.240" not in text
    assert "Wingstop" not in text
    _walk(document)

    scans = {item["scan_id"]: item for item in document["scans"]}
    assert scans["adx"]["counts"]["reference"] == 0
    assert scans["adx"]["zero_reference_validated"] is False
    assert scans["adx"]["full_market_extra_computed"] is False
    assert scans["adx"]["alternate_only_within_sample"] == 67
    assert scans["pullback"]["counts"]["reference"] == 30
    assert scans["pullback"]["reference_indicator_passed"] == 30
    assert scans["pullback"]["counts"]["engine_pass"] == 0
    assert scans["pullback"]["alternate_only_within_sample"] == 8
    assert scans["squeeze"]["counts"]["reference"] == 2
    assert scans["squeeze"]["reference_indicator_passed"] == 2
    assert scans["turtle"]["counts"]["reference"] == 129
    assert scans["turtle"]["reference_indicator_passed"] == 128
    assert scans["weak"]["counts"]["reference"] == 9
    assert scans["weak"]["reference_indicator_passed"] == 9
    assert scans["young"]["counts"]["reference"] == 4
    assert scans["young"]["counts"]["overlap"] == 4
    assert scans["young"]["counts"]["engine_pass"] == 4
    assert scans["young"]["rank_mode"] == "reference_sctr"

    turtle = {row["symbol"]: row for row in scans["turtle"]["rows"]}
    assert turtle["SNDK"]["indicator_status"] == "blocked_input"
    assert turtle["SNDK"]["confirmed_failed"] == []
    assert turtle["SNDK"]["unresolved"][0]["code"] == "target_close_null"
    for symbol in ("OCTV", "SHAZ", "SKHU", "SKHY", "SUNB"):
        assert turtle[symbol]["bar_count"] < 200
        assert turtle[symbol]["indicator_status"] == "passed"
        assert turtle[symbol]["confirmed_failed"] == []
    for symbol in ("GSOL", "XRPZ", "ZCSH", "SKHU"):
        assert turtle[symbol]["name_observation"]
        assert turtle[symbol]["indicator_status"] == "passed"
