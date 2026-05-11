# aoiko（あおいこ）

> 個人事業主向け的青色申告 + 記帳工具

以中性的「青い子」為吉祥物，對應青色申告 65 萬控除的個人開發工具。
自用優先，視情況以 OSS 形式公開。

---

## 1. 專案定位

- **目標使用者**：日本個人事業主（フリーランス）
- **核心目標**：複式簿記記帳 → 青色申告決算書 + 確定申告書 B → 產生 `.xtx` → 匯入 e-Tax 軟體
- **發布形態**：自用 + OSS 公開（README 明記「非稅理士監修」）
- **後端方針**：**純前端**。不做帳號系統。使用者自帶 API key / 雲端帳號（BYOK）
- **授權候選**：MIT 或 AGPL（若重視防止他人 SaaS 化則選 AGPL）

---

## 2. 整體架構

```
┌─────────────────────────┐         ┌──────────────────────┐
│  Chrome 擴充             │ ──→     │  本地 Web App (PWA)   │
│  - 電商購買履歷擷取        │ postMsg │  - 仕訳帳/總勘定元帳   │
│  - 收據拍照               │         │  - 決算書產生         │
│                         │         │  - .xtx 匯出          │
└─────────────────────────┘         │  - IndexedDB 儲存     │
                                    └──────────────────────┘
                                              ↑
                                    ┌──────────────────────┐
                                    │ 使用者自帶的 API key   │
                                    │ - Gemini/GPT (OCR/分類)│
                                    │ - Google Drive (同步)  │
                                    └──────────────────────┘
```

**切分原則**：擴充只做「在別的網站上才能做的事」，其餘一律集中在 Web App。

---

## 3. 資料模型（複式簿記）

### 必備資料表

- **勘定科目**：內建符合青色申告決算書的標準科目體系
- **仕訳（Journal Entry）**：日期 + 借方 N 筆 + 貸方 N 筆 + 摘要。強制借貸一致
- **補助科目**：例如「普通預金」底下分「三菱 UFJ」「住信 SBI」
- **取引先（Vendor）**：店家主檔。必須含インボイス登録番号欄位
- **固定資產台帳**：取得日、取得價額、耐用年數、償却方法、本年度償却額（65 萬控除必要）
- **家事按分**：自宅兼事務所等情境，單筆支出的事業使用比率設定

### 設計原則

1. **仕訳是唯一真實來源（Single Source of Truth）**
   - CSV 匯入、擴充擷取、OCR 結果一律先成為「候選仕訳」
   - 經使用者確認後才寫入仕訳帳
2. **保留訂正・刪除歷史**
   - 已確定仕訳不可直接編輯
   - 修正一律以「修正仕訳」沖銷
   - 對應電子帳簿保存法的必要條件
3. **金額型別強制使用 Decimal.js**
   - 不使用 JS number
   - 日圓雖為整數，但按分・稅率計算會有除法

### 勘定科目の code と name について

- **code（番号）は業界慣例、政府は管轄しない**
  - `1xxx 資産 / 2xxx 負債 / 3xxx 純資産 / 4xxx 収益 / 5xxx 費用`
  - 弥生・freee・MF などと類似、aoiko は 4 桁・step 10（`1110, 1120, 1130 ...`）採用
  - 使用者は自由に変更可能
- **name（名前）は青色申告決算書 PDF と `.xtx` で参照される、規定値**
  - 標準科目の name は国税庁書式に揃える必要あり
  - 例：「水道光熱費」「租税公課」「減価償却費」など決算書 PL 行に対応
  - リネーム可だが、`.xtx` 出力時に決算書行へマップできなくなるリスクあり
- **使用者自訂科目の code 範囲**
  - 推奨：`8xxx`（資産・負債・純資産系）/ `9xxx`（収益・費用系）
  - step 10 で 100 件のスロット → 個人事業主には十分
  - 標準科目間に挿入したい場合は 5 桁化（例：`5150` と `5160` の間に `51551, 51552, ...`）
  - code は string 型なので桁数自由、字典順ソートで分類は維持される
- **`.xtx` 出力層**
  - 内部 code →「決算書行 name」のマッピングテーブルを別途持つ
  - 使用者が code を変更しても出力は壊れない設計

---

## 4. 自動分類（三層 Fallback）

推定候選仕訳對方科目的優先順序：

1. **規則引擎**：使用者定義「店家 → 科目」對應表（最快、零成本、可重現）
2. **歷史比對**：沿用同店家最近一筆仕訳
3. **LLM 分類**：上述都未命中時，才呼叫使用者自己的 Gemini/GPT key（一次批次處理 20 筆）

LLM 須回傳信心度。低信心標紅 → 使用者確認。
**LLM 結果自動回寫規則引擎**。下次同店家即可免費命中。

---

## 5. CSV Parser 策略

採插件式：
```
parsers/
  mufg-bank.ts        # 三菱 UFJ
  sbi-shinsei.ts      # 住信 SBI
  rakuten-card.ts     # 樂天信用卡
  paypay.ts
  ...
```

每個 parser 為 `(csvText) => CandidateEntry[]` 純函式。
**OSS 公開時，這會是社群貢獻的主入口**。

### 優先順序

1. 自己的主力銀行
2. 自己的主力信用卡
3. PayPay / 電子マネー
4. Amazon / 樂天購買履歷

---

## 6. Chrome 擴充的職責

**只做兩件事**，其餘一律放在 Web App。

### (a) 電商購買履歷擷取
- Amazon.co.jp `/gp/your-account/order-history`
- 樂天市場購買履歷
- Yahoo!ショッピング

→ 以品項為單位產生候選仕訳。可達成 CSV 拿不到的「明細層級分類」。

### (b) 收據拍照
- 從擴充啟動鏡頭 → 上傳到使用者自己的 Gemini API
- 取得結構化資料 → 送進 Web App

### 不做
- **網銀擷取**：違反規約、風險高。以 CSV 匯入替代

---

## 7. .xtx 產出

### 流程
1. 仕訳帳 → 試算表
2. 損益計算書 + 貸借対照表
3. 套用當年度 XML schema → 產生 `.xtx`
4. 使用者匯入 **e-Taxソフト(WEB版)** → マイナンバーカード署名 → 最終送出
   - 也相容傳統 PC 版 e-Taxソフト
   - 對應 `.xtx`（最終送信檔），不處理 `.wxtx`（WEB 版內部中間檔）

### 對象書類
- 所得税の確定申告書 B
- 青色申告決算書（一般用）共 4 頁
  - 損益計算書
  - 月別売上
  - 減価償却
  - 貸借対照表

### 警告
- 稅法、XML schema **每年都會改**
- **以「年度模組」實作**。每年 1～2 月需更新

---

## 8. 青色申告 65 萬控除的硬性要求

實作必須滿足下列條件：

- [x] 複式簿記
- [x] 貸借対照表 + 損益計算書
- [x] **e-Tax 電子申告 OR 優良な電子帳簿保存**（兩者擇一，否則只有 55 萬）
- [x] 帳簿保存 7 年（以 IndexedDB + 自動備份保證）

### 路線選擇

**Phase 1-4 採「e-Tax 電子申告」路線**：
- 只需保留訂正・刪除履歷 + 7 年保存
- 不必扛「優良な電子帳簿」的全部檢索要件
- 對個人事業主自用工具最務實

**「優良な電子帳簿」路線列為 Phase 5+ 進階選項**：
- 需滿足三條件檢索（取引年月日 / 取引金額 / 取引先），含範圍與組合檢索
- 売上 5,000 萬円以下的免除條件**不適用**於拿 65 萬控除的情境
- 好處：過少申告加算税減免 + 不依賴 e-Tax 連線
- 但 Dexie schema 從第一天起就要為這條路線預留複合 index（見第 17 節）

---

## 9. 開發路線

> **記法**：✅ 完了 / 🔧 進行中 / ⬜ 未着手 / ⏸ 後回し

### Phase 1a：骨架可動 ✅ 完了

- ✅ 仕訳帳 CRUD + Dexie schema（含第 17 節的複合 index）
- ✅ 仕訳手動輸入 UI（補助科目 + 多行複合仕訳 + 稅率対応）
- ✅ FSA API 自動本機資料夾備份（Chrome / Edge）
- ✅ CSV parser 1 家（住信SBI ハイブリッド預金）+ 通用 CSV 工具

### Phase 1b：報表 + 多瀏覽器対応 + テスト基盤 ✅ 完了

- ✅ 損益計算書（年度別）
- ✅ 月別売上（バーチャート）
- ✅ 仕訳一覧 + 篩選 + 分頁（複合 index 検証）
- ✅ 訂正（沖銷）機能
- ✅ 補助科目管理
- ✅ ホーム今月概況 hero panel
- ✅ 設定頁分離 + 路由（history mode + fallback 設定）
- ✅ OPFS フォルバック + 手動 JSON 匯出（Safari / Firefox / iOS 対応）
- ✅ PWA manifest + service worker（iPad「ホーム画面に追加」対応）
- ✅ Vitest + happy-dom + fake-indexeddb（テスト基盤、106 tests）
- ✅ CSV import UI（ファイル選択 → 候補プレビュー → 各行で対方科目選択 → 確定）
- ✅ 主要 8 parsers：三菱UFJ / 三井住友銀行 / 住信SBI / 楽天 / 三井住友カード / JCB / セゾン / PayPay
  - ⚠ SBI 以外は実 CSV 未検証、ヘッダー文字列は推定。実 CSV 入手後に微調整必要

### Phase 1c：完成度 + データ管理 ✅ 完了

- ✅ 勘定科目の有効/無効切替 UI（使わない科目を非表示にできる）
- ✅ 取引先 CRUD（インボイス番号、既定対方科目、公表サイトリンク）
- ✅ 自動分類ルール（CSV インポート時に対方科目自動入力、優先度順、ヒット数追跡）
- ✅ JSON から復元（バックアップから完全復元、互換性チェック）
- ✅ インポート履歴ページ + 整批訂正（バッチ単位で全件 reverseEntry）
- ✅ 申告ロック（年度を「申告済み」スナップショットでロック、ロック中は訂正不可）
- ✅ taxIncluded / homeOfficeRatio 入力欄（仕訳行ごと、Phase 2 集計層で活用予定）

### Phase 1d：パーサー拡張基盤 ✅ 完了

- ✅ Auto-discovery（`import.meta.glob` で `parsers/*.ts` の default export を自動収集）
  - 新しい parser を追加 → ファイル作成のみで UI に出現、`index.ts` 編集不要
- ✅ テンプレート一式（`_template.example.{ts,test.ts,csv}`）+ コピーするだけで開発開始
- ✅ JSON 宣言型 parser（`defineParser({ columns: {...} })`）
  - 銀行型 / カード型 / 符号付き型 の 3 パターンを設定だけで表現
  - TypeScript を書けない貢献者でも対応可能（将来的に Settings から JSON 投入する UI 想定）
- ✅ `CONTRIBUTING.md`：parser 追加の step-by-step（TypeScript / JSON 両方）+ fixture 匿名化ガイド

### Phase 2：青色申告可實際送出 ✅ 完了（.xtx 形式照合は残課題）

- ✅ 家事按分集計層套用（`expandHomeOffice`：仕訳行を「事業使用分」+「事業主貸」に自動分解）
- ✅ 固定資產台帳 CRUD（Settings の「固定資産」section）
- ✅ 減価償却計算（直接法・月按分・1円残し、`computeDepreciation`）
- ✅ 減価償却仕訳の年末一括生成（`generateYearEndDepreciation`、重複防止）
- ✅ 貸借対照表（`buildBS`：当期純利益を純資産に算入、balanced チェック）
- ✅ Reports 頁に BS section + `.xtx` ダウンロードボタン
- ⚠ **残課題**：`.xtx` の実 XSD 照合（国税庁公開のスキーマと突合し、要素名・名前空間・順序を確定）+ e-Taxソフト(WEB版) で読込検証

### Phase 2.5 候補（任意）

- 定率法（declining-balance）による減価償却対応
- 前期繰越（開始残高）処理 — 多期間運用に必要
- 修正申告（filed snapshot 解除後の差分仕訳ガイド）
- 月別経費の集計（PL 詳細）
- 取引先別 / 補助科目別 集計レポート

### Phase 3：好用度提升

- ✅ LLM 基盤（`domain/llm.ts`：BYOK Gemini クライアント、テキスト + 画像対応）
- ✅ LLM 自動分類（`domain/llm-classify.ts`：CSV インポート時、rule miss 行を一括分類、信頼度バッジ表示、ユーザー override で hit-count 記録）
- ✅ Gemini API キー UI（Settings の「LLM 連携」section、接続テスト付き、BYOK 完全クライアント側保存）
- ✅ 領収書 OCR（`domain/ocr.ts` + `/receipt` route：画像 → Gemini Vision → 編集可な構造データ → 仕訳化、`source='ocr'` で識別）
- ⬜ Chrome 擴充（Amazon + 樂天 履歴擷取）— monorepo 重構が必要、独立大型作業

### Phase 4：對外發布（OSS）
- 大量增加 CSV parser（コミュニティ貢献経由）
- README + 自架指南（Cloudflare Pages drag-drop / `npm run build` → 任意靜態主機）
- LICENSE（AGPL-3.0）
- DISCLAIMER.md + 初回起動時の免責同意 UI
- SECURITY.md / PRIVACY.md
- `aoiko` 商標確認（J-PlatPat 検索）
- Fixture を「明らかに虚構」な名前へ調整
- **E2E テスト整備**：Playwright（→ 第 17 節「テスト戦略」Tier 3）
  - 主要シナリオ全フロー、Chrome / Safari / Firefox の matrix
  - GitHub Actions matrix で PR ごとに実行
- **GitHub Actions CI**：`npm run verify` + Playwright を PR / push で自動実行
- JSON parser を Settings UI から追加できるようにする（Phase 1d で API は完成）
- Google Drive API 同步（OAuth、衝突處理、配額管理 — 任意）
- ⏸ **官方版（aoiko.app など）の運用判断は最後に決める**
  - 個人責任ライン・年次更新負荷・OSS 健全性のトレードオフが大きい
  - gnucash / HomeBank の姿勢と同様、自架推奨でスタートする可能性大
  - 決定までは「公開イコール OSS 公開（self-host 前提）」で進行

---

## 10. 技術棧

| 領域 | 選用 | 理由 |
|------|------|------|
| Frontend | **Svelte 5 + TypeScript + Vite**（純 SPA，**不用 SvelteKit**） | 使用者公司熟、bundle 小、寫法簡潔；runes 取代 store |
| UI | **bits-ui + shadcn-svelte + Tailwind CSS** | 無樣式 primitive + 可改源碼樣板，貼合 Svelte 生態 |
| 表格 | **TanStack Table（Svelte adapter）** 或 svelte-headless-table | 可編輯、虛擬滾動、欄位排序、a11y |
| 日付 | bits-ui 的 DatePicker + `@internationalized/date` | 日本語 locale、和暦處理 |
| State | **Svelte 5 runes**（`.svelte.ts` + class 單例） | 內建、無需額外套件；禁用 svelte/store 的 writable 等 |
| Storage | Dexie（IndexedDB wrapper） | 結構化、支援 index、liveQuery |
| 數值 | **Decimal.js** | 避免按分・稅率精度問題；禁用 JS number 處理金額 |
| 表單驗證 | zod + felte 或 sveltekit-superforms（純 Svelte 版） | 與 Decimal.js / Dexie schema 共用型別 |
| 路由 | 自製極小 history router（`src/router.svelte.ts`） | 30 行・依存ゼロ、SPA fallback で配備 |
| PWA | Vite PWA plugin | 離線 + 桌面安裝 |
| CSV 解析 | papaparse + iconv-lite（或 `TextDecoder('shift_jis')`） | 處理 Shift_JIS / UTF-8 兩種編碼 |
| 擴充 | Manifest V3（Phase 3 拆 monorepo） | 與 Web App 共享 parser／型別 |
| `.xtx` | 手刻 XML builder（xmlbuilder2） | schema 年度更新，不需重型 framework |

**目標瀏覽器**：Chrome / Edge 桌面版（FSA API 必要）。Safari / Firefox / iOS 走降級路徑（見第 11 節）。

**Svelte 5 寫法規範**：詳見 `CLAUDE.md`（runes-only，禁用 Svelte 4 legacy 寫法）。

---

## 11. 備份方針

### 雙軌降級策略

依瀏覽器能力自動切換，使用者首次啟動時依偵測結果決定走哪條路徑：

| 環境 | 持久化 | 備份方式 |
|------|--------|---------|
| Chrome / Edge 桌面 | IndexedDB + **FSA API 自動寫雲端同步資料夾** | 自動，無感 |
| Safari / Firefox / iOS | IndexedDB + **OPFS 鏡像** | 啟動 banner 提醒「N 天未匯出」，按鈕一鍵下載 JSON |

**能力偵測順序**：
1. `showDirectoryPicker` 可用 → 走 FSA API（主路徑）
2. `navigator.storage.getDirectory` 可用 → 走 OPFS + 手動匯出
3. 都不行（罕見）→ 純 IndexedDB + 強制每日匯出提醒

**抽象層**：定義 `BackupAdapter` 介面，兩種實作切換，UI 不需感知差異。

### Phase 1a：FSA API 路徑 ✅ 完了
- Directory handle 存進 IndexedDB（settings table の `backupFolderHandle`）、再起動時に再選択不要
- 新セッション初回書き込み時 `requestPermission()` を呼ぶ
- 仕訳・取引先・固定資産変更時に 1 秒デバウンスで自動書き出し
- Cloudflare Pages / Netlify / GitHub Pages いずれでも動作するよう静的 fallback 配備済（`public/_redirects` + Vite plugin による `dist/404.html`）

### Phase 1b：FSA API 不可用環境の降級 🔧 進行中
- **iPad / Safari / Firefox 利用時の必須機能**
- OPFS 鏡像をメイン永続化として採用（iOS Safari は無操作で IndexedDB がクリアされる仕様、OPFS の方が堅牢）
- 「JSON ダウンロード」ボタン、ファイル名は `aoiko-ledger-YYYY-MM-DD.json`、ユーザーが手動で iCloud Drive 等にコピー
- `navigator.storage.persist()` でストレージ永続化を要求（PWA 化と組合せ効果が最大）
- 「N 日間バックアップ無し」の警告 banner
- 能力偵測：`FsaBackupAdapter` → `OpfsBackupAdapter` → 純 IndexedDB（最終フォールバック、強制毎日匯出 prompt）

### Phase 1b：PWA 化 🔧 進行中
- iPad「ホーム画面に追加」対応（manifest + service worker）
- 「ホーム画面起動」状態では IndexedDB / OPFS が persistent storage に昇格し、無操作でも消えない
- Vite PWA plugin（`vite-plugin-pwa`）採用予定

### Phase 4：Google Drive API 直接整合
- OAuth 流程、token 管理、衝突解決、配額管理
- 工時超過 1 週
- 自用階段不需要，要對外發布時再評估

### 防止資料遺失的 UX
- 啟動時：偵測到本機資料但備份資料夾／OPFS 未設定 → 強制跳設定畫面
- 偵測到持續備份失敗 → 顯示警告
- iOS PWA 定位為「輔助查閱」，主要操作建議在桌面，於 README 與啟動畫面說明

---

## 12. 品牌

- **名稱**：aoiko（あおいこ／青い子）
- **吉祥物**：**猫**（方向確定、デザイン詳細は後日）。藏青色を基調にしたカラーリングと合わせる予定。
- **角色語氣案**：
  - empty state：「今月の仕訳、まだ 3 件しかないよ」
  - 確認對話框：「この仕訳、本当にこれでいい？」
  - 月底：「決算書出すね」
- **作業順序**：ユーザーが具体的なデザイン方向を確定するまで現状の「あ」placeholder で運用。確定後に icon / empty state 等を差し替え。

---

## 13. 風險與雷區

1. **稅法每年改**：科目、控除額、`.xtx` schema、インボイス制度。**把年度當成資料的一級維度**
2. **發布後的隱性責任**：即便寫明「自負責任」，使用者算錯仍會找來。README 與 App 內都要大字注記
3. **インボイス制度（2023 起）**：是否為適格請求書發行事業者會影響仕訳。取引先主檔必須含登錄號碼
   - 番号驗證若要整合国税庁 Web-API：**採 BYOK 應用 ID**（使用者自行寄 email 申請後填入），不代管，與 Gemini key 同模式
   - 預設提供「複製登錄番号 → 開新分頁查公表サイト」的快捷鈕作為零成本退路
4. **電子帳簿保存法**：65 萬控除的必要條件。**訂正履歷保存要在資料模型設計時就放進去**（事後補很痛）
5. **資料消失**：純本地 = 清瀏覽器資料即全損。**每月匯出 JSON 提醒** + Phase 1 自動備份雙保險
6. **網銀擷取的誘惑**：技術上可行但違反規約。**不做**

---

## 14. 對外發布的留意點

- 直接部署 GitHub Pages / Cloudflare Pages（零後端、零成本）
- README 明示對應範圍（「對應：XX 銀行、XX 卡、個人事業主青色申告」）
- 不做帳號系統。要分享資料就匯出 JSON
- i18n 之後再說。日文一種足以（自用 + JP 個人事業主）
- **授權：AGPL-3.0**
  - 防止他人拿去做收費 SaaS（稅務工具被商業化會有麻煩）
  - 個人使用、自架完全自由
  - **必須一開始就選定**：AGPL → MIT 不可能（要全部貢獻者同意）；反之亦然

---

## 15. 開發環境

### 設計取向
**選擇最標準、貢獻者門檻最低的組合**。工具鏈本身對「公開後好上手」幾乎無影響（後加無痛），真正影響門檻的是「README 一行指令能不能跑起來」與「devcontainer 是否就緒」。

### 必要工具

| 項目 | 選用 | 理由 |
|------|------|------|
| Runtime | **Node 22 LTS** | 釘 `.nvmrc` 與 `engines.node >=22` |
| 套件管理 | **npm** | 每個 Node 開發者都會、無額外安裝。Phase 3 真要 monorepo 時再升 pnpm |
| 編輯器 | VS Code | 已記載於 CLAUDE.md |
| 瀏覽器 | Chrome / Edge 最新版 | FSA API 必要 |

### 起手式（Phase 1a Day-0）

```bash
npm create vite@latest aoiko -- --template svelte-ts
cd aoiko
npm install
npm install dexie decimal.js
npm install -D tailwindcss @tailwindcss/vite
# shadcn-svelte 與 bits-ui 透過 CLI 初始化：
npx shadcn-svelte@latest init
npm run dev
```

### 專案結構（Phase 1a / 1b：單一 package）

```
aoiko/
├── .devcontainer/        # Codespaces 一鍵啟動
├── .nvmrc                # Node 22
├── LICENSE               # AGPL-3.0
├── package.json          # engines.node >=22
├── vite.config.ts
├── svelte.config.js
├── tsconfig.json         # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
├── tailwind.config.ts
├── app.css               # Tailwind base + shadcn-svelte CSS variables
└── src/
    ├── db/               # Dexie schema、複合 index、liveQuery 包裝
    ├── domain/           # 仕訳、決算邏輯、Decimal helpers（純 TS、框架無關）
    ├── parsers/          # CSV parsers（每行一個檔案 + fixture）
    ├── backup/           # BackupAdapter 介面 + FSA / OPFS 實作
    ├── tax-schema/       # 年度模組（2026/、2027/...）
    ├── stores/           # 全域 state（*.svelte.ts，class + 單例）
    ├── lib/              # 共用工具（shadcn-svelte 元件習慣放這）
    └── routes/           # 頁面元件（依 svelte-spa-router 組）
```

Phase 3 加 Chrome 擴充時再升級為 monorepo（將 `parsers` 與 `domain` 抽到 `packages/shared`）。**這時候已知道哪些東西要共用，重構比預先設計準確**。

### 工具鏈最小組合

導入済み：
- ✅ TypeScript strict mode（含 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）
- ✅ `svelte-check`（Svelte template + TS 整合檢查）
- ✅ Vite 內建錯誤檢查
- ✅ `.devcontainer/devcontainer.json`（Codespaces 一鍵啟動）
- ✅ `.nvmrc` + `engines`
- ✅ `LICENSE`（AGPL-3.0）
- ✅ `CLAUDE.md` 已含 Svelte 5 寫法規範
- ✅ **Vitest + happy-dom + fake-indexeddb**（unit / integration / DB tests）
- ✅ `npm run verify` 一鍵跑 check + test + build

未導入（需要時再裝）：
- ⬜ `@testing-library/svelte`：元件互動測試（form 提交、$state 變化）
- ⬜ **Playwright**：E2E 測試（跨頁面流程、真瀏覽器互動）
- ⬜ Biome：lint / format（多人協作起爭議時）
- ⬜ lefthook：pre-commit typecheck（防忘記跑 verify）
- ⬜ GitHub Actions CI：PR 自動跑 verify

### テスト戦略（Tier 別）

| Tier | 範囲 | 工具 | 状況 |
|------|------|------|------|
| 1 | 純邏輯（lib / domain / parsers） | Vitest | ✅ 完了 |
| 1 | DB 操作（Dexie） | Vitest + fake-indexeddb | ✅ 完了 |
| 2 | 元件互動（form / button click） | Vitest + @testing-library/svelte | ⬜ 第二個 parser 完成時導入 |
| 3 | E2E 全フロー（real browser、PWA install、FSA permission） | Playwright | ⬜ Phase 4 對外發布前導入 |
| 3 | 跨瀏覽器（Chrome / Safari / Firefox） | Playwright matrix | ⬜ Phase 4 |

**Tier 1 / 2 はオフラインで CI 友好**：すべての PR で必ず実行する。

**Tier 3（E2E）**：書き出し・取り扱いコストが高いため、UI 安定後の Phase 4 でまとめて整備する：
- 主要シナリオ：仕訳追加 → 一覧 → 訂正 → 確認、設定保存 → リロード保持、CSV インポート → 候補 → 確定、PWA インストール → オフライン起動 → 復元
- 非テスト対象（手動確認）：FSA 許可ダイアログ操作、iCloud Drive への手動コピー、iOS Safari「ホーム画面に追加」操作

---

## 16. 貢獻者體驗

### 設計目標
**末端使用者**完全不碰開發環境（純前端 = 開瀏覽器即可）。**貢獻者**門檻越低，OSS 生態才養得起來。

### 三種角色與門檻

| 角色 | 需要做什麼 | 門檻 |
|------|----------|------|
| 末端使用者（個人事業主） | 開瀏覽器訪問部署 URL | 零 |
| 貢獻者（寫 CSV parser） | clone + `npm install` + `npm run dev` | 中 |
| 自架者（不信任他人託管） | 自己 build 後丟靜態主機 | 中高 |

### CSV Parser 貢獻路徑 ✅ 完了

CSV parser は OSS の主入口。「ファイル 3 つ追加だけで貢献完了」を実現済み：

```
src/parsers/
  _template.example.ts        # コピー元（auto-discovery から除外）
  _template.example.test.ts   # テスト雛形
  fixtures/_template.example-sample.csv
  mufg.ts                     # 本物の parser（default export）
  mufg.test.ts
  fixtures/mufg-sample.csv
  index.ts                    # ↓ auto-discovery、編集不要
  json-config.ts              # JSON 宣言型 parser のファクトリ
```

#### Auto-discovery

`src/parsers/index.ts` は `import.meta.glob` で `./*.ts` の default export を自動収集。
**貢献者は `index.ts` を編集する必要なし**：ファイルを置けば UI に出現。

#### TypeScript で書く（柔軟）

貢献者の手順：
1. `_template.example.*` を 3 つコピー、リネーム
2. 値（name / displayName / accountCode / encoding / 列名）を編集
3. 自分の銀行 CSV を匿名化して fixture に貼る
4. `npm run test` で確認
5. PR

#### JSON で書く（簡単、限定的）

`defineParser({ columns: {...} })` で銀行型 / カード型 / 符号付き型の 3 パターンを宣言的に表現可能。
TypeScript を書けない貢献者でも対応可能。詳細は `CONTRIBUTING.md`。

→ **Dexie / Svelte / app 全体の知識は一切不要**。
parser 層と UI 層は分離されており、parser は純粋関数。

### README 的「3 分鐘上手」段落

Phase 1a 就要寫好（即便還沒對外）：

```bash
git clone https://github.com/.../aoiko.git
cd aoiko
npm install
npm run dev
# → http://localhost:5173
```

任何多一步都會勸退人。

### Devcontainer / Codespaces

`.devcontainer/devcontainer.json` 從第一天起準備。
**這是公開後最大幅降低門檻的單一動作**——貢獻者按一個按鈕就在瀏覽器裡有完整環境，連本機 Node 都不用裝。

### 公開時補齊的清單（Phase 4）

- `LICENSE`（AGPL-3.0，**Phase 1a 就放好**）
- `README.md`：日文 + 大字免責聲明
- `DISCLAIMER.md` + app 內首次啟動強制閱讀彈窗
- `CONTRIBUTING.md`：CSV parser 貢獻指南為主
- `SECURITY.md`：BYOK 風險告知
- `PRIVACY.md`：明示「無後端、無遙測、無 cookie」
- Issue templates（bug / parser request / 稅法變更回報）
- PR template
- GitHub Actions CI（typecheck + test + build）
- Renovate 或 Dependabot
- Branch protection（main 必須 PR + CI 過）

---

## 17. 下一步行動候選

- [ ] 資料模型（Dexie schema）的詳細設計
  - 一開始就放好複合 index：`[date+amount]`、`[date+vendorId]`、`[vendorId+amount]`
  - 為「優良な電子帳簿」三條件檢索（取引年月日 / 取引金額 / 取引先）預留路徑
  - 訂正履歷欄位（`originalEntryId`、`reversedAt` 等）一併設計
- [ ] 第一個 CSV parser 模板
- [ ] 當年度 `.xtx` schema 的規格調查（以 e-Taxソフト(WEB版) 為匯入對象）
- [ ] 專案骨架建立（Vite + React + Dexie + Manifest V3 monorepo）
- [ ] `BackupAdapter` 介面設計（FSA / OPFS 兩實作）
- [ ] 吉祥物初稿