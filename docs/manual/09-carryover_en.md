# 09. Prior-period carryover

Carry prior year-end balances into the new fiscal year as an opening journal entry.

**Language**: [日本語](09-carryover.md) | **English** | [繁體中文](09-carryover_zh-TW.md)

> **By the end of this chapter you can**
> - Generate the opening journal entry from the prior year's closing balances at the start of a new year
> - Understand how net income and owner's draws/contributions are absorbed into Owner's Capital
> - Delete and recreate a carryover entry if needed
>
> **Prerequisites**: prior-year entries are registered in aoiko, and the year is locked or essentially finalized.

## 1. What is the carryover

For Blue Return filing as a sole proprietor, each year produces a **P/L** and a **balance sheet** (BS). BS shows year-end balances; **the new year continues from those balances**, so at the start of each new year:

- Prior year-end **asset balances** become the new year's debits
- Prior year-end **liability balances** become the new year's credits
- Prior year's **net income** and **owner's draws/contributions** are absorbed into **Owner's Capital**

This opening journal entry is what aoiko's **"Settings → Prior-period carryover (opening balances)"** auto-generates.

## 2. The opening entry's structure

Example: 2026 fiscal year opening entry (prior 2025 year-end values)

```
2026-01-01  Prior-period carryover (opening balances)
  Debit   1110 Cash                 500,000
  Debit   1130 Ordinary deposit   1,200,000
  Debit   1310 Accounts receivable  300,000
  Debit   1514 Tools & equipment   250,000   (cost − accumulated depreciation)
  Credit  2120 Accounts payable     80,000
  Credit  3110 Owner's capital   2,170,000   (= debit total − other credits)
```

### Owner's capital formula

`New year's owner's capital = Prior year-end capital + Prior net income + Owner's contributions − Owner's draws`

i.e.:
- **Prior net income** is absorbed into capital (capital increases when profitable)
- **Owner's draws** (personal withdrawals) reduce capital
- **Owner's contributions** (personal funds added to business) increase capital

> So the new year's capital represents the "net equity of the business". The owner's-draw/contribution accounts reset to 0, accumulating from zero again in the new year.

## 3. Carryover steps

### 3-1. Switch to the new year

Settings → **"Current fiscal year"** → set to the new year (e.g. 2026) → **"Save"**.

### 3-2. Preview

In Settings → **"Prior-period carryover (opening balances)"** → click **"Preview"**:

- Shows the debit (assets) and credit (liabilities + capital) breakdown
- Shows the capital calculation basis:
  - **Prior year-end capital**: capital from the prior carryover (or from earlier years)
  - **Prior net income**: net income from prior P/L
  - **Owner's movements**: prior owner's draws / contributions

Review the preview to ensure it looks correct.

### 3-3. Create

When OK, click **"Create opening journal entry"**. An entry dated `{year}-01-01` is created and appears in Home's recent entries and Reports' BS.

Success message:
> ✓ Created opening journal entry

### 3-4. Redo (delete and recreate)

If something is wrong:

1. Click **"Delete existing carryover entry"** to remove the existing `{year}-01-01` carryover entry (this is a **physical delete**, not a reversal — the opening carryover is machine-generated metadata-like, exempt from the audit-history requirement)
2. Fix the prior year's entries / fixed assets
3. Click **"Preview"** again → **"Create opening journal entry"**

### 3-5. Errors

| Error | Meaning |
|---|---|
| A carryover entry already exists. Delete it first. | Already exists at `{year}-01-01`. See 3-4 |
| No prior-year entries to carry over | No prior-year journal entries at all (e.g. first year of use) |

## 4. First year (no prior data)

When you first start using aoiko, there's no prior year so **"No prior-year entries to carry over"** appears. **Create the opening entry manually**:

Example: business start year, ¥500,000 personal funds + existing business PC (book value ¥200,000)

```
2026-01-01  Opening balances
  Debit   1110 Cash              500,000
  Debit   1514 Tools & equipment 200,000
  Credit  3110 Owner's capital   700,000
```

Use [02. Creating journal entries § 1](02-journal_en.md#1-manual-entry--home-screen) to enter manually.

> Tax treatment of the business-start date and prior-acquired PC requires confirmation with a tax accountant.

## 5. Year-transition workflow

1. Complete prior-year entries through **year-end** (e.g. 2025-12-31)
2. Reports → **"Lock as Filed"** to lock the year ([06. § 8](06-reports_en.md#8-year-lock-filed))
3. Settings → **"Current fiscal year"** → change to 2026
4. Settings → Prior-period carryover → **"Create opening journal entry"**
5. Begin booking 2026 entries

> Note: **current-year depreciation entries** are separate from carryover. The correct order is: generate depreciation entries for the prior year ([08. § 3](08-depreciation_en.md#3-year-end-depreciation-entry-generation)), then run carryover.

## 6. Notes

- The carryover entry is dated `2026-01-01` (year-start)
- You cannot create it twice in the same year; recreate via delete-then-create
- The entry's `description` is "Prior-period carryover (opening balances)"
- Internally tagged as `source: 'carryover'` (filterable via [02. § 2-1](02-journal_en.md#2-1-filters))

## 7. Next steps

- Year's depreciation → [08. Depreciation § 3](08-depreciation_en.md#3-year-end-depreciation-entry-generation)
- Year-end output / filing → [10. `.xtx` export](10-xtx-export_en.md)
- If you need to amend after filing → [12. Amended filing](12-amended_en.md)