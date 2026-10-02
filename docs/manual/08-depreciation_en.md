# 08. Depreciation

Fixed-asset registration, straight-line / declining-balance methods, monthly proration / ¥1 memorandum value, small-asset depreciation special provision (¥400,000), year-end entry generation.

**Language**: [日本語](08-depreciation.md) | **English** | [繁體中文](08-depreciation_zh-TW.md)

> **By the end of this chapter you can**
> - Register acquired fixed assets in aoiko
> - Choose between straight-line and declining-balance (200%)
> - Determine eligibility for the small-asset depreciation special provision (Special Taxation Measures Act Art. 28-2, ¥400,000)
> - Generate year-end depreciation entries in bulk
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) — basic info and fiscal year are configured.

## 1. What is a fixed asset (in aoiko)

Business assets acquired for **¥100,000 or more** are registered as fixed assets and **depreciated** over multiple years.

| Acquisition cost | Treatment |
|---|---|
| < ¥100,000 | Fully expensed in the year (`5200 消耗品費` (Consumables) etc.) |
| ¥100,000 – ¥200,000 | Lump-sum depreciable asset (equal over 3 years) OR normal depreciation. Both supported |
| ¥100,000 – ¥300,000 (acquired on or before 2026/3/31) | Small-asset special provision eligible |
| ¥100,000 – ¥400,000 (**acquired on/after 2026/4/1**) | Small-asset special provision eligible (**Reiwa 8 reform raised threshold from ¥300,000 to ¥400,000**) |
| ¥400,000+ | Normal depreciation (straight-line or declining-balance; old straight-line or old declining-balance for assets acquired on/before 2007-03-31; lease-period straight-line for leases other than one transferring ownership — see § 2-2) |

## 2. Register a fixed asset

Navigation **"Settings"** > **"Fixed assets"** section.

### 2-1. Registration form

| Field | Content | Example |
|---|---|---|
| Name | Identifier label | `MacBook Pro 14"` |
| Acquisition date | When put into business use (not necessarily purchase date) | `2026-05-01` |
| Acquisition cost | Tax-inclusive amount (integer) | `350000` |
| Useful life | Statutory life from the National Tax Agency table | `4` (PCs typically 4 years) |
| Account | The debit account (Building / Vehicles / Tools etc.) | `1514 車両運搬具` (Vehicles) |
| Depreciation method | Straight-line / Declining balance (200%) / "Old straight-line method (acquired on/before 2007-03-31)" / "Old declining-balance method (acquired on/before 2007-03-31)" / "Lease-period straight-line method" / Small-asset special provision (Special Taxation Measures Act Art. 28-2, immediate expense) / Lump-sum depreciable asset (3-year even split) | ↓ see below |
| "Usable period is under 1 year" | Checkbox, for the Income Tax Act Enforcement Order Art. 138(1) immediate-expensing branch | |
| "Essential in nature to the business" | Checkbox. Affects whether a sale/disposal counts as capital gain (see § 5-2) | |
| "Lease term (months)" | Only entered when "Lease-period straight-line method" is selected | `60` |
| "Use declining-balance if disqualified (elected or deemed elected)" | Checkbox. Chooses the normal-depreciation method used for small-asset-special assets that fall out of eligibility (see § 3) | |

"Old straight-line method" and "Old declining-balance method" only appear for assets acquired on or before March 31, 2007 (Heisei 19). "Lease-period straight-line method" is for leases other than one transferring ownership (Income Tax Act Enforcement Order Art. 120-2(1)(6)).

Click **"Add"** to register.

### 2-2. Choosing a method

#### Straight-line (default)

Same amount each year. Formula: `Acquisition cost × 1/useful life × monthly proration` (for a converted asset, the acquisition cost here is the original acquisition cost; see § 2-3)

- Business PCs, software, machinery, etc.
- Predictable, easy to plan
- Default for sole proprietors (no prior filing required)

#### Declining-balance (200%)

Larger amount earlier, smaller later. Formula: `Undepreciated balance × rate (200%/life) × monthly proration`, switching to equal-amount mode when `tentative amount < guaranteed minimum`. The guaranteed minimum is `acquisition cost × guarantee rate`. A converted asset uses its original acquisition cost for the guaranteed minimum and starts from the undepreciated balance as of the conversion date (see § 2-3).

- Vehicles, machinery, etc., when you want larger initial expense
- For sole proprietors, **prior notification** (Depreciation Method Notification) is required
- aoiko supports useful lives 2 – 20 years

#### Old straight-line / Old declining-balance (acquired on or before March 31, 2007)

Assets acquired on or before March 31, 2007 (Heisei 19) depreciate under the old system. Old straight-line: `(cost − residual value) × 1/useful life`. Old declining-balance: `undepreciated balance × old rate`. Both switch, from the year after reaching 95% of cost, to amortizing the remainder (5% of cost minus ¥1) equally over the remaining 5 years (Income Tax Act Enforcement Order Art. 134(2), which applies to old declining-balance too). Residual value comes from Useful Life Ministerial Ordinance Schedule 11 (Schedules 1, 2, 5, 6: generally 10%, 0% for software; Schedule 3 intangibles, Schedule 6 software, mining rights, and mine tunnels: 0%; Schedule 4 living things: 5–50%; cattle/horses: the smaller of that percentage or ¥100,000). aoiko has old declining-balance rates for useful lives 2–100 years.

#### Lease-period straight-line (Income Tax Act Enforcement Order Art. 120-2(1)(6))

For a lease other than one transferring ownership. Annual amount = (acquisition cost, minus the residual guarantee amount when the contract is on or before March 31, 2027 and one exists) ÷ lease term in months × this year's months under the lease. Enter the contracted lease term in the "Lease term (months)" field.

#### Small-asset special provision (Special Taxation Measures Act Art. 28-2, immediate expense)

Fully expensed in the year if requirements met.

- Blue-return filers only
- Acquisition cost **below the threshold**:
  - Acquired by 2026/3/31: < ¥300,000
  - **Acquired on/after 2026/4/1: < ¥400,000** (Reiwa 8 reform)
- **Number of regular employees** at or below a limit (500 or fewer if acquired before 2026/4/1, 400 or fewer on/after)
- **Assets acquired on or after April 1, 2022 only**: assets used for leasing (other than leasing carried out as a main business) are excluded from eligibility (Reiwa 4 Government Ordinance No. 136 Suppl. Prov. Art. 4; Reiwa 4 Act No. 4 Suppl. Prov. Art. 31). Assets acquired on or before March 31, 2022 stay under the old rule, with no leasing exclusion at all. The National Tax Agency describes three types of "leasing carried out as a main business": leasing mainly to those who supply you goods, leasing that continuously uses your own business resources (staff, equipment, etc.), and leasing incidental to your main business. It also describes an exclusion when a buy-back condition covers roughly 90% or more of the acquisition cost. aoiko doesn't determine this automatically; self-declare it with the "Used for leasing (other than leasing as a principal business)" checkbox on the form
- Attaching a **breakdown statement** to the return is a requirement for eligibility (satisfied instead by recording set items on the blue-return statement's "Depreciation calculation" section — see § 4)
- Annual cap of ¥3,000,000 (excess goes through normal depreciation; prorated by the number of months in business during the year you started or closed, rounding any partial month up; the start date comes from [13. Opening Setup](13-opening-setup_en.md), and the closing date is entered on the same screen)
- Expiry: through 2029-03-31

When you select **"Small-asset special provision (Special Taxation Measures Act Art. 28-2, immediate expense)"**, aoiko auto-checks eligibility:

| Display | Meaning |
|---|---|
| ✓ Acquisition on 2026-05-01 meets threshold (under ¥400,000) | OK, can register |
| ⚠ Applies only to costs from ¥100,000 up to (not including) ¥400,000 (outside that range, so it's not applicable) | Acquisition cost outside the eligible range |
| ⚠ The application deadline (2029-03-31) has passed, so this special provision cannot be applied | Past expiry |

#### Lump-sum depreciable asset (Enforcement Order Art. 139)

Amortizes the acquisition cost **equally over 3 years** (no monthly proration, always cost × 1/3). Available to both blue-return and white-return filers.

- For assets with acquisition cost **¥100,000 or more and under ¥200,000** (under ¥100,000 is a small asset under Enforcement Order Art. 138, which requires full expensing instead)
- Even if disposed of or sold, **the undepreciated balance cannot be written off early — the 3-year equal amortization continues as scheduled** (statutory constraint, with exceptions only for ceasing business or inheritance; see § 5 "Disposal / sale" below)

Selecting **"Lump-sum depreciable asset (3-year even split)"** in the form auto-checks whether the acquisition cost is ¥100,000 or more and under ¥200,000.

### 2-3. Converted assets (personal use converted to business use)

An asset purchased before starting the business and put into business use afterward (a converted asset) is registered from Opening Setup in [13. Opening Setup § 4](13-opening-setup_en.md#4-converted-assets-bought-before-opening-used-from-opening-onward): "Acquisition date" holds the actual purchase date, "Acquisition cost" the actual purchase price, and a separate undepreciated balance as of the conversion date is stored alongside it (shown under the asset name in the fixed-assets table as "Undepreciated balance when put into business use"). From then on, depreciation follows Income Tax Act Enforcement Order Art. 135 and uses the two figures for different purposes:

- **Original acquisition cost** (the actual purchase price): the basis for the straight-line/old-straight-line annual amount, the declining-balance guaranteed minimum, where depreciation stops under each method (the ¥1 memorandum value, or full write-off for intangibles), eligibility for Enforcement Order Art. 138 (immediate expensing) / Art. 139 (lump-sum) / Special Taxation Measures Act Art. 28-2 (small-asset special provision), and the year's ¥3,000,000 cap tally
- **Undepreciated balance as of the conversion date**: the declining-balance/old-declining-balance starting balance, and the ceiling on how much can actually be expensed (the decline before conversion belongs to a non-business period and isn't a deductible expense). The fixed-assets table's "Year-end book value" and the opening entry's debit amount are also based on this figure

Whether Enforcement Order Art. 138, Art. 139, and Special Taxation Measures Act Art. 28-2 apply to converted assets, and how the eligibility threshold and cap interact with these two figures, has no published position from the NTA, the Ministry of Finance, or the National Tax Tribunal. What's described above follows the majority view among accounting-software vendors and tax-accountant practice explanations that aoiko implements; confirm with a tax accountant before filing.

### 2-4. Monthly proration and ¥1 memorandum value

Automatic behavior:

- **Monthly proration**: count the acquisition month as month 1, prorate by months in business use that year. Example: acquired in June, life 4 years, straight-line → 7/12 booked in current year
- **Where depreciation stops**: for assets acquired on or after 2007-04-01, tangible fixed assets under Income Tax Act Enforcement Order Art. 6 items 1–7 and 9 (excluding living things) depreciate until the book value reaches ¥1 (the memorandum value). Intangible fixed assets and mine tunnels under item 8 depreciate to the full cost (ending book value ¥0). Assets under a lease other than one transferring ownership (contracted on or before 2027-03-31) depreciate to cost minus the residual guarantee amount. Living things differ between the new system (above, ¥1 memorandum value) and the old system (acquired on or before 2007-03-31, depreciate to cost minus residual value)
- Amortizing the remainder equally over 5 years after reaching 95% of cost applies only to assets acquired on or before 2007-03-31 (old straight-line and old declining-balance alike; Income Tax Act Enforcement Order Art. 134(2))

### 2-5. Fixed assets for real estate income (only if enabled in Settings)

Once **Settings > Use real estate income** is turned on, the registration form gains a **"Business" / "Real estate"** category selector. For assets (e.g. buildings) registered as "Real estate", the **"Property detail"** button in the asset list lets you fill in the rental property's details (address, property type, tenant, rental period, floor area, annual rent, key money etc., deposit balance). The depreciation calculation and entry generation itself use the same logic as business assets.

> While this setting is off, neither the category selector nor the property detail button appears.

## 3. Year-end depreciation entry generation

At year-end (or any time within), select the **"Target year"** and click **"Generate depreciation entries"**:

- Calculates the year's depreciation for every registered fixed asset
- Creates one entry per asset (Debit `5210 減価償却費` (Depreciation) / Credit `1520 減価償却累計額` (Accumulated depreciation) — indirect method; the asset account itself is not reduced)
- Skips assets whose year's depreciation entry already exists
- An asset selected for the small-asset special provision that exceeds the annual ¥3,000,000 cap, or turns out ineligible, drops out of the small-asset tally and is instead depreciated normally by **straight-line** (or declining-balance, if "Use declining-balance if disqualified (elected or deemed elected)" is checked on the form), using its acquisition cost and useful life as-is, continuing in later years too

### Example result message

```
✓ Created 12 entries
ℹ 2 asset(s) posted with ordinary depreciation (straight-line/declining-balance): over the ¥3,000,000 annual cap
ℹ 1 asset(s) posted with ordinary depreciation (straight-line/declining-balance): small-asset special provision not applicable
```

> Generated entries appear in Home's "Recent journal entries" and in the Reports P/L. If you ran the wrong target year, reverse the relevant entries ([02. § 3 Reversing entries](02-journal_en.md#3-reversing-entries--fixing-mistakes)), fix asset info, then run again.

## 4. Fixed assets table columns

Settings > Fixed assets table:

| Column | Content |
|---|---|
| Name | Identifier |
| Acquired | Acquisition (purchase) date — for a converted asset, the purchase date rather than the date put into business use (see § 2-3) |
| Acquisition cost | Integer |
| Useful life | 4 years, 6 years, etc. |
| Current-year depreciation | Year's depreciation amount (after generation) |
| Year-end book value | Acquisition cost − accumulated depreciation. For a converted asset: "Undepreciated balance when put into business use" (the balance as of the conversion date) − depreciation booked since conversion |

Assets expensed immediately under the small-asset special provision show **"Current-year depreciation" = acquisition cost** (for a converted asset, the "Undepreciated balance when put into business use" instead of the acquisition cost) and **"Year-end book value" = 0** (no ¥1 memorandum value, since the rule is immediate write-off). An asset that fell out of small-asset eligibility (over the ¥3,000,000 cap, or otherwise ineligible) is listed in the `.xtx` export's "Depreciation calculation" section (the depreciable-asset breakdown on the white return statement) with the method 定額法 (straight-line) or 定率法 (declining-balance), with the amount matching the generated entry (it isn't part of the small-asset summary row on the blue-return statement below).

The blue-return statement KOA210 (and KOA220, if you have real estate income)'s "Depreciation calculation" section groups every asset that used the small-asset special provision this year into a single row (Special Taxation Measures Act Basic Directive 28-2-3): the name is the earliest-acquired asset's name, with the Japanese suffix " 他" ("and others") appended when two or more assets are grouped, acquisition cost and the depreciation base are the sum of each asset's original acquisition cost, this year's ordinary depreciation / this year's total depreciation / the amount included as a necessary expense are the sum of each asset's actual expensed amount this year (capped at the undepreciated balance as of conversion for a converted asset), the ending undepreciated balance is ¥0, and the remarks read "措法28の2（明細は別途保管）" (Special Taxation Measures Act Art. 28-2; details kept separately). No individual breakdown statement needs to be attached (Special Taxation Measures Act Basic Directive 28-2-3). This summary row only applies to the blue-return statement, not the white return's income/expense breakdown statement.

## 5. Disposal / sale

From the fixed assets table, use **"Dispose / Sell"** next to the asset name to record scrapping or a sale.

### 5-1. Scrap (disposal, no proceeds)

If the asset accrues depreciation in the current year, generate that year's depreciation entry first in [§ 3. Year-end depreciation entry generation](#3-year-end-depreciation-entry-generation). If you enter the disposal date and click **"Create journal entry"** before doing so, aoiko shows:

> Run "Generate depreciation entries" first. The disposal entry only balances together with this year's depreciation entry.

and does not create the entry.

Once the current year's depreciation entry exists, entering the disposal date and clicking **"Create journal entry"** automatically books the book value (undepreciated balance) at that point as the necessary expense `5280 固定資産除却損` (Loss on disposal of fixed assets) (debit `固定資産除却損` + `減価償却累計額` / credit the asset account). No further depreciation is booked afterward.

### 5-2. Sale (with proceeds)

Enter the disposal date, select "Sale", and enter the sale price, then create the entry:

- For a normal asset: **the difference between the sale proceeds and the book value is transferred through `事業主貸` (owner's draws) / `事業主借` (owner's contributions)**, with no effect on the profit & loss statement (debit the sale proceeds and `減価償却累計額` / credit the asset account; a gain is credited to `事業主借`, a loss debited to `事業主貸`)
- For a lump-sum depreciable asset that is essential in nature to the business (§ 5-3): the full sale proceeds are booked as debit cash etc. / credit `事業主借`. Because the 3-year equal depreciation continues, the asset account and `1520 減価償却累計額` are left untouched, and the profit & loss statement is not affected
- For a lump-sum depreciable asset that is not essential in nature to the business (§ 5-3): the full sale proceeds are booked as `4910` / `4920` 雑収入 (Miscellaneous income) (the book value and each asset's acquisition cost are not treated as an acquisition expense)

In every case, one credit line (the asset account for a normal asset; `事業主借` or 雑収入 for a lump-sum depreciable asset) automatically carries the taxable-transfer marker: the tax-inclusive sale price, the tax rate (10%), and the tax-inclusive flag. The consumption-tax taxable base is the tax-exclusive amount computed from this tax-inclusive price. Under simplified taxation, this sale is always aggregated as 4th-category business ([07. Consumption tax § 4-5](07-consumption-tax_en.md#4-5-consumption-tax-on-selling-a-fixed-asset)). Retirement with no proceeds is not taxed.

> When a sole proprietor sells a business fixed asset such as tools/fixtures, vehicles, or machinery, the resulting gain/loss is capital gain (**comprehensive taxation**), not business income, and must not be included in business income. Capital gain under comprehensive taxation is filed on pages **1 and 2** of Tax Return Form B (第一表・第二表), not on page 3 (第三表, separate taxation) used for land/buildings or securities. aoiko does not include the sale gain/loss in the P/L; it treats it as a transaction crossing the business/personal boundary, using the `事業主貸`/`事業主借` accounts already used for home-office private-use allocation and year-end equity rollup (except for a lump-sum depreciable asset booked as miscellaneous income above).
>
> However, an asset costing under ¥100,000 (the Enforcement Order Art. 138 immediate-expensing asset) is, in principle, excluded from capital gain (Income Tax Act Enforcement Order Art. 81 item 2). Only when its useful life is not under 1 year AND it is essential in nature to the business does it exceptionally produce capital gain as normal. An asset with a useful life under 1 year never produces capital gain, even if essential in nature to the business (Income Tax Basic Directive 33-1-3). A lump-sum depreciable asset (cost ¥100,000 or more, under ¥200,000) is likewise excluded unless essential in nature to the business (Income Tax Act Enforcement Order Art. 81 item 3; § 5-3). An asset that used the Special Taxation Measures Act Art. 28-2 small-asset special provision (under ¥400,000, immediate expensing) isn't covered by these exclusions, so selling it produces capital gain as normal. Declare this with the "Essential in nature to the business" checkbox on the § 2-1 registration form.

The bottom of the screen shows a **reference capital-gain estimate** (sale proceeds − acquisition expense [book value] − transfer costs, plus the holding period). The holding period is **short-term if within 5 years of the acquisition date, long-term if over 5 years**. The year's capital gain (short- and long-term combined, plus any other comprehensive-taxation capital gain) is offset against the ¥500,000 special deduction first from short-term gain, then from any remaining long-term gain (if the gain is under ¥500,000, the deduction equals that amount). When there's both a gain and a loss, they're netted first, then the deduction is applied. The long-term capital gain after the deduction, combined with any occasional income, is then counted at **half** when included in total income. This is a reference value only and isn't reflected in the `.xtx` export — file the actual return separately on pages 1 and 2 of Tax Return Form B. For a lump-sum depreciable asset that is essential in nature to the business, the acquisition expense used in this estimate is ¥0 (see § 5-3, Income Tax Basic Directive 49-40-2, and NTA Q&A).

### 5-3. Disposing of or selling a lump-sum depreciable asset

Lump-sum depreciable assets (Enforcement Order Art. 139) must **legally continue their 3-year equal amortization** even after disposal or sale — the undepreciated balance can't be written off early. The year of disposal or sale still produces that year's depreciation (Income Tax Basic Directive 49-40-2). aoiko creates no journal entry when a lump-sum depreciable asset is scrapped; the 3-year equal amortization simply continues, the asset account and `1520 減価償却累計額` stay as they are, and no disposal entry is created after the 3-year amortization ends either.

Selling a lump-sum depreciable asset that **is** essential in nature to the business is treated like a normal asset and produces capital gain like usual (§ 5-2), but under Income Tax Basic Directive 49-40-2 and NTA Q&A, no individual asset's acquisition cost can be deducted as an acquisition expense — the reference capital-gain estimate treats the acquisition expense as ¥0. Selling a lump-sum depreciable asset that is **not** essential in nature to the business never produces capital gain (Income Tax Act Enforcement Order Art. 81 item 3); the full sale proceeds are booked as miscellaneous income against business income instead (§ 5-2).

When several lump-sum depreciable assets are registered as a group, the denominator for the 3-year equal amortization is the group's combined acquisition cost, not each asset individually.

### 5-4. Reflecting this in the `.xtx` export

For the year of disposal/sale, the remarks field on KOA110 (income/expense breakdown statement) page 2's depreciation schedule automatically notes "Scrap" or "Sale".

## 6. FAQs

### Q. How is software depreciated?

As an intangible fixed asset. Useful life 5 years (self-use software). Straight-line only.

### Q. What about used assets?

Simplified-method formula (round any partial year down, minimum 2 years):
`(Statutory life − years elapsed) + years elapsed × 20%`

The simplified method only applies to assets on Useful Life Ministerial Ordinance Schedules 1, 2, 5, and 6 — it can't be used for Schedule 3 intangible fixed assets or Schedule 4 living things (use the statutory life instead). It also can't be used when capital expenditure made after acquisition exceeds 50% of the acquisition cost (use the estimation method or the statutory life instead).

aoiko doesn't auto-compute; enter the resulting years.

## 7. Next steps

- Carry over fixed-asset book values to the next year → [09. Prior-period carryover](09-carryover_en.md)
- Confirm depreciation amounts → [06. Reports § 3](06-reports_en.md#3-profit--loss-pl)