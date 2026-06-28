# 10. `.xtx` Export

Generate an e-Tax `.xtx` file and load it into e-Tax software (download edition).

**Language**: [日本語](10-xtx-export.md) | **English** | [繁體中文](10-xtx-export_zh-TW.md)

> **By the end of this chapter you can**
> - Export the tax return (KOA020) + blue-return financial statements (KOA210) into one `.xtx`
> - Load the exported `.xtx` into e-Tax software (download edition)
> - Understand what aoiko fills (the business part) vs. what you complete in e-Tax (deductions, tax)
>
> **Prerequisites**: Basic info and filer info from [01. Setup](01-setup.md), opening transfers from [09. Carryover](09-carryover.md), year-end depreciation from [08. Depreciation](08-depreciation.md), and confirmed journal entries for the year.

## 1. What `.xtx` is

`.xtx` is the XML filing-data file that **e-Tax software (download edition)** accepts via "組み込み" (load). Per the **NTA official W3C XSD** (from e-tax19 "XML schema"), aoiko bundles the following into one `.xtx`:

- **KOA020-023**: tax return, first table
- **KOA210-011**: blue-return financial statements (general)
- **TEA060**: filing/transmission slip
- **Procedure code**: `RKO0010` (income tax & special reconstruction income tax return)

aoiko's `.xtx` passes **xmllint XSD validation in CI** and has been **verified by real import into the download edition**.

> **e-Tax software (web edition) does NOT support loading the income-tax procedure (RKO0010).** Use the **download edition** (per-tax module install required). The online preparation corner ("作成コーナー") does not support loading `.xtx`.

## 2. What aoiko's `.xtx` includes / excludes

aoiko handles **business profit and loss**. The `.xtx` carries the financial statements, the **business part** of the tax return, plus the **filer info** required to submit.

### Included

| Form | Source |
|---|---|
| Filer info (tax office, user ID, name, address) | Settings ＞ Filer Info |
| Tax return p.1: business (営業等) revenue | PL (sales) |
| Tax return p.1: business income (①) and blue-return special deduction | PL + deduction type |
| Financial statements p.1 P&L (incl. pre/deduction/post amounts) | PL + deduction type |
| Financial statements p.2 monthly sales & purchases | Monthly (purchases = COGS only) |
| Financial statements p.4 balance sheet | BS |

### Excluded (completed in e-Tax)

| Item | How to complete |
|---|---|
| **Income deductions** (basic, spouse, social insurance, medical, etc.) | Enter in e-Tax |
| **Total income, taxable income, tax calculation** | Auto-computed in e-Tax |
| **Attachments** (medical detail, deduction certificates, etc.) | Attach in e-Tax |
| **Consumption tax return** | Prepare separately in e-Tax (aoiko gives estimates only; [07. Consumption Tax](07-consumption-tax.md)) |

> This division of labor is common to accounting software: the software produces bookkeeping, statements, and business income; the personal deductions and tax are completed by the filer in e-Tax at filing time.

## 3. Export steps

### 3-1. Pre-export checklist

1. **Settings ＞ Filer Info** has tax office, user ID, name, address (export is blocked if missing)
2. **Settings ＞ Blue-return special deduction** type (650k/550k/100k) is correct
3. All journal entries for the year are **confirmed**
4. **Opening transfers** ([09. Carryover](09-carryover.md)) exist dated `2026-01-01`
5. **Depreciation entries** generated at year end ([08. § 3](08-depreciation.md#3-年末に減価償却仕訳を生成))
6. Reports ＞ BS shows **assets = liabilities + equity** (no imbalance warning)

### 3-2. File name

aoiko generates `aoiko-{year}.xtx`, saved to your browser's Downloads folder.

> aoiko's `.gitignore` includes `aoiko-*.xtx` so it is not accidentally committed.

> **About fiscal year 2026 (Reiwa 8)**: the Reiwa 8 income-tax e-Tax module is not released until the filing period (2027). You can verify against the current Reiwa 7 module using the dev build's "Test: export as Reiwa 7" button (the envelope structure is year-independent).

## 4. Loading into e-Tax software (download edition)

**Important**: aoiko's `.xtx` is verified in CI and on real devices, but **final review of the filing content is your responsibility**.

1. Launch the download edition and **install the income-tax year module** (if not installed)
2. **Select the user** → **"申告・申請等"**
3. **"組み込み"** → choose aoiko's `.xtx`
4. Confirm all 3 forms (return, statements, slip) reach "組み込み" status
5. Use **"帳票編集"** to verify:
   - P&L, monthly, and balance sheet match aoiko's reports
   - Tax return p.1: business revenue, business income, blue-return deduction, name, address, tax office are correct
6. Enter remaining items (income deductions, tax) in e-Tax
7. **If loading errors out**: the export may have a problem — please report via GitHub Issue.

## 5. Internal spec (reference)

### XSD source

- Distributed by: NTA e-Tax "published specifications" list
- Source CAB: `e-tax19.CAB` "XML schema"
- Bundled in aoiko: under `docs/xtx-spec/{shotoku,general}/`
  - `KOA020-023.xsd` (tax return), `KOA210-011.xsd` (blue-return statements, general)
  - `General.xsd`, `ITdefinition.xsd`, `ITreference.xsd`, `zeimusho.xsd`, `zeimoku.xsd`

### Document model

Two-tier ID/IDREF:

- **Envelope**: `<DATA>` (5 namespaces) → procedure element `RKO0010` → `CATALOG` (RDF manifest) + `CONTENTS`
- **Definition side** (IT part): `<IT VR="1.5" id="IT">` lists filer info, year, etc. with IDs
- **Reference side** (per-form): each form is a single form element containing page children; leaves point to the definition side via IDREF
- **Slip**: `SOFUSHO` (TEA060, kyotsu namespace)

aoiko builds the `.xtx` dynamically from JSON schemas auto-generated from the XSDs.

## 6. Common errors

| Error (e-Tax) | Likely cause |
|---|---|
| `SC00X010 cannot load this file` | Filer info not entered, or loaded into the wrong year module |
| Wrong file format | A non-`.xtx` file was loaded |
| Form mismatch | aoiko's bundled XSD diverged from the current year ([docs/xtx-spec/README.md](../../docs/xtx-spec/README.md)) |
| Wrong digit/format | Negative or non-integer amounts; review journal entries |

## 7. Next steps

- Lock the year after filing → [06. Reports § 8](06-reports.md#8-年度ロック申告済み)
- Found a mistake after filing → [12. Amended Return](12-amended.md)
- Take a backup → [11. Backup & Restore](11-backup.md)