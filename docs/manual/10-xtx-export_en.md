# 10. `.xtx` Export

Generate an e-Tax `.xtx` file and load it into e-Tax software (download edition).

**Language**: [日本語](10-xtx-export.md) | **English** | [繁體中文](10-xtx-export_zh-TW.md)

> **By the end of this chapter you can**
> - Export the tax return (KOA020) + the matching statement — blue-return financial statements (KOA210) or, for white return, the income/expense breakdown statement (KOA110) — into one `.xtx`
> - If real estate income is entered, the real-estate financial statements (KOA220 for blue, KOA130 for white) are attached to the same `.xtx` too (see [14. Income & tax deductions](14-income-deductions_en.md))
> - Load the exported `.xtx` into e-Tax software (download edition)
> - Understand what aoiko fills (the business part) vs. what you complete in e-Tax (deductions, tax, the white-return family-employee deduction)
>
> **Prerequisites**: Basic info and filer info from [01. Setup](01-setup.md), opening transfers from [09. Carryover](09-carryover.md), year-end depreciation from [08. Depreciation](08-depreciation.md), and confirmed journal entries for the year.

## 1. What `.xtx` is

`.xtx` is the XML filing-data file that **e-Tax software (download edition)** accepts via "組み込み" (load). Per the **NTA official W3C XSD** (from e-tax19 "XML schema"), aoiko bundles the following into one `.xtx`:

- **KOA020-023**: tax return, first table
- **KOA210-011**: blue-return financial statements (general), or **KOA110-012**: income/expense breakdown statement (general) for white return — decided by **Settings ＞ Filer Info ＞ Filing Type**
- **KOA220-008**: blue-return financial statements (real estate income), or **KOA130-009**: income/expense breakdown statement (real estate income) — attached alongside the business statement above only when **Settings ＞ Use real estate income** is on and real estate income has been entered in [14. Income & tax deductions](14-income-deductions_en.md)
- **TEA060**: filing/transmission slip
- **Procedure code**: `RKO0010` (income tax & special reconstruction income tax return)

aoiko's `.xtx` passes **xmllint XSD validation in CI** and has been **verified by real import into the download edition**.

> **About bad debt write-off / allowance for real estate income**: the blue-return real estate statement (KOA220) has no dedicated field for these two accounts, so they're written into the form's own "additional item" slot (capped at 5 entries). The white-return breakdown statement (KOA130) has a dedicated "貸倒金" (bad debt write-off) field, so that one is written directly there — but since white returns have no allowance concept at all, "貸倒引当金繰入額（不動産）" (bad debt allowance) is never written to KOA130 (see [14. Income & tax deductions](14-income-deductions_en.md)).

> **e-Tax software (web edition) does NOT support loading the income-tax procedure (RKO0010).** Use the **download edition** (per-tax module install required). The online preparation corner ("作成コーナー") does not support loading `.xtx`.

## 2. What aoiko's `.xtx` includes / excludes

aoiko handles **business profit and loss**. The `.xtx` carries the financial statements, the **business part** of the tax return, plus the **filer info** required to submit.

### Included

| Form | Source |
|---|---|
| Filer info (tax office, user ID, name, address) | Settings ＞ Filer Info |
| Tax return p.1: business (営業等) revenue | PL (sales) |
| Tax return p.1: business income (①) | PL (after expenses; blue return further subtracts the blue-return special deduction) |

**Blue return** (statement: blue-return financial statements, KOA210)

| Form | Source |
|---|---|
| Tax return p.1: blue-return special deduction amount | PL + deduction type |
| Statements p.1 P&L (incl. pre/deduction/post amounts) | PL + deduction type |
| Statements p.2 monthly sales & purchases | Monthly (purchases = COGS only) |
| Statements p.4 balance sheet | BS |

**White return** (statement: income/expense breakdown statement, KOA110)

| Form | Source |
|---|---|
| Breakdown statement p.1: revenue, expense by category, pre-family-deduction income | PL |

> White return has no balance sheet or monthly-sales fields (the breakdown statement itself has no such sections). Family-employee salary and bad-debt-reserve entries have no matching field on the breakdown statement and are excluded from the income calculation too (see "Excluded" below).

### Excluded (completed in e-Tax)

| Item | How to complete |
|---|---|
| **Income deductions** (basic, spouse, social insurance, medical, etc.) | Enter in e-Tax |
| **Total income, taxable income, tax calculation** | Auto-computed in e-Tax |
| **Attachments** (medical detail, deduction certificates, etc.) | Attach in e-Tax |
| **Consumption tax return** (multi-category simplified taxation, 30% special) | Prepare separately in e-Tax (aoiko gives estimates only; general taxation, the 20% special provision, and single-category simplified taxation have `.xtx` export: [§ 6](#6-consumption-tax-general--20-special-provision--simplified-taxation-xtx-export), [07. Consumption Tax](07-consumption-tax_en.md)) |
| **White-return family-employee deduction** (flat ¥860,000 for a spouse, ¥500,000 per other relative) and the post-deduction income | Enter in e-Tax (aoiko does not compute it — it depends on relationship data aoiko doesn't track) |

> This division of labor is common to accounting software: the software produces bookkeeping, statements, and business income; the personal deductions and tax are completed by the filer in e-Tax at filing time.

## 3. Export steps

### 3-1. Pre-export checklist

1. **Settings ＞ Filer Info** has tax office, user ID, name, address (export is blocked if missing)
2. **Settings ＞ Filing Type** matches your actual filing (blue or white return)
3. For blue return, **Settings ＞ Blue-return special deduction** type (650k/550k/100k) is correct
4. All journal entries for the year are **confirmed**
5. **Opening transfers** ([09. Carryover](09-carryover.md)) exist dated `2026-01-01`
6. **Depreciation entries** generated at year end ([08. § 3](08-depreciation.md#3-年末に減価償却仕訳を生成))
7. For blue return, Reports ＞ BS shows **assets = liabilities + equity** (no imbalance warning). White return's breakdown statement has no balance sheet, so this check doesn't apply

### 3-2. File name

aoiko generates `aoiko-{year}.xtx`, saved to your browser's Downloads folder.

> aoiko's `.gitignore` includes `aoiko-*.xtx` so it is not accidentally committed.

> **About fiscal year 2026 (Reiwa 8)**: the Reiwa 8 income-tax e-Tax module is not released until the filing period (2027). You can verify against the current Reiwa 7 module using the dev build's "Test: export as Reiwa 7" button (the envelope structure is year-independent).

## 4. Loading into e-Tax software (download edition)

**Important**: aoiko's `.xtx` is verified in CI and on real devices, but **final review of the filing content is your responsibility**.

1. Launch the download edition and **install the income-tax year module** (if not installed)
2. **Select the user** → **"申告・申請等"**
3. **"組み込み"** → choose aoiko's `.xtx`
4. Confirm all 3 forms (return, statement, slip) reach "組み込み" status
5. Use **"帳票編集"** to verify:
   - Blue return: P&L, monthly, and balance sheet match aoiko's reports
   - White return: the breakdown statement's revenue, expense categories, and pre-family-deduction income match aoiko's reports
   - Tax return p.1: business revenue, business income (blue return only: the blue-return deduction), name, address, tax office are correct
6. Enter remaining items (income deductions, tax, and for white return the family-employee deduction) in e-Tax
7. **If loading errors out**: the export may have a problem — please report via GitHub Issue.

## 5. Internal spec (reference)

### XSD source

- Distributed by: NTA e-Tax "published specifications" list
- Source CAB: `e-tax19.CAB` "XML schema"
- Bundled in aoiko: under `docs/xtx-spec/{shotoku,general}/`
  - `KOA020-023.xsd` (tax return), `KOA210-011.xsd` (blue-return statements, general), `KOA110-012.xsd` (income/expense breakdown statement, general)
  - `KOA220-008.xsd` (blue-return statements, real estate income), `KOA130-009.xsd` (income/expense breakdown statement, real estate income)
  - `General.xsd`, `ITdefinition.xsd`, `ITreference.xsd`, `zeimusho.xsd`, `zeimoku.xsd`

### Document model

Two-tier ID/IDREF:

- **Envelope**: `<DATA>` (5 namespaces) → procedure element `RKO0010` → `CATALOG` (RDF manifest) + `CONTENTS`
- **Definition side** (IT part): `<IT VR="1.5" id="IT">` lists filer info, year, etc. with IDs
- **Reference side** (per-form): each form is a single form element containing page children; leaves point to the definition side via IDREF
- **Slip**: `SOFUSHO` (TEA060, kyotsu namespace)

aoiko builds the `.xtx` dynamically from JSON schemas auto-generated from the XSDs.

## 6. Consumption tax (general / 20% special provision / simplified taxation) `.xtx` export

This is a **separate file and separate procedure** from the income-tax `.xtx` above (procedure `RKO0010`). Load it into e-Tax separately, once the consumption-tax period (calendar year) is finalized.

### Coverage

- **Procedure `RSH0010`** (consumption tax and local consumption tax filing) outputs one of:
  - **General taxation**: the consumption tax return (general form) + attachments 1-3 and 2-3. **Assumes a 100% taxable-sales ratio** (no non-taxable sales or export exemptions) — attachment 2-3 only uses the full-deduction category ("taxable sales ≤ ¥500M and taxable-sales ratio ≥ 95%"); the individual-attribution and proportional-allocation methods are not supported
  - **20% special provision**: the consumption tax return (simplified-taxation form) + attachment 6 (transitional measure for tax credits). This provision uses this form structure even if you have not formally elected simplified taxation (per the NTA's dedicated guide)
  - **Simplified taxation (single business category only)**: the consumption tax return (simplified-taxation form) + attachments 4-3 and 5-3
- **Only general taxation, the 20% special provision, and single-category simplified taxation are supported.** Simplified taxation across multiple business categories (the 75% rule etc.) and the 30% special provision are not yet supported for form output (see [07. Consumption Tax](07-consumption-tax_en.md))
- **Known simplification**: sales returns/discounts are already netted into the taxable base in aoiko's aggregation, so the corresponding attachment field won't show them as a separate line. **The final tax amount itself is still calculated correctly.**

### Export steps

1. Set **Settings → Consumption tax** to "taxable business" (for simplified taxation, also set "simplified" + the business category)
2. Fill in **Settings → Filer info** (tax office, user ID number, name, address)
3. On the Reports page → **"Consumption tax"** section, confirm the desired method appears in the method list
4. Click **"Download general-taxation .xtx"**, **"Download 2%-special .xtx"**, or **"Download simplified-taxation .xtx"** (filename `aoiko-shohi-{year}.xtx`)

### Loading into e-Tax software (download edition)

Separately from income tax, install the **consumption tax year module** first, then load it. The steps mirror [§ 4](#4-loading-into-e-tax-software-download-edition) ("load" → select file → review the numbers in form editing).

## 7. Common errors

| Error (e-Tax) | Likely cause |
|---|---|
| `SC00X010 cannot load this file` | Filer info not entered, or loaded into the wrong year module |
| Wrong file format | A non-`.xtx` file was loaded |
| Form mismatch | aoiko's bundled XSD diverged from the current year ([docs/xtx-spec/README.md](../../docs/xtx-spec/README.md)) |
| Wrong digit/format | Negative or non-integer amounts; review journal entries |

## 8. Next steps

- Lock the year after filing → [06. Reports § 8](06-reports.md#8-年度ロック申告済み)
- Found a mistake after filing → [12. Amended Return](12-amended.md)
- Take a backup → [11. Backup & Restore](11-backup.md)