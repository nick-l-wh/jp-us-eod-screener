"""Build a derived US comparison for 2026-11-20.

Reads a private archive from disk and returns membership plus clause evidence.
The returned document is meant to be passed through public_document before it is
written anywhere that gets published. This module does not fetch data.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from jp_us_screener.compare import (
    COVERAGE_HIT_UNION,
    RANK_MODE_REFERENCE,
    Candidate,
    ReferenceMember,
    compare_scan,
    public_document,
)
from jp_us_screener.features import compute_features
from jp_us_screener.models import Bar, Security
from jp_us_screener.version import EQUAL_ABS_TOL

SESSION = "2026-11-20"
PACKAGE = "cloud-input-us-parity-2026-11-20"

SCAN_FILES = {
    "adx": "ADX-2026-11-20.csv",
    "pullback": "Pullback-2026-11-20.csv",
    "squeeze": "Squeeze-On-2026-11-20.csv",
    "turtle": "Turtle-Soup-Plus-One-buy-2026-11-20.csv",
    "weak": "Weak-ADX-2026-11-20.csv",
    "young": "Young-Trend-2026-11-20.csv",
}

TYPE_DETAIL = "結果表沒有類型欄，不能把 type is stock 判成通過或失敗"
ETF_DETAIL = "結果表沒有 group 欄，不能把 group is not ETF 判成通過或失敗"

WITHHOLD = {
    "adx": {"adx-type": ("security_type_not_in_export", TYPE_DETAIL)},
    "pullback": {"pb-type": ("security_type_not_in_export", TYPE_DETAIL)},
    "squeeze": {"sq-type": ("security_type_not_in_export", TYPE_DETAIL)},
    "turtle": {
        "tu-type": ("security_type_not_in_export", TYPE_DETAIL),
        "tu-etf": ("etf_group_not_in_export", ETF_DETAIL),
    },
    "weak": {"wk-type": ("security_type_not_in_export", TYPE_DETAIL)},
    "young": {},
}

NULL_CLOSE = {
    "id": "target-close-null",
    "label": "目標日調整收市是空的",
    "code": "target_close_null",
    "detail": "2026-11-20 的 Close 與 Adj Close 都是空的。沒有用結果表的收市價填入，也沒有沿用前一日。",
}


def _repair_adjusted_ohlc(
    open_: float, high: float, low: float, close: float
) -> tuple[float, float, float, float] | None:
    """Pull float dust from adj = raw * adj_close / close back inside the bar.

    A gap larger than the engine's absolute tolerance is a real inconsistency.
    """

    def snap(value: float, bound: float) -> float | None:
        if abs(value - bound) <= EQUAL_ABS_TOL:
            return bound
        return None

    if high < low:
        snapped = snap(high, low)
        if snapped is None:
            return None
        high = snapped
    if close > high:
        snapped = snap(close, high)
        if snapped is None:
            return None
        close = snapped
    if close < low:
        snapped = snap(close, low)
        if snapped is None:
            return None
        close = snapped
    if open_ > high:
        snapped = snap(open_, high)
        if snapped is None:
            return None
        open_ = snapped
    if open_ < low:
        snapped = snap(open_, low)
        if snapped is None:
            return None
        open_ = snapped
    return open_, high, low, close


METADATA_CODES = {
    "security_type_not_in_export",
    "etf_group_not_in_export",
    "missing_market_cap",
    "missing_market_cap_currency",
    "market_cap_currency_not_usd",
    "market_cap_as_of_not_session",
}

INPUT_BLOCK_CODES = {
    "target_close_null",
    "interior_null_adjusted_price",
    "adjusted_ohlc_inconsistent",
    "missing_target_bar",
    "missing_feature",
}


def _indicator_status(row: dict[str, Any]) -> str:
    codes = {item.get("code") for item in row["unresolved"]}
    if codes & INPUT_BLOCK_CODES:
        return "blocked_input"
    if row["confirmed_failed"]:
        return "failed"
    if row["decision"] == "engine_pass" or codes <= METADATA_CODES:
        return "passed"
    return "unresolved"


def _blank(value: str | None) -> bool:
    return value is None or value.strip() == "" or value.strip().lower() in {"nan", "none"}


def _number(value: str) -> float | None:
    if _blank(value):
        return None
    return float(value)


def name_observation(name: str) -> str | None:
    text = name.lower()
    if "proshares" in text:
        return "export_name_contains_proshares"
    if "trust" in text:
        return "export_name_contains_trust"
    if "adr" in text:
        return "export_name_contains_adr"
    return None


def _security(symbol: str) -> Security:
    return Security(
        market="US",
        symbol=symbol,
        name="",
        security_type="unresolved",
        listing_segment="",
        exchange="",
        currency="USD",
        cohort="",
        market_cap=None,
        market_cap_currency="",
        market_cap_as_of="",
        group="",
    )


def load_bars(path: Path, symbol: str) -> tuple[list[Bar], dict[str, str] | None]:
    bars: list[Bar] = []
    target_null = False
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["date"] > SESSION:
                continue
            prices = (row["adj_open"], row["adj_high"], row["adj_low"], row["adj_close"])
            if any(_blank(item) for item in prices):
                if row["date"] == SESSION:
                    target_null = True
                    continue
                return [], {
                    "id": "interior-null-price",
                    "label": "歷史裡有空的調整價",
                    "code": "interior_null_adjusted_price",
                    "detail": f"{row['date']} 的調整 OHLC 不齊，這條序列沒有拿來計算",
                }
            open_, high, low, close = (float(item) for item in prices)
            repaired = _repair_adjusted_ohlc(open_, high, low, close)
            if repaired is None:
                return [], {
                    "id": "adjusted-ohlc-inconsistent",
                    "label": "調整後 OHLC 不一致",
                    "code": "adjusted_ohlc_inconsistent",
                    "detail": f"{row['date']} 的調整 OHLC 高低不成立，這條序列沒有拿來計算",
                }
            open_, high, low, close = repaired
            bars.append(
                Bar(
                    "US",
                    symbol,
                    row["date"],
                    open_,
                    high,
                    low,
                    close,
                    float(row["volume"] or 0),
                    "split_and_dividend",
                )
            )
    if target_null:
        return [], NULL_CLOSE
    if not bars or bars[-1].date != SESSION:
        return [], {
            "id": "missing-target-bar",
            "label": "沒有目標日",
            "code": "missing_target_bar",
            "detail": "序列最後一根不是 2026-11-20",
        }
    return bars, None


def _reference_rows(path: Path) -> list[ReferenceMember]:
    members: list[ReferenceMember] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            members.append(
                ReferenceMember(
                    symbol=row["Symbol"].strip(),
                    sctr=_number(row.get("SCTR", "")),
                    universe=(row.get("Universe") or "").strip(),
                )
            )
    return members


def _rank_lookup(metadata_path: Path) -> tuple[dict[str, ReferenceMember], dict[str, str | None]]:
    lookup: dict[str, ReferenceMember] = {}
    observations: dict[str, str | None] = {}
    with metadata_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            symbol = row["symbol"].strip()
            lookup[symbol] = ReferenceMember(
                symbol=symbol,
                sctr=_number(row.get("sctr_as_exported", "")),
                universe=(row.get("universe_cohort_as_exported") or "").strip(),
            )
            observations[symbol] = name_observation(row.get("name_as_exported") or "")
    return lookup, observations


def build_document(root: Path) -> dict[str, Any]:
    price_dir = root / "prices" / "us-full-histories"
    meta_path = root / "metadata" / "us-baseline-symbol-metadata-as-exported.csv"
    rank_lookup, observations = _rank_lookup(meta_path)
    candidates: list[Candidate] = []
    bar_counts: dict[str, int] = {}
    for symbol in sorted(rank_lookup):
        bars, block = load_bars(price_dir / f"{symbol}.csv", symbol)
        bar_counts[symbol] = len(bars)
        if block is not None:
            candidates.append(Candidate(_security(symbol), feature=None, input_block=block, withhold=None))
            continue
        feature = compute_features(bars)[-1]
        candidates.append(
            Candidate(_security(symbol), feature=feature, withhold=None)
        )
    scans = []
    for scan_id, filename in SCAN_FILES.items():
        prepared = []
        for candidate in candidates:
            prepared.append(
                Candidate(
                    candidate.security,
                    candidate.feature,
                    candidate.input_block,
                    WITHHOLD[scan_id] or None,
                )
            )
        report = compare_scan(
            scan_id=scan_id,
            session_date=SESSION,
            candidates=prepared,
            reference=_reference_rows(root / "stockcharts" / "original" / filename),
            rank_mode=RANK_MODE_REFERENCE,
            candidate_coverage=COVERAGE_HIT_UNION,
            rank_lookup=rank_lookup,
        )
        for row in report["rows"]:
            row["name_observation"] = observations.get(row["symbol"])
            row["bar_count"] = bar_counts.get(row["symbol"])
            row["indicator_status"] = _indicator_status(row)
        report["price_basis"] = "股息與分割調整後的開高低收。成交量是未調整股數。沒有把未調整高位和調整收市混用。"
        report["alternate_only_within_sample"] = sum(
            1
            for row in report["rows"]
            if row["grouping_causal"] and row["alternate_outcome"] == "match" and not row["in_reference"]
        )
        report["reference_indicator_passed"] = sum(
            1 for row in report["rows"] if row["in_reference"] and row["indicator_status"] == "passed"
        )
        report["blockers"] = [
            *report["blockers"],
            "結果表沒有股票或 ETF 類型。Young Trend 原文沒有 type is stock。有類型條件的掃描不能因此判成通過。",
            "170 隻是結果短名單，不是 SCTR 排名宇宙。參考 SCTR 只用來隔離其他條件，不是本地族群排名，也不能用短名單的平均去對官方 SCTR。",
        ]
        scans.append(report)
    return {
        "session_date": SESSION,
        "data_version": {
            "package": PACKAGE,
            "created_at_asia_taipei": "2026-11-21 20:36:53",
            "symbols": 170,
            "bars": 202950,
            "warmup_at_least_200": 165,
            "bars_1291": 149,
            "warmup_under_200": ["OCTV", "SHAZ", "SKHU", "SKHY", "SUNB"],
            "target_close_null": ["SNDK"],
            "close_compared": 173,
            "close_uncompared": 1,
            "supersedes": "先前把 170 隻都寫成 1291 根，並把 174 列收市都寫成相差不超過 0.01。",
            "price_basis": "股息與分割調整後的 adj OHLC",
        },
        "scans": scans,
    }


def write_public(root: Path, destination: Path) -> dict[str, Any]:
    document = public_document(build_document(root))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return document
