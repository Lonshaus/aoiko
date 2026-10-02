# 02. Creating journal entries

Manual entry creation, browsing/searching the journal list, and reversing entries.

**Language**: [日本語](02-journal.md) | **English** | [繁體中文](02-journal_zh-TW.md)

> **By the end of this chapter you can**
> - Enter multi-line journal entries with debits and credits
> - Filter the journal list by year / month / description / amount / vendor
> - Reverse a confirmed entry with a reversing entry
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) is done (trade name, fiscal year, and any subaccounts you need).

## 1. Manual entry — Home screen

The bottom half of the **"Home"** navigation contains the **New journal entry** form.

### 1-1. Basic flow

1. **Date**: transaction date (defaults to today)
2. **Description**: what the transaction is (e.g. `Electricity bill`, `Workshop fee`)
3. Enter one or more **debit** lines:
   - **Account**: pick from the dropdown (e.g. `5130 水道光熱費` (Utilities))
   - **Subaccount** (optional): if registered (e.g. `AWS`)
   - **Amount**: positive integer
   - **Tax rate**: `Standard 10%` / `Reduced 8%` / `Out of scope`
   - **Tax included**: checked means tax-inclusive; unchecked means tax-exclusive
4. Enter one or more **credit** lines (same fields)
5. Use **"+ Add debit"** / **"+ Add credit"** for composite (multi-line) entries
6. **"Difference"** at the bottom shows the gap between the debit and credit totals (in red while they don't match). When they match, **"✓ Balanced"** appears
7. Click **"Add entry"** → it appears immediately in the **"Recent journal entries"** list on the Home screen

### 1-2. Recording real estate income entries (only if enabled in Settings)

Once **Settings > Use real estate income** is turned on, a **"Business" / "Real estate"** toggle appears at the top of the form. Choosing "Real estate" narrows the account dropdown to real-estate-only accounts (named with a "（不動産）" suffix). The toggle keeps its state while you stay on the Home screen entering further entries, so you don't need to reselect it for every entry when recording a batch of similar transactions. It resets to "Business" once you navigate to another screen.

> While this setting is off, the toggle doesn't appear at all and the screen is unchanged from before.

### 1-3. Use the home-office (mixed-use) allocation

For expenses that split between business and personal at your home office:

1. Tick **"Home-office ratio"** on the relevant line
2. Enter a ratio (e.g. `0.30` = 30% business; the remaining 70% goes to owner's draws automatically)
3. On submit, the line expands into 2 lines (business expense + `1610 事業主貸` (Owner's draws))

> Per-account default ratios can be registered in **Settings > Home-office allocation default ratios**. Picking a registered account pre-fills the ratio (overridable per line).

### 1-4. Clearing the form

Use **"Clear"** to reset everything mid-entry.

### 1-5. Recording item and quantity (simple inventory)

Choosing a **仕入 (Purchases, 5020)** or **売上高 (Sales, 4110)** line reveals an **Item** dropdown and a **Quantity** field. Register items in the **"Items (simple inventory)"** section of Settings. Once recorded, the [06. Reports](06-reports_en.md) profit & loss statement shows an **estimated ending inventory value** using the statutory default (most-recent-purchase-cost method) — for reference only, it is not posted automatically.

> This is on by default. If you've filed for a valuation method other than most-recent-purchase-cost, untick **Settings > Auto-calculate ending inventory (most-recent-purchase-cost method)** to disable this estimate and go back to journaling ending inventory manually.

### 1-6. Adding a department tag

The **"Department tag"** field next to the description lets you attach a free-text tag (e.g. `Tokyo branch`, `Online sales`) for lightly separating multiple locations, business lines, or channels. Previously used tags appear as autocomplete suggestions.

> Department tags are a display label for aggregation/filtering only — they never affect tax calculations or `.xtx` export. You can filter the account breakdown by department in [06. Reports](06-reports_en.md).

### 1-7. Attaching a receipt photo

Choosing a photo in the **"Receipt photo"** field below the description opens a confirmation dialog with a preview. Confirm the photo is correct and press **"Attach"** — it's saved together with the entry once confirmed. Repeat to attach multiple photos (remove a thumbnail with **×** before submitting).

> **Once confirmed, attachments cannot be replaced or deleted** (required for record integrity under Japan's Electronic Books Preservation Act). If you attached the wrong photo, use a reversing entry instead — the original photo stays in the history.
>
> The confirmation dialog can be skipped via **Settings > Skip the confirmation before attaching receipt photos** (you can re-enable it there any time).

### 1-8. Recording a foreign-currency transaction

aoiko has no dedicated multi-currency feature or exchange-rate lookup. In practice, most foreign-currency transactions already come with a settled ¥ amount by the time you record them — credit card statements, bank remittance slips, etc. do the conversion at their own rate — so just enter that ¥ amount as a normal entry (noting the foreign amount in the description, e.g. `USD 100`, makes it easier to cross-reference later).

For an outstanding foreign-currency receivable/payable, or a cash purchase made abroad where you need to work out the ¥ equivalent yourself, just enter whatever ¥ amount you consider reasonable at the time. Once the actual settled amount is known, book the difference to `4910 雑収入` (Miscellaneous income) or `5910 雑費` (Miscellaneous expenses). Accounts themselves can't be added, but subaccounts (e.g. `Exchange gain/loss`) can be added and removed under **Settings > Subaccounts** if you want to separate it out.

### 1-9. Recording employee salary and withholding tax

aoiko has no payroll calculation or automatic withholding-tax feature. If you employ regular staff (not a family employee under blue-return status), work out the withholding tax yourself using the NTA's official "[Withholding tax table for employment income](https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm)" and record it as a normal entry.

1. **Debit**: `5230 給料賃金` (Salaries and wages) for the gross salary (before social insurance deductions)
2. **Credit**: `1130 普通預金` (Ordinary deposit) etc. for the actual net amount paid
3. **Credit**: `2140 預り金` (Withholdings payable) for the withholding tax plus the employee's share of social insurance

### Common patterns

| Transaction | Debit | Credit |
|---|---|---|
| Sale, received by card | 1320 未収入金 (Other receivables) | 4110 売上高 |
| Expense paid by credit card | 5xxx Expense | 2120 未払金 (Accounts payable) |
| Card auto-debit from bank | 2120 未払金 | 1130 普通預金 |
| Inject cash into business | 1110 現金 (Cash) | 3110 元入金 (Owner's capital) |
| Withdraw personal funds from business account | 1610 事業主貸 | 1130 普通預金 |
| Home rent, 30% business portion | 5260 地代家賃 (Rent) 30% / 1610 事業主貸 70% | 1130 普通預金 |

## 2. Browsing entries — Journal list

Click **"Journal"** in the navigation to open the journal list.

### 2-1. Filters

The filter row at the top:

| Filter | Input |
|---|---|
| **Year** | number (e.g. `2026`) |
| **Month** | dropdown (`All months` / `1`–`12`) |
| **Description contains** | text (substring match; applied on Enter or blur) |
| **Amount (min)** | number; blank = no minimum |
| **Amount (max)** | number; blank = no maximum |
| **Vendor** | dropdown of registered vendors |

> **Any two or more in combination** is supported, satisfying the search-capability requirement of Japan's Electronic Books Preservation Act (qualified e-bookkeeping).

Use **"Reset"** to clear filters (year reverts to current, month to current).

### 2-2. View entry details

Click on a row to **expand** it. Each debit/credit line is shown with account, subaccount, tax rate, amount, and description. The `▾` / `▸` icon indicates expanded state.

Below the line details you'll find a list of **receipt photos** (click a thumbnail for full size) and a field to add more. Whether the entry came from CSV import, OCR, or manual entry, you can attach a receipt photo here after the fact (the same confirmation flow from 1-7 applies).

### 2-3. Pagination

50 entries per page. Use **"← Prev"** / **"Next →"** at the bottom.

## 3. Reversing entries — fixing mistakes

> aoiko **does not allow editing confirmed entries directly**. To meet the audit-history requirement of the Electronic Books Preservation Act, mistakes are corrected via a **reversing entry**. The original entry is retained as history.

### 3-1. How to reverse

1. Click on the entry to expand it
2. Click **"Reverse"**
3. Confirmation dialog: "A reversing entry with debits and credits swapped will be created with today's date, and the original entry will be marked “Reversed”" → click **"Reverse"**
4. The original entry now shows a **"Reversed"** badge with strikethrough
5. A new reversing entry appears in the list (today's date)
6. Re-enter the correct entry (manually, via CSV, OCR, or order import)

### 3-2. Example

Original:
```
2026-05-01  Electricity bill
  Debit   5130 水道光熱費  8,000
  Credit  1130 普通預金    8,000
```

Click "Reverse" → today-dated reversing entry is auto-generated:
```
2026-05-26  [訂正] Electricity bill
  Debit   1130 普通預金    8,000
  Credit  5130 水道光熱費  8,000
```

The net effect on the ledger is zero. Add a new entry with the correct amount (e.g. 8,500).

### 3-3. Can I undo a reversal?

No — a reversed entry can't be reversed again (the **"Reversed"** badge appears and the button is hidden). You could reverse the reversal to restore the original, but the history accumulates.

> If many mistakes came from a CSV import, look at the **Import history** for **"Reverse batch"** instead (see [03. CSV import](03-csv-import_en.md)).

## 4. Next steps

- Bulk-import bank/card history → [03. CSV import](03-csv-import_en.md)
- View aggregates and confirmations → [06. Reports](06-reports_en.md)