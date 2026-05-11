# aoiko（あおいこ / 青い子）

日本の個人事業主向け、純フロントエンド帳簿ツール。青色申告 65万円控除を目標に、CSV/OCR/拡張機能からの取り込み、複式簿記、減価償却、貸借対照表、`.xtx` 出力までを Web App 単体で完結させる。バックエンド無し、BYOK（API キーは利用者が持参）。

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
├── domain/              # ドメインロジック（フレームワーク非依存・Vitest テスト対象）
│   ├── journal.ts          # 仕訳の作成・確定
│   ├── reverse.ts          # 訂正仕訳
│   ├── reports.ts          # PL / BS / 月別 / 取引先別
│   ├── depreciation.ts     # 定額法・定率法 減価償却
│   ├── carryover.ts        # 前期繰越（期首振替）
│   ├── home-office.ts      # 家事按分
│   ├── snapshots.ts        # 年度ロック（申告済み）
│   ├── amended.ts          # 修正申告ガイド
│   ├── llm-classify.ts     # LLM による CSV 行分類
│   ├── ocr.ts              # 領収書 OCR
│   ├── rules.ts            # ルール エンジン
│   ├── import.ts           # CSV インポートのオーケストレーション
│   └── restore.ts          # バックアップ復元
├── parsers/             # 銀行・カード CSV パーサ（プラグイン）
├── routes/              # Svelte ルート（Home / Journal / Reports / Import / Receipt / Settings）
├── components/          # 再利用 Svelte コンポーネント
├── stores/              # グローバル state（class + singleton）
├── lib/                 # Decimal / id / settings ヘルパ
├── db/                  # Dexie スキーマ
├── backup/              # バックアップ adapter（FSA / OPFS）
└── tax-schema/          # 年度別税制スキーマ
    └── 2026/               # 勘定科目テーブル・.xtx 出力（仮）
```

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

[AGPL-3.0](LICENSE)（公開時に LICENSE ファイルを同梱予定）

## 開発規範

`CLAUDE.md` 参照。