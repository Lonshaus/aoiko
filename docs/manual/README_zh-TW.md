# aoiko 使用指南

**Language**: [日本語](README.md) | [English](README_en.md) | **繁體中文**

給第一次用 aoiko 的人的逐步操作說明。每章對應一個功能或一種工作流，從上往下讀完就能完成日常記帳。

> 安裝與啟動請看[主 README](../../README_zh-TW.md)。本指南專注於打開 App **之後**怎麼用。

## 目錄

### A 群：基本操作（先讀）

1. [初次設定](01-setup_zh-TW.md) — 免責同意、商號、年度、消費税方式、輔助科目、交易對象、OCR/LLM 引擎選擇
2. [建立傳票](02-journal_zh-TW.md) — 手動建立、沖銷傳票（修正傳票）、傳票列表複合搜尋
3. [CSV 匯入](03-csv-import_zh-TW.md) — 從銀行・信用卡明細一次建立傳票、自動分類規則、匯入紀錄
4. [報表](06-reports_zh-TW.md) — 月別銷貨、損益計算書、資產負債表、月別 PL、交易對象別集計、消費税 4 方式比較

### B 群：周邊取込（視需要）

5. [收據 OCR](04-receipt-ocr_zh-TW.md) — 紙本收據 → 傳票候選
6. [訂單取込](05-order-import_zh-TW.md) — Amazon / 楽天 等貼上 → LLM 抽取

### C 群：進階功能（視需要）

7. [消費税](07-consumption-tax_zh-TW.md) — 4 方式怎麼選、經過措置、仕入税額控除
8. [減價償卻](08-depreciation_zh-TW.md) — 固定資產、定額・定率法、少額 40 萬日圓特例
9. [前期繰越](09-carryover_zh-TW.md) — 年度切換、期首振替傳票
10. [`.xtx` 輸出](10-xtx-export_zh-TW.md) — e-Tax 格式產生與匯入驗證
11. [備份與還原](11-backup_zh-TW.md) — File System Access API、OPFS、JSON 匯出
12. [修正申告](12-amended_zh-TW.md) — 申告済 snapshot、差分偵測、提交手順

## 體例

- **UI 元素名**完全照畫面顯示引用（例：「設定」→「LLM 連動」）
- **程式碼塊**寫實際指令、檔案路徑或 JSON 值
- **> 引用塊**標注意點、地雷、補充
- **截圖**：之後視需要放 `docs/manual/images/`，目前以純文字為主

## 意見回饋

不清楚的地方、錯誤、改善建議請到 [GitHub Issues](https://github.com/Lonshaus/aoiko/issues)。