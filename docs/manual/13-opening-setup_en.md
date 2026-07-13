# 13. Business opening setup (Opening Wizard)

Generate the journal entries and fixed-asset registrations needed at business opening, from a single form covering pre-opening expenses, converted assets, and custom items.

**Language**: [日本語](13-opening-setup.md) | **English** | [繁體中文](13-opening-setup_zh-TW.md)

> **By the end of this chapter you can**
> - Book pre-opening preparation costs as a deferred asset and choose to expense them in full this year or amortize over 5 years
> - Automatically compute the "opening book value" of an asset bought before opening but put into business use afterward, and register it as a fixed asset
> - Have the offsetting entry against your opening capital (元入金) generated automatically
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) done. This is for a brand-new business (no prior-year entries exist). For switching years on an existing business, use [09. Prior-period carryover](09-carryover_en.md) instead.

## 1. What the Opening Wizard is

Opened from **"Business opening setup"** in Settings. It bundles the journal entries and fixed-asset registrations specific to business opening. You can still enter these by hand, but the wizard is especially recommended for **converted assets**, since the opening book value calculation follows a nontrivial official formula.

## 2. Business start date

The reference date for all calculations. Enter the date you actually started operating the business.

## 3. Pre-opening expenses (開業費)

Register expenses paid before opening to prepare the business (business cards, advertising, website design, supplies, meeting costs, etc.).

- **Not included**: items costing ¥100,000 or more (register those under "Converted assets" below, or as a regular fixed asset), cost of goods purchased for resale, deposits/key money, and expenses incurred after opening
- The total of the items you register creates an entry: **debit Pre-opening expenses / credit Owner's capital**
- Then choose **"Expense in full this year"** or **"Amortize over 5 years (books year 1's portion only)"**:
  - Full expensing: also books **debit Deferred-asset amortization / credit Pre-opening expenses** for the full amount (the pre-opening expense balance becomes zero)
  - 5-year: only year 1's portion (total ÷ 5, rounded down) is expensed. The remainder stays on the books as a deferred asset; add the amortization entries for later years yourself from the regular journal entry screen.

> Amortizing pre-opening expenses is discretionary under tax law (任意償却) — you may expense any amount in any year you choose. The 5-year even split is just a convenient default, not a required allocation.

## 4. Converted assets (bought before opening, used from opening onward)

Register things like a computer that you bought before opening and started using for the business only after opening.

For an asset with a period of private use, you must NOT use the original purchase price as-is — you must use the **"opening book value" after subtracting depreciation attributable to the private-use period** as the acquisition cost (National Tax Agency [No.2108](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2108.htm)).

### 4-1. Fields

Enter the asset name, purchase date, purchase price, useful life, and account, and the following are computed automatically:

- **Private-use period depreciation**: acquisition cost × 0.9 × the old straight-line rate for a useful life of 1.5× the original, over the private-use period (rounded down under 6 months, rounded up to a full year at 6 months or more)
- **Opening book value**: the purchase price minus this depreciation. This is registered as the fixed asset's acquisition cost (with the acquisition date set to your business start date)

### 4-2. About the small-asset special provision (please note)

There's a checkbox to indicate whether the opening book value qualifies for the small-asset special provision (under ¥300,000 or ¥400,000 depending on the acquisition date).

> ⚠ **Whether this special provision can be applied to a converted asset's calculated value is not clearly established by official guidance as of this writing** (the ordinary provision's text and circulars center on newly acquired assets). This setting is only a provisional choice — **please confirm with a tax accountant before actual filing**. If we later find clearer authority on this point, we will update this tool's logic and this explanation accordingly. For anything already filed before such an update, you'll need to work out the appropriate response with your tax accountant yourself.
>
> If you want to change this choice later, you can correct the generated entries and fixed-asset registration using the reversing-entry feature in [02. Creating journal entries](02-journal_en.md).

### 4-3. The ¥300,000 / ¥400,000 threshold

The Reiwa 8 tax reform raised the small-asset special provision's cap from under ¥300,000 to under ¥400,000, but **the higher cap applies only when the acquisition date is on or after April 1, 2026** (not the business-supply date). Since a converted asset's purchase date is often earlier, even if your business start date is after April 1, the ¥300,000 threshold still applies if the purchase date itself predates April 1.

## 5. Opening inventory / deposits (optional)

If you already have inventory purchased before opening, or a deposit/key money for rented office space, register these via "Custom items" below using the appropriate account.

## 6. Custom items

Add anything not covered by the categories above, specifying an item name, account, debit/credit side, and amount.

## 7. Review and create

**"Review"** shows a summary of what will be created; **"Create"** generates the journal entries and fixed-asset registrations in one go. Afterward, check the results in the entry list ([02. Creating journal entries](02-journal_en.md)) or the fixed-asset list ([08. Depreciation](08-depreciation_en.md)).

## 8. Next steps

- Generate this year's depreciation entries for converted assets → [08. Depreciation § 3](08-depreciation_en.md#3-year-end-depreciation-entry-generation)
- Switching to the following year → [09. Prior-period carryover](09-carryover_en.md)