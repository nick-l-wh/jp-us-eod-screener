import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVIEW_PATH = ROOT / "web" / "src" / "review" / "2026-11-20.json"
APP_PATH = ROOT / "web" / "src" / "App.tsx"
DEMO_PATH = ROOT / "web" / "public" / "demo" / "snapshot.json"

EXPECTED_ROWS = {
    "adx": 0,
    "pullback": 30,
    "squeeze": 2,
    "turtle": 129,
    "weak": 9,
    "young": 4,
}


def _load():
    return json.loads(REVIEW_PATH.read_text(encoding="utf-8"))


def test_review_counts_are_reference_not_engine_output():
    review = _load()
    assert review["title"] == "2026-11-20 資料核對"
    assert review["target_session_date"] == "2026-11-20"
    assert review["reference_label"] == "參考結果，非本引擎計算"
    assert review["engine_computed_scans"] is True
    assert review["indicator_recalculated"] is True
    assert review["scan_parity_claimed"] is False
    assert review["data_version"] == "cloud-input-us-parity-2026-11-20"
    rows = {item["id"]: item["rows"] for item in review["stockcharts_baseline"]["scans"]}
    assert rows == EXPECTED_ROWS
    assert sum(rows.values()) == review["stockcharts_baseline"]["row_sum"] == 174
    assert review["stockcharts_baseline"]["unique_symbols"] == 170
    assert review["stockcharts_baseline"]["conditions_edited"] is False


def test_review_price_note_is_not_a_match_rate():
    review = _load()
    price = review["price_comparison"]
    assert price["reference_rows"] == 174
    assert price["close_compared"] == 173
    assert price["close_abs_diff_at_most_0_01"] == 173
    assert price["close_uncompared_null"] == 1
    assert price["volume_rechecked"] is False
    label = price["label"]
    assert "不是掃描準確率" in label
    assert "走勢一致" in label
    assert "指標對等" in label
    blob = json.dumps(review, ensure_ascii=False)
    for banned in ("掃描準確率為", "命中率", "官方對等", "scan parity", "chart agreement"):
        assert banned not in blob


def test_review_publishes_no_raw_prices_or_exports():
    review = _load()
    assert review["raw_ohlcv_published"] is False
    assert review["account_export_published"] is False
    assert review["redistribution_verified"] is False
    assert review["full_package_published"] is False
    assert review["us"]["probe"]["symbol"] == "AAPL"
    assert review["us"]["probe"]["counted_as_hit"] is False
    assert review["us"]["target_bar_present"] == 170
    assert review["us"]["history_bars"] == 202950
    assert review["us"]["warmup_at_least_200"] == 165
    assert review["us"]["bars_1291"] == 149
    assert review["us"]["target_close_null"] == ["SNDK"]
    assert review["us"]["warmup_under_200"] == ["OCTV", "SHAZ", "SKHU", "SKHY", "SUNB"]
    assert review["jp"]["universe_size"] == 3700
    assert review["jp"]["target_bar_present"] == 3651
    assert review["jp"]["target_bar_missing"] == 49
    assert review["jp"]["ohlc_inconsistent"] == 15
    assert review["jp"]["official_scan_parity"] is False

    def walk(node):
        if isinstance(node, list):
            if node and all(isinstance(item, (int, float)) for item in node):
                raise AssertionError("numeric price series published")
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            for key, value in node.items():
                assert key.lower() not in {"open", "high", "low", "adjclose", "adj_open"}
                walk(value)

    walk(review)
    blob = REVIEW_PATH.read_text(encoding="utf-8")
    assert "market,symbol,date,open" not in blob
    assert ".csv" not in blob
    assert len(blob) < 20_000


def test_results_are_the_landing_and_demo_stays_separate():
    app = APP_PATH.read_text(encoding="utf-8")
    assert '|| "pullback"' in app
    assert "ScanResults" in app
    assert "2026-11-20 資料核對" in app
    assert "篩選工作台" in app
    demo = json.loads(DEMO_PATH.read_text(encoding="utf-8"))
    assert demo["mode"] == "demo"
    assert demo["demo_disclaimer"] == "示範／合成資料，並非實際行情或今日命中"
    assert "參考結果，非本引擎計算" not in json.dumps(demo, ensure_ascii=False)
    assert "2026-11-20 資料核對" not in json.dumps(demo, ensure_ascii=False)
