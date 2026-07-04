# aoiko 使い方ガイド

<p align="center">
  <img src="../../src/assets/logo-wordmark.png" alt="aoiko" width="360" />
</p>

**Language**: **日本語** | [English](README_en.md) | [繁體中文](README_zh-TW.md)

aoiko を初めて使う方向けの操作手順書です。各章は 1 つの機能・1 つの作業フローに対応していて、上から順に読めば日常運用に必要な操作がひととおり身につきます。

> aoiko のインストール・起動方法は [メイン README](../../README.md) を参照してください。本ガイドはアプリを開いた後の操作にフォーカスします。

## 目次

### A. 基本操作（最初に読む）

1. [初回設定](01-setup.md) — 免責同意、屋号、年度、消費税方式、補助科目・取引先、OCR/LLM エンジン選択
2. [仕訳の作成](02-journal.md) — 手動仕訳、訂正仕訳、仕訳一覧の複合検索
3. [CSV 取込](03-csv-import.md) — 銀行・カード明細から仕訳をまとめて作成、自動分類ルール、取込履歴
4. [レポート](06-reports.md) — 月別売上、損益計算書（PL）、貸借対照表（BS）、月別 PL、取引先別集計、消費税 4 方式比較

### B. 周辺取込（必要に応じて）

5. [領収書 OCR](04-receipt-ocr.md) — 紙レシート → 仕訳候補
6. [注文取込](05-order-import.md) — Amazon / 楽天 等の貼り付け → LLM 抽出

### C. 進階機能（必要に応じて）

7. [消費税](07-consumption-tax.md) — 4 方式の選び方、経過措置、仕入税額控除
8. [減価償却](08-depreciation.md) — 固定資産、定額・定率法、少額 40 万特例
9. [前期繰越](09-carryover.md) — 年度切替、期首振替仕訳
10. [`.xtx` 出力](10-xtx-export.md) — e-Tax 形式の生成と取込検証
11. [バックアップと復元](11-backup.md) — File System Access API、OPFS、JSON エクスポート
12. [修正申告](12-amended.md) — 申告済スナップショット、差分検出、提出手順

## フィードバック

不明な点・誤り・改善案は [GitHub Issues](https://github.com/Lonshaus/aoiko/issues) へどうぞ。