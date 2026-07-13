# aoiko User Guide

<p align="center">
  <img src="../../src/assets/logo-wordmark.png" alt="aoiko" width="360" />
</p>

**Language**: [日本語](README.md) | **English** | [繁體中文](README_zh-TW.md)

Step-by-step instructions for first-time aoiko users. Each chapter covers one feature or workflow; reading them in order gives you everything you need for day-to-day operation.

> For installation and startup, see the [main README](../../README_en.md). This guide focuses on what to do **after** opening the app.

## Table of contents

### A. Basics (read first)

- [01. Initial setup](01-setup_en.md) — disclaimer, trade name, year, consumption tax method, sub-accounts, vendors, OCR/LLM engine
- [02. Creating journal entries](02-journal_en.md) — manual entry, correcting (reversing) entries, composite search on the journal list
- [03. CSV import](03-csv-import_en.md) — bulk-create entries from bank/card statements, auto-classification rules, import history
- [06. Reports](06-reports_en.md) — monthly sales, P/L, balance sheet, monthly P/L, vendor breakdown, consumption-tax 4-method comparison

### B. Additional import paths (as needed)

- [04. Receipt OCR](04-receipt-ocr_en.md) — paper receipt → journal candidate
- [05. Order import](05-order-import_en.md) — paste Amazon / 楽天 etc. → LLM extract

### C. Advanced features (as needed)

- [07. Consumption tax](07-consumption-tax_en.md) — choosing among 4 methods, transitional credit, input tax credit
- [08. Depreciation](08-depreciation_en.md) — fixed assets, straight-line / declining balance, ¥400k small-asset rule
- [09. Prior-period carryover](09-carryover_en.md) — fiscal year transition, opening journal
- [10. `.xtx` export](10-xtx-export_en.md) — e-Tax format generation and import verification
- [11. Backup and restore](11-backup_en.md) — File System Access API, OPFS, JSON export
- [12. Amended filing](12-amended_en.md) — filed snapshots, diff detection, submission steps
- [13. Business opening setup (Opening Wizard)](13-opening-setup_en.md) — pre-opening expenses, converted-asset book value calculation, custom items
- [14. Income & tax deductions](14-income-deductions_en.md) — entering family, insurance, medical expense, and donation data; estimating from the basic deduction through the special reconstruction income tax; reflecting the result in the `.xtx` export
- [15. Issuing invoices and quotes](15-invoices_en.md) — auto-generated journal entry and receivable on issue, correction via reversing entry, converting a quote to an invoice

## Feedback

Please report unclear points, errors, or suggestions on [GitHub Issues](https://github.com/Lonshaus/aoiko/issues).