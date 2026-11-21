import { useEffect, useMemo, useState } from "react";

export const SCAN_ROUTES = [
  { id: "adx", en: "ADX", zh: "ADX" },
  { id: "pullback", en: "Pullback", zh: "回調" },
  { id: "squeeze", en: "Squeeze On", zh: "擠壓開啟" },
  { id: "turtle", en: "Turtle Soup Plus One - buy", zh: "海龜湯加一（買入）" },
  { id: "weak", en: "Weak ADX", zh: "弱 ADX" },
  { id: "young", en: "Young Trend", zh: "初生趨勢" },
] as const;

export type MarketCode = "US" | "JP";

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

export function ScanResults({ scanId, market }: { scanId: string; market: MarketCode }) {
  const [published, setPublished] = useState<CompareReport | null>(null);
  const [publishedState, setPublishedState] = useState<"loading" | "missing" | "ready">("loading");
  const [dataVersion, setDataVersion] = useState<Record<string, unknown> | null>(null);
  const [localReport, setLocalReport] = useState<CompareReport | null>(null);
  const [localRows, setLocalRows] = useState<CompareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "symbol", dir: "asc" });
  const meta = SCAN_ROUTES.find((item) => item.id === scanId) ?? SCAN_ROUTES[0];
  const marketSlug = market === "JP" ? "jp" : "us";

  useEffect(() => {
    const injected = window.sessionStorage.getItem("screener-comparison-json");
    if (injected) {
      try {
        const parsed = JSON.parse(injected) as CompareReport;
        if (isReport(parsed) && parsed.scan_id === scanId) setLocalReport(parsed);
      } catch {
        setError("本機比較 JSON 無法讀取");
      }
    }
    fetch(asset("comparison/2026-11-20.json"))
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload) {
          setPublishedState("missing");
          return;
        }
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
        } else {
          setPublishedState("missing");
        }
      })
      .catch(() => setPublishedState("missing"));
  }, [scanId]);

  const report = localReport ?? published;
  const referenceRows = useMemo(() => {
    const localBySymbol = new Map((localRows ?? []).map((row) => [row.symbol, row]));
    const base = report ? report.rows.filter((row) => row.in_reference) : (localRows ?? []);
    return base.map((row) => {
      const local = localBySymbol.get(row.symbol);
      if (!local) return row;
      return {
        ...row,
        name: local.name || row.name,
        local_volume: local.local_volume || row.local_volume,
        reference_sctr: row.reference_sctr ?? local.reference_sctr,
      };
    });
  }, [report, localRows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? referenceRows.filter((row) => `${row.symbol} ${row.name}`.toLowerCase().includes(needle))
      : referenceRows;
    return [...matched].sort((left, right) => compareValues(left, right, sort.key, sort.dir));
  }, [referenceRows, query, sort]);

  const session = report?.session_date ?? "2026-11-20";

  function toggleSort(key: string) {
    setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
  }

  async function onReferenceFile(file: File | undefined) {
    if (!file) return;
    const parsed = parseReferenceCsv(await file.text());
    if (!parsed.length) {
      setError("參考 CSV 沒有代號列");
      return;
    }
    setLocalRows(parsed);
    setError(null);
  }

  return (
    <div className="app results-app" data-testid="scan-results" data-market={market}>
      <header className="top">
        <div>
          <p className="eyebrow">日美收市篩選</p>
          <h1 data-testid="page-title">{meta.en}</h1>
        </div>
        <p className="session-date" data-testid="session-date">{formatSession(session)}</p>
      </header>
      <nav className="scans" aria-label="六條掃描">
        {SCAN_ROUTES.map((item) => (
          <a
            key={item.id}
            className={item.id === scanId ? "active" : ""}
            href={`#/${marketSlug}/${item.id}`}
            data-testid={`scan-link-${item.id}`}
          >
            {item.en}
          </a>
        ))}
      </nav>
      <div className="market-row">
        <div className="market-switch" role="tablist" aria-label="市場">
          <a href={`#/jp/${scanId}`} role="tab" aria-selected={market === "JP"} className={market === "JP" ? "active" : ""} data-testid="market-JP">日股</a>
          <a href={`#/us/${scanId}`} role="tab" aria-selected={market === "US"} className={market === "US" ? "active" : ""} data-testid="market-US">美股</a>
        </div>
        {market === "US" ? (
          <p className="results-count" data-testid="result-counts">參考結果 {report ? referenceRows.length : "—"}</p>
        ) : null}
      </div>
      {market === "JP" ? (
        <p className="jp-empty" data-testid="jp-empty">尚未產生日股結果</p>
      ) : (
        <>
          <p className="tiny-note">參考結果 · SCTR 為參考值</p>
          {error ? <p className="error-banner">{error}</p> : null}
          <div className="toolbar">
            <input
              aria-label="搜尋結果"
              placeholder="搜尋代號或名稱"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <details className="local-fields">
              <summary>補上名稱與成交量</summary>
              <p className="quiet">選擇本機的結果 CSV。檔案留在這台瀏覽器，不會上傳。</p>
              <input
                type="file"
                accept=".csv,text/csv"
                data-testid="reference-csv"
                onChange={(event) => void onReferenceFile(event.target.files?.[0])}
              />
            </details>
          </div>
          <div className="table-wrap">
            <table className="dense" data-testid="result-table">
              <thead>
                <tr>
                  <th><button type="button" onClick={() => toggleSort("symbol")}>代號</button></th>
                  <th><button type="button" onClick={() => toggleSort("name")}>名稱</button></th>
                  <th><button type="button" onClick={() => toggleSort("local_volume")}>成交量</button></th>
                  <th><button type="button" onClick={() => toggleSort("reference_sctr")}>SCTR</button></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.symbol}>
                    <td>{row.symbol}</td>
                    <td>{row.name || "—"}</td>
                    <td>{row.local_volume || "—"}</td>
                    <td>{row.reference_sctr ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {publishedState !== "loading" && filtered.length === 0 ? (
            <p className="quiet" data-testid="reference-empty">{query ? "沒有符合的代號" : "參考結果 0"}</p>
          ) : null}
        </>
      )}
      <details className="provenance" data-testid="comparison-detail">
        <summary>比較詳情</summary>
        {market === "JP" ? (
          <p>日股這六條還沒有計算。不會用美股代號代替，也不會把美元門檻套成日圓。</p>
        ) : report ? (
          <>
            <p>
              這張表是參考結果，不是引擎確認命中。參考 {report.counts.reference}。
              其餘條件通過 {report.reference_indicator_passed ?? "—"}。
              引擎確認通過 {report.counts.engine_pass}。重疊 {report.counts.overlap}。
            </p>
            <p>{report.rank_mode_label}。{report.price_basis}</p>
            <p>
              另一種括號讀法在這批代號裡會多出 {report.alternate_only_within_sample ?? 0} 隻，那些不在參考表。
              全市場的多出和漏掉沒有計算。參考為 0 {report.zero_reference_validated ? "已在全市場核對" : "尚未被全市場驗證"}。
            </p>
            {dataVersion ? (
              <p>
                資料版本 {String(dataVersion.package ?? "")}。{String(dataVersion.symbols ?? "")} 隻、{String(dataVersion.bars ?? "")} 根；
                至少 200 根 {String(dataVersion.warmup_at_least_200 ?? "")}；1291 根 {String(dataVersion.bars_1291 ?? "")}。
                {String(dataVersion.supersedes ?? "")}
              </p>
            ) : null}
            <ul>
              {report.blockers.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <ul>
              {report.rows.filter((row) => row.in_reference && (row.indicator_status === "blocked_input" || row.confirmed_failed.length > 0)).map((row) => (
                <li key={row.symbol}>{row.symbol}：{reasonFor(row)}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>美股比較尚未載入。</p>
        )}
        <p className="quiet"><a href="#/workspace">篩選工作台</a></p>
      </details>
    </div>
  );
}

function reasonFor(row: CompareRow): string {
  if (row.indicator_status === "blocked_input") return row.unresolved[0]?.detail || "這一列的輸入不能計算";
  if (row.confirmed_failed.length) {
    return row.confirmed_failed.slice(0, 2).map((item) => `${item.label}${item.detail ? `（${tidy(item.detail)}）` : ""}`).join("；");
  }
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

function compareValues(left: CompareRow, right: CompareRow, key: string, dir: "asc" | "desc"): number {
  const rawLeft = (left as Record<string, unknown>)[key];
  const rawRight = (right as Record<string, unknown>)[key];
  const a = rawLeft === null || rawLeft === undefined || rawLeft === "" ? null : Number(rawLeft);
  const b = rawRight === null || rawRight === undefined || rawRight === "" ? null : Number(rawRight);
  let result = 0;
  if (a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) && key !== "symbol" && key !== "name") {
    result = a - b;
  } else {
    result = String(rawLeft ?? "").localeCompare(String(rawRight ?? ""));
  }
  return dir === "asc" ? result : -result;
}
