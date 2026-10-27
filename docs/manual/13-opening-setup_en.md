# 13. Opening Setup

Generate the journal entries and fixed-asset registrations needed at business opening, from a single form covering pre-opening expenses, converted assets, and custom items.

**Language**: [日本語](13-opening-setup.md) | **English** | [繁體中文](13-opening-setup_zh-TW.md)

> **By the end of this chapter you can**
> - Book pre-opening preparation costs as a deferred asset and choose to expense them in full this year, amortize over 5 years, or amortize a custom amount
> - Automatically compute the "Opening book value" of an asset bought before opening but put into business use afterward, and register it as a fixed asset
> - Have the offsetting entry against 元入金 (owner's capital) generated automatically
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) done. For switching years on an existing business, use [09. Prior-period carryover](09-carryover_en.md) instead. If the year you enter has no opening entry but another year does, you choose whether to create it as a reopening or as a change of start date ([§ 7-2](#7-2-when-the-year-you-entered-has-no-opening-entry-but-another-year-does)).

## 1. What Opening Setup is

Opened from **"Opening Setup"** in Settings. It bundles the journal entries and fixed-asset registrations specific to business opening. You can still enter these by hand, but the **converted assets** opening book value calculation follows a nontrivial official formula.

## 2. Business start date

The reference date for all calculations. Enter the date you actually started operating the business.

When the screen opens, it first loads the saved business start and closing dates and the opening entries. While loading, "Loading…" is shown and the input fields do not appear. If loading fails, "The saved business dates and opening entries could not be read, so nothing can be created:" is shown followed by the reason, and nothing can be created. Once loaded, the business start date field is filled with the date of the opening entries of the most recent year. If there are no opening entries, it is filled with the business start date saved in Settings, and if there is none of that either, with today's date.

The same screen has a "Business closing date (leave blank if not closing)" field. If you plan to close the business, enter it — it's used for the monthly proration of the small-asset special provision's annual ¥3,000,000 cap in the year you open or close ([08. Depreciation § 2-2](08-depreciation_en.md#2-2-choosing-a-method)). Leave it blank if you're not closing, or don't know yet. The closing date field starts with the saved closing date only when that date is on or after the business start date.

When you create with the closing date left blank, the saved closing date is handled as follows.

- On or after the business start date: deleted
- Before the business start date: kept, not deleted
- A value that cannot be read as a date: kept, not deleted

If the saved closing date is before the business start date and you enter a different closing date and create, the review screen shows "The saved closing date … will be replaced by the date you entered." The year of the saved closing date is calculated as a full year, without proration by closing date.

If the business start date is not a date, or the closing date is neither blank nor a date, "Enter the business start date as a date. Leave the closing date blank or enter a date." appears, and "Review" and "Create" cannot be pressed. When you create, the business start and closing dates are also saved as Settings values ([§ 7](#7-review-and-create)).

### 2-1. "Business start and closing dates" in Settings

You can also check and correct the business start and closing dates in the "Business start and closing dates" section of Settings. At the top it shows "The annual limit (3,000,000 yen) for the small depreciable asset special rule is prorated by the months of business in the year you open and the year you close. For a year with opening entries, the date of those entries is used as the business start date."

- While the dates are loading it shows "Loading…"; if loading fails it shows "The business start and closing dates could not be read:" followed by the reason
- Under "Business start date used for each year", each year's start date and its source are listed, like "2026: 2026-04-01 (date of the opening entries)". The source is "date of the opening entries" or "saved value". When a year has no start date, "Not set (treated as a full year)" is shown and the year is calculated as a full year
- When the date of an opening entry cannot be read as a date, "The opening entry date "…" cannot be read as a date. Fix that entry with a correcting entry." appears
- There are two fields, "Business start date (saved value)" and "Business closing date (leave blank if not closing)". If the saved start date falls in a year that has opening entries, "That year uses the date of its opening entries, so this value is not used in calculations." appears; if it falls in a year without opening entries, a message like "Used as the business start date for 2026." appears. There is only one saved start date, and it is used only for the year of that date
- When the dates make a period of closing and reopening in the same year, "Calculated as closing and reopening in the same year (from January 1 to the closing date, and from the start date to December 31)." appears
- When a saved value cannot be read as a date, "The saved value "…" cannot be read as a date. Saving a date replaces it; saving the field blank deletes it." appears
- If you enter a value that cannot be read as a date and press "Save", "A value cannot be read as a date." appears and nothing is saved

When you press "Save", if the business start date had already been changed on another screen, a message like "Nothing was saved because the business start date had been changed on another screen. The latest value has been loaded; check it and save again." appears (for the closing date, or for both, the field name changes accordingly). Only the conflicting field returns to the latest value; the input in the other field stays as it is.

If a save changes the calculation for some year, and the range from the earliest year that changes through the Current tax year (or the depreciation target year, if that is later) includes a filed year, a confirmation is shown first ([§ 7](#7-review-and-create)). If there are also confirmed depreciation, disposal or sale entries, "Change the business start or closing date?" and "There are confirmed depreciation, disposal or sale entries. Existing entries are not rewritten; the depreciation calculated from now on will change." are shown, and pressing **"Change"** saves. If no year's calculation changes, as when you only change a saved value that is not used, none of these confirmations appear.

If there is a year whose redo stopped partway, this section also shows the notice and an "Open Opening Setup" link ([§ 9](#9-years-where-a-redo-stopped-partway)).

## 3. Pre-opening expenses (開業費)

Register expenses paid before opening to prepare the business (business cards, advertising, website design, supplies, meeting costs, etc.).

- **Not included**: items costing ¥100,000 or more (register those under "Converted assets" below, or as a regular fixed asset), cost of goods purchased for resale, security/guarantee deposits, and expenses incurred after opening
- The total of the items you register creates an entry: **debit 開業費 (pre-opening expenses) / credit 元入金 (owner's capital)**
- Then choose **"Expense in full this year"**, **"Amortize over 5 years (records only the first year's portion)"**, or **"Voluntary amortization (Enforcement Order Art. 137(3))"**:
  - Full expensing: also books **debit 減価償却費 (depreciation) / credit 開業費 (pre-opening expenses)** for the full amount (the pre-opening expense balance becomes zero)
  - 5-year: under Income Tax Act Enforcement Order Art. 137(1)(1), year 1's portion is the deferred-asset amount divided by 60, multiplied by the number of months you were in business during the year you incurred the cost (rounding any partial month up). The remainder stays on the books as a deferred asset; add the amortization entries for later years yourself from the regular journal entry screen.
  - Voluntary amortization: enter the amount yourself in the "This year's amortization amount" field, capped at the pre-opening expense's undepreciated balance. Unlike the 5-year split, you can choose any amount for any year.

> Amortizing pre-opening expenses is discretionary under tax law (任意償却, same article, paragraph 3) — you may expense any amount in any year you choose. The 5-year even split is just a convenient default, not a required allocation.

If you enter an unreadable value in an amount field, "Enter the amount as a number of 0 or more (e.g. 5000)" appears below the field, and if you enter a value of ¥100 trillion or more, "The amount is too large. Enter an amount under ¥100 trillion" appears; in both cases pressing **"Add"** does not add the item. The former error also appears when you press "Add" with an item name entered and the amount left blank. "This year's amortization amount" for voluntary amortization follows the same standard: the former error for an unreadable value, the latter for ¥100 trillion or more.

## 4. Converted assets (bought before opening, used from opening onward)

Register things like a computer that you bought before opening and started using for the business only after opening.

For an asset with a period of private use, you cannot use the original purchase price directly; you must compute an **"Opening book value" after subtracting depreciation attributable to the private-use period** (National Tax Agency [No.2108](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2108.htm), NTA Q&A). The fixed asset's "acquisition cost" field, however, still holds the **actual purchase price (original acquisition cost)** as-is; this opening book value is stored separately as the undepreciated balance as of the conversion date and shown under the asset name in the fixed-assets table as "Undepreciated balance when put into business use" (Income Tax Act Enforcement Order Art. 135).

### 4-1. Fields

Enter the asset name, purchase date, purchase price, useful life, and account, and the following are computed automatically:

- **Private-use period depreciation**: the purchase price minus the residual value (per the residual-value ratio in Useful Life Ministerial Ordinance Schedule 11 — 10% of cost for most tangible assets, 0% for intangible fixed assets and mine tunnels), multiplied by the old straight-line rate for a useful life of 1.5× the original (rounding any partial year down), over the private-use period (rounded down under 6 months, rounded up to a full year at 6 months or more)
- **Opening book value (undepreciated balance as of the conversion date)**: the purchase price minus this depreciation

If you enter an unreadable value in the acquisition cost, "Acquisition cost: Enter the amount as a number of 0 or more (e.g. 5000)" appears; for ¥100 trillion or more, "Acquisition cost: The amount is too large. Enter an amount under ¥100 trillion" appears. The useful life must be a whole number from 2 to 67 years. Otherwise "Useful life:" appears followed by "The useful life cannot be used with this depreciation method" or "Enter a useful life of 2 to 67 years for a converted asset (the depreciation before business use uses the old straight-line rate for 1.5 times the useful life)." If the purchase date is after the business start date, "The purchase date … is after the business start date …. Only assets acquired on or before the business start date can be converted at opening. Register assets acquired for the business after opening under Fixed assets in Settings." appears. While these errors are showing, pressing **"Add"** does not add the item. If the opening book value of an added row cannot be calculated, that row shows "Fixed asset "name": reason" and **"Create"** cannot be pressed.

On the registered fixed asset, the **acquisition date and acquisition cost hold your actual purchase date and purchase price**, and the **undepreciated balance as of the conversion date is stored separately** (shown in the fixed-assets table as "Undepreciated balance when put into business use"). How these two figures get used is covered in [08. Depreciation § 2-3](08-depreciation_en.md#2-3-converted-assets-personal-use-converted-to-business-use): the **actual purchase price (original acquisition cost)** is the basis for the straight-line annual amount, the declining-balance guaranteed minimum, eligibility for the small-asset special provision (Special Taxation Measures Act Art. 28-2) / Enforcement Order Art. 138 (immediate expensing) / Art. 139 (lump-sum), and the annual ¥3,000,000 cap tally; the starting balance for the declining-balance annual amount, the amount actually expensable in the opening year, and the cap on the fixed-assets table's "Year-end book value" use the **undepreciated balance as of the conversion date**.

### 4-2. About the small-asset special provision (please note)

There's a checkbox to indicate whether the **actual purchase price (original acquisition cost)** qualifies for the small-asset special provision (blue-return filers only, under ¥300,000 or ¥400,000 depending on the acquisition date). If applied, the amount actually expensable in the opening year is capped at the undepreciated balance as of the conversion date.

> ⚠ **Whether this special provision can be applied to a converted asset is not clearly established by any published position from the National Tax Agency, the Ministry of Finance, or the National Tax Tribunal** (the ordinary provision's text and circulars center on newly acquired assets). The treatment described here — eligibility judged on the original acquisition cost, actual expensing capped at the undepreciated balance as of the conversion date — is aoiko's implementation, following the majority view among accounting-software vendors and tax-accountant practice explanations. This setting is only a provisional choice — **please confirm with a tax accountant before actual filing**. For anything already filed, you'll need to work out the appropriate response with your tax accountant yourself.
>
> If you want to change this choice later, run Opening Setup again with opening entries for the same year already in place and press **"Reverse the existing opening entries and start over"**, which then appears: it cancels that year's opening entries with reversing entries, deletes the fixed assets Opening Setup registered for that year, and recreates everything (it stops if any of those assets already has depreciation or disposal entries; see [§ 7-1](#7-1-when-an-opening-entry-already-exists-for-the-year-you-entered)).

### 4-3. The ¥300,000 / ¥400,000 threshold

The Reiwa 8 tax reform raised the small-asset special provision's cap from under ¥300,000 to under ¥400,000, but **the higher cap applies only when the acquisition date is on or after April 1, 2026** (not the date put into business use). Since a converted asset's purchase date is often earlier, even if your business start date is after April 1, the ¥300,000 threshold still applies if the purchase date itself (= the acquisition date) predates April 1. This threshold check also uses the actual purchase price (original acquisition cost).

## 5. Opening inventory / deposits (optional)

If you already have inventory purchased before opening, or a security or guarantee deposit for rented office space, register these via "Custom items" below using the appropriate account.

## 6. Custom items

Add anything not covered by the categories above, specifying an item name, account, debit/credit side, and amount. The messages shown when you enter an unreadable value or a value of ¥100 trillion or more in the amount, and what happens when you press "Add" with a name entered and the amount left blank, are the same as for the pre-opening expenses in § 3.

## 7. Review and create

**"Review"** shows a summary of what will be created; **"Create"** generates the journal entries and fixed-asset registrations in one go. Afterward, check the results in the entry list ([02. Creating journal entries](02-journal_en.md)) or the fixed-asset list ([08. Depreciation](08-depreciation_en.md)).

If any of the following reaches ¥100 trillion or more — the total of the pre-opening expenses, the opening book value of any converted asset, the amount of a custom item, the amortization amount for voluntary amortization, or the amount of 元入金 (owner's capital) that goes in as the balancing difference of these — the review screen shows "The amount is too large. Enter an amount under ¥100 trillion" and nothing is created.

Registering the opening entries and fixed assets and saving the business start and closing dates are done together as a single write. If creation is aborted, neither the entries and fixed assets nor the saved start and closing dates are written. It is aborted in these cases.

- The year you entered already has opening entries ([§ 7-1](#7-1-when-an-opening-entry-already-exists-for-the-year-you-entered))
- The closing date was changed on another screen while you were confirming. "The business closing date was changed on another screen while you were confirming, so nothing was saved. Check the details and try again." appears
- The write failed. "Nothing was changed because the data could not be saved (the opening entries, fixed assets, and saved business start and closing dates are as they were)." appears together with the reason

Before the write, if the range from the earliest affected year (the earliest of the year you open, the year being reversed, and the year the closing date changes) through the Current tax year (or through the latest affected year, if that is later) includes a filed year, the "Writing to a filed year" confirmation appears ([06. § 8](06-reports_en.md#8-year-lock-filed)). Press **"Proceed"** to write.

### 7-1. When an opening entry already exists for the year you entered

If the year you entered already has opening entries created by Opening Setup, pressing **"Create"** creates nothing and shows "This year already has entries created by Opening Setup. Nothing was created, to avoid double-counting. To redo it, press "Reverse the existing opening entries and start over" below." At this point the review screen shows the **"Reverse the existing opening entries and start over"** button. Changing the business start date makes the button disappear.

Pressing the button shows the "Reverse the opening entries and start over?" confirmation, whose description gives the year to reverse and the year to create. Press **"Reverse and start over"** and exactly one year is redone, in this order.

1. Cancel that year's opening entries with reversing entries (the reversing entries remain in the books as correction history)
2. Delete the fixed assets that Opening Setup registered for that year. Fixed assets are not entries, so they are deleted rather than reversed
3. Create the opening entries and fixed assets from the current input

> Only fixed assets that Opening Setup registered with its marker can be deleted. Fixed assets registered by Opening Setup before this mechanism existed carry no marker, so they are not deleted automatically. Delete them by hand from the fixed-assets list in Settings.

The redo is done as a single write, and if it is aborted nothing is changed. It is aborted in these cases.

- There are no entries or fixed assets to create by the redo. "There are no entries or fixed assets to create, so the redo was not carried out (it would only reverse the existing entries). Enter at least one item with an amount greater than 0 yen." appears
- The closing date was changed on another screen while you were confirming
- A fixed asset to be deleted already has depreciation or disposal entries. Correct those entries first
- The write failed

### 7-2. When the year you entered has no opening entry but another year does

If the year you entered has no opening entry but another year has opening entries created by Opening Setup, pressing **"Create"** shows an "Opening entries exist for another year" dialog. The books cannot tell whether this is a reopening or a change of start date, so you choose which to create it as. The buttons below are for when the latest other year is 2025.

- **"Create as reopening (keep the opening entries for 2025 and other years)"**: creates the opening entries for the year you entered while leaving the other years' opening entries in place
- **"Create as a change of start date (reverse the 2025 opening entries first)"**: reverses the opening entries of the latest of the other years, then creates the opening entries for the year you entered. The same "Reverse the opening entries and start over?" confirmation as in § 7-1 then appears, giving the year to reverse and the year to create. Deleting fixed assets and the cases where it is aborted are also the same as in § 7-1

## 8. Next steps

- Generate this year's depreciation entries for converted assets → [08. Depreciation § 3](08-depreciation_en.md#3-year-end-depreciation-entry-generation)
- Switching to the following year → [09. Prior-period carryover](09-carryover_en.md)

## 9. Years where a redo stopped partway

If a year's opening entries were reversed and never re-created, the Opening Setup screen shows the following notice. The same notice is also shown in the "Business start and closing dates" section of Settings.

> The {years} opening entries were reversed partway through a redo and never re-created. Enter them again in Opening Setup and create them, or use "Restore the opening entries" to bring back the entries from before the reversal. If you have already handled this another way, you can hide this notice with "Don't show" in Opening Setup.

Each year has **"Restore the opening entries"** and **"Don't show"** buttons. The Settings screen only shows the notice; the restore operation is done on the Opening Setup screen, via "Open Opening Setup".

### 9-1. Restoring the opening entries

Pressing "Restore the opening entries" shows the "Restore the 2026 opening entries?" confirmation.

- The opening entries to restore are listed with their description and amount (the total debit). An entry whose amount cannot be read shows "—"
- If the date of the opening entries differs from the saved business start date, a message like "The opening entries to restore are dated 2026-04-01; the saved business start date is 2026-05-01." appears
- If the range includes a filed year, the filed-year confirmation appears after you press "Restore"

Pressing "Restore" creates new entries copying the opening entries from before the reversal. The new entries have `[再計上]` at the start of the description and today as the entry date. The original entries and the reversing entries remain as they are. The fixed-asset records for converted assets were not kept, so register them again afterwards in [§ 10](#10-converted-assets-to-register-again). Carryovers to later years are not corrected automatically, so redo the carryover in Settings if needed ([09. Prior-period carryover](09-carryover_en.md)).

The result is shown as follows.

| Display | Situation |
|---|---|
| "Restored 2 opening entries." | Restored (the number is how many entries were created) |
| "This year is no longer in the state left by an interrupted redo, so nothing was changed." | The state changed while you were confirming |
| "The original entry of a reversing entry is missing or was not created by Opening Setup, so the entries cannot be restored. Nothing was changed." | The target to restore is not valid |
| "An amount in the original entries cannot be read, so they cannot be restored. Nothing was changed." | An amount in the original entries cannot be read |

### 9-2. Hiding the notice

Pressing "Don't show" shows the "Hide the notice for 2026?" confirmation. Its description reads "Once hidden, "Restore the opening entries" for that year is no longer shown either. You can bring it back at any time with "Show hidden years"." Pressing "Don't show" in the confirmation stops that year's notice from appearing on both the Opening Setup screen and the Settings screen. When there are hidden years, "Show hidden years (1)" appears on the Opening Setup screen, and pressing it brings the notices back.

## 10. Converted assets to register again

Among the converted assets of the opening entries restored in [§ 9-1](#9-1-restoring-the-opening-entries), those that are not registered as fixed assets are listed under **"Converted assets to register again"** on the Opening Setup screen. Enter the acquisition date, acquisition cost and useful life and register them, and they are used for year-end depreciation. The entry amount is used as the opening book value. Each row shows the name, year and opening book value in the form "name (2026, opening book value ¥…)". If the list cannot be loaded, "The converted assets to register again could not be read, so the list cannot be shown:" is shown followed by the reason, in place of the list.

An asset with the same name and the same account registered in Settings, whose acquisition date is on or before the business start date, is treated as corresponding to this converted asset. In that case "An asset with the same name registered in Settings (name, acquired …) was treated as this converted asset" appears.

- **"Register"**: the business start date and account are shown, and you enter the acquisition date, acquisition cost and useful life. The "Apply the small-asset special provision" checkbox appears only for a blue return. If the range includes a filed year, the filed-year confirmation appears before registering
- When the opening book value calculated from your input differs from the entry amount, "The opening book value calculated from your input is …, which differs from the entry amount …. The asset will be registered with the entry amount to match the books." is shown with both amounts, and the button changes to **"Register with the entry amount"**. Pressing it registers with the entry amount
- When the acquisition cost is less than the opening book value, "The acquisition cost is less than the opening book value (…), so the asset cannot be registered. Check the acquisition cost." appears and the asset cannot be registered
- The reason is also shown, and the asset cannot be registered, when the acquisition date cannot be read as a date ("Purchase date cannot be read as a date"), the acquisition date is after the business start date ("The purchase date … is after the business start date …. …"), the useful life is outside 2–67 years, or the acquisition cost cannot be read or is ¥100 trillion or more
- When the entry amount cannot be read or exceeds the limit, "The entry amount cannot be read or exceeds the limit, so this asset cannot be registered. Check the original entry." appears and the asset cannot be registered
- **"Don't register"**: removes that converted asset from the list

When registration succeeds, "Registered name as a fixed asset." appears. When the asset is already registered or the original entry was reversed, "This asset was not registered because it is already registered or its original entry was reversed." appears.