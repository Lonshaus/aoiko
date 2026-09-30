# 10. `.xtx` export

Generate an e-Tax `.xtx` file and load it into e-Tax software (download edition).

**Language**: [日本語](10-xtx-export.md) | **English** | [繁體中文](10-xtx-export_zh-TW.md)

> **By the end of this chapter you can**
> - Export the tax return (KOA020) + the matching statement — blue-return financial statements (KOA210) or, for white return, the income/expense breakdown statement (KOA110) — into one `.xtx`
> - If real estate income is entered, the real-estate financial statements (KOA220 for blue, KOA130 for white) are attached to the same `.xtx` too (see [14. Income & tax deductions](14-income-deductions_en.md))
> - Load the exported `.xtx` into e-Tax software (download edition)
> - Understand what aoiko fills (the business part, plus income deductions and tax if [14. Income & tax deductions](14-income-deductions_en.md) is filled in) vs. what you complete in e-Tax
>
> **Prerequisites**: Basic info and filer info from [01. Initial setup](01-setup_en.md), the carryover entry from [09. Prior-period carryover](09-carryover_en.md), year-end depreciation from [08. Depreciation](08-depreciation_en.md), and confirmed journal entries for the year.

## 1. What `.xtx` is

`.xtx` is the XML filing-data file that **e-Tax software (download edition)** accepts via "組み込み" (load). Per the **NTA official W3C XSD** (from e-tax19 "XML schema"), aoiko bundles the following into one `.xtx`:

- **KOA020-023**: tax return, first table
- **KOA210-011**: blue-return financial statements (general), or **KOA110-012**: income/expense breakdown statement (general) for white return — decided by **Settings > Filer info > Filing type**
- **KOA220-008**: blue-return financial statements (real estate income), or **KOA130-009**: income/expense breakdown statement (real estate income) — attached alongside the business statement above only when **Settings > Use real estate income** is on and real estate income has been entered in [14. Income & tax deductions](14-income-deductions_en.md)
- **TEA060**: filing/transmission slip
- **Procedure code**: `RKO0010` (income tax & special reconstruction income tax return)

> **About bad debt write-offs and the allowance for doubtful accounts for real estate income**: the blue-return real estate statement (KOA220) has no dedicated field for these two accounts, so they're written into the form's own "additional item" slot (capped at 5 entries). The white-return breakdown statement (KOA130) has a dedicated "貸倒金" (bad debt write-off) field, so that one is written directly there, and "貸倒引当金繰入額（不動産）" (provision to the allowance for doubtful accounts) is written to the additional-item slot (one entry only). The individually assessed allowance for doubtful accounts has no blue-return requirement (Income Tax Act Art. 52(1)), so it's a deductible expense on a white return too as long as it's a business-scale rental (see [14. Income & tax deductions](14-income-deductions_en.md)).

> **e-Tax software (web edition) does NOT support loading the income-tax procedure (RKO0010).** Use the **download edition** (per-tax module install required). The Return Preparation Corner (確定申告書等作成コーナー) does not support loading `.xtx`.

## 2. What aoiko's `.xtx` includes / excludes

aoiko handles **business profit and loss**. The `.xtx` carries the financial statements, the **business part** of the tax return, plus the **filer info** required to submit.

### Included

| Form | Source |
|---|---|
| Filer info (tax office, user identification number, name, address) | Settings > Filer info |
| Tax return p.1: business (営業等) revenue | PL (sales) |
| Tax return p.1: business income (①) | PL (after expenses; blue return further subtracts the blue-return special deduction. When the home-worker special provision under Special Taxation Measures Act Art. 27 ([14. Income & tax deductions](14-income-deductions_en.md)) applies, the expenses are the special-provision expenses, which already include family employee salary/deduction: total revenue − special-provision expenses, and for a blue return also − the blue-return special deduction) |

**Blue return** (statement: blue-return financial statements, KOA210)

| Form | Source |
|---|---|
| Tax return p.1: blue-return special deduction amount | PL + deduction type (whether cash-basis applies and total revenue two years prior also feed the eligibility check; [14. Income & tax deductions](14-income-deductions_en.md)) |
| Statements p.1 P/L (incl. pre-deduction / deduction / post-deduction amounts) | PL + deduction type. When the home-worker special provision applies, "pre-deduction income" = total revenue minus special-provision expenses, "deduction" = the blue-return special deduction above, and "income" = the difference between them (matching the tax return's business income) — this no longer matches the ordinary Reports P/L |
| Statements p.2 monthly sales & purchases | Monthly (purchases = COGS only) |
| Statements p.2 depreciation schedule | Per-asset depreciation and ending balance ([08. Depreciation](08-depreciation_en.md)). Assets that used the small-asset special provision (Special Taxation Measures Act Art. 28-2) this year are grouped into one row (Special Taxation Measures Act Basic Directive 28-2-3; [08. Depreciation § 4](08-depreciation_en.md#4-fixed-assets-table-columns)). An asset that exceeded the annual ¥3,000,000 cap or turned out ineligible is shown individually as "straight-line" or "declining-balance" |
| Statements p.4 balance sheet | BS |

**White return** (statement: income/expense breakdown statement, KOA110)

| Form | Source |
|---|---|
| Breakdown statement p.1: revenue, expense by category, pre-family-deduction income | PL. When the home-worker special provision applies, "pre-family-deduction income" = total revenue minus special-provision expenses, "family deduction" = 0, and "income" = the difference between them (matching the tax return's business income) |
| Tax return: family employee deduction | Computed and output by aoiko (see the note below) |

> White return has no balance sheet or monthly-sales fields (the breakdown statement itself has no such sections). Family employee salary and the allowance for doubtful accounts (lump-sum assessment) require a blue return, so they're excluded from the breakdown statement output and from the income calculation too (see "Completed in e-Tax" below). The allowance for doubtful accounts (individual assessment) is a deductible expense on a white return too, so it's written to the additional-item slot (capped at 5 entries) as an expense with no fixed field.

### Completed in e-Tax

| Item | How to complete |
|---|---|
| **Income deductions** (basic, spouse, social insurance, medical, etc.) | Output automatically if entered in [14. Income & tax deductions](14-income-deductions_en.md); otherwise enter in e-Tax |
| **Total income, taxable income, tax calculation** | Same as above (computed and output by aoiko when deductions are entered; otherwise auto-computed in e-Tax) |
| **Attachments** (medical detail, deduction certificates, etc.) | Attach in e-Tax |
| **Consumption tax return** (the 30% special provision, and simplified taxation for a filer who actually runs multiple business categories) | Prepare separately in e-Tax (aoiko gives estimates only; general taxation, the 20% special provision, and simplified taxation have `.xtx` export: [§ 5](#5-consumption-tax-general--20-special-provision--simplified-taxation-xtx-export), [07. Consumption tax](07-consumption-tax_en.md)) |
| **Basis for the allowance for doubtful accounts (lump-sum assessment)** ("total receivables" and "deductible limit" on page 2 of the financial statement) | Enter in e-Tax (aoiko does not track per-debtor receivable balances, so both boxes are output blank; the addition itself is still output) |
| **Schedule of allowance for doubtful accounts (individual valuation)** | Prepare in e-Tax (it needs the statutory ground and the expected recoverable amounts, which aoiko does not hold, so aoiko does not generate it) |

> **White return family employee deduction**: under Income Tax Act Art. 57(3), the deduction is the **lower** of (¥860,000 for a spouse / ¥500,000 for another relative, flat) and (pre-deduction business income etc. ÷ (number of family employees + 1)). aoiko computes this amount and outputs it on the tax return, satisfying the Art. 57(5) statement requirement. Complete the return's own statement items, such as the relationship to the filer, in e-Tax. When the home-worker special provision (Special Taxation Measures Act Art. 27) applies, blue-return family employee salary and the white return family employee deduction are already included in the special-provision expenses, so they are not subtracted again on the business-income side — the deduction/salary field there is output as ¥0 (the NTA's position isn't published, so aoiko follows this reading of Income Tax Act Art. 57(1) (blue-return family employee salary included in necessary expenses) and Art. 57(3) (white return deduction "deemed a necessary expense")). The family employee's name, relationship, and months worked are still recorded as usual on page 2, and this does not affect the deduction on the business-scale real estate income side.
>
> **A provision to the allowance for doubtful accounts isn't valid without its supporting statement.** Under Income Tax Act Art. 52(4), stating the basis of the addition calculation on the tax return is a condition for the allowance to apply at all (for individual allowances, that basis must also be retained, per Enforcement Order Art. 144(2) and Enforcement Regulation Art. 36). aoiko outputs the addition amount, but not the statement items or retained records behind it — complete those in e-Tax as shown above. The same note appears in the journal entry form when you post to the relevant account.

> The baseline division of labor is common to accounting software: the software produces bookkeeping, statements, and business income; the rest is completed by the filer in e-Tax at filing time. aoiko additionally outputs income deductions and tax when [14. Income & tax deductions](14-income-deductions_en.md) is filled in.

## 3. Export steps

### 3-1. Pre-export checklist

1. **Settings > Filer info** has tax office, user identification number, name, address (export is blocked if missing)
2. **Settings > Filing type** matches your actual filing (blue or white return)
3. For blue return, **Settings > Blue-return special deduction** type is correct (three tiers from tax year 2027 (Reiwa 9) on — ¥750,000 / ¥650,000 / ¥100,000; ¥650,000 / ¥550,000 / ¥100,000 for tax year 2026)
4. All journal entries for the year are **confirmed**
5. The **carryover entry** ([09. Prior-period carryover](09-carryover_en.md)) exists dated `{year}-01-01` (in your first year, created by hand)
6. **Depreciation entries** generated at year end ([08. § 3](08-depreciation_en.md#3-year-end-depreciation-entry-generation))
7. For blue return, Reports > Balance sheet shows **assets = liabilities + equity** (no imbalance warning). White return's breakdown statement has no balance sheet, so this check doesn't apply
8. If there's real estate income, the real estate income section in [14. Income & tax deductions](14-income-deductions_en.md) is filled in and saved (export is refused otherwise — this figure determines the cap on the blue-return special deduction, so aoiko never outputs a guessed amount in its absence)

### 3-2. File name

aoiko generates a file named `aoiko-{year}.xtx`.
<!-- only:browser -->
It's saved to your browser's Downloads folder.
<!-- /only -->
<!-- only:native -->
On desktop, a save dialog opens to choose the destination; on iPad/iPhone it's saved inside the app's own storage area, retrievable from the Files app etc.
<!-- /only -->

> **About tax year 2026 (Reiwa 8)**: the income-tax e-Tax module for tax year 2026 (Reiwa 8) is not released until the filing period (2027).

## 4. Loading into e-Tax software (download edition)

**Important**: **final review of the filing content is your responsibility**.

1. Launch the download edition and **install the income-tax year module** (if not installed)
2. **Select the user** → **"申告・申請等"**
3. **"組み込み"** → choose aoiko's `.xtx`
4. Confirm all 3–4 forms (return, statement, the real-estate statement if applicable, slip) reach "組み込み" status
5. Use **"帳票編集"** to verify (going through each page is recommended):
   - Blue return: statements p.1 P/L, p.2 monthly figures and depreciation schedule, and p.4 balance sheet match aoiko's reports and fixed-asset list (when the home-worker special provision applies, the statement's "pre-deduction income" won't match the Reports P/L's [pre-special-provision] business income — that's expected. Also confirm the small-asset summary row and any individually-shown ineligible assets match the fixed-asset list)
   - White return: the breakdown statement's revenue, expense categories, and pre-family-deduction income match aoiko's reports (same caveat when the home-worker special provision applies)
   - Tax return p.1: business revenue, business income (blue return only: the blue-return deduction), name, address, tax office are correct
6. Enter remaining items in e-Tax (if [14. Income & tax deductions](14-income-deductions_en.md) is filled in, deductions and tax are already output; what remains is unentered deductions)
7. **If loading errors out**: see [§ 6. Common errors](#6-common-errors).

## 5. Consumption tax (general / 20% special provision / simplified taxation) `.xtx` export

This is a **separate file and separate procedure** from the income-tax `.xtx` above (procedure `RKO0010`). Load it into e-Tax separately, once the consumption-tax period (calendar year) is finalized.

### Coverage

- **General taxation uses procedure `RSH0010`** (consumption tax and local consumption tax filing, general form); **the 20% special provision and simplified taxation use procedure `RSH0030`** (simplified-taxation form):
  - **General taxation** (`RSH0010`): the consumption tax return (general form) + Attachments 1-3 and 2-3. **Assumes a 100% taxable-sales ratio** (no non-taxable sales or export exemptions) — Attachment 2-3 only uses the full-deduction category ("taxable sales ≤ ¥500 million and taxable-sales ratio ≥ 95%"); the individual-attribution and proportional-allocation methods are not supported
  - **20% special provision** (`RSH0030`): the consumption tax return (simplified-taxation form) + Attachment 6 (transitional measure for tax credits). Attachment 6 carries through the rate-specific (7.8% / 6.24%) tax on sales returns/discounts entered in the Reports' "Consumption tax" section as-is (0 if not entered). This provision uses this form structure even if you have not formally elected simplified taxation (per the NTA's dedicated guide)
  - **Simplified taxation** (`RSH0030`): the consumption tax return (simplified-taxation form) + Attachments 4-3 and 5-3. When a fixed-asset sale's 4th category differs from your set category, the per-category fields on Attachment 5-3 are filled in from the Consumption Tax Act Enforcement Order Art. 57 two-category computation (principle method or the 75% rule)
- **Only general taxation, the 20% special provision, and simplified taxation are supported.** The 30% special provision is not yet supported for form output (see [07. Consumption tax](07-consumption-tax_en.md)). Simplified taxation for a filer who actually runs multiple business categories is also not supported
- Sales returns/discounts are already netted into the taxable base in aoiko's aggregation, so the corresponding attachment field won't show them as a separate line (except the 20% special provision's Attachment 6, which does show the entered rate-specific returns/discounts as a separate line)

### Export steps

1. Set **Settings > Consumption tax** to **"Taxable entity"** (for simplified taxation, also choose **"Simplified method"** and the **"Simplified-method category"**)
2. Fill in **Settings > Filer info** (tax office, user identification number, name, address)
3. On the Reports page > **"Consumption tax"** section, confirm the desired method appears in the method list
4. Click **"Export general-taxation .xtx"**, **"Export 20% special provision .xtx"**, or **"Export simplified-taxation .xtx"** (filename `aoiko-shohi-{year}.xtx`; for general taxation and simplified taxation, an interim filing is `aoiko-shohi-{year}-interim.xtx`)

### Loading into e-Tax software (download edition)

Separately from income tax, install the **consumption tax year module** first, then load it. The steps mirror [§ 4](#4-loading-into-e-tax-software-download-edition) ("load" → select file → review the numbers in form editing).

## 6. Common errors

| Error (e-Tax) | Likely cause |
|---|---|
| `SC00X010 cannot load this file` | Filer info not entered, or loaded into the wrong year module |
| Wrong file format | A non-`.xtx` file was loaded |
| Form mismatch | aoiko's bundled XSD diverged from the current year |
| Wrong digit/format | Negative or non-integer amounts; review journal entries |

## 7. Next steps

- Lock the year after filing → [06. Reports § 8](06-reports_en.md#8-year-lock-filed)
- Found a mistake after filing → [12. Amended filing](12-amended_en.md)
- Take a backup → [11. Backup and restore](11-backup_en.md)