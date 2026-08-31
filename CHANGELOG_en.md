# Changelog

**Language**: [日本語](CHANGELOG.md) | **English** | [繁體中文](CHANGELOG_zh-TW.md)

This file follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and the versions follow [Semantic Versioning](https://semver.org/). For aoiko, a "breaking change" (major) means a change that makes existing backup JSON or in-browser data (IndexedDB) unreadable by the new version.

## [1.1.1] - 2026-08-30

A round-up of places the display language did not reach. No new features.

### Changed

- The support screen can now be dismissed by clicking outside it
- Going to Settings from the notice on the home screen now lands on the backup section

### Fixed

- Error messages still appearing in Japanese on the English and Traditional Chinese screens
- Some input hints in Settings not matching the display language
- A confirmation prompt not matching the display language
- The full-text link in the disclaimer being split mid-sentence
- The order-import instructions not matching the actual modifier keys
- Numbers that are not 13 digits being accepted as a registration number
- On some mobile browsers, the header being hidden behind the top of the screen after scrolling

## [1.1.0] - 2026-08-22

Backups are now written as loose files inside a folder instead of one archive, and a year you have already filed can no longer be rewritten by accident. Ledger speed has also been improved across the board.

### Added

- **Folder backups**. Backups are now written as loose files inside a folder. Receipt photos are deduplicated by SHA-256, so a ledger with many photos writes out quickly and only the differences grow from one backup to the next. Receipts no longer referenced are cleaned up automatically
- **Protection for filed years**. Any operation that would change a year already marked as filed is detected and warned about before it is written. The same safeguard now also covers paths that bypass the screen, so import and year-end processing can no longer rewrite a filed year silently
- **Bad-debt reserve**. Individually-assessed and lump-sum-assessed reserves are now handled separately, and the individually-assessed portion can be deducted as a necessary expense on white returns too. The reversal entry at the start of the following period (the write-back method) is now generated as well
- **Redo for the business-opening wizard**. The wizard can now be run again from the start even after it has already been run once. A second run no longer double-books opening costs or converted assets
- **Editing invoice and quote drafts**. Drafts can now be edited after being created. Printouts now show the reduced-rate notice and the payment due date
- The copyright notices of the third-party software we bundle can now be opened from within aoiko. Dependencies distributed only through CSS are now included as well

### Changed

- Backup export and restore switched from a single zip to loose files inside a folder. The "backup interval" setting has been removed as a result
- Links to the full text of the disclaimer and the third-party licenses now open within aoiko instead of leaving it
- Sending to a `.local` address now also counts as sending outside the device, and shows the send confirmation
- Improved ledger speed for large books. Rendering the confirmation table for 2,000 rows dropped from 82.6 seconds to 0.33 seconds (0.74 seconds even at 5,000 rows); backup export and restore are now streamed, alongside image processing, so the screen no longer freezes. Also fixed CSV import memory usage growing without bound as row count increased

### Fixed (ledger and backups)

- A failed restore could leave the ledger fully erased with no way back. Erasing and writing now happen as a single unit
- A backup that had exported successfully could fail to restore. Restore now also verifies the backup's CRC32
- Backup zips over 4GiB were corrupted (zip64 support added)
- Ledgers with many receipt photos could fail to save, so export was not possible
- The ledger itself is now restored even when an attachment is corrupted. Orphaned line items are no longer imported, and a failed save of income deductions is no longer silently swallowed
- On browsers that cannot observe when a save has completed, a cancelled backup was treated as saved
- The screen now reloads automatically after a backup is restored
- Reading a receipt photo evicted from cloud storage could hang indefinitely

### Fixed (tax filings and forms)

- On the blue-return statement (real estate), bad-debt reserve and expenses with no matching field were dropped (KOA210)
- On the statement of earnings, expenses entered in the additional-item field with no matching field were dropped (KOA110, KOA130)
- The single-parent deduction is now year-specific, supporting the ¥380,000 amount for 令和9年分 (2027) onward
- Redoing the opening-of-period transfer now uses reversing entries, so the history is preserved
- Fixed the year on screen not following after a restore, year-end depreciation not being checked against a filed year, and negative amounts on line items not being handled the same way everywhere

### Fixed (import)

- Order import now stops and shows a reason when the line-item total does not match the grand total
- Switching the import source left the already-loaded table in place

### Fixed (printing)

- Print settings had no effect, the screen froze after printing, and some reports could not be printed at all
- Tables did not fit on A4, and borders disappeared in dark mode

### Fixed (screen)

- The receipt image picker opened the camera directly, leaving no way to choose from the photo library or files
- On mobile browsers, the disclaimer dialog was hidden behind the status bar on some devices
- Just opening the share sheet showed an error
- `<html lang>` stayed Japanese even after switching the UI language
- Layout issues on narrow screens: overflowing button labels, text links too small to tap, cramped account columns, and mismatched form control heights
- Japanese shinjitai kanji had leaked into the Traditional Chinese translation
- Misleading states after a failed load: the heading updating to the new year while old figures remained, and lists staying stuck on "loading"
- Connection failures now also show the actual reason

## [1.0.4] - 2026-08-13

### Added

- The copyright notices of the third-party software we bundle are now included in what we distribute, as `THIRD_PARTY_LICENSES.txt`, reachable from the disclaimer screen and from Settings. This is what MIT, BSD-2-Clause, Apache-2.0 and OFL-1.1 each require

### Changed

- The purely-local OCR engine switched from tesseract.js to tesseract-wasm. The engine, the WASM core and the Japanese model are now all served by aoiko itself, so the local OCR engine makes no external request at all (previously the trained data was fetched from a CDN on first use). The download also shrank from over 12MB to about 5MB
- The "trained data source" setting was removed, since the model is now bundled

### Fixed

- The purely-local OCR could pick up the wrong total when it misread the thousands separator on a receipt. Reading `合計 2,200円` as `2.200` or `2.,200` caused the total to be imported as 200 yen

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