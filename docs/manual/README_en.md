# aoiko User Guide

**Language**: [日本語](README.md) | **English** | [繁體中文](README_zh-TW.md)

Step-by-step instructions for first-time aoiko users. Each chapter covers one feature or workflow; reading them in order gives you everything you need for day-to-day operation.

> For installation and startup, see the [main README](../../README_en.md). This guide focuses on what to do **after** opening the app.

## Table of contents

### A. Basics (read first)

1. [Initial setup](01-setup_en.md) — disclaimer, trade name, year, consumption tax method, sub-accounts, vendors, OCR/LLM engine
2. [Creating journal entries](02-journal_en.md) — manual entry, correcting (reversing) entries, composite search on the journal list
3. [CSV import](03-csv-import_en.md) — bulk-create entries from bank/card statements, auto-classification rules, import history
4. [Reports](06-reports_en.md) — monthly sales, P/L, balance sheet, monthly P/L, vendor breakdown, consumption-tax 4-method comparison

### B. Additional import paths (as needed)

5. [Receipt OCR](04-receipt-ocr_en.md) — paper receipt → journal candidate
6. [Order import](05-order-import_en.md) — paste Amazon / 楽天 etc. → LLM extract

### C. Advanced features (as needed)

7. Consumption tax — choosing among 4 methods, transitional credit, input tax credit (TBD)
8. Depreciation — fixed assets, straight-line / declining balance, ¥400k small-asset rule (TBD)
9. Prior-period carryover — fiscal year transition, opening journal (TBD)
10. `.xtx` export — e-Tax format generation and import verification (TBD)
11. Backup and restore — File System Access API, OPFS, JSON export (TBD)
12. Amended filing — filed snapshots, diff detection, submission steps (TBD)

## Conventions

- **UI labels** are quoted exactly as shown on screen (e.g. "Settings" → "LLM integration")
- **Code blocks** are actual commands, file paths, or JSON values
- **> Block quotes** indicate cautions, pitfalls, or supplementary notes
- **Images**: when needed they go in `docs/manual/images/`; the guide is text-first to begin with

## Feedback

Please report unclear points, errors, or suggestions on [GitHub Issues](https://github.com/Lonshaus/aoiko/issues).