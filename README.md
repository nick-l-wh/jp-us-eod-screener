# 日美收市股票篩選

私人草稿。只處理美國與日本的股票，ETF 在排名和掃描之前剔除。沒有選定行情供應商，也不會登入 StockCharts。

這不是官方掃描器的複製品。ADX、Pullback、Young Trend 的原文沒有括號，引擎使用已標明的暫定分組，畫面上會看到 **條件分組待核對**。

## 本草稿不做的事

- 不合併進 `main`，不把倉庫改成公開
- 不設定行情排程。CI 只在 push／pull request。Pages 只在這條草稿分支被推上時重建靜態頁
- 不接付費行情，不索取憑證，不從網絡抓行情
- 不對 StockCharts 帳戶做登入或擷取

## 安裝

需要 Python 3.11+ 與 Node.js 22。

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd web && npm ci
```

## 測試與建置

```bash
python -m pytest
cd web && npm run typecheck && npm run build
```

CI 見 `.github/workflows/ci.yml`，只在 push 和 pull request 執行，沒有排程。

前端預覽：

```bash
cd web && npm run dev
```

靜態預覽：`https://nick-l-wh.github.io/jp-us-eod-screener/`。打開先到 2026-11-20 的六條結果（預設美股 Pullback）。每頁只有掃描、日股／美股、日期，以及代號、名稱、成交量、SCTR。比較說明收在「比較詳情」。日股尚未計算。覆蓋更正仍在 `#/review`：170 隻、202950 根、165 隻至少 200 根、149 隻 1291 根、173 列收市可比較，SNDK 的目標日收市是空的。名稱和成交量不放進網站，可用本機 CSV 補上且不上傳。篩選工作台在 `#/workspace`。`.github/workflows/pages.yml` 在草稿分支 `cursor/jp-us-eod-screener-draft-8d68` 被推上時，以 `VITE_BASE=/jp-us-eod-screener/` 建置 `web` 並上傳。本地與 CI 不設這個變數，仍用相對路徑。倉庫維持私人。這不是行情排程。頁上不提供整包行情下載。

## 命令列

原始行情放在被 git 忽略的 `data/`。不要把歷史檔或金鑰提交進來。

```bash
python -m jp_us_screener compute \
  --ohlcv data/ohlcv.csv \
  --universe data/universe.csv \
  --marketcap data/marketcap.csv \
  --config config/default.json \
  --previous snapshots/previous.json \
  --out snapshots/latest.json \
  --csv snapshots/latest.csv
```

- 結構壞掉、沒有可判定證券，或計算中途拋錯：退出碼 1，**不覆寫** `--out`
- 成功但沒有命中：會寫入，並標明已完成計算
- `--mode demo` 會在快照和 CSV 寫上示範聲明。日常計算用預設 `real`
- `python -m jp_us_screener templates --dir data/templates` 寫出 CSV 範本
- `python -m jp_us_screener provider` 只會說明尚未選擇供應商

`src/jp_us_screener/provider.py` 的介面沒有任何抓取實作。

## 網頁

靜態頁，沒有後端。真實模式打開時是空白，文案是「尚未匯入真實行情」。

- 匯入快照 JSON：只在瀏覽器讀取，不上傳
- 預檢 OHLCV／宇宙 CSV：只檢查表頭、日期、OHLC 和類型，不在網頁計算指標
- 示範開關載入 `web/public/demo/snapshot.json`。畫面和 CSV 都會帶「示範／合成資料，並非實際行情或今日命中」
- 可切換美國／日本和六條掃描，搜尋、排序、看新增／保留／剔除、匯出 CSV、看規則和迷你走勢

## 匯入格式

OHLCV 欄位：`market,symbol,date,open,high,low,close,volume,adjustment`

- `market` 只接受 `US` 或 `JP`
- `symbol` 本身不含冒號。合格代號是 `US:SYN-EXAMPLE` 這種 `市場:代號`
- `date` 為 `YYYY-MM-DD`，每個代號必須嚴格遞增、不可重複
- `adjustment` 必須整列是 `split_and_dividend`（拆股並調整股息）。這對應檢視當時「adjusted for dividends」的語境
- 成交量是未調整股數，不是成交金額。不要寫千分位逗號
- 星期六、日的列會被拒絕。引擎沒有交易所假期表，也不會把缺日填成前值

宇宙欄位：`market,symbol,name,security_type,listing_segment,exchange,currency,cohort,market_cap,market_cap_currency,market_cap_as_of,group`

- `security_type`：`stock` 才會進入排名和掃描。`etf` 先剔除。空白、`unknown` 或其他類型會診斷，不會假設成股票
- `cohort`：`large`、`mid` 或 `small`。預設不依市值自動分層
- `listing_segment`：`primary`、`adr`、`otc`，或留空。明確的 `adr`／`otc` 在預設 `unresolved` 下不會靜默納入或排除。空白不會靠代號猜測
- 市值是貨幣的絕對單位，必須有 `market_cap_currency`。不要從價格反推

可選市值檔：`market,symbol,market_cap,market_cap_currency,market_cap_as_of`。和宇宙檔衝突會整次失敗。

範本在 `web/public/templates/`。規則 JSON 在 `web/public/rules.json`。

## 六條掃描

原文在 `sources/saved-scans-2026-11-21.txt`。語意版本 `2026-11-21.provisional.1`。

| 掃描 | 原文分組 | 本引擎 |
| --- | --- | --- |
| ADX、Pullback、Young Trend | 沒有括號的 OR 然後 AND | 暫定 `(大型或中型) 且其餘條件`，並顯示條件分組待核對 |
| Weak ADX | 原文有括號 | 依括號 |
| Squeeze、Turtle | 全是 AND，且限美國 | 美國照原文；日本顯示「需要日股適配參數」 |

`yesterday's max(25, Plus DI(14))` 是**不含今日的前 25 根** +DI(14) 最高值，不是和數字 25 比較。`min` 同樣。沒有 yesterday's 的 `min(20)`、`min(63)` 包含今日。

Pullback 的 Daily ULCER(10) 和 Young Trend 的 ROC(3) 只排序、不過濾。預設較大值在前，方向未經來源核對。

Squeeze 的 `market cap > 1,000` 按來源的百萬美元，即大於 1e9 USD。Weak 的 `10,000` 即大於 1e10 USD。這兩個過濾一直生效，不能用下面的分層開關關掉。缺市值，或市值貨幣不是 USD，該列是未滿足依賴，不會變成命中，也不會把美元門檻換算成日圓。Squeeze 沒有 `close > 5`；那一條只在 Turtle。收市價可以低於 5 美元，只要高於 SMA(200) 就通過 Squeeze 的價格條款。Turtle 的 `close > 5` 是美元，日本市場整條不跑，不會改成 5 日圓。

Young Trend 原文沒有股票條款。只留股票是引擎的宇宙政策，不是假裝原文有這一句。

## 指標

回看窗是交易柱，不是日曆日。

- Wilder DI／ATR：TR、+DM、−DM 從第二根開始。第一個平滑值是頭 `period` 個觀測的平均，放在該段最後一根。其後是 `(prev * (period - 1) + current) / period`。period 14 時，第一個 DI 在第 15 根（index 14），第一個 ADX 是其後 14 個 DX 的平均，在第 28 根（index 27）
- EMA：頭 `period` 根的 SMA 做種子，乘數 `2 / (period + 1)`
- RSI(14)：同一套 Wilder 種子。平均跌幅為 0 時 RSI 為 100
- ROC 是百分比：`(close / close_n_ago - 1) * 100`
- 布林帶 (20, 2)：母體標準差，除以 N。寬度 `(上軌 - 下軌) / 中軌 * 100`
- Keltner：EMA(20) ± 1.5 × Wilder ATR(10)
- Ulcer(10)：ChartSchool 的百分比回撤（相對窗口最高收市，零或負數），再取平方平均的平方根
- PPO(12,26,9)：`(EMA12 - EMA26) / EMA26 * 100`，訊號線是 PPO 的 9 日 EMA，直方圖是兩者之差。3 日斜率是 `(hist - hist_3日前) / 3`
- 等式只用相對 1e-12、絕對 1e-9 吸收浮點捨入，不是價格容許帶。落在範圍內的大於／小於視作相等

## 技術排名

標籤是「技術排名（依SCTR公開方法，非官方）」。

公開權重（[ChartSchool SCTR](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/stockcharts-technical-rank-sctr)）：

- 距 EMA200 的百分比 × 0.30
- ROC(125) × 0.30
- 距 EMA50 的百分比 × 0.15
- ROC(20) × 0.15
- PPO 直方圖 3 日斜率：限制在 [-1, 1]，映射成 0 至 5 分
- RSI(14) × 0.05

每個市場、每個族群各自把分數編成 0.0 到 99.9。最低 0.0，最高 99.9，同分取平均序位，half up 到 0.1。大型欄位和中型欄位不是同一條全球排名。人數少於設定（預設 5，而且至少 2）時，該族群排名不可用。

PPO 採用 (12, 26, 9)。權重表是這個參數；SCTR 正文曾把訊號線寫成 12 日 EMA。兩者不一致，這裡跟隨權重表和 PPO 頁的 9 日訊號線，不聲稱和官方分數一致。

`config/default.json` 裡 `cohort_thresholds.*.enabled` 預設是 false。這只表示：宇宙檔沒有 `cohort` 時，不要用市值自動分成大型或中型。它不是 Squeeze／Weak 市值過濾的開關。日股沒有官方分層，請在宇宙檔填 `cohort`。檔裡的美國數字只是停用的公開參考。

## 真實與示範

| | 真實 | 示範 |
| --- | --- | --- |
| 預設畫面 | 尚未匯入真實行情 | 必須打開示範開關 |
| 代號 | 你的檔案 | `SYN-` 合成代號 |
| 聲明 | 無 | 畫面和匯出固定一句：示範／合成資料，並非實際行情或今日命中 |
| 價格 | 只來自匯入 | 生成規則在 `src/jp_us_screener/demo.py`，不是發行人報價 |

示範快照若被當成真實檔匯入，只要 `mode` 是 `demo` 或帶有聲明，網頁仍會顯示那句聲明。

## 授權與私隱

本草稿為私人研究，保留所有權利，不授權再散布。掃描原文是使用者自己的儲存條件，只供這個倉庫對照。ChartSchool 的公式按公開頁記載重建，並在上面附了出處；本倉庫不隸屬 StockCharts。

不要把行情歷史、帳戶、API 金鑰放進 git。`data/` 和 `snapshots/` 已被忽略。網頁匯入不會離開瀏覽器。

## 限制

- 暫定分組不是已核對的掃描語法
- 排序方向未經來源核對
- 技術排名會因種子、族群成員和供應商調整制度而偏離官方 SCTR
- 沒有交易所假期表；週末會拒絕，假期則依賴匯入檔本身不要補柱
- ADR／OTC 預設未決議
- Squeeze 和 Turtle 的日股參數尚未設定
- 迷你走勢只是收市折線，不是圖表平台
