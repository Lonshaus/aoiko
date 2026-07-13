# Changelog

**Language**: **日本語** | [English](CHANGELOG_en.md) | [繁體中文](CHANGELOG_zh-TW.md)

本ファイルの形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、バージョン番号は [Semantic Versioning](https://semver.org/lang/ja/) に従う。aoiko における「互換性を壊す変更（major）」は、既存のバックアップ JSON またはブラウザ内データ（IndexedDB）が新バージョンで読めなくなる変更を指す。

## [1.0.0] - 2026-07-13

初版リリース。

### 追加

- 複式簿記の記帳：仕訳・訂正仕訳・電子帳簿保存法準拠の監査履歴・優良な電子帳簿要件の複合検索
- 青色申告・白色申告の両対応：青色申告決算書（一般用・不動産所得用）／収支内訳書（一般用・不動産所得用）
- e-Tax `.xtx` 書き出し：確定申告書＋決算書の併載、消費税申告書（本則課税・簡易課税・2割特例）。国税庁公式 XSD 準拠・e-Tax ソフト実機組み込み検証済み
- 銀行・クレジットカード CSV 取り込み（13 種、実 CSV 検証済み）・取込履歴・重複検知・バッチ単位 reverse
- 領収書 OCR・注文ページ貼り付け取り込み・LLM 科目分類（Gemini／OpenAI 互換・Ollama 等／Tesseract、外部送信前の確認ダイアログ付き）
- 減価償却（定額法・200% 定率法・少額特例・一括償却）・家事按分・前期繰越・開業時セットアップ（開業精霊）
- 消費税概算の 4 方式比較（本則・簡易・2割特例・3割特例、経過措置 80/70/50/30% 対応）
- 報表：月別売上・損益計算書・貸借対照表・月別 PL・取引先別／補助科目別集計
- 請求書・見積書の作成
- 修正申告ガイド（申告済スナップショットとの差分表示）
- JSON バックアップ・復元（File System Access API／OPFS 自動フォールバック）
- PWA オフライン動作・三言語 UI（日本語・English・繁體中文）

[1.0.0]: https://github.com/Lonshaus/aoiko/releases/tag/v1.0.0