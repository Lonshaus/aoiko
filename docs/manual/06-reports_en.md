# 06. Reports

Monthly sales, P/L, balance sheet, monthly P/L, vendor and subaccount breakdowns, consumption-tax method comparison.

**Language**: [日本語](06-reports.md) | **English** | [繁體中文](06-reports_zh-TW.md)

> **By the end of this chapter you can**
> - Understand the income status for the current year
> - Read the P/L and balance sheet, and respond to balance mismatch warnings
> - Find expense imbalances via vendor / sub-account / department breakdowns
> - Compare consumption-tax methods to pick the most favorable
> - Operate the year-lock (filed) feature
>
> **Prerequisites**: you have a reasonable number of entries booked for the current year via [02. Creating journal entries](02-journal_en.md) or [03. CSV import](03-csv-import_en.md).

Click **"Reports"** in the navigation to open the Reports screen. The screen shows per tax year; switch via the **year dropdown** at the top.

## 1. Overview (year summary)

The top **"2026 overview"** (the selected year) block:

| Field | What |
|---|---|
| Income | Revenue total − expense total (before blue-return special deduction) |
| Entries | Number of confirmed entries for the year |

If the year is locked as filed, **🔒 Filed** appears on the right with an **"Unlock"** button.

> **Year lock**: shows a confirmation before anything is written to or reversed in a filed year ("Proceed" continues). Only issuing and voiding invoices is refused while the year is locked. To file an amendment, "Unlock" → edit → "Lock as filed" again (see [12. Amended filing](12-amended_en.md)).

## 2. Monthly sales

The **"Monthly sales"** section: each month's sales total as a bar-chart-like table. Top right shows the annual total (e.g. **"Annual total ¥1,160,000"**).

> Sales here means the credit side of revenue accounts (4xxx) such as `4110 売上高` (Sales), aggregated by month.

## 3. Profit & Loss (P/L)

**"Profit and loss statement"** section:

| Block | What |
|---|---|
| Revenue | Revenue accounts (4xxx) for the year, with a **"Revenue total"** |
| Expenses | Expense accounts (5xxx) for the year, with an **"Expenses total"** |
| Income (revenue − expenses) | Net income (before blue-return special deduction) |

> Accounts with no activity are omitted. If a whole block has no activity, it shows **"None"**.

### 3-1. Home-office allocation reflected

If you used home-office allocation ([02. § 1-3](02-journal_en.md#1-3-use-the-home-office-mixed-use-allocation)), the expense side shows only the business portion. The rest goes to `1610 事業主貸` (Owner's draws) on the balance sheet.

### 3-2. Depreciation reflected

After running **Settings > Fixed assets > "Generate depreciation entries"** at year-end, `5210 減価償却費` (Depreciation) appears in P/L expenses. See [08. Depreciation](08-depreciation_en.md).

## 4. Balance sheet (BS)

**"Balance sheet"** section: snapshot of balances at year-end (or current). The right side shows the reference date (e.g. **"as of 2026-12-31"**).

| Block | What |
|---|---|
| Assets | Cash, deposits, accounts receivable, fixed assets, etc. `1610 事業主貸` (Owner's draws) is also an asset |
| Liabilities | Accounts payable, other payables, loans, allowance for doubtful accounts, etc. |
| Equity | 元入金 (Owner's capital) + 事業主借 (owner's contributions) + current-period net income |

Bottom: **"Assets total"** and **"Liabilities + equity total"** should match.

### 4-1. Mismatch warning

When the two totals diverge:
> ⚠ Assets total ¥1,250,000 does not match Liabilities + equity total ¥1,248,000. Journal entries may be inconsistent.

Typical causes:

- An entry with mismatched debit/credit totals (the form cannot save one, so this normally comes only from restoring a hand-edited backup)
- Inconsistency from a restored backup
- Manually edited JSON backup that broke the data

> Find the offending entry by filtering the journal list by date/amount, then reverse and re-enter.

## 5. Monthly P/L (accounts × months)

**"Monthly P/L (account × month)"** section: cross-tab with accounts as rows and months (1–12 + Total) as columns.

| Use | Example |
|---|---|
| See monthly variation | `5150 通信費` (Communications) jumps in July → AWS one-off |
| Detect anomalies | Sales drop in November only |
| Catch seasonality | `5170 接待交際費` (Entertainment expenses) clusters around the year-end holidays |

Top right: the net income (e.g. **"Net income ¥1,128,360"**).

## 6. Vendor / subaccount / department breakdowns

The **"Breakdown"** section aggregates the year's totals by your chosen axis.

| Axis | Use |
|---|---|
| Vendor | Total per major vendor (also useful for invoice-counterparty audits) |
| Subaccount | Per-bank inflows/outflows, per-card spending, etc. |
| Department | Totals per **"Department tag"** ([02. § 1-6](02-journal_en.md#1-6-adding-a-department-tag)) attached to entries |

Unclassified entries (without vendor / subaccount) show under **"(Unclassified)"**. When an entry references a vendor or subaccount that no longer exists, it shows under **"(Unknown vendor)"** / **"(Unknown subaccount)"** instead.

> If you've been linking vendors to entries, "How much did I spend at Amazon this year" pops out instantly.

## 7. Consumption-tax method comparison

For taxable businesses, the **"Consumption tax"** section runs the year's actuals through each method side by side. General and simplified taxation are always shown; the 20% special provision is shown for years up to 2026, and the 30% special provision only for 2027 and 2028:

| Method | Basis |
|---|---|
| General taxation | Output tax − input tax (auto-applies 80/70/50/30% transitional credit) |
| Simplified taxation | Output tax − (whichever is larger of: the weighted average of each business category's output tax × its deemed input rate, or, when one category makes up 75% or more of taxable sales, that category's rate applied to the whole under the 75% rule) |
| 20% special provision | (Output tax minus the entered rate-specific tax on sales returns/discounts) × 20% (limited to 2023/10–2026/9) |
| 30% special provision | (Output tax minus the entered rate-specific tax on sales returns/discounts and the tax on specified small-asset transfers) × 30% (limited to tax years 2027–2028 (Reiwa 9–10); specified small-asset transfers dated 2026-10-01 to 2028-03-31 are not deducted — see [07. Consumption tax](07-consumption-tax_en.md)) |

> **Important**: this screen provides **estimates and comparison**. `.xtx` output of the actual return is supported for **general taxation, the 20% special provision, and simplified taxation** (simplified taxation supports the two-category computation — including the 75% rule — for a fixed-asset sale's 4th category alongside your configured category, but does not cover a filer who actually runs multiple business categories; [10. `.xtx` export § 5](10-xtx-export_en.md#5-consumption-tax-general--20-special-provision--simplified-taxation-xtx-export)). The 30% special provision is out of scope for form generation — use the Return Preparation Corner (確定申告書等作成コーナー) or a tax accountant for that. Details in [07. Consumption tax](07-consumption-tax_en.md).

## 8. Year lock (Filed)

Once you've filed for a year, you can **lock** it to prevent accidental edits.

### 8-1. Locking

Select the year → in the overview block, click **"Lock as filed"**. A confirmation dialog opens; for a taxable year, choose the method you actually filed under in **"Consumption tax method used in the filing"** (the method with the lowest tax payable is preselected), then press **"Lock"**.

After locking:
- 🔒 Filed badge appears
- Adding or reversing entries in that year shows a confirmation first ("Proceed" continues); issuing and voiding invoices for that year is refused
- Snapshots of the P/L, balance sheet, and monthly sales (per-account amounts) are saved. For a year in which you are a taxable business, the consumption-tax method you choose in the lock dialog and its tax amount (national portion) are saved too and used for next year's interim filing and method comparison (if the consumption tax cannot be calculated, it is not saved and a note says so)

### 8-2. Unlocking

For an amended return: **"Unlock"** → add reversing entries → **"Lock as filed"** again. Re-locking saves a new snapshot of the amended figures. The old snapshot is not overwritten: it is kept as `superseded` from the moment you unlock. The amended-filing flow is in [12. Amended filing](12-amended_en.md).

## 9. Multi-year trend analysis

In the **"Multi-year trend analysis"** section, pick a start and end year (up to 10 years) and press **"Run analysis"** to compare P/L and balance-sheet account amounts side by side across years.

> This is a plain numeric table, not a chart — you can directly subtract the two columns to see how much changed. It only computes on demand (opening the page doesn't trigger it automatically).

Covers P/L and BS only (consumption tax, fixed assets, etc. are out of scope).

## 10. Budget management & cash flow forecast

### 10-1. Budget vs actual

In the **"Budget management"** section, enter a **revenue budget** and **expense budget** per month, then press **"Save budget"**. The same row shows actuals (pulled automatically from the existing monthly totals) and the difference.

> Budgets are monthly totals only (not broken down by account).

### 10-2. Receivables/payables and cash flow forecast

In the **"Receivables & payables"** section, register each item with a type (receivable/payable), description, due date, and amount — it's tracked as an independent sub-ledger (the description of a receivable auto-generated by issuing an invoice reads "invoice number (vendor name)"). When a payment comes in or goes out, enter the amount in that row's field and press **"Record payment"** (the remaining balance decreases automatically).

Below, in **"Cash flow forecast"**, pick an as-of date and horizon (in months), then press **"Run forecast"** to see expected inflow, outflow, and net change per month. Anything past due but not yet settled is rolled into the nearest month.

## 11. Sanity-check perspectives

When looking at Reports, scan these points for anything off:

| Check | Sign of trouble |
|---|---|
| BS totals match | Mismatch warning appears |
| Income aligns with reality | Net income is extremely high or low |
| Monthly P/L has no abnormal months | Sales 10× in just one month |
| Vendor breakdown shows no surprises | Unknown vendor with a large total |
| Consumption-tax comparison matches your method | Selected method is not the cheapest |

> If you find something off, use the journal-list filters ([02. § 2](02-journal_en.md#2-browsing-entries--journal-list)) to narrow down to the culprit, then reverse and re-enter.

## 12. Next steps

- Once books are stable, export to e-Tax format → [10. `.xtx` export](10-xtx-export_en.md)
- Lock the year after filing → § 8
- Set up backups → [11. Backup and restore](11-backup_en.md)