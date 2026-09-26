# 13. Business opening setup (Opening Wizard)

Generate the journal entries and fixed-asset registrations needed at business opening, from a single form covering pre-opening expenses, converted assets, and custom items.

**Language**: [日本語](13-opening-setup.md) | **English** | [繁體中文](13-opening-setup_zh-TW.md)

> **By the end of this chapter you can**
> - Book pre-opening preparation costs as a deferred asset and choose to expense them in full this year, amortize over 5 years, or amortize a custom amount
> - Automatically compute the "Opening book value" of an asset bought before opening but put into business use afterward, and register it as a fixed asset
> - Have the offsetting entry against your opening capital (元入金) generated automatically
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) done. This is for a brand-new business (no prior-year entries exist). For switching years on an existing business, use [09. Prior-period carryover](09-carryover_en.md) instead.

## 1. What the Opening Wizard is

Opened from **"Business opening setup"** in Settings. It bundles the journal entries and fixed-asset registrations specific to business opening. You can still enter these by hand, but the **converted assets** opening book value calculation follows a nontrivial official formula.

## 2. Business start date

The reference date for all calculations. Enter the date you actually started operating the business.

The same screen has a "Business closing date (leave blank if not closing)" field. If you plan to close the business, enter it — it's used for the monthly proration of the small-asset special provision's annual ¥3M cap in the year you open or close ([08. Depreciation § 2-2](08-depreciation_en.md#2-2-choosing-a-method)). Leave it blank if you're not closing, or don't know yet (blank = not closing, treated as the full year).

## 3. Pre-opening expenses (開業費)

Register expenses paid before opening to prepare the business (business cards, advertising, website design, supplies, meeting costs, etc.).

- **Not included**: items costing ¥100,000 or more (register those under "Converted assets" below, or as a regular fixed asset), cost of goods purchased for resale, deposits/key money, and expenses incurred after opening
- The total of the items you register creates an entry: **debit Pre-opening expenses / credit Owner's capital**
- Then choose **"Expense in full this year"**, **"Amortize over 5 years (books year 1's portion only)"**, or **"Voluntary amortization"** (Enforcement Order Art. 137(3)):
  - Full expensing: also books **debit Depreciation / credit Pre-opening expenses** for the full amount (the pre-opening expense balance becomes zero)
  - 5-year: under Income Tax Act Enforcement Order Art. 137(1)(1), year 1's portion is the deferred-asset amount divided by 60, multiplied by the number of months you were in business during the year you incurred the cost (rounding any partial month up). The remainder stays on the books as a deferred asset; add the amortization entries for later years yourself from the regular journal entry screen.
  - Voluntary amortization: enter the amount yourself in the "This year's amortization amount" field, capped at the pre-opening expense's undepreciated balance. Unlike the 5-year split, you can choose any amount for any year.

> Amortizing pre-opening expenses is discretionary under tax law (任意償却, same article, paragraph 3) — you may expense any amount in any year you choose. The 5-year even split is just a convenient default, not a required allocation.

## 4. Converted assets (bought before opening, used from opening onward)

Register things like a computer that you bought before opening and started using for the business only after opening.

For an asset with a period of private use, you must NOT use the original purchase price as-is for the private-use adjustment — you must compute an **"Opening book value" after subtracting depreciation attributable to the private-use period** (National Tax Agency [No.2108](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2108.htm), NTA Q&A). The fixed asset's "acquisition cost" field, however, still holds the **actual purchase price (original acquisition cost)** as-is; this opening book value is stored separately as the undepreciated balance as of the conversion date and shown under the asset name in the fixed-assets table as "Undepreciated balance when put into business use" (Income Tax Act Enforcement Order Art. 135).

### 4-1. Fields

Enter the asset name, purchase date, purchase price, useful life, and account, and the following are computed automatically:

- **Private-use period depreciation**: the purchase price minus the residual value (per the residual-value ratio in Useful Life Ministerial Ordinance Schedule 11 — 10% of cost for most tangible assets, 0% for intangible fixed assets and mine tunnels), multiplied by the old straight-line rate for a useful life of 1.5× the original (rounding any partial year down), over the private-use period (rounded down under 6 months, rounded up to a full year at 6 months or more)
- **Opening book value (undepreciated balance as of the conversion date)**: the purchase price minus this depreciation

On the registered fixed asset, the **acquisition date and acquisition cost hold your actual purchase date and purchase price**, and the **undepreciated balance as of the conversion date is stored separately** (shown in the fixed-assets table as "Undepreciated balance when put into business use"). How these two figures get used is covered in [08. Depreciation § 2-3](08-depreciation_en.md#2-3-converted-assets-personal-use-converted-to-business-use): the **actual purchase price (original acquisition cost)** is the basis for the straight-line annual amount, the declining-balance guaranteed minimum, eligibility for the small-asset special rule (Sochiho Art. 28-2) / Enforcement Order Art. 138 (immediate expensing) / Art. 139 (lump-sum), and the annual ¥3M cap tally; the starting balance for the declining-balance annual amount, the amount actually expensable in the opening year, and the cap on the fixed-assets table's "Year-end book value" use the **undepreciated balance as of the conversion date**.

### 4-2. About the small-asset special provision (please note)

There's a checkbox to indicate whether the **actual purchase price (original acquisition cost)** qualifies for the small-asset special provision (Blue Return filers only, under ¥300,000 or ¥400,000 depending on the acquisition date). If applied, the amount actually expensable in the opening year is capped at the undepreciated balance as of the conversion date.

> ⚠ **Whether this special provision can be applied to a converted asset is not clearly established by any published position from the National Tax Agency, the Ministry of Finance, or the National Tax Tribunal** (the ordinary provision's text and circulars center on newly acquired assets). The treatment described here — eligibility judged on the original acquisition cost, actual expensing capped at the undepreciated balance as of the conversion date — is aoiko's implementation, following the majority view among accounting-software vendors and tax-accountant practice explanations. This setting is only a provisional choice — **please confirm with a tax accountant before actual filing**. For anything already filed, you'll need to work out the appropriate response with your tax accountant yourself.
>
> If you want to change this choice later, you can correct the generated entries and fixed-asset registration using the reversing-entry feature in [02. Creating journal entries](02-journal_en.md).

### 4-3. The ¥300,000 / ¥400,000 threshold

The Reiwa 8 tax reform raised the small-asset special provision's cap from under ¥300,000 to under ¥400,000, but **the higher cap applies only when the acquisition date is on or after April 1, 2026** (not the business-supply date). Since a converted asset's purchase date is often earlier, even if your business start date is after April 1, the ¥300,000 threshold still applies if the purchase date itself (= the acquisition date) predates April 1. This threshold check also uses the actual purchase price (original acquisition cost).

## 5. Opening inventory / deposits (optional)

If you already have inventory purchased before opening, or a deposit/key money for rented office space, register these via "Custom items" below using the appropriate account.

## 6. Custom items

Add anything not covered by the categories above, specifying an item name, account, debit/credit side, and amount.

## 7. Review and create

**"Review"** shows a summary of what will be created; **"Create"** generates the journal entries and fixed-asset registrations in one go. Afterward, check the results in the entry list ([02. Creating journal entries](02-journal_en.md)) or the fixed-asset list ([08. Depreciation](08-depreciation_en.md)).

## 8. Next steps

- Generate this year's depreciation entries for converted assets → [08. Depreciation § 3](08-depreciation_en.md#3-year-end-depreciation-entry-generation)
- Switching to the following year → [09. Prior-period carryover](09-carryover_en.md)