# aoiko（あおいこ）

<p align="center">
  <img src="src/assets/logo-wordmark.png" alt="aoiko" width="360" />
</p>

**Language**: [日本語](README.md) | **English** | [繁體中文](README_zh-TW.md)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

🌐 **Online**: <https://aoiko.pages.dev>

A pure-frontend bookkeeping tool for Japanese sole proprietors. Supports the three-tier blue return (青色申告) deduction from tax year 2027 (Reiwa 9) — ¥750,000 / ¥650,000 / ¥100,000 (see the Guide's "01. Initial setup" and "14. Income & tax deductions" chapters for the requirements). Provides CSV/OCR/online-store order page import, double-entry bookkeeping, depreciation, balance sheet, and `.xtx` (e-Tax format) export in a single app. The white return (income/expense breakdown statement) is also supported. No backend, BYOK (you bring your own API key).

<p align="center">
  <img src="docs/images/screenshot-home-en.png" alt="Home: monthly summary, journal entry form, and recent entries" width="49%" />
  <img src="docs/images/screenshot-reports-en.png" alt="Reports: yearly summary and monthly sales" width="49%" />
</p>


## Features

- **Double-entry bookkeeping**: journal entries, reversing entries (修正仕訳), audit history that preserves the original entry
- **CSV import**: banks = MUFG / SMBC / SBI Shinsei; payment apps = PayPay (credit-card payments only; balance not supported); cards = Rakuten / JCB (incl. Recruit Card) / Saison / SMBC / MUFG / au PAY / PayPay / View (JRE CARD) / Life
- **Import history**: per-batch records of CSV imports, file-hash duplicate detection, batch-level reversal
- **OCR**: receipt → journal candidate. Engine selectable: Gemini Vision (default) / OpenAI-compatible / Ollama and other local AIs that accept image input / your browser's built-in AI / **Tesseract (purely local WASM OCR — does not extract vendor or items, leaving those fields empty; manual verification required)**
- **Order import (paste → AI extract)**: paste a full Amazon / Rakuten order page; an AI extracts the line items → review → save. Resilient to UI changes since no DOM scraping.
- **AI classification**: CSV line → account code (rule-first, AI fallback). Engine selectable: Gemini / OpenAI-compatible / Ollama and other local AIs / your browser's built-in AI.
- **OCR/AI privacy**: pre-send confirmation dialog before external transmission (skippable via a setting). With Ollama on localhost or with Tesseract selected, images never leave your device (to use localhost, allow aoiko's public URL in Ollama's `OLLAMA_ORIGINS` setting; Tesseract's language data is served by aoiko itself too, so it makes no external request at all).
- **Home-office allocation**: auto-split mixed business / personal expenses into business portion and owner's draws
- **Depreciation**: straight-line, 200% declining-balance (useful lives 2–20 years), old straight-line, old declining-balance, lease-period straight-line, and lump-sum depreciable assets (3-year equal write-off); monthly proration, ¥1 memorandum value
- **Small-asset depreciation special provision**: Special Taxation Measures Act Art. 28-2 (¥300,000 → ¥400,000 threshold from 2026-04-01), with ¥3,000,000 annual cap tracking
- **Prior-period carryover**: auto-generate the carryover entry from prior year-end balances (net profit and 事業主貸 / 事業主借 (owner's draws / contributions) are absorbed into 元入金 (owner's capital))
- **Opening Setup**: pre-opening expenses, converted assets (auto-computes the opening book value for personal-to-business conversions per NTA rules), and custom items — generates the journal entries and fixed-asset registrations in one go
- **Consumption tax estimation**: compares general and simplified taxation (categories 1–6, always shown) plus the special provision that applies to that year (the 20% special provision through 2026, the 30% special provision for 2027–2028), with the 80/70/50/30% transitional input-tax credit automatically applied
- **e-Tax `.xtx` export**: bundles the tax return (KOA020) with the matching financial statement (blue-return financial statements KOA210, or the income/expense breakdown statement KOA110 — switchable via filing type) into one file; when there is real estate income, the real-estate statement (KOA220 or KOA130) is bundled too. Consumption tax returns (general taxation, simplified taxation, 20% special provision) are exported as a separate file
- **Reports**: monthly sales, P/L, balance sheet, monthly P/L (account × month), vendor / subaccount breakdowns, consumption-tax method comparison
- **Composite search**: in the journal list, combine two or more of year / month / description / amount range / vendor (only entries created from invoices carry a vendor)
- **Invoices & quotes**: create and print documents with line items and per-rate tax breakdowns (includes the invoice-system registration number and per-rate consumption tax amounts), auto-generates the accounts-receivable journal entry on issue, corrections via reversing entries, quote-to-invoice conversion
- **Amended filing guide**: diff between filed snapshot and current values + submission steps
- **Backup**: File System Access API (Chromium) with OPFS (Firefox / Safari 26 and later) automatic fallback (manual export only when neither is available)
- **PWA**: bookkeeping, reports, depreciation, consumption-tax calculation, `.xtx`, invoices/quotes, and backup restore all work offline. Tesseract fetches its language data from the same origin on its first recognition; cloud engines and viewing the third-party license list require a connection

## Usage

See [docs/manual/](docs/manual/README_en.md) for step-by-step operating instructions. Covers initial setup, journal entries, CSV import, and reports in dedicated chapters (also available in Japanese and Traditional Chinese).

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0)

## Legal & safety documents

- [DISCLAIMER_en.md](DISCLAIMER_en.md) — Disclaimer (actual filing / tax-law compliance / AI usage risks)
- [SECURITY_en.md](SECURITY_en.md) — Security policy, vulnerability reporting
- [PRIVACY_en.md](PRIVACY_en.md) — Privacy policy, data collection / transmission breakdown