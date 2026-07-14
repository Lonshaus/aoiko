# aoiko 使用指南

<p align="center">
  <img src="../../src/assets/logo-wordmark.png" alt="aoiko" width="360" />
</p>

**Language**: [日本語](README.md) | [English](README_en.md) | **繁體中文**

給第一次用 aoiko 的人的逐步操作說明。每章對應一個功能或一種工作流，從上往下讀完就能完成日常記帳。

> 安裝與啟動請看[主 README](../../README_zh-TW.md)。本指南專注於打開 App **之後**怎麼用。

## 目錄

### A 群：基本操作（先讀）

- [01. 初次設定](01-setup_zh-TW.md) — 免責同意、商號、年度、消費税方式、輔助科目、交易對象、OCR/LLM 引擎選擇
- [02. 建立傳票](02-journal_zh-TW.md) — 手動建立、沖銷傳票（修正傳票）、傳票列表複合搜尋
- [03. CSV 匯入](03-csv-import_zh-TW.md) — 從銀行・信用卡明細一次建立傳票、自動分類規則、匯入紀錄
- [06. 報表](06-reports_zh-TW.md) — 月別銷貨、損益計算書、資產負債表、月別 PL、交易對象別集計、消費税 4 方式比較

### B 群：周邊取込（視需要）

- [04. 收據 OCR](04-receipt-ocr_zh-TW.md) — 紙本收據 → 傳票候選
- [05. 訂單取込](05-order-import_zh-TW.md) — Amazon / 楽天 等貼上 → LLM 抽取

### C 群：進階功能（視需要）

- [07. 消費税](07-consumption-tax_zh-TW.md) — 4 方式怎麼選、經過措置、仕入税額控除
- [08. 減價償卻](08-depreciation_zh-TW.md) — 固定資產、定額・定率法、少額 40 萬日圓特例
- [09. 前期繰越](09-carryover_zh-TW.md) — 年度切換、期首振替傳票
- [10. `.xtx` 輸出](10-xtx-export_zh-TW.md) — e-Tax 格式產生與匯入驗證
- [11. 備份與還原](11-backup_zh-TW.md) — File System Access API、OPFS、JSON 匯出
- [12. 修正申告](12-amended_zh-TW.md) — 申告済 snapshot、差分偵測、提交手順
- [13. 開業時設定（開業精靈）](13-opening-setup_zh-TW.md) — 開業費、轉用資產未償卻殘額計算、自由項目
- [14. 所得控除・税額控除](14-income-deductions_zh-TW.md) — 輸入家庭成員・保險費・醫療費・捐款等資料，試算基礎扣除〜復興特別所得税，並反映到 `.xtx` 輸出
- [15. 請款單・報價單的發行](15-invoices_zh-TW.md) — 發行時自動產生仕訳・應收帳款、以打消し仕訳訂正、報價單轉請款單

## 意見回饋

不清楚的地方、錯誤、改善建議請到 [GitHub Issues](https://github.com/Lonshaus/aoiko/issues)。