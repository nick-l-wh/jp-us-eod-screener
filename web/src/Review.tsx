import review from "./review/2026-11-20.json";

export const REVIEW = review;

export function Review({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const scans = review.stockcharts_baseline.scans;
  const rowSum = scans.reduce((total, scan) => total + scan.rows, 0);
  return (
    <div className="review" data-testid="review-page">
      <section className="review-hero">
        <p className="eyebrow">目標交易日 {review.target_session_date} · 台北彙整 {review.compiled_at_asia_taipei}</p>
        <p className="reference-seal" data-testid="review-reference">{review.reference_label}</p>
        <p>
          日股已有目標日與 30 個交易日的價格覆蓋。美股只收集了 StockCharts 結果表裡出現過的代號，用來核對資料，不是全市場掃描。
        </p>
      </section>

      <section className="review-grid">
        <article>
          <h2>美國覆蓋</h2>
          <p className="quiet">{review.us.coverage_class}</p>
          <dl className="metrics">
            <div><dt>結果表獨特代號</dt><dd>{review.us.unique_baseline_symbols}</dd></div>
            <div><dt>有 11 月 20 日</dt><dd>{review.us.target_bar_present} · 缺 {review.us.target_bar_missing}</dd></div>
            <div><dt>30 個交易日</dt><dd>{review.us.window_start} 至 {review.us.window_end}</dd></div>
            <div><dt>窗口齊全</dt><dd>{review.us.symbols_with_all_window_sessions}</dd></div>
            <div><dt>至少 200 根</dt><dd>{review.us.warmup_at_least_200}，各 {review.us.reported_bar_count_each.toLocaleString("zh-HK")} 根</dd></div>
          </dl>
          <p className="quiet">{review.us.close_adjustment} 來源：{review.us.source}</p>
          <p data-testid="review-probe">
            {review.us.probe.symbol} 是{review.us.probe.role}，有目標日線，但不是掃描命中，沒有計入上面的列數。
          </p>
        </article>
        <article>
          <h2>日本覆蓋</h2>
          <p className="quiet">{review.jp.universe}</p>
          <dl className="metrics">
            <div><dt>宇宙</dt><dd>{review.jp.universe_size.toLocaleString("zh-HK")}</dd></div>
            <div><dt>有 11 月 20 日</dt><dd>{review.jp.target_bar_present.toLocaleString("zh-HK")} · {review.jp.target_bar_present_pct}%</dd></div>
            <div><dt>缺目標日</dt><dd>{review.jp.target_bar_missing}</dd></div>
            <div><dt>OHLC 不一致</dt><dd>{review.jp.ohlc_inconsistent}</dd></div>
            <div><dt>30 個交易日齊全</dt><dd>{review.jp.symbols_with_all_window_sessions.toLocaleString("zh-HK")}</dd></div>
            <div><dt>歷史至少 200 根</dt><dd>{review.jp.warmup_at_least_200.toLocaleString("zh-HK")}</dd></div>
            <div><dt>歷史至少 300 根</dt><dd>{review.jp.warmup_at_least_300.toLocaleString("zh-HK")}</dd></div>
          </dl>
          <p className="quiet">{review.jp.window_start} 至 {review.jp.window_end}，共 {review.jp.window_sessions} 個交易日。{review.jp.warmup_note}</p>
          <p className="quiet">{review.jp.ohlc_inconsistent_note} {review.jp.close_adjustment}</p>
        </article>
      </section>

      <section>
        <h2>日本市場分段</h2>
        <div className="table-wrap">
          <table>
            <caption>現時宇宙裡，有 2026-11-20 日線的普通股數量。</caption>
            <thead>
              <tr><th>分段</th><th>宇宙</th><th>有目標日</th></tr>
            </thead>
            <tbody>
              {review.jp.segments.map((segment) => (
                <tr key={segment.name}>
                  <td>{segment.name}</td>
                  <td>{segment.universe.toLocaleString("zh-HK")}</td>
                  <td>{segment.has_target.toLocaleString("zh-HK")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="quiet">{review.jp.universe_timing} {review.jp.source} 日股不是 StockCharts 官方日股掃描。</p>
      </section>

      <section>
        <h2>六條 StockCharts 結果表</h2>
        <p className="reference-seal">{review.reference_label}</p>
        <div className="table-wrap">
          <table data-testid="review-counts">
            <caption>2026-11-20 美股收市、股息調整後的結果表列數。不是本引擎的命中。</caption>
            <thead>
              <tr><th>掃描</th><th>結果表列數</th></tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.id}><td>{scan.name}</td><td>{scan.rows}</td></tr>
              ))}
              <tr><td>列數合計</td><td>{rowSum}</td></tr>
              <tr><td>獨特代號</td><td>{review.stockcharts_baseline.unique_symbols}</td></tr>
            </tbody>
          </table>
        </div>
        <ul>
          {review.stockcharts_baseline.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </section>

      <section data-testid="review-price">
        <h2>收市價與成交量水準</h2>
        <p className="reference-seal">{review.price_comparison.label}</p>
        <dl className="metrics">
          <div><dt>比較列</dt><dd>{review.price_comparison.rows_compared}</dd></div>
          <div><dt>收市絕對差 ≤ 0.01</dt><dd>{review.price_comparison.close_abs_diff_at_most_0_01}</dd></div>
          <div><dt>成交量完全相同</dt><dd>{review.price_comparison.volume_exact}</dd></div>
          <div><dt>成交量相差在 5% 內</dt><dd>{review.price_comparison.volume_within_5pct}</dd></div>
        </dl>
        <p>{review.price_comparison.baseline_adjustment} {review.price_comparison.yahoo_adjustment}</p>
      </section>

      <section>
        <h2>來源與仍未完成</h2>
        <ul>
          {review.provenance.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <ol>
          {review.still_open.map((item) => <li key={item}>{item}</li>)}
        </ol>
        <p className="quiet">
          已交付的快照 JSON 可在篩選工作台本地匯入，檔案不會上傳。CSV 預檢只檢查表頭與欄位，不會計算掃描。此頁不提供整包下載。
        </p>
        <button type="button" className="toggle" data-testid="review-open-workspace" onClick={onOpenWorkspace}>
          開啟篩選工作台
        </button>
      </section>
    </div>
  );
}
