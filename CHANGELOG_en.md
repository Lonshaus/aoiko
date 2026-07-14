# Changelog

**Language**: [日本語](CHANGELOG.md) | **English** | [繁體中文](CHANGELOG_zh-TW.md)

This file follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and the versions follow [Semantic Versioning](https://semver.org/). For aoiko, a "breaking change" (major) means a change that makes existing backup JSON or in-browser data (IndexedDB) unreadable by the new version.

## [1.0.0] - 2026-07-13

Initial release.

### Added

- Double-entry bookkeeping: journal entries, correcting entries, audit history in line with the Electronic Books Storage Act, composite search satisfying the qualified electronic ledger requirements
- Both blue and white return support: blue-return financial statements (general / real estate) and income-and-expense breakdown statements (general / real estate)
- e-Tax `.xtx` export: tax return bundled with the financial statement, plus consumption tax returns (general taxation / simplified taxation / 20% special rule). Conforms to the NTA's official XSD, verified against a real e-Tax software import
- Bank and credit-card CSV import (13 parsers, validated against real CSVs), import history, duplicate detection, batch-level reverse
- Receipt OCR, order-page paste import, and LLM account classification (Gemini / OpenAI-compatible incl. Ollama / Tesseract, with a pre-send confirmation dialog)
- Depreciation (straight-line, 200% declining-balance, small-asset special rule, lump-sum), home office allocation, prior-period carryover, business opening setup (Opening Wizard)
- Consumption tax estimation with 4-method comparison (general / simplified / 20% special / 30% special), transitional 80/70/50/30% input-tax credit applied automatically
- Reports: monthly sales, P/L, balance sheet, monthly P/L, vendor / sub-account breakdowns
- Invoice and quotation creation (auto-generates the receivable journal entry on issue, corrections via reversing entries, quotation-to-invoice conversion)
- Amended filing guide (diff between filed snapshot and current values)
- JSON backup and restore (File System Access API with OPFS automatic fallback)
- PWA offline operation, trilingual UI (日本語 / English / 繁體中文)

[1.0.0]: https://github.com/Lonshaus/aoiko/releases/tag/v1.0.0