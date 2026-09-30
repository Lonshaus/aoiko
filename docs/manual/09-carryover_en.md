# 09. Prior-period carryover

Carry prior year-end balances into the new fiscal year as a carryover entry.

**Language**: [日本語](09-carryover.md) | **English** | [繁體中文](09-carryover_zh-TW.md)

> **By the end of this chapter you can**
> - Generate the carryover entry from the prior year's closing balances at the start of a new year
> - Understand how net income and 事業主貸 / 事業主借 (owner's draws / contributions) are absorbed into 元入金 (owner's capital)
> - Cancel and recreate a carryover entry if needed
>
> **Prerequisites**: prior-year entries are registered in aoiko, and the year is locked or essentially finalized.

## 1. What is the carryover

aoiko keeps double-entry books regardless of filing type (blue or white return), so each year produces a **P/L** and a **balance sheet** (BS). BS shows year-end balances; **the new year continues from those balances**, so at the start of each new year:

- Prior year-end **asset balances** become the new year's debits
- Prior year-end **liability balances** become the new year's credits
- Prior year's **net income** and **事業主貸 / 事業主借 (owner's draws / contributions)** are absorbed into **元入金 (owner's capital)**

This carryover entry is what aoiko's **"Prior-period carryover (opening balance)"** in Settings auto-generates.

## 2. The carryover entry's structure

Example: 2026 fiscal year carryover entry (prior 2025 year-end values)

```
2026-01-01  前期繰越（2025年から）
  Debit   1110 現金             500,000
  Debit   1130 普通預金        1,200,000
  Debit   1310 売掛金           300,000
  Debit   1510 工具器具備品     250,000   (cost − accumulated depreciation)
  Credit  2120 未払金            80,000
  Credit  3110 元入金         2,170,000   (= debit total − other credits)
```

### 元入金 (owner's capital) formula

`New year's 元入金 = Prior year-end 元入金 + Prior net income + 事業主借 − 事業主貸`

i.e.:
- **Prior net income** is absorbed into capital (capital increases when profitable)
- **事業主貸** (owner's draws, personal withdrawals) reduce capital
- **事業主借** (owner's contributions, personal funds added to business) increase capital

> So the new year's capital represents the "net equity of the business". The 事業主貸 / 事業主借 accounts reset to 0, accumulating from zero again in the new year.

## 3. Carryover steps

### 3-1. Switch to the new year

Settings > **"Current fiscal year"** → set to the new year (e.g. 2026) → **"Save"**.

### 3-2. Preview

In Settings > **"Prior-period carryover (opening balance)"** → click **"Preview"**:

- Shows the debit (assets) and credit (liabilities + capital) breakdown
- Shows the capital calculation basis:
  - **Prior year-end capital**: capital from the prior carryover (or from earlier years)
  - **Prior-year net income**: net income from prior P/L
  - **事業主貸 (owner's draws) / 事業主借 (owner's contributions)**: the prior year's withdrawals / contributions

Review the preview to ensure it looks correct.

### 3-3. Create

When OK, click **"Create carryover entry"**. An entry dated `{year}-01-01` is created and appears in Home's "Recent journal entries" and Reports' BS.

Success message:
> ✓ Carryover entry created

### 3-4. Redo (delete and recreate)

If something is wrong:

1. Click **"Delete existing carryover entry"** to cancel the existing `{year}-01-01` carryover entry (this is **not a physical delete**: aoiko automatically creates a reversing entry dated the same day that offsets it. Confirmed entries are immutable and corrections are kept as reversing entries, per the Electronic Books Preservation Act. Both the original carryover entry and the reversing entry stay in the history)
2. Fix the prior year's entries / fixed assets
3. Click **"Preview"** again → **"Create carryover entry"**

### 3-5. Errors

| Error | Meaning |
|---|---|
| A carryover entry already exists. Delete it first. | Already exists at `{year}-01-01`. See 3-4 |
| No journal entries in the previous year — nothing to carry over | No prior-year journal entries at all (e.g. first year of use) |

## 4. First year (no prior data)

When you first start using aoiko, there's no prior year so **"No journal entries in the previous year — nothing to carry over"** appears. Use the dedicated business-opening screen instead of carryover:

- If you have assets bought before opening and put into business use afterward (converted assets), or pre-opening expenses to book → use **[13. Opening Setup](13-opening-setup_en.md)**, which computes the opening book value and generates the offsetting entry against 元入金 (owner's capital) automatically
- If you're simply contributing cash or assets whose book value you already know, you can also create the entry by hand:

```
2026-01-01  Opening balances
  Debit   1110 現金             500,000
  Debit   1510 工具器具備品     200,000
  Credit  3110 元入金           700,000
```

Use [02. Creating journal entries § 1](02-journal_en.md#1-manual-entry--home-screen) to enter manually.

> Tax treatment of matters such as the date you filed your business-start notification and the acquisition date of a business PC should be confirmed with a tax accountant.

## 5. Year-transition workflow

1. Complete prior-year entries through **year-end** (e.g. 2025-12-31)
2. Reports > **"Lock as filed"** to lock the year ([06. § 8](06-reports_en.md#8-year-lock-filed))
3. Settings > **"Current fiscal year"** → change to 2026
4. Settings > Prior-period carryover > **"Create carryover entry"**
5. Begin booking 2026 entries

> Note: **current-year depreciation entries** are separate from carryover. The correct order is: generate depreciation entries for the prior year ([08. § 3](08-depreciation_en.md#3-year-end-depreciation-entry-generation)), then run carryover.

## 6. Notes

- The carryover entry is dated `2026-01-01` (year-start)
- You cannot create it twice in the same year; recreate via delete-then-create
- The entry's description is "前期繰越（○○年から）" (fixed Japanese text that includes the prior year)
- Internally tagged as `source: 'carryover'` (the journal list has no filter for it)

## 7. Reversing the allowance for doubtful accounts (洗替方式)

### 7-1. Why it exists

Under Income Tax Act Art. 52(3), the allowance for doubtful accounts booked at the end of the prior year must be added back to this year's gross revenue in full (the "洗替方式" / replacement method), and a fresh allowance is booked at this year's end. The carryover covered by this chapter just carries `2170 貸倒引当金` (Allowance for doubtful accounts) forward like any other liability — it does not perform this reversal. If nobody books the reversal, the allowance balance stays on the balance sheet, this year's new addition stacks on top of it, and the deduction accumulates year after year while gross revenue is understated. aoiko gives you a button that generates this entry.

### 7-2. Where the button is

Settings > the year-end processing area, next to Depreciation and Prior-period carryover: **"Reverse the allowance for doubtful accounts"**. Pressing it generates one journal entry dated `{year}-01-01`.

### 7-3. What it generates

| Side | Account | Amount |
|---|---|---|
| Debit | 2170 貸倒引当金 | Total addition booked last year |
| Credit | 4120 貸倒引当金繰戻額 (Reversal of allowance for doubtful accounts) | Total of last year's 5810 (lump-sum) + 5811 (individual) |
| Credit | 4230 貸倒引当金繰戻額（不動産） (Reversal of allowance for doubtful accounts, real estate) | Total of last year's 5410 (real estate) |

### 7-4. Behavior notes

- Nothing to reverse (no addition booked in the prior year) → the button reports that and creates nothing
- Running it twice → the second run is refused; only one reversal entry per year
- An addition entry that has been corrected via a reversing entry (訂正) is excluded from both the calculation and the duplicate check, so a mistaken reversal can be corrected and regenerated

### 7-5. Reflected in `.xtx`

The reversal is revenue and lands in the right box automatically on `.xtx` export. The business and real-estate parts go to different forms.

| Reversal | Blue return | White return |
|---|---|---|
| 4120 (business) | Statement p.1, allowance reversal box (KOA210 `AMF00420`) | Breakdown statement 「その他の収入」 (KOA110) |
| 4230 (real estate) | Real-estate statement's additional-item slot (KOA220) | Real-estate breakdown statement 「名義書換料その他」 (KOA130) |

See [10. `.xtx` export](10-xtx-export_en.md) for details.

## 8. Next steps

- Year's depreciation → [08. Depreciation § 3](08-depreciation_en.md#3-year-end-depreciation-entry-generation)
- Year-end output / filing → [10. `.xtx` export](10-xtx-export_en.md)
- If you need to amend after filing → [12. Amended filing](12-amended_en.md)