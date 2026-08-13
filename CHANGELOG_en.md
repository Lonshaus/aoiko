# Changelog

**Language**: [日本語](CHANGELOG.md) | **English** | [繁體中文](CHANGELOG_zh-TW.md)

This file follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and the versions follow [Semantic Versioning](https://semver.org/). For aoiko, a "breaking change" (major) means a change that makes existing backup JSON or in-browser data (IndexedDB) unreadable by the new version.

## [1.0.5] - 2026-08-13

### Fixed

- The bundled `THIRD_PARTY_LICENSES.txt` was missing entries for software that is actually distributed, including the Svelte runtime, UI components and the bundled Inter font. npm's "development dependency" classification describes whether a package is needed at install time, not whether it ends up in what we distribute, and it was being used as the test. The list went from 7 entries to 48

## [1.0.4] - 2026-08-13

### Added

- Bundled the copyright notices of production npm dependencies as `THIRD_PARTY_LICENSES.txt`, now shipped with the app and reachable from the disclaimer-consent screen and the settings screen. This satisfies the attribution requirements of MIT, BSD-2-Clause, and Apache-2.0

### Changed

- Switched the local OCR engine from tesseract.js to tesseract-wasm. The engine, the WASM core, and the Japanese model are now all served from the same origin, so the local OCR engine makes no external request at all (previously the trained data was fetched from a CDN on first use). Download size for the local engine dropped from over 12MB to about 5MB
- Removed the "trained-data source" setting, since the model is now bundled with the app

## [1.0.3] - 2026-07-31

Fixes wrong figures on tax filings, plus a set of defects that lost ledger data or corrupted backups in ways a later update cannot undo. **If any of these apply to you, see "What to check" below.**

### Fixed (figures on tax filings)

- Real-estate income was treated in full as the blue-return special deduction, and disappeared from the main form. Exporting `.xtx` now stops and prompts you when the real-estate section of the deductions screen has not been filled in
- The balance sheet on the financial statement did not balance: accumulated depreciation was dropped (so fixed assets were reported at acquisition cost) and "income before the blue-return special deduction" was never written. A balance sheet is required for the ¥650,000 / ¥750,000 deduction
- The basic deduction for 令和8年分 (2026) is now the post-reform amount (¥620,000 plus the income-based addition). The dependant income threshold is updated from ¥580,000 to ¥620,000
- The white-return family employee deduction was never subtracted anywhere. Family employee entry (name, relationship, age, months worked) has been added and now flows into both the statement of earnings and the main form. A spouse or relative registered as a family employee is automatically excluded from the spouse and dependant deductions
- The declining-balance method wrote acquisition cost into the "base amount for depreciation" column (it should be the prior year-end book value, or the revised acquisition cost after the switch to the revised rate). On the general blue-return statement the column was left blank entirely
- Closing inventory was written as a negative number, overstating cost of sales by twice the closing inventory
- Deductible consumption-tax input was computed separately on screen and in the `.xtx`, differing by up to ¥100. The per-rate breakdowns on appendix tables 1-3 and 2-3 are also fixed
- Rental properties appeared in the depreciation schedule of the general statement of earnings
- On the real-estate blue-return statement, family employee salary went into the "additional item" expense rows instead of its own field
- Bad-debt reserve (real estate) was not added back to income on white returns
- The due dates for the first three monthly instalments of consumption-tax interim filing (11-instalment case) were wrong

### Fixed (ledger and backups)

- **Fixed-asset disposal/sale and rental property details could not be saved.** Saving failed as soon as an amount was entered, with no error shown, so the input was lost on leaving the screen
- **Backup snapshots were not atomic.** A backup taken while you were entering data could contain journal lines whose parent entry was missing, and restore accepted them
- **A backup requested while another was being written was discarded and never retried.** Entries made while a backup was compressing could end up in no backup at all
- Invoices dated 31 December received duplicate numbers (duplicate qualified-invoice numbers), and double-clicking Issue created duplicate journal entries and receivables
- A CSV decoded with the wrong character encoding did not raise an error; every description was imported as mojibake. The app now tells you the selected source is wrong
- Cancellation and refund rows on SMBC card statements (`-1,110`, `▲732`) made the whole import fail
- Receipt OCR could create a journal entry that appeared on no screen at all when the date could not be read
- Inventory valuation counted returns in the wrong direction, shifting closing inventory and cost of sales
- The business-opening wizard always failed for converted assets with a useful life of 21 years or more (such as a 22-year wooden or 47-year reinforced-concrete building), and long-held assets produced a negative book value that aborted the whole operation
- The tax office setting could be silently overwritten with an empty value on save after editing the field
- The submit buttons on receipt OCR and order import stayed active during processing, creating duplicate entries

### Changed

- Leaving a screen with unsaved input now asks for confirmation (journal entry, deductions, invoices, receipt OCR, order import, CSV import, business-opening wizard), covering in-app navigation, the browser back button and closing the tab

### What to check

- **If you registered a fixed-asset disposal or rental property details**: it may not have been saved. Check the settings screen
- **If you use automatic backup**: take a fresh manual backup on this version
- **If you issued invoices dated 31 December**: two or more on the same day share a number
- **If you have already exported `.xtx`**: regenerating on this version may change the figures

## [1.0.2] - 2026-07-27

### Fixed

- Receipt OCR always failed when Tesseract was selected as the OCR engine. The worker and WASM core are now served from the same origin instead of an external CDN (first use still needs a connection to fetch the language data)
- Automatic backup reported "OK" while never actually saving on some environments. The capability check now covers the API used for writing; where it is unavailable the status says so and points to manual download (Safari below 26 and iOS are affected). **If you used v1.0.1 or earlier on such an environment, not a single automatic backup was saved — please download one manually from the settings screen**

## [1.0.1] - 2026-07-16

### Fixed

- Mobile width (~400px) support: the header collapses into a hamburger menu on narrow screens, and the journal list, recent entries on Home, and import history tables scroll horizontally (the amount column used to be cut off). Also fixed the fixed-asset form select overflowing the screen and the monthly summary numbers being clipped on narrow widths
- Added a revision history section to the disclaimer (mapping the version number shown in the consent status to its changes)
- Updated manual pages, UI strings, and disclaimer statements that were left stale after the income-deduction and consumption-tax `.xtx` features landed (triggers a one-time disclaimer re-consent)

### Changed

- Refreshed README screenshots; each language's README now shows the UI in that language

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

[1.0.2]: https://github.com/Lonshaus/aoiko/releases/tag/v1.0.2
[1.0.1]: https://github.com/Lonshaus/aoiko/releases/tag/v1.0.1
[1.0.0]: https://github.com/Lonshaus/aoiko/releases/tag/v1.0.0