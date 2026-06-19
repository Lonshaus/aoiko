# aoiko（あおいこ / 青い子）

**Language**: [日本語](README.md) | [English](README_en.md) | **繁體中文**

[![CI](https://github.com/Lonshaus/aoiko/actions/workflows/ci.yml/badge.svg)](https://github.com/Lonshaus/aoiko/actions/workflows/ci.yml) [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

🌐 **線上試用**: <https://aoiko.pages.dev>（僅供試用・注意事項見「[使用者向：本機啟動](#使用者向本機啟動)」）

給日本個人事業主用的純前端記帳工具。目標是青色申告 **75 萬日圓**特別控除（令和 9 年分以後、需 e-Tax 期限內提交＋優良な電子帳簿保存／改正前的 65 萬日圓控除也持續支援），把 CSV／OCR／EC 訂單頁取込、複式簿記、減價償卻、資產負債表、`.xtx`（e-Tax 申報檔）輸出全部在單一 Web App 中完成。無後端、BYOK（API 金鑰使用者自備）。

## 主要功能

- **複式簿記**：仕訳、訂正仕訳（修正仕訳）、符合電子帳簿保存法的稽核履歷
- **CSV 取込**：銀行＝三菱UFJ／三井住友／SBI新生／PayPay（信用卡決済運用、餘額未對應）；卡片＝楽天／JCB（含 Recruit Card 等）／セゾン／三井住友／三菱UFJ／au PAY／PayPay／ビュー（JRE CARD）／ライフ。全部用真實 CSV 驗證過
- **取込履歴**：CSV 匯入的批次紀錄、檔案 hash 重複偵測、可整批 reverse
- **OCR**：收據 → 仕訳候補。引擎可選：Gemini Vision（預設）／OpenAI 相容・Ollama 等本地 vision LLM／**Tesseract（純本地 WASM OCR、精度有限、必須人工確認）**
- **訂單取込（貼上 → LLM 抽取）**：把 Amazon・楽天 等的訂單頁全文貼進來，由 LLM 抽出品項明細 → 確認 → 轉成仕訳。不依賴 DOM 解析，網站改版不怕
- **LLM 分類**：CSV 行 → 勘定科目（規則優先、LLM 後援）。引擎可選 Gemini 或本地 AI
- **OCR/LLM 隱私**：對外送出前會跳確認對話框。把 Ollama 等指向 localhost、或選 Tesseract 時，影像不會離開本機（Ollama 限本地執行版＋需設 `OLLAMA_ORIGINS`；Tesseract 僅首次從 CDN 下載 traineddata，可自架做到完全離線）
- **家事按分**：把家庭兼事務所的經費自動拆成事業用與事業主貸
- **減價償卻**：定額法、200% 定率法（耐用年數 2〜20 年）、月分攤、留 1 円殘存
- **少額減價償卻資產特例**：措法 28 之 2（30→40 萬日圓、2026-04-01 起），年合計 300 萬日圓上限管理
- **前期繰越**：去年年末殘高 → 期首振替仕訳自動產生（純利益、事業主貸借吸收至元入金）
- **消費稅概算**：本則／簡易（第 1〜6 種）／2 割特例／3 割特例 4 種方式比較、80/70/50/30% 經過措置自動套用
- **報表**：月別売上、損益計算書、貸借対照表、月別 PL（科目 × 月）、取引先別／補助科目別集計、消費稅 4 方式比較
- **複合検索（優良な電子帳簿要件）**：仕訳一覧可組合 年/月/摘要/金額範圍/取引先 搜尋（符合電子帳簿保存法「2 個以上任意組合」要件）
- **修正申告引導**：申告済 snapshot 與目前值的差分顯示＋提交手順
- **備份**：File System Access API（Chromium）→ OPFS（Safari/Firefox）自動 fallback
- **PWA**：離線運作

## 技術構成

| Layer | Tech |
|-------|------|
| UI | Svelte 5（runes）＋ Tailwind ＋ bits-ui ＋ shadcn-svelte |
| Build | Vite ＋ vite-plugin-pwa |
| Storage | IndexedDB（Dexie）＋ File System Access API / OPFS |
| Money | Decimal.js（14+2 零填充可排序索引） |
| OCR / LLM | 設定中選擇：Google Gemini API（BYOK）／OpenAI 相容・Ollama 等本地 vision LLM／Tesseract（純本地 WASM OCR） |
| Test | Vitest ＋ fake-indexeddb |
| Lang | TypeScript strict ＋ `noUncheckedIndexedAccess` ＋ `exactOptionalPropertyTypes` |

> 不使用 SvelteKit（純 SPA、自製 history router）。

## 目錄結構

```
src/
├── domain/                    # 領域邏輯（與框架無關、Vitest 測試對象）
│   ├── journal.ts             # 仕訳建立／確定
│   ├── reverse.ts             # 訂正仕訳
│   ├── reports.ts             # PL / BS / 月別 / 取引先別
│   ├── depreciation.ts        # 定額法、定率法 減價償卻
│   ├── carryover.ts           # 前期繰越（期首振替）
│   ├── home-office.ts         # 家事按分
│   ├── consumption-tax.ts     # 消費稅 4 方式 ＋ 經過措置
│   ├── snapshots.ts           # 年度鎖定（申告済）
│   ├── amended.ts             # 修正申告引導
│   ├── llm-classify.ts        # LLM 進行 CSV 行分類
│   ├── ocr.ts                 # 收據 OCR（vision LLM 路）
│   ├── receipt-text-extract.ts # OCR 原始文字 → 結構化（Tesseract 確定性抽取）
│   ├── order-extract.ts       # 訂單頁貼上文字 → 結構化（LLM 抽取）
│   ├── rules.ts               # 規則引擎
│   ├── send-confirm.ts        # 對外送出前確認邏輯
│   ├── import.ts              # CSV 匯入流程編排
│   ├── import-batch.ts        # CSV 取込履歴・批次 reverse
│   └── restore.ts             # 備份還原
├── parsers/                   # 銀行・卡片 CSV parser（plugin 式）
├── routes/                    # Svelte 路由（Home / JournalList / JournalEntryForm /
│                              #   Import / OrderImport / ImportHistory / Receipt /
│                              #   Reports / Settings）
├── components/                # 共用 Svelte 元件（送出確認對話框等）
├── stores/                    # 全域 state（class ＋ singleton）
├── lib/                       # 共用 helper
│   ├── decimal.ts             # Decimal.js wrapper ＋ 可排序索引轉換
│   ├── csv.ts                 # 標準 CSV parser（BOM 除去、引號處理）
│   ├── llm-adapter.ts         # vision LLM adapter factory（Gemini / OpenAI 相容）
│   ├── receipt-extractor.ts   # OCR 引擎抽象（vision LLM / Tesseract 共通）
│   ├── order-extractor.ts     # 訂單取込引擎抽象（包裝 LLM Adapter）
│   ├── ocr/tesseract-engine.ts # Tesseract WASM 包裝（動態 import）
│   ├── settings.ts            # 設定 KV store
│   ├── id.ts                  # ID 產生
│   └── utils.ts               # shadcn-svelte 工具
├── db/                        # Dexie schema
├── backup/                    # 備份 adapter（FSA / OPFS）
└── tax-schema/                # 年度版稅務 schema
    └── 2026/                  # 勘定科目表、`.xtx` 輸出（依官方 XSD、需實機驗證）
```

## 使用者向：本機啟動

線上版公開於 <https://aoiko.pages.dev>。但**僅供試用**，請注意以下幾點：

- 每次 push 到 master 就自動部署，**版本會不預告變動**（更新時機無法自行掌控）。
- 實際記帳・申報，**建議自行在本機架設、可固定版本**（步驟見下）。
- 資料僅存於瀏覽器（IndexedDB），不會送到伺服器。請自負責任使用。

想在本機跑請照以下步驟啟動。資料存在瀏覽器 IndexedDB、不會離開本機（請見 [PRIVACY.md](PRIVACY.md)）。

### 前提

- [Node.js 22 LTS](https://nodejs.org/) 以上
- npm（Node.js 內建）
- Git（取得 repo 用、ZIP 下載也行）
- 現代瀏覽器（Chrome / Edge / Safari / Firefox）

### 啟動步驟

```bash
git clone https://github.com/Lonshaus/aoiko.git
cd aoiko
npm install
npm run build
npm run preview
```

瀏覽器打開 <http://localhost:4173>。首次啟動會請你同意免責事項，接著在「設定」畫面輸入事業名稱、年度。要用 OCR/LLM 的話在「設定」選引擎（Gemini API 金鑰／Ollama 等 OpenAI 相容 endpoint／Tesseract〔僅 OCR、精度有限〕）。

### 以 PWA 安裝（推薦）

Chrome / Edge 網址列右側的「安裝」按鈕點下去，aoiko 就會像桌面應用一樣啟動、也能離線運作。Safari 使用者請走「分享」→「加入主畫面」。

### 資料存放位置

- 仕訳、固定資產、取引先、設定 → 瀏覽器 IndexedDB（本機、不送伺服器）
- 「設定」→「備份」可指定本地資料夾、自動 JSON 備份（File System Access API、不支援的瀏覽器走 OPFS）

清掉瀏覽器資料 IndexedDB 也會消失，所以建議定期手動匯出（設定畫面）或指定備份資料夾。

### 更新方法

```bash
git pull
npm install
npm run build
npm run preview
```

裝成 PWA 的話、啟動時會跳「新版本」提示。

## 使用方式

操作手順請見 [docs/manual/](docs/manual/README_zh-TW.md)。分章節說明初次設定・建立傳票・CSV 匯入・報表（日文・英文版也有）。

## 開發

```bash
npm install
npm run dev        # 開發伺服器
npm run test       # Vitest
npm run check      # svelte-check 型別檢查
npm run build      # 正式建置
npm run verify     # check ＋ test ＋ build
```

Node 22 LTS（CI 也用 22、本機跑 Node 24 也行，`engines: >=22`）／ npm（Node.js 內建）。

## 授權

[GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）

## 法務・安全相關文件

- [DISCLAIMER_zh-TW.md](DISCLAIMER_zh-TW.md) — 免責事項（實際申告、稅法遵循、LLM 使用風險）
- [SECURITY_zh-TW.md](SECURITY_zh-TW.md) — 安全政策、漏洞回報手順
- [PRIVACY_zh-TW.md](PRIVACY_zh-TW.md) — 隱私政策、資料收集／傳送內訳