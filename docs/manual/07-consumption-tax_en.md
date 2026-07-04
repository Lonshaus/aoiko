# 07. Consumption tax

Choosing among the 4 methods, transitional credit, input tax credit, deemed input rate.

**Language**: [日本語](07-consumption-tax.md) | **English** | [繁體中文](07-consumption-tax_zh-TW.md)

> **By the end of this chapter you can**
> - Understand the 4 methods (general / simplified / 2% special / 3% special) and pick the most favorable
> - Know how the transitional measures (80/70/50/30%) are applied inside aoiko
> - Use the Reports' "Consumption-tax 4-method comparison" as a decision aid
> - Map your choices to the settings (taxRegistration / taxFilingMethod)
>
> **Prerequisites**: consumption tax method set per [01. § 4](01-setup_en.md#4-choose-a-consumption-tax-method).
>
> **Important**: aoiko is an **estimation/comparison tool**. It does NOT produce the consumption tax return form (supporting tables 2-3 etc.). Use the online preparation corner ("作成コーナー") or a tax accountant for actual filing.
>
> The Reports' "Consumption-tax 4-method comparison" also shows a **"Filing-form equivalent (est.)"** column alongside the whole-yen estimate used for method comparison. It mimics the actual return's rounding (taxable base rounded down to the nearest 1,000 yen, tax amounts rounded down to 100 yen), so it's closer to what you'd actually pay — but it is still not a formal return produced with the supporting tables.

## 1. Overview of the 4 methods

| Method | Formula | Scope | Tends to favor |
|---|---|---|---|
| **General** | Output tax − input tax | All taxable businesses | Lots of inputs, many qualified invoices |
| **Simplified** | Output tax − (output tax × deemed input rate) | Sales ≤ ¥50M, prior notification filed | Actual input rate < deemed input rate |
| **2% special** | Output tax × 20% | 2023/10–2026/9 only — invoice-system transition relief | New-to-taxable due to invoice registration, around ¥10M sales |
| **3% special** | Output tax × 30% | Reiwa 9 & 10 only, sales ≤ ¥50M | Better than simplified in some cases |

> **National / local breakdown**: aoiko separates national (7.8% or 6.24%) and local (2.2% or 1.76%) consumption tax internally and shows totals. The Reports' "Consumption-tax 4-method comparison" displays totals.

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
| `taxFilingMethod` | `two-wari` | 2% special |
| `taxFilingMethod` | `three-wari` | 3% special |

Configure these on the Settings screen per [01. § 4](01-setup_en.md#4-choose-a-consumption-tax-method).

### 4-2. The Reports' "Consumption-tax 4-method comparison"

Navigation **"Reports"** → **"Consumption tax"** section. The year's actuals are run through all 4 methods side by side, showing the payable (national, local, total).

| Column | Content |
|---|---|
| Method | The 4 methods (simplified shows the registered category) |
| Output tax | Tax on taxable sales (4xxx accounts) for the year |
| Input tax (pre-transitional) | Tax on taxable purchases (5xxx + 1xxx, excluding owner's draws 1610) — informational |
| Creditable input tax | Post-transitional credit amount |
| Payable | Output − creditable (simplified / 2% / 3% use separate formulas) |

> The currently selected method is highlighted. If **another method has a lower payable**, that's a candidate for next year's choice.

### 4-3. What aoiko aggregates for input tax

- Debit side with **expense** or **asset** category (5xxx + 1xxx excluding owner's draws 1610)
- Tax rate > 0 (10% / 8%)
- If `taxIncluded: true`, the inclusive amount is back-calculated; if `false`, exclusive is used

> Output tax: credit side of revenue category with tax rate > 0.

## 5. Practical flow for choosing a method

1. **Can you stay tax-exempt?**
   - Sales ≤ ¥10M + no invoice registration → set `tax-free`, done
2. **Have you registered (newly taxable due to invoice system)?**
   - Around ¥10M sales: start with **2% special** (until 2026/9), compare in Reports
   - Around ¥50M sales: consider **3% special** (Reiwa 9 & 10)
3. **Continuing taxable with sales ≤ ¥50M?**
   - Few inputs → **simplified** often wins (depends on category)
   - Many inputs + most invoices qualified → **general**
4. **Sales > ¥50M?**
   - **General** only (simplified / specials not available)

> Simplified taxation requires a **prior notification** (Simplified Taxation Selection Notification, by the end of the prior fiscal year). Setting `simplified` in aoiko alone doesn't fulfill this — file the notification with the tax office too.

## 6. Caveats

- aoiko's consumption tax does **not** handle special cases (mixed-business categorization, non-creditable purchases, adjustment amounts, etc.)
- Overseas transactions (reverse charge, export-tax-exempt) are not supported
- Non-taxable purchases like residential rent: register with rate 0% — they will be automatically excluded from aggregates
- Misc. and home-office allocation expense handling: see [02. Creating journal entries § 1-2](02-journal_en.md#1-2-use-the-home-office-mixed-use-allocation)

## 7. Next steps

- Acquiring fixed assets → [08. Depreciation](08-depreciation_en.md)
- Year transition → [09. Prior-period carryover](09-carryover_en.md)
- `.xtx` filing output (excluding consumption-tax return) → [10. `.xtx` export](10-xtx-export_en.md)