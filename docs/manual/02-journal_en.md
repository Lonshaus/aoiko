# 02. Creating journal entries

Manual entry creation, browsing/searching the journal list, and correcting (reversing) entries.

**Language**: [日本語](02-journal.md) | **English** | [繁體中文](02-journal_zh-TW.md)

> **By the end of this chapter you can**
> - Enter multi-line journal entries with debits and credits
> - Filter the journal list by year / month / description / amount / vendor
> - Reverse a confirmed entry with a correcting entry
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) is done (trade name, fiscal year, and any sub-accounts you need).

## 1. Manual entry — Home screen

The bottom half of the **"Home"** navigation contains the **New journal entry** form (`JournalEntryForm`).

### 1-1. Basic flow

1. **Date**: transaction date (defaults to today)
2. **Description**: what the transaction is (e.g. `Electricity bill`, `Workshop fee`)
3. Enter one or more **debit** lines:
   - **Account**: pick from the dropdown (e.g. `5130 Utilities`)
   - **Sub-account** (optional): if registered (e.g. `AWS`)
   - **Amount**: positive integer
   - **Tax rate**: `10%` / `8%` / `0%` (non-taxable)
   - **Tax included**: checked means tax-inclusive; unchecked means tax-exclusive
4. Enter one or more **credit** lines (same fields)
5. Use **"+ Add debit"** / **"+ Add credit"** for composite (multi-line) entries
6. When debit and credit totals match, a green **"✓ Balanced"** badge appears. Otherwise a **"Difference ¥xxx"** warning
7. Click **"Add entry"** → it appears immediately in the "Recent entries" list on the Home screen

### 1-2. Use the home-office (mixed-use) allocation

For expenses that split between business and personal at your home office:

1. Tick **"Home-office ratio"** on the relevant line
2. Enter a ratio (e.g. `0.30` = 30% business; the remaining 70% goes to owner's draws automatically)
3. On submit, the line expands into 2 lines (business expense + 1610 Owner's draws)

> A default ratio can be registered in **Settings → Home-office default ratio** (overridable per line).

### 1-3. Clearing the form

Use **"Clear"** to reset everything mid-entry.

### Common patterns

| Transaction | Debit | Credit |
|---|---|---|
| Sale, received by card | 1320 Accounts receivable | 4110 Sales |
| Expense paid by credit card | 5xxx Expense | 2120 Accounts payable |
| Card auto-debit from bank | 2120 Accounts payable | 1130 Ordinary deposit |
| Inject cash into business | 1110 Cash | 3110 Owner's capital |
| Withdraw personal funds from business account | 1610 Owner's draws | 1130 Ordinary deposit |
| Home rent, 30% business portion | 5260 Rent 30% / 1610 Owner's draws 70% | 1130 Ordinary deposit |

## 2. Browsing entries — Journal list

Click **"Journal"** in the navigation to open `JournalList`.

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

> **Any two or more in combination** is supported, satisfying the search-capability requirement of Japan's Electronic Books Preservation Act (qualified electronic ledger).

Use **"Reset"** to clear filters (year reverts to current, month to current).

### 2-2. View entry details

Click on a row to **expand** it. Each debit/credit line is shown with account, sub-account, tax rate, amount, and memo. The `▾` / `▸` icon indicates expanded state.

### 2-3. Pagination

50 entries per page. Use **"← Prev"** / **"Next →"** at the bottom.

## 3. Correcting (reversing) entries — fixing mistakes

> aoiko **does not allow editing confirmed entries directly**. To meet the audit-history requirement of the Electronic Books Preservation Act, mistakes are corrected via a **reversing entry**. The original entry is retained as history.

### 3-1. How to reverse

1. Click on the entry to expand it
2. Click **"Reverse"**
3. Confirmation dialog: "A reversing entry with debits and credits swapped will be created with today's date, and the original entry will be marked 'Reversed'" → click **"Reverse"**
4. The original entry now shows a **"Reversed"** badge with strikethrough
5. A new reversing entry appears in the list (today's date)
6. Re-enter the correct entry (manually, via CSV, OCR, or order import)

### 3-2. Example

Original:
```
2026-05-01  Electricity bill
  Debit   5130 Utilities          8,000
  Credit  1130 Ordinary deposit   8,000
```

Click "Reverse" → today-dated reversing entry is auto-generated:
```
2026-05-26  Reversal: Electricity bill
  Debit   1130 Ordinary deposit   8,000
  Credit  5130 Utilities          8,000
```

The net effect on the ledger is zero. Add a new entry with the correct amount (e.g. 8,500).

### 3-3. Can I undo a reversal?

No — a reversed entry can't be reversed again (the **"Reversed"** badge appears and the button is hidden). You could reverse the reversal to restore the original, but the history accumulates.

> If many mistakes came from a CSV import, look at the **Import history** for **"Reverse this batch"** instead (see [03. CSV import](03-csv-import_en.md)).

## 4. Next steps

- Bulk-import bank/card history → [03. CSV import](03-csv-import_en.md)
- View aggregates and confirmations → [06. Reports](06-reports_en.md)