# 14. Income & tax deductions

Estimate the tax return's "income deductions" and "tax calculation" sections on the "Deductions" screen.

**Language**: [日本語](14-income-deductions.md) | **English** | [繁體中文](14-income-deductions_zh-TW.md)

> **By the end of this chapter you can**
> - Understand what aoiko covers (deduction/credit estimates on top of business income) and what it doesn't (items with complex individual circumstances)
> - Enter family, insurance, medical expense, and donation data and see the estimate from the basic deduction through to the special reconstruction income tax
> - Know how to reflect income deductions/credits in the `.xtx` export
>
> **Prerequisite**: business income (the PL side of the financial statements) is finalized. [06. Reports](06-reports_en.md).

## 1. What aoiko covers

aoiko is fundamentally a "business P&L only" tool, but at the user's request it now also estimates the tax return's (KOA020, page 1) "income deductions" and "tax calculation" sections (below).

| Category | Contents |
|---|---|
| Other income | Salary income (the salary income deduction is calculated automatically); miscellaneous income (public pension is entered as a final amount, other misc. income is revenue minus expenses) |
| Real estate income (only if enabled in Settings) | Profit/loss is derived automatically from journal entries (recorded with the business/real estate toggle). Estimates the self-assessed business-scale status, the shared blue-return deduction pool with business income, and the loss-offsetting limitation from land-acquisition loan interest |
| Income deductions | Basic deduction, social insurance deduction, small business mutual aid deduction, life insurance deduction, earthquake insurance deduction, medical expense deduction, donation deduction, disability deduction, single parent/widow deduction, working student deduction, spouse deduction/special spouse deduction, dependent deduction, specific relative special deduction |
| Tax credits | Dividend tax credit, housing loan special tax credit, political donation special tax credit, housing seismic renovation special tax credit etc., foreign tax credit etc., other tax credits, disaster exemption amount |
| Tax calculation | Taxable income, income tax (progressive rate), special reconstruction income tax, estimated tax due/refund after subtracting withholding tax |

> **The casualty loss deduction, mortgage tax credit, and foreign tax credit are entered as final confirmed amounts.** Because they depend heavily on individual circumstances (disaster details, the year-end mortgage balance history, foreign tax payment certificates, etc.) and the rules are complex, aoiko doesn't calculate these — instead, transcribe the final amount from the NTA's worksheet or your accountant. Likewise, the "classification" codes for the spouse deduction, dependent deduction, specific relative special deduction, mortgage tax credit, and foreign tax credit (codes representing relationship or mortgage contract type) are not output, so complete them in e-Tax yourself if you use these deductions.
>
> **Public pension income is also entered as a final confirmed amount.** Its formula depends on age, pension amount, and other income across a frequently-revised bracket table, so aoiko doesn't calculate it — transcribe the final amount from the NTA's public pension income worksheet.
>
> **The payee breakdowns for rent paid, loan interest paid, and professional fees for real estate income (the detail pages of KOA220/KOA130) are also entered as final confirmed amounts.** The rental property details (property detail) are entered from the fixed asset registration in [08. Depreciation § 2-4](08-depreciation_en.md#2-4-fixed-assets-for-real-estate-income-only-if-enabled-in-settings).
>
> **Bad debt for real estate income (write-off vs. allowance) is recorded under two separate accounts.** "貸倒金（不動産）" (bad debt write-off) is an actual realized loss (deductible even if not a business-scale rental, per Income Tax Act art. 64); "貸倒引当金繰入額（不動産）" (bad debt allowance) is a reserve provision (only available for business-scale rentals per art. 51-4 — aoiko does not verify the business-scale requirement itself). For a non-business-scale rental with a bad debt, the correct treatment is generally not an allowance but excluding the uncollectible amount from that year's gross revenue in the year it's confirmed uncollectible. If the year is still unfiled, simply reduce/reverse the corresponding rent journal entry directly; if it relates to an already-filed year, use the correction-entry flow in [12. Amended Return](12-amended_en.md) (there's no dedicated bad-debt feature — it routes through the existing correction flow).

## 2. Input fields

Enter data from the **"Deductions"** navigation item.

- **Other income** (optional): salary income (enter the amount paid and withholding tax from your withholding slip); miscellaneous income (public pension as a final amount, other misc. income as revenue and expenses); withholding tax on the business income side (final amount)
- **Real estate income** (only shown if enabled in Settings): whether it's a business-scale rental (self-assessed), interest on debt incurred to acquire land (final amount), payee breakdowns for rent paid / loan interest paid / professional fees (multiple entries per category)
- **Family**: whether you have a spouse and their total income/age; dependents (name, age, total income, co-residing lineal ascendant) registered per person
- **Social insurance / life insurance, etc.**: social insurance and small business mutual aid contributions paid; life insurance (by new/old system and general/medical-nursing-care/individual pension category); earthquake insurance and the transitional measure (old long-term casualty insurance)
- **Medical expenses / donations / casualty loss**: medical expenses paid and insurance reimbursement received; total donations (including furusato nozei); casualty loss deduction (final amount)
- **Your status**: whether you qualify as disabled, special disabled, single parent, widow, or working student
- **Tax credits**: dividend tax credit, mortgage tax credit, political donation special tax credit, housing seismic renovation special tax credit etc., foreign tax credit, other tax credits, disaster exemption amount (all entered as final amounts)

Input is saved per year (it isn't automatically carried over from the previous year).

## 3. Estimate results

The bottom of the screen shows each deduction amount, the total income deductions, taxable income, income tax after credits, the special reconstruction income tax, the final income tax + special reconstruction income tax amount, withholding tax, and the estimated tax due/refund. Business income is derived automatically from the financial statements' totals and can't be edited on this screen. Total income adds any salary/misc income entered under "Other income" and real estate income (the offsettable portion) to business income, and that combined figure is what drives the basic deduction bracket, etc.

> The basic deduction reflects the temporary addition limited to Reiwa 7/8 (tax years 2025/2026, per the special provisions law art. 41-16-2): ¥950,000 for total income ≤¥1.32M, ¥580,000 for total income over ¥6.55M up to ¥23.5M, etc. — the amount varies by income level (from Reiwa 9/2027 onward it's scheduled to unify to a flat ¥580,000 for total income ≤¥23.5M).
>
> The salary income deduction reflects the temporary minimum-guarantee increase limited to Reiwa 8/9 (tax years 2026/2027): a flat ¥740,000 for salary income up to ¥2.2M (scheduled to revert to the permanent ¥690,000 from Reiwa 10/2028 onward).
>
> When there's real estate income, the blue-return special deduction (¥650k/¥550k/¥100k) is allocated from a single pool shared with business income (real estate is deducted first, then the remainder from business income). Real estate income that isn't a business-scale rental can't reach the ¥650k/¥550k tiers on its own (capped at ¥100k), but if business income alone qualifies for the ¥650k tier etc., that pool extends to the real estate portion too.

## 4. Reflecting this in the `.xtx` export

When generating the tax return `.xtx` in [10. `.xtx` export](10-xtx-export_en.md), if you've saved input on this screen, the income deduction/tax credit fields are automatically included. If nothing is saved (not entered), they're omitted as before, and you complete them yourself in e-Tax. If real estate income is entered, the real-estate financial statements (blue: KOA220, white: KOA130) are attached alongside the tax return (KOA020) in the same submission data.

## 5. Next steps

- Choosing a consumption tax method / interim filing → [07. Consumption tax](07-consumption-tax_en.md)
- `.xtx` export (income tax / consumption tax) → [10. `.xtx` export](10-xtx-export_en.md)