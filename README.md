# aoiko（あおいこ / 青い子）

日本の個人事業主向け、純フロントエンド帳簿ツール。青色申告 **75 万円**控除（令和 9 年分以降、要 e-Tax 期限内提出 + 優良な電子帳簿保存 / 改正前の 65 万円控除にも引き続き対応）を目標に、CSV/OCR/拡張機能からの取り込み、複式簿記、減価償却、貸借対照表、`.xtx` 出力までを Web App 単体で完結させる。バックエンド無し、BYOK（API キーは利用者が持参）。

> 🚧 **Phase 2.5 完了。Phase 3（Chrome 拡張）・Phase 4（対外発布）作業中。実申告で使用しないこと。**

## 主な機能

- **複式簿記**：仕訳・訂正仕訳（修正仕訳）・電子帳簿保存法準拠の監査履歴
- **CSV 取り込み**：MUFG / SMBC / SBI / 楽天 / SMBCカード / JCB / セゾン / PayPay（7/8 は実 CSV 未検証）
- **OCR**：Gemini Vision で領収書 → 仕訳候補
- **LLM 分類**：CSV 行 → 勘定科目（ルール優先・LLM フォールバック）
- **家事按分**：自宅兼事務所の経費を事業使用分・事業主貸へ自動分割
- **減価償却**：定額法・200% 定率法（耐用年数 2〜20 年）、月按分・1 円残し
- **前期繰越**：前年末残高 → 期首振替仕訳の自動生成（純利益・事業主貸借を元入金へ吸収）
- **報表**：月別売上・損益計算書・貸借対照表・月別 PL（科目 × 月）・取引先別 / 補助科目別集計
- **修正申告ガイド**：申告済スナップショットと現在値の差分表示 + 提出手順
- **バックアップ**：File System Access API（Chromium）→ OPFS（Safari/Firefox）の自動フォールバック
- **PWA**：オフライン動作

## 技術構成

| Layer | Tech |
|-------|------|
| UI | Svelte 5（runes） + Tailwind + bits-ui + shadcn-svelte |
| Build | Vite + vite-plugin-pwa |
| Storage | IndexedDB（Dexie）+ File System Access API / OPFS |
| Money | Decimal.js（14+2 ゼロパディング辞書順インデックス） |
| LLM | Google Gemini API（BYOK） |
| Test | Vitest + fake-indexeddb |
| Lang | TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |

> SvelteKit 不使用（純 SPA、自前 history router）。

## ディレクトリ

```
src/
├── domain/             # ドメインロジック（フレームワーク非依存・Vitest テスト対象）
│   ├── journal.ts      # 仕訳の作成・確定
│   ├── reverse.ts      # 訂正仕訳
│   ├── reports.ts      # PL / BS / 月別 / 取引先別
│   ├── depreciation.ts # 定額法・定率法 減価償却
│   ├── carryover.ts    # 前期繰越（期首振替）
│   ├── home-office.ts  # 家事按分
│   ├── snapshots.ts    # 年度ロック（申告済み）
│   ├── amended.ts      # 修正申告ガイド
│   ├── llm-classify.ts # LLM による CSV 行分類
│   ├── ocr.ts          # 領収書 OCR
│   ├── rules.ts        # ルール エンジン
│   ├── import.ts       # CSV インポートのオーケストレーション
│   └── restore.ts      # バックアップ復元
├── parsers/            # 銀行・カード CSV パーサ（プラグイン）
├── routes/             # Svelte ルート（Home / Journal / Reports / Import / Receipt / Settings）
├── components/         # 再利用 Svelte コンポーネント
├── stores/             # グローバル state（class + singleton）
├── lib/                # Decimal / id / settings ヘルパ
├── db/                 # Dexie スキーマ
├── backup/             # バックアップ adapter（FSA / OPFS）
└── tax-schema/         # 年度別税制スキーマ
    └── 2026/           # 勘定科目テーブル・.xtx 出力（仮）
```

## 利用者向け：ローカル起動

ホスティング先は未定のため、現状は **自分の PC で起動して使う** 形式。データはブラウザの IndexedDB に保存されローカル端末から外に出ない（[PRIVACY.md](PRIVACY.md) 参照）。

### 前提

- [Node.js 22 LTS](https://nodejs.org/) 以上（npm 同梱）
- Git（リポジトリ取得用、ZIP ダウンロードでも可）
- モダンブラウザ（Chrome / Edge / Safari / Firefox）

### 起動手順

```bash
git clone https://github.com/Lonshaus/aoiko.git
cd aoiko
npm install
npm run build
npm run preview
```

ブラウザで <http://localhost:4173> を開く。初回は免責事項に同意し、「設定」画面で事業名・年度・（OCR/LLM を使う場合は）Gemini API キーを入力。

### PWA としてインストール（推奨）

Chrome / Edge のアドレスバー右に出る「インストール」ボタンからインストールすれば、デスクトップアプリのように起動でき、オフラインでも動く。Safari は「共有」→「ホーム画面に追加」。

### データ保存場所

- 仕訳・固定資産・取引先・設定 → ブラウザの IndexedDB（端末内、サーバ送信なし）
- 「設定」→「バックアップ」でローカルフォルダを指定すると自動 JSON バックアップ（File System Access API、対応外ブラウザは OPFS）

ブラウザのデータを消去すると IndexedDB も消えるため、定期的な手動エクスポート（設定画面）かバックアップフォルダ指定を推奨。

### アップデート方法

```bash
git pull
npm install
npm run build
npm run preview
```

PWA としてインストール済みの場合、起動時に新バージョン検出ダイアログが出る。

## 開発

```bash
npm install
npm run dev        # 開発サーバ
npm run test       # Vitest 実行
npm run check      # svelte-check 型チェック
npm run build      # 本番ビルド
npm run verify     # test + check + build
```

Node 22 LTS（CI も 22 で実行。ローカルは Node 24 でも可、`engines: >=22`）/ npm。

## ステータス

| Phase | 状態 |
|-------|------|
| 1（仕訳・基本 UI・スキーマ） | ✅ |
| 2（CSV インポート・LLM・OCR・家事按分・減価償却） | ✅ |
| 2.5（前期繰越・月別 PL・取引先別・定率法・修正申告） | ✅ |
| 3（Chrome 拡張：Amazon / 楽天 履歴擷取） | ⬜ |
| 4（対外発布：LICENSE / README polish / DISCLAIMER / CI / E2E / 法務） | 進行中 |

## ライセンス

[GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）

## 法務・安全に関する文書

- [DISCLAIMER.md](DISCLAIMER.md) — 免責事項（実申告・税法準拠・LLM 利用リスク）
- [SECURITY.md](SECURITY.md) — セキュリティポリシー、脆弱性報告手順
- [PRIVACY.md](PRIVACY.md) — プライバシーポリシー、収集・送信データの内訳

## 開発規範

`CLAUDE.md` 参照。