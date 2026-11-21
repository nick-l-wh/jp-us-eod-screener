import { Fragment, useEffect, useMemo, useState } from "react";

export const SCAN_ROUTES = [
  { id: "adx", en: "ADX", zh: "ADX" },
  { id: "pullback", en: "Pullback", zh: "回調" },
  { id: "squeeze", en: "Squeeze On", zh: "擠壓開啟" },
  { id: "turtle", en: "Turtle Soup Plus One - buy", zh: "海龜湯加一（買入）" },
  { id: "weak", en: "Weak ADX", zh: "弱 ADX" },
  { id: "young", en: "Young Trend", zh: "初生趨勢" },
] as const;

type Clause = {
  id: string;
  label: string;
  status: string;
  code?: string | null;
  detail?: string | null;
};

type CompareRow = {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  reference_sctr: number | null;
  reference_universe: string;
  in_reference: boolean;
  engine_outcome: string | null;
  decision: string;
  membership: string;
  confirmed_failed: Clause[];
  unresolved: Clause[];
  alternate_outcome: string | null;
  grouping_causal: boolean;
  technical_outcome?: string | null;
  block_kind?: string;
  indicator_status?: string;
  bar_count?: number | null;
  name_observation?: string | null;
  local_close?: string;
  local_volume?: string;
};

export type CompareReport = {
  scan_id: string;
  scan_name: string;
  scan_name_en: string;
  session_date: string;
  rank_mode: string;
  rank_mode_label: string;
  candidate_coverage: string;
  full_market_extra_computed: boolean;
  full_market_missing_computed: boolean;
  zero_reference_validated: boolean;
  grouping_warning: string | null;
  counts: Record<string, number>;
  blockers: string[];
  rows: CompareRow[];
  layout_fixture?: boolean;
  origin?: string;
  price_basis?: string;
  alternate_only_within_sample?: number;
  reference_indicator_passed?: number;
};

const MEMBERSHIP: Record<string, string> = {
  overlap: "重疊",
  missing: "參考有、引擎無",
  extra: "引擎多出",
  within_sample_extra: "樣本內多出",
  indeterminate: "未定",
  outside_reference_not_hit: "樣本內未命中",
  reference_only: "只有參考表",
};

const COLUMNS = [
  ["symbol", "代號"],
  ["name", "名稱"],
  ["exchange", "交易所"],
  ["sector", "板塊"],
  ["industry", "產業"],
  ["reference_sctr", "參考 SCTR"],
  ["reference_universe", "族群"],
  ["membership", "比較"],
  ["decision", "判定"],
] as const;

function asset(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${path.replace(/^\//, "")}`;
}

function formatSession(iso: string): string {
  const [year, month, day] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const index = Number(month) - 1;
  if (!year || !day || index < 0 || index > 11) return iso;
  return `${Number(day)} ${months[index]} ${year}`;
}

function parseReferenceCsv(text: string): CompareRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const header = splitCsv(lines[0]).map((cell) => cell.trim().toLowerCase());
  const index = (name: string) => header.indexOf(name);
  return lines.slice(1).map((line) => {
    const cells = splitCsv(line);
    const pick = (name: string) => {
      const at = index(name);
      return at >= 0 ? cells[at] ?? "" : "";
    };
    const sctr = Number(pick("sctr"));
    return {
      symbol: pick("symbol"),
      name: pick("name"),
      exchange: pick("exchange"),
      sector: pick("sector"),
      industry: pick("industry"),
      reference_sctr: Number.isFinite(sctr) && pick("sctr") !== "" ? sctr : null,
      reference_universe: pick("universe"),
      in_reference: true,
      engine_outcome: null,
      decision: "not_computed",
      membership: "reference_only",
      confirmed_failed: [],
      unresolved: [],
      alternate_outcome: null,
      grouping_causal: false,
      local_close: pick("close"),
      local_volume: pick("volume"),
    };
  }).filter((row) => row.symbol);
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function isReport(value: unknown): value is CompareReport {
  if (!value || typeof value !== "object") return false;
  const row = value as CompareReport;
  return typeof row.scan_id === "string" && Array.isArray(row.rows) && typeof row.session_date === "string";
}

export function ScanResults({ scanId }: { scanId: string }) {
  const [published, setPublished] = useState<CompareReport | null>(null);
  const [publishedState, setPublishedState] = useState<"loading" | "missing" | "ready">("loading");
  const [dataVersion, setDataVersion] = useState<Record<string, unknown> | null>(null);
  const [localReport, setLocalReport] = useState<CompareReport | null>(null);
  const [localRows, setLocalRows] = useState<CompareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(500);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "symbol", dir: "asc" });
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(COLUMNS.map(([key]) => [key, !["name", "exchange", "sector", "industry"].includes(key)])),
  );
  const [showColumns, setShowColumns] = useState(false);
  const [showNonHits, setShowNonHits] = useState(false);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const meta = SCAN_ROUTES.find((item) => item.id === scanId) ?? SCAN_ROUTES[0];

  useEffect(() => {
    const injected = window.sessionStorage.getItem("screener-comparison-json");
    if (injected) {
      try {
        const parsed = JSON.parse(injected) as CompareReport;
        if (isReport(parsed) && parsed.scan_id === scanId) {
          setLocalReport(parsed);
        }
      } catch {
        setError("本機比較 JSON 無法讀取");
      }
    }
    fetch(asset("comparison/2026-11-20.json"))
      .then((response) => {
        if (!response.ok) {
          setPublishedState("missing");
          return null;
        }
        return response.json();
      })
      .then((payload) => {
        if (!payload) return;
        if (payload.data_version) setDataVersion(payload.data_version);
        const scans = Array.isArray(payload.scans) ? payload.scans : null;
        const report = scans
          ? scans.find((item: CompareReport) => item.scan_id === scanId)
          : Array.isArray(payload)
            ? payload.find((item: CompareReport) => item.scan_id === scanId)
            : payload[scanId] ?? payload;
        if (isReport(report) && report.scan_id === scanId) {
          setPublished(report);
          setPublishedState("ready");
          if ((report.counts?.reference ?? 0) === 0) setShowNonHits(true);
        } else {
          setPublishedState("missing");
        }
      })
      .catch(() => setPublishedState("missing"));
  }, [scanId]);

  const report = localReport ?? published;
  const rows = useMemo(() => {
    const source = report?.rows ?? localRows ?? [];
    const localBySymbol = new Map((localRows ?? []).map((row) => [row.symbol, row]));
    const merged = source.map((row) => {
      const local = localBySymbol.get(row.symbol);
      if (!local) return row;
      return {
        ...row,
        name: local.name || row.name,
        exchange: local.exchange || row.exchange,
        sector: local.sector || row.sector,
        industry: local.industry || row.industry,
        local_close: local.local_close,
        local_volume: local.local_volume,
      };
    });
    return merged.filter((row) => showNonHits || row.in_reference || row.membership === "reference_only");
  }, [report, localRows, showNonHits]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? rows.filter((row) =>
          `${row.symbol} ${row.name} ${row.exchange} ${row.sector} ${row.industry} ${row.membership}`.toLowerCase().includes(needle),
        )
      : rows;
    return [...matched].sort((left, right) => compareValues(left, right, sort.key, sort.dir));
  }, [rows, query, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const session = report?.session_date ?? "2026-11-20";
  const referenceCount = report?.counts.reference ?? localRows?.length ?? null;
  const hasTable = visibleRows.length > 0 || (report?.rows.length ?? localRows?.length ?? 0) > 0;
  const showingLocalPrices = (localRows ?? report?.rows ?? []).some((row) => row.local_close || row.local_volume);

  async function onComparisonFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const reportValue = Array.isArray(parsed)
        ? parsed.find((item) => isReport(item) && item.scan_id === scanId)
        : parsed;
      if (!isReport(reportValue) || reportValue.scan_id !== scanId) {
        setError("這份比較檔不是這一頁的掃描");
        return;
      }
      setLocalReport(reportValue);
      setError(null);
      setPage(0);
    } catch {
      setError("比較檔不是 JSON");
    }
  }

  async function onReferenceFile(file: File | undefined) {
    if (!file) return;
    const parsed = parseReferenceCsv(await file.text());
    if (!parsed.length) {
      setError("參考 CSV 沒有代號列");
      return;
    }
    setLocalRows(parsed);
    setVisible((current) => ({ ...current, name: true, exchange: true, sector: true, industry: true }));
    setError(null);
    setPage(0);
  }

  return (
    <div className="app results-app" data-testid="scan-results">
      <header className="top">
        <div>
          <p className="eyebrow">日美收市篩選</p>
          <h1 data-testid="page-title">{meta.en}</h1>
          <p className="quiet">{meta.zh} · 參考結果與引擎結果分開列出</p>
        </div>
        <p className="session-date" data-testid="session-date">{formatSession(session)}</p>
      </header>
      <nav className="scans" aria-label="六條掃描">
        {SCAN_ROUTES.map((item) => (
          <a key={item.id} className={item.id === scanId ? "active" : ""} href={`#/${item.id}`} data-testid={`scan-link-${item.id}`}>
            <span>{item.en}</span>
          </a>
        ))}
      </nav>
      <div className="results-count" data-testid="result-counts">
        <strong>參考 {referenceCount === null ? "—" : referenceCount}</strong>
        <span>引擎通過 {report ? report.counts.engine_pass : "—"}</span>
        <span>重疊 {report ? report.counts.overlap : "—"}</span>
        <span>參考有、引擎無 {report ? report.counts.missing : "—"}</span>
        <span>多出 {report ? report.counts.extra : "—"}</span>
        <span>樣本內多出 {report ? report.counts.within_sample_extra : "—"}</span>
        <span>未定 {report ? report.counts.indeterminate : "—"}</span>
      </div>
      {report ? (
        <p className="finding" data-testid="scan-finding">
          參考表 {report.counts.reference} 列裡，其餘條件通過 {report.reference_indicator_passed ?? "—"} 列。
          引擎確認通過 {report.counts.engine_pass}。重疊 {report.counts.overlap}。
          另一種括號讀法在這 170 隻裡會多出 {report.alternate_only_within_sample ?? 0} 隻，那些不在參考表。
          全市場的多出和漏掉沒有計算。
        </p>
      ) : null}
      {report?.layout_fixture ? <p className="warn">版面夾具，不是 2026-11-20 的市場結果。</p> : null}
      {error ? <p className="error-banner">{error}</p> : null}
      {!report && !localRows && publishedState !== "loading" ? (
        <section className="blocked" data-testid="comparison-blocked">
          <h2>這一頁還沒有 2026-11-20 的引擎比較</h2>
          <p>
            現有附件只有 30 個交易日，不夠 SMA(200) 的暖機。沒有用那段資料計算命中，也沒有把參考表抄進網站。
            全市場多出、漏掉，以及 ADX 參考為 0 是否成立，都還沒有計算。
          </p>
          <p className="quiet">參考 CSV 可以在這台瀏覽器打開，不會上傳。名稱、收市和成交量不會先放在網站上。</p>
        </section>
      ) : null}
      <div className="toolbar">
        <label>
          每頁
          <select
            aria-label="每頁列數"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
          >
            {[50, 100, 500].map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <input
          aria-label="搜尋結果"
          placeholder="搜尋代號、名稱、板塊"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
        <button type="button" onClick={() => setShowColumns((value) => !value)} data-testid="columns-toggle">欄位</button>
        <label className="file">
          本機參考 CSV
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="reference-csv"
            onChange={(event) => void onReferenceFile(event.target.files?.[0])}
          />
        </label>
        <label className="file">
          本機比較 JSON
          <input
            type="file"
            accept="application/json,.json"
            data-testid="comparison-json"
            onChange={(event) => void onComparisonFile(event.target.files?.[0])}
          />
        </label>
        <label>
          <input type="checkbox" checked={showNonHits} onChange={(event) => setShowNonHits(event.target.checked)} />
          顯示未命中
        </label>
      </div>
      {showColumns ? (
        <div className="column-picker">
          {COLUMNS.map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={visible[key]}
                onChange={() => setVisible((current) => ({ ...current, [key]: !current[key] }))}
              />
              {label}
            </label>
          ))}
        </div>
      ) : null}
      {hasTable ? (
        <div className="table-wrap">
          <table className="dense" data-testid="result-table">
            <thead>
              <tr>
                <th>原因</th>
                {COLUMNS.filter(([key]) => visible[key]).map(([key, label]) => (
                  <th key={key}>
                    <button
                      type="button"
                      onClick={() =>
                        setSort((current) => ({
                          key,
                          dir: current.key === key && current.dir === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      {label}
                    </button>
                  </th>
                ))}
                {showingLocalPrices ? <th>本機收市</th> : null}
                {showingLocalPrices ? <th>本機成交量</th> : null}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <Fragment key={row.symbol}>
                  <tr onClick={() => setOpenSymbol((current) => (current === row.symbol ? null : row.symbol))}>
                    <td className="reason">{reasonFor(row)}</td>
                    {visible.symbol ? <td>{row.symbol}</td> : null}
                    {visible.name ? <td>{row.name}</td> : null}
                    {visible.exchange ? <td>{row.exchange}</td> : null}
                    {visible.sector ? <td>{row.sector}</td> : null}
                    {visible.industry ? <td>{row.industry}</td> : null}
                    {visible.reference_sctr ? <td>{row.reference_sctr ?? "—"}</td> : null}
                    {visible.reference_universe ? <td>{row.reference_universe || "—"}</td> : null}
                    {visible.membership ? <td>{MEMBERSHIP[row.membership] ?? row.membership}</td> : null}
                    {visible.decision ? <td>{decisionLabel(row)}</td> : null}
                    {showingLocalPrices ? <td>{row.local_close || "—"}</td> : null}
                    {showingLocalPrices ? <td>{row.local_volume || "—"}</td> : null}
                  </tr>
                  {openSymbol === row.symbol ? (
                    <tr key={`${row.symbol}-detail`} className="detail-row">
                      <td colSpan={COLUMNS.filter(([key]) => visible[key]).length + (showingLocalPrices ? 2 : 0) + 1}>
                        <PredicateDetail row={row} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {hasTable ? (
        <div className="pager">
          <button type="button" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一頁</button>
          <span data-testid="page-indicator">{safePage + 1} / {pageCount} · {filtered.length} 列</span>
          <button type="button" disabled={safePage + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>下一頁</button>
        </div>
      ) : null}
      <details className="provenance" data-testid="provenance">
        <summary>技術出處與仍未定的部分</summary>
        {report ? (
          <>
            <p>{report.rank_mode_label}。覆蓋：{coverageLabel(report.candidate_coverage)}。{report.price_basis}</p>
            {dataVersion ? (
              <p>
                資料版本 {String(dataVersion.package ?? "")}，{String(dataVersion.created_at_asia_taipei ?? "")}。
                {String(dataVersion.symbols ?? "")} 隻、{String(dataVersion.bars ?? "")} 根；
                至少 200 根 {String(dataVersion.warmup_at_least_200 ?? "")}；
                1291 根 {String(dataVersion.bars_1291 ?? "")}。
                {String(dataVersion.supersedes ?? "")}
              </p>
            ) : null}
            <p>
              全市場多出{report.full_market_extra_computed ? "已" : "未"}計算。
              全市場漏掉{report.full_market_missing_computed ? "已" : "未"}計算。
              參考為 0 {report.zero_reference_validated ? "已在全市場核對" : "尚未被全市場驗證"}。
            </p>
            {report.grouping_warning ? <p>{report.grouping_warning}</p> : null}
            <ul>
              {report.blockers.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </>
        ) : (
          <p>
            網站沒有存放 2026-11-20 的行情、成交量或完整參考表。本機 CSV 只留在瀏覽器。
            日股 Squeeze 與 Turtle 仍是「需要日股適配參數」，不會把美元門檻套到日圓。
          </p>
        )}
        <p className="quiet">示範工作台在 <a href="#/">篩選工作台</a>，與這六頁的比較無關。</p>
      </details>
    </div>
  );
}

function PredicateDetail({ row }: { row: CompareRow }) {
  if (row.membership === "reference_only") {
    return <p>這列來自本機參考表。引擎尚未計算，所以沒有條件差異。</p>;
  }
  return (
    <div className="predicate">
      <p>
        其餘條件：{outcomeLabel(row.technical_outcome)}。
        引擎判定：{outcomeLabel(row.engine_outcome)}。
        {row.grouping_causal ? `另一讀法：${outcomeLabel(row.alternate_outcome)}，兩種分組不同。` : "兩種分組沒有把這列拆開。"}
      </p>
      {row.confirmed_failed.length ? (
        <>
          <h3>已確認未過</h3>
          <ul>
            {row.confirmed_failed.map((item) => (
              <li key={item.id} data-status="fail">{item.label}：{tidy(item.detail) || item.status}</li>
            ))}
          </ul>
        </>
      ) : <p>沒有已確認未過的條件。</p>}
      {row.unresolved.length ? (
        <>
          <h3>資料未齊，不能判定</h3>
          <ul>
            {row.unresolved.map((item) => (
              <li key={item.id} data-status="unavailable">{item.label}：{item.detail || item.code}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function reasonFor(row: CompareRow): string {
  if (row.indicator_status === "blocked_input") {
    return row.unresolved[0]?.detail || "這一列的輸入不能計算";
  }
  if (row.confirmed_failed.length) {
    const failed = row.confirmed_failed
      .slice(0, 2)
      .map((item) => `${item.label}${item.detail ? `（${tidy(item.detail)}）` : ""}`)
      .join("；");
    const alternate = row.grouping_causal && row.alternate_outcome === "match" ? " 另一讀法會通過。" : "";
    return `已確認未過：${failed}${alternate}`;
  }
  if (row.decision === "engine_pass") {
    return "引擎通過。排名用的是參考 SCTR，不是本地族群排名。";
  }
  const codes = new Set(row.unresolved.map((item) => item.code));
  if (row.indicator_status === "passed" && codes.has("missing_market_cap")) {
    return "其餘條件通過。沒有 2026-11-20 的市值，不能把這列算成命中。";
  }
  if (row.indicator_status === "passed" && (codes.has("security_type_not_in_export") || codes.has("etf_group_not_in_export"))) {
    return "其餘條件通過。結果表沒有股票或 ETF 類型，不能把這列算成命中。";
  }
  if (row.membership === "reference_only") return "這列只來自本機參考表，引擎還沒有比較。";
  return row.unresolved[0]?.detail || "未定";
}

function tidy(detail?: string | null): string {
  if (!detail) return "";
  return detail.replace(/-?\d+\.\d+(?:e[+-]?\d+)?/gi, (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return value;
    const absolute = Math.abs(number);
    if (absolute >= 1000) return number.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (absolute >= 100) return number.toFixed(1);
    return number.toFixed(2);
  });
}

function outcomeLabel(value?: string | null): string {
  if (value === "match") return "通過";
  if (value === "no_match") return "未過";
  if (value === "insufficient_warmup") return "暖機不足";
  if (value === "unmet_dependency") return "未定";
  return value || "—";
}

function decisionLabel(row: CompareRow): string {
  if (row.decision === "engine_pass") return "引擎通過";
  if (row.decision === "confirmed_failed_condition") return "已確認未過";
  if (row.decision === "not_computed") return "引擎未計算";
  return "未定";
}

function coverageLabel(value: string): string {
  if (value === "full_market") return "全市場";
  if (value === "selection_biased_hit_union") return "其他掃描命中的聯集，不是全市場";
  return value;
}

function compareValues(left: CompareRow, right: CompareRow, key: string, dir: "asc" | "desc"): number {
  const a = String((left as Record<string, unknown>)[key] ?? "");
  const b = String((right as Record<string, unknown>)[key] ?? "");
  const numeric = Number(a);
  const other = Number(b);
  const result = Number.isFinite(numeric) && Number.isFinite(other) && a !== "" && b !== ""
    ? numeric - other
    : a.localeCompare(b);
  return dir === "asc" ? result : -result;
}
