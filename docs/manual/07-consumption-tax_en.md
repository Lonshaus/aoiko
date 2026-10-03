# 07. Consumption tax

Choosing a method, transitional credit, input tax credit, deemed input rate.

**Language**: [日本語](07-consumption-tax.md) | **English** | [繁體中文](07-consumption-tax_zh-TW.md)

> **By the end of this chapter you can**
> - Understand each method (general / simplified / 20% special provision / 30% special provision) and pick the most favorable
> - Know how the transitional measures (80/70/50/30%) are applied inside aoiko
> - Use the method comparison in the Reports' "Consumption tax" section as a decision aid
> - Know how your choices map to the settings on screen (tax status / filing method)
>
> **Prerequisites**: consumption tax method set per [01. § 4](01-setup_en.md#4-choose-a-consumption-tax-method).
>
> **Important**: aoiko's consumption tax calculation is an **estimation/comparison tool**. `.xtx` export is supported for **general taxation, the 20% special provision, and simplified taxation** (simplified taxation supports the two-category computation — including the 75% rule — for a fixed-asset sale's 4th category alongside your configured category, but does not cover a filer who actually runs multiple business categories; [10. `.xtx` export § 5](10-xtx-export_en.md#5-consumption-tax-general--20-special-provision--simplified-taxation-xtx-export)). The 30% special provision is out of scope for form generation — use the Return Preparation Corner (確定申告書等作成コーナー) or a tax accountant for that.
>
> The method comparison in the Reports' "Consumption tax" section also shows a **"Filing-form equivalent (est.)"** column alongside the ¥1-unit estimate used for method comparison. It mimics the actual return's rounding (taxable base rounded down to the nearest ¥1,000, tax amounts rounded down to ¥100), so it's closer to what you'd actually pay — but it is still not a formal return produced with the supporting tables.

## 1. Overview of the methods

| Method | Formula | Scope | Tends to favor |
|---|---|---|---|
| **General** | Output tax − input tax | All taxable businesses | Lots of inputs, many qualified invoices |
| **Simplified** | Output tax − (whichever is larger of: the weighted average of each business category's output tax × its deemed input rate, or, when one category makes up 75% or more of taxable sales, that category's rate applied to the whole under the 75% rule) | Sales ≤ ¥50 million, advance election filed | Actual input rate < deemed input rate |
| **20% special provision** | (Output tax minus the entered rate-specific tax on sales returns/discounts) × 20% | 2023/10–2026/9 only — periods you became taxable because of invoice registration | New-to-taxable due to invoice registration, around ¥10 million sales |
| **30% special provision** | (Output tax minus the entered rate-specific tax on sales returns/discounts and the tax on specified small-asset transfers) × 30% | Tax years 2027–2028 (Reiwa 9–10) only, individuals only, base-period (2 years prior) taxable sales ≤ ¥10 million | Better than simplified in some cases |

> Both the 20% and 30% special provisions apply only to a taxable period that would otherwise have been tax-exempt without registration. They don't apply to: a foreign business with no permanent establishment in Japan; a period where you're still under an election to be a taxable business; a period in which you acquired an asset subject to the adjusted-fixed-asset rules; a period you became taxable because of inheritance; or a period with a shortened taxable period (for the 30% provision, every case on this list except inheritance applies). "Newly established corporation" is not a criterion here at all — that concept (Consumption Tax Act Art. 12-2) only applies to corporations, judged by business year and capital. From October 1, 2026 through March 31, 2028, the rule that excludes specified small-asset transfers from the base applies with substituted wording, so those transfers are not excluded during that window (Reiwa 8 Act No. 12, Suppl. Prov. Art. 90 Para. 2).

> **National / local breakdown**: aoiko separates national (7.8% or 6.24%) and local (2.2% or 1.76%) consumption tax internally and shows totals. The method comparison in the Reports' "Consumption tax" section displays totals.
>
> You can adjust the base for the 20% and 30% special provisions in the per-year inputs in the "Consumption tax" section. For "Tax on sales returns/discounts not yet offset (7.8% rate)" and "Tax on sales returns/discounts not yet offset (6.24% rate)", enter only the national consumption tax portion of returns/discounts that have not already been offset against sales on the debit side of a journal entry (offset amounts are already reflected in the taxable base). For the 30% special provision, also enter "Specified small-asset transfers (deducted from the 30% special provision base)" with the transfer date and its national consumption tax portion; only transfers falling outside the Suppl. Prov. Art. 90 Para. 2 window above (October 1, 2026 – March 31, 2028) — i.e. on or after April 1, 2028 — are automatically excluded from the base. Transfers within that window stay in the base.

## 2. Deemed input rates (simplified taxation)

Statutory rates by business category:

| Category | Deemed input rate | Industry |
|---|---|---|
| 1st | 90% | Wholesale |
| 2nd | 80% | Retail, agri/forestry/fishery (food) |
| 3rd | 70% | Manufacturing, construction, agri/forestry/fishery (other), etc. |
| 4th | 60% | Other (restaurants etc.) |
| 5th | 50% | Services, finance, transport/communications |
| 6th | 40% | Real estate |

> Refer to the National Tax Agency's business-category FAQ. Typical IT freelancers / consultants are usually **5th category** (services).
>
> When a fixed-asset sale (always 4th category) falls in a different category from the one you set, aoiko computes it as running two business categories under Consumption Tax Act Enforcement Order Art. 57: either the principle method (a weighted-average deemed input rate: the sum of each category's output tax × its deemed input rate, divided by the total output tax of all categories) or, when one category makes up 75% or more of taxable sales (excluding tax-exempt sales), the 75% rule that applies that category's rate to the whole (same article, Para. 3). aoiko automatically uses whichever gives the larger credit, and the `.xtx` export includes the per-category fields on Attachment 5-3. A filer who actually runs multiple business categories is out of scope.

## 3. Transitional measure (purchases without qualified invoice)

Under the invoice system (started 2023/10), the **input tax credit ratio** for **purchases without a qualified invoice** (e.g. from tax-exempt suppliers):

| Period | Credit ratio |
|---|---|
| 2023/10/01 – 2026/09/30 | **80%** |
| 2026/10/01 – 2028/09/30 | **70%** (added by the Reiwa 8 reform extension) |
| 2028/10/01 – 2030/09/30 | **50%** |
| 2030/10/01 – 2031/09/30 | **30%** (added by the Reiwa 8 reform extension) |
| 2031/10/01 – | **0%** (full phase-out) |

> Purchases **with** a qualified invoice are always 100% creditable (assuming conditions met). The transitional measure applies only to "no qualified invoice" cases.
>
> Each journal line in aoiko is marked as qualified-invoice compliant or not (on [04. Receipt OCR](04-receipt-ocr_en.md) it is set when the registration-number field holds a T + 13-digit number; on CSV import you set it per row with the "Qualified" checkbox, off by default; manual entries and order imports are always not compliant and the screen offers no way to change it). Under general taxation, this mark together with the transaction date determines the applied credit ratio.

## 4. Operation in aoiko

### 4-1. Settings mapping

| Setting | Choice | Effect |
|---|---|---|
| Tax status | Taxable business | File as a taxable business |
| Tax status | Tax-exempt business (no consumption-tax filing) | Tax-exempt; Reports show estimates only as reference |
| Filing method | General taxation | General taxation |
| Filing method | Simplified taxation | Simplified taxation (with "Simplified taxation category" for the business category) |
| Filing method | 20% special provision (2023/10–2026/9) | 20% special provision |
| Filing method | 30% special provision (tax years 2027–2028, Reiwa 9–10) | 30% special provision |

Configure these on the Settings screen per [01. § 4](01-setup_en.md#4-choose-a-consumption-tax-method).

### 4-2. The Reports' "Consumption tax" section

Navigation **"Reports"** > **"Consumption tax"** section. The year's actuals are run through general and simplified taxation (always shown) plus the special provision that applies to that year (the 20% special provision up to 2026, the 30% special provision for 2027 and 2028) side by side, showing the payable (national, local, total).

| Column | Content |
|---|---|
| Filing method | General and simplified taxation, plus the special provision that applies to the year (simplified shows the registered category) |
| Output tax | Tax on taxable sales (4xxx accounts) for the year, plus the tax on journal lines carrying a taxable-transfer marker (e.g. a fixed-asset sale), whatever their account — including asset-account and `事業主借` (Owner's contributions) lines |
| Input tax (before transitional rule) | Tax on taxable purchases (5xxx + 1xxx, excluding `1610 事業主貸` (owner's draws)) — informational |
| Creditable input tax | Post-transitional credit amount |
| Tax payable | Output − creditable (simplified / 20% / 30% special provision use separate formulas) |
| Filing-form equivalent (est.) | An estimate that mimics the actual return's rounding (taxable base rounded down to the nearest ¥1,000, tax amounts rounded down to ¥100, etc.) |

> The method with the lowest net payable is highlighted and marked "★ Lowest payable". If it differs from your current method, it's a candidate for next year's choice.

### 4-3. What aoiko aggregates for input tax

- Debit side with **expense** or **asset** category (5xxx + 1xxx excluding `1610 事業主貸`)
- Tax rate > 0 (10% / 8%)
- If **Tax included** is ticked, the inclusive amount is back-calculated; if not, exclusive is used

> Output tax: credit side of revenue category with tax rate > 0. A line carrying a taxable-transfer amount — e.g. a fixed-asset sale — is counted once, using that line's own tax rate and inclusive/exclusive flag, into both output tax and the numerator (taxable sales) of the taxable-sales ratio, regardless of its account category (see [08. Depreciation](08-depreciation_en.md) for details).

### 4-4. Interim filing

Whether interim filing is required, and how many installments, is based on last year's confirmed national consumption tax divided by the months in the immediately preceding taxable period (Consumption Tax Act Art. 42 Paras. 1, 4, 6: ×6 exceeding ¥240,000 → once a year; ×3 exceeding ¥1,000,000 → 3 times a year; ×1 exceeding ¥4,000,000 → 11 times a year). Check the "Interim filing" panel below the "Consumption tax" section.

- **Months in the immediately preceding taxable period**: entered per tax year (1–12; blank = 12)
- **Prior year's confirmed tax**: auto-filled from the consumption tax saved when that year was locked in aoiko; enter it manually if the year is not locked or its consumption tax could not be calculated at lock time
- Based on the amount entered, aoiko shows whether filing is required, how many installments (1 / 3 / 11 per year), each period, its due date, and the prorated payment amount
- For individuals using the installment method (予定申告, prorated from last year), a filing is deemed to have been submitted on the filing deadline itself (Consumption Tax Act Art. 44). The payment obligation itself arises under Art. 48, and late payment triggers delinquency tax under Act on General Rules for National Taxes Art. 60 Para. 1. The tax office mailing a payment slip is an administrative convenience, not the reason filing is deemed done
- To compute from this period's actual results instead (**仮決算**, actual-results method), pick a period and export a `.xtx` for general or simplified taxation (the return-type field 「申告の種類」 is marked as interim, with the period included). The 20% special provision is an attachment to the final return and does not support interim filing
- If you made interim payments this year, enter the amount in the annual `.xtx` export panel — it's credited against the balance due (treated as ¥0 if left blank)

### 4-5. Consumption tax on selling a fixed asset

Selling a business fixed asset is an act incidental to the business and counts as a taxable transfer of taxable assets (Consumption Tax Act Basic Directive 5-1-7(3)). The taxable base is the tax-exclusive sale price (Consumption Tax Act Art. 28 Para. 1). Retirement without consideration is not taxed. Under simplified taxation, a fixed-asset sale is always treated as 4th-category business regardless of the category you set (Consumption Tax Act Basic Directive 13-2-9). See [08. Depreciation](08-depreciation_en.md) for details.

## 5. Practical flow for choosing a method

1. **Can you stay tax-exempt?**
   - Sales ≤ ¥10 million + no invoice registration → set tax status to **"Tax-exempt business"**, done
2. **Have you registered (newly taxable due to invoice system)?**
   - Around ¥10 million sales: start with **20% special provision** (until 2026/9), compare in Reports
   - Base-period taxable sales ≤ ¥10 million and an individual: consider **30% special provision** (tax years 2027–2028, Reiwa 9–10)
3. **Continuing taxable with sales ≤ ¥50 million?**
   - Few inputs → **simplified** often wins (depends on category)
   - Many inputs + most invoices qualified → **general**
4. **Sales > ¥50 million?**
   - **General** only (simplified / specials not available)

> Simplified taxation requires an **advance election** (the Simplified Taxation Selection Notification, filed by the end of the prior year). Choosing simplified taxation in aoiko alone doesn't fulfill this — file the notification with the tax office too.

## 6. Caveats

- **Cross-border transactions** (export exemption, import consumption tax, reverse charge) can be classified using the options the "tax category" field offers when a line's rate is 0% (see [02. Creating journal entries](02-journal_en.md))
- **Non-taxable sales** (e.g. residential rent) use the same "tax category" field — select **"Non-taxable"** so the amount is counted only in the denominator of the taxable-sales ratio (registering at rate 0% alone does not include it in that ratio)
- When the **taxable-sales ratio is under 95%, or taxable sales exceed ¥500 million**, general taxation splits the deduction using either the individual attribution method or the proportional allocation method. Choose the method under **Settings > Consumption tax**. With the individual attribution method, also set each purchase line's "usage category" (taxable-sales only / common use / non-taxable-sales only — unset defaults to taxable-sales only). Once you choose the proportional allocation method, you can't switch back to the individual attribution method until you've used it continuously through every taxable period starting up to and including the one in which 2 years have passed since you started (Consumption Tax Act Art. 30 Para. 5)
- **Bad-debt tax adjustment** (Consumption Tax Act Art. 39): when a receivable becomes uncollectible, select "Bad debt write-off" in the "tax category" field on that entry's debit line (e.g. the `5270 貸倒金` (bad debt write-off) account), and set the **Tax rate** to the original sale's rate (10% / 8%) — aoiko back-calculates the tax portion from the tax-included write-off amount and deducts it from the period's payable tax. If the receivable is later recovered, select "Bad debt recovery" on the income-side line to add the previously-deducted tax back. Applies under general, simplified, 20% special provision, and 30% special provision taxation alike
- Handling of miscellaneous expenses and the business-use portion of home-office allocation: see [02. Creating journal entries § 1-3](02-journal_en.md#1-3-use-the-home-office-mixed-use-allocation)

## 7. Next steps

- Acquiring fixed assets → [08. Depreciation](08-depreciation_en.md)
- Year transition → [09. Prior-period carryover](09-carryover_en.md)
- `.xtx` filing output (income tax; consumption tax for general taxation / 20% special provision / simplified taxation) → [10. `.xtx` export](10-xtx-export_en.md)