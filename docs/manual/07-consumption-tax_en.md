# 07. Consumption tax

Choosing a method, transitional credit, input tax credit, deemed input rate.

**Language**: [日本語](07-consumption-tax.md) | **English** | [繁體中文](07-consumption-tax_zh-TW.md)

> **By the end of this chapter you can**
> - Understand each method (general / simplified / 20% special provision / 30% special provision) and pick the most favorable
> - Know how the transitional measures (80/70/50/30%) are applied inside aoiko
> - Use the method comparison in the Reports' "Consumption tax" section as a decision aid
> - Map your choices to the settings (taxRegistration / taxFilingMethod)
>
> **Prerequisites**: consumption tax method set per [01. § 4](01-setup_en.md#4-choose-a-consumption-tax-method).
>
> **Important**: aoiko's consumption tax calculation is an **estimation/comparison tool**. `.xtx` export is supported for **general taxation, the 20% special provision, and simplified taxation** (simplified taxation supports the two-category computation — including the 75% special rule — for a fixed-asset sale's 4th category alongside your set category, but not a filer who actually runs multiple business categories; [10. `.xtx` export § 5](10-xtx-export_en.md#5-consumption-tax-general--20-special-provision--simplified-taxation-xtx-export)). The 30% special provision is out of scope for form generation — use the online preparation corner ("作成コーナー") or a tax accountant for that.
>
> The method comparison in the Reports' "Consumption tax" section also shows a **"Filing-form equivalent (est.)"** column alongside the whole-yen estimate used for method comparison. It mimics the actual return's rounding (taxable base rounded down to the nearest 1,000 yen, tax amounts rounded down to 100 yen), so it's closer to what you'd actually pay — but it is still not a formal return produced with the supporting tables.

## 1. Overview of the methods

| Method | Formula | Scope | Tends to favor |
|---|---|---|---|
| **General** | Output tax − input tax | All taxable businesses | Lots of inputs, many qualified invoices |
| **Simplified** | Output tax − (whichever is larger of: the weighted average of each business category's output tax × its deemed input rate, or, when one category makes up 75% or more of taxable sales, that category's rate applied to the whole under the 75% special rule) | Sales ≤ ¥50M, prior notification filed | Actual input rate < deemed input rate |
| **2-wari special** | (Output tax minus the entered rate-specific tax on sales returns/discounts) × 20% | 2023/10–2026/9 only — periods you became taxable because of invoice registration | New-to-taxable due to invoice registration, around ¥10M sales |
| **3-wari special** | (Output tax minus the entered rate-specific tax on sales returns/discounts and the tax on specified small-asset transfers) × 30% | Reiwa 9 & 10 only, individuals only, base-period (2 years prior) taxable sales ≤ ¥10M | Better than simplified in some cases |

> Both the 20% and 30% special provisions apply only to a taxable period that would otherwise have been tax-exempt without registration. They don't apply to: a foreign business with no permanent establishment in Japan; a period where you're still under an election to be a taxable business; a period in which you acquired an asset subject to the adjusted-fixed-asset rules; a period you became taxable because of inheritance; or a period with a shortened taxable period (the 30% provision excludes only the inheritance case). "Newly established corporation" is not a criterion here at all — that concept (Consumption Tax Act Art. 12-2) only applies to corporations, judged by fiscal year and capital. From October 1, 2026 through March 31, 2028, the rule that excludes small-value asset transfers from the base is read-substituted, so those transfers are not excluded during that window (Reiwa 8 Act No. 12, Suppl. Prov. Art. 90 Para. 2).

> **National / local breakdown**: aoiko separates national (7.8% or 6.24%) and local (2.2% or 1.76%) consumption tax internally and shows totals. The method comparison in the Reports' "Consumption tax" section displays totals.
>
> You can adjust the base for the 20% and 30% special provisions in the per-year inputs in the "Consumption tax" section. For "Tax on sales returns/discounts not yet offset (7.8% rate)" and "Tax on sales returns/discounts not yet offset (6.24% rate)", enter only the national consumption tax portion of returns/discounts that have not already been offset against sales on the debit side of a journal entry (offset amounts are already reflected in the taxable base). For the 30% special provision, also enter "Specified small-asset transfers (deducted from the 30% special provision base)" with the transfer date and its national consumption tax portion; only transfers falling outside the Suppl. Prov. Art. 90 Para. 2 window above (2026/10/1–2028/3/31) — i.e. on or after April 1, 2028 — are automatically excluded from the base. Transfers within that window stay in the base.

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
> When a fixed-asset sale (always 4th category) falls in a different category from the one you set, aoiko computes it as running two business categories under Consumption Tax Act Enforcement Order Art. 57: either the principle method (each category's taxable-base tax × its deemed input rate, weighted and summed) or, when one category makes up 75% or more of taxable sales (excluding tax-exempt sales), the 75% special rule that applies that category's rate to the whole (same article, Para. 3). aoiko automatically uses whichever gives the larger credit, and the `.xtx` export includes the per-category fields on Attached Table 5-3. A filer who actually runs multiple business categories is out of scope.

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
> Each journal line in aoiko has an `invoiceCompliant: true / false` flag (auto-set to `true` when [04. Receipt OCR](04-receipt-ocr_en.md) recognizes a T+13 number; defaults to `false` for CSV and manual entries). Under general taxation, this flag together with the transaction date determines the applied credit ratio.

## 4. Operation in aoiko

### 4-1. Settings mapping

| Setting key | Value | Effect |
|---|---|---|
| `taxRegistration` | `taxable` | File as a taxable business |
| `taxRegistration` | `tax-free` | Tax-exempt; Reports show estimates only as reference |
| `taxFilingMethod` | `general` | General taxation |
| `taxFilingMethod` | `simplified` | Simplified taxation (with `simplifiedTaxCategory` for the business category) |
| `taxFilingMethod` | `two-wari` | 20% special provision |
| `taxFilingMethod` | `three-wari` | 30% special provision |

Configure these on the Settings screen per [01. § 4](01-setup_en.md#4-choose-a-consumption-tax-method).

### 4-2. The Reports' "Consumption tax" section

Navigation **"Reports"** → **"Consumption tax"** section. The year's actuals are run through general and simplified taxation (always shown) plus the special provision that applies to that year (the 20% special provision up to 2026, the 30% special provision for 2027 and 2028) side by side, showing the payable (national, local, total).

| Column | Content |
|---|---|
| Method | General and simplified taxation, plus the special provision that applies to the year (simplified shows the registered category) |
| Output tax | Tax on taxable sales (4xxx accounts) for the year, plus the tax on journal lines carrying a taxable-transfer marker (e.g. a fixed-asset sale), whatever their account — including asset-account and `Owner's contribution` lines |
| Input tax (pre-transitional) | Tax on taxable purchases (5xxx + 1xxx, excluding owner's draws 1610) — informational |
| Creditable input tax | Post-transitional credit amount |
| Payable | Output − creditable (simplified / 20% / 30% special provision use separate formulas) |
| Filing-form equivalent (est.) | An estimate that mimics the actual return's rounding (taxable base rounded down to the nearest 1,000 yen, tax amounts rounded down to 100 yen, etc.) |

> The currently selected method is highlighted. If **another method has a lower payable**, that's a candidate for next year's choice.

### 4-3. What aoiko aggregates for input tax

- Debit side with **expense** or **asset** category (5xxx + 1xxx excluding owner's draws 1610)
- Tax rate > 0 (10% / 8%)
- If `taxIncluded: true`, the inclusive amount is back-calculated; if `false`, exclusive is used

> Output tax: credit side of revenue category with tax rate > 0. A line carrying a taxable-transfer amount — e.g. a fixed-asset sale — is counted once, using that line's own tax rate and inclusive/exclusive flag, into both output tax and the numerator (taxable sales) of the taxable-sales ratio, regardless of its account category (see [08. Depreciation](08-depreciation_en.md) for details).

### 4-4. Interim filing

Whether interim filing is required, and how many installments, is based on last year's confirmed national consumption tax divided by the months in the immediately preceding taxable period (Consumption Tax Act Art. 42 Paras. 1, 4, 6: ×6 exceeding ¥240,000 → once a year; ×3 exceeding ¥1,000,000 → 3 times a year; ×1 exceeding ¥4,000,000 → 11 times a year). Check the "Interim filing" panel below the "Consumption tax" section.

- **Months in the immediately preceding taxable period**: entered per tax year (1–12; blank = 12)
- **Prior year's confirmed tax**: auto-filled if that year was locked in aoiko; otherwise enter it manually
- Based on the amount entered, aoiko shows whether filing is required, how many installments (1 / 3 / 11 per year), each period, its due date, and the prorated payment amount
- For individuals using the installment method (予定申告, prorated from last year), a filing is deemed to have been submitted on the filing deadline itself (Consumption Tax Act Art. 44). The payment obligation itself arises under Art. 48, and late payment triggers delinquency tax under Act on General Rules for National Taxes Art. 60 Para. 1. The tax office mailing a payment slip is an administrative convenience, not the reason filing is deemed done
- To compute from this period's actual results instead (**仮決算**, actual-results method), pick a period and export a `.xtx` for general or simplified taxation (the "filing type" field is marked as interim, with the period included). The 20% special provision is an attachment to the final return and does not support interim filing
- If you made interim payments this year, enter the amount in the annual `.xtx` export panel — it's credited against the balance due (treated as ¥0 if left blank)

### 4-5. Consumption tax on selling a fixed asset

Selling a business fixed asset is an act incidental to the business and counts as a taxable transfer of taxable assets (Consumption Tax Act Basic Directive 5-1-7(3)). The taxable base is the tax-exclusive sale price (Consumption Tax Act Art. 28 Para. 1). Retirement without consideration is not taxed. Under simplified taxation, a fixed-asset sale is always treated as 4th-category business regardless of the category you set (Consumption Tax Act Basic Directive 13-2-9). See [08. Depreciation](08-depreciation_en.md) for details.

## 5. Practical flow for choosing a method

1. **Can you stay tax-exempt?**
   - Sales ≤ ¥10M + no invoice registration → set `tax-free`, done
2. **Have you registered (newly taxable due to invoice system)?**
   - Around ¥10M sales: start with **20% special provision** (until 2026/9), compare in Reports
   - Base-period taxable sales ≤ ¥10M and an individual: consider **30% special provision** (Reiwa 9 & 10)
3. **Continuing taxable with sales ≤ ¥50M?**
   - Few inputs → **simplified** often wins (depends on category)
   - Many inputs + most invoices qualified → **general**
4. **Sales > ¥50M?**
   - **General** only (simplified / specials not available)

> Simplified taxation requires a **prior notification** (Simplified Taxation Selection Notification, by the end of the prior fiscal year). Setting `simplified` in aoiko alone doesn't fulfill this — file the notification with the tax office too.

## 6. Caveats

- **Cross-border transactions** (export exemption, import consumption tax, reverse charge) can be classified in the "tax category" field that appears when a line's rate is 0% (see [02. Creating journal entries](02-journal_en.md))
- **Non-taxable sales** (e.g. residential rent) use the same "tax category" field — select "tax-exempt" so the amount is counted in the taxable-sales-ratio denominator (registering at rate 0% alone does not include it in that ratio)
- When the **taxable-sales ratio is under 95%, or taxable sales exceed ¥500M**, the general method splits the deduction using either the individual attribution method or the proportional allocation method. Choose the method under **Settings ＞ Consumption tax**; with the individual attribution method, also set each purchase line's "usage category" (taxable-sales only / common use / non-taxable-sales only — unset defaults to taxable-sales only). Once you choose the proportional allocation method, you can't switch back to the individual attribution method until you've used it continuously through every taxable period starting up to and including the one in which 2 years have passed since you started (Consumption Tax Act Art. 30 Para. 5)
- **Bad-debt tax adjustment** (Consumption Tax Act Art. 39): when a receivable becomes uncollectible, select "bad debt write-off" in the "tax category" field on that entry's debit line (e.g. the bad-debt-loss account), and set `taxRate` to the original sale's rate (10% / 8%) — aoiko back-calculates the tax portion from the tax-included write-off amount and deducts it from the period's payable tax. If the receivable is later recovered, select "bad debt recovery" on the income-side line to add the previously-deducted tax back. Applies under general, simplified, 20% special provision, and 30% special provision taxation alike
- Misc. and home-office allocation expense handling: see [02. Creating journal entries § 1-3](02-journal_en.md#1-3-use-the-home-office-mixed-use-allocation)

## 7. Next steps

- Acquiring fixed assets → [08. Depreciation](08-depreciation_en.md)
- Year transition → [09. Prior-period carryover](09-carryover_en.md)
- `.xtx` filing output (income tax; consumption tax for general taxation / 20% special provision / simplified taxation) → [10. `.xtx` export](10-xtx-export_en.md)