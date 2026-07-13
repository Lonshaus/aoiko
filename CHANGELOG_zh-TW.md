# Changelog

**Language**: [日本語](CHANGELOG.md) | [English](CHANGELOG_en.md) | **繁體中文**

本檔案格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版號遵循 [Semantic Versioning](https://semver.org/)。對 aoiko 而言，「破壞相容性的變更（major）」指讓既有備份 JSON 或瀏覽器內資料（IndexedDB）無法被新版讀取的變更。

## [1.0.0] - 2026-07-13

初版發佈。

### 新增

- 複式簿記記帳：仕訳、訂正仕訳、符合電子帳簿保存法的稽核履歷、滿足優良な電子帳簿要件的複合検索
- 青色申告與白色申告雙對應：青色申告決算書（一般用・不動産所得用）／収支内訳書（一般用・不動産所得用）
- e-Tax `.xtx` 輸出：確定申告書＋決算書併載於同一檔，另支援消費稅申告書（本則課税・簡易課税・2割特例）。依國稅廳官方 XSD、已通過 e-Tax 軟體實機匯入驗證
- 銀行與信用卡 CSV 匯入（13 種 parser、全部用真實 CSV 驗證過）、取込履歴、重複偵測、整批 reverse
- 收據 OCR、訂單頁貼上匯入、LLM 科目分類（Gemini／OpenAI 相容・Ollama 等／Tesseract，對外送出前有確認對話框）
- 減價償卻（定額法、200% 定率法、少額特例、一括償卻）、家事按分、前期繰越、開業時設定（開業精靈）
- 消費稅概算 4 方式比較（本則・簡易・2割特例・3割特例，自動套用 80/70/50/30% 經過措置）
- 報表：月別売上、損益計算書、貸借対照表、月別 PL、取引先別／補助科目別集計
- 請求書與見積書製作
- 修正申告引導（申告済 snapshot 與目前值的差分顯示）
- JSON 備份與還原（File System Access API，自動 fallback 到 OPFS）
- PWA 離線運作、三語 UI（日本語／English／繁體中文）

[1.0.0]: https://github.com/Lonshaus/aoiko/releases/tag/v1.0.0