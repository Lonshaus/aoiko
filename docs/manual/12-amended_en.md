# 12. Amended filing

Filed-year snapshots, diff detection, reversing entries, submission flow.

**Language**: [日本語](12-amended.md) | **English** | [繁體中文](12-amended_zh-TW.md)

> **By the end of this chapter you can**
> - Lock a filed year and preserve a "snapshot as filed"
> - When you notice a mistake later, add reversing entries and see the diff
> - Organize what you need to file an amended return
>
> **Prerequisites**: the year is locked in [06. Reports § 8](06-reports_en.md#8-year-lock-filed).

## 1. What is an amended filing

After submitting your tax return, if you find an error:

- **Tax under-reported** (additional payment needed) → **Amended return** (修正申告)
- **Tax over-reported** (refund right) → **Request for correction** (更正の請求)

The forms and processing differ on the e-Tax side. The aoiko-side work is similar in both (enter the changes, look at the diff), but the e-Tax procedure varies.

> aoiko does not directly assist with creating or submitting the return. It provides diff detection and organization of "what changed".

## 2. The filed snapshot

When you click **"Lock as filed"** ([06. Reports § 8](06-reports_en.md#8-year-lock-filed)), aoiko saves to IndexedDB a **snapshot** of:

- Four report types: monthly sales, profit & loss (P/L), balance sheet (BS), and consumption tax (if configured)

This is the snapshot of what you reported on the return.

> Keep the **original return** (paper copy or e-Tax submission copy) separately. The aoiko snapshot is just numbers — it doesn't cover the return body (personal info, deductions, etc.).

## 3. Amendment workflow

### 3-1. Unlock

You must unlock to make changes.

1. Reports → select the year
2. Beside 🔒 Filed badge, click **"Unlock"**
3. After confirmation, the year is unlocked

> The snapshot is **not** deleted — it's preserved.

### 3-2. Make the changes

After unlocking:

- **Adding** entries (missed expense, omitted sales, etc.) → see [02. Creating journal entries](02-journal_en.md)
- **Fixing** entries (wrong amount / account) → reverse the wrong one and add a correct one ([02. § 3 Reversing entries](02-journal_en.md#3-reversing-entries--fixing-mistakes))
- **Re-registering** fixed assets (useful life correction, disposal, etc.) → see [08. Depreciation](08-depreciation_en.md)

> Write a clear description (e.g. "2026 amended return — added missed sales from XXX Co."). Future-you needs to know why.

### 3-3. Review the diff

After entering reversing entries, the Reports screen's **"Amended return guide"** panel (separate from the Overview block) shows:

- The filing date, and whether anything has changed since the filed snapshot (if nothing has, it says an amended return is not required)
- When something has changed, **Revenue / Expenses / Income (net)** each with **"Filed: …"** and **"Current: …"** values (income also shows the **difference** from the filed value, as "Current: … (Δ …)")
- Only when something has changed, a checklist of the amendment steps (unlock → correct the wrong entries → check the amended P/L and BS → file on e-Tax → re-lock)

> Verify the diff is what you expected. If unintended areas changed, inspect the related entries.

### 3-4. Create the amended return on e-Tax

Once the numbers are stable in aoiko:

1. Open e-Tax software (download edition) or the Return Preparation Corner (the e-Tax software web edition does not support income-tax amended returns)
2. **"Create an amended return"** menu (exact name varies by year)
3. Bring in the **original return** values (financial statements — blue-return statements or the white return breakdown statement — → tax return) by loading a re-exported `.xtx` into the download edition, or by hand in the Return Preparation Corner
4. Enter **the corrected amounts**
5. The diff is computed on the e-Tax side. It also shows estimated delinquency and additional penalty taxes
6. Submit (electronically)

> Re-exporting `.xtx` ([10. `.xtx` export](10-xtx-export_en.md)) from aoiko is built straight from the current state of your books, and the income-tax section's filing-type field (the `SHINKOKU_KBN` tag) is always output as "確定" (final) — it never switches to an amended-return type. Treat the re-exported `.xtx` as a reference for checking the corrected figures, and create the actual amended-return submission through e-Tax's own amended-return menu.

### 3-5. Re-lock after submission

After submitting the amended return:

1. Reports > year > **"Lock as filed"** to re-lock
2. A **new snapshot** is saved with the post-amendment values (this becomes the new "filed" reference)

> The old snapshot isn't deleted — it's kept with status `superseded`. That gives you a baseline to look back at "before vs after" later, but keep the original return submission separately regardless.

## 4. Common cases

### Case A: missed sales

```
Discovered: ¥100,000 of sales for December missed after filing the 2026 return
```

1. Unlock
2. Add entry: `Debit 1320 未収入金 (Other receivables) 100,000 / Credit 4110 売上高 (Sales) 100,000` (dated 2026-12-31 etc.)
3. Confirm diff: Income +100,000
4. File amended return on e-Tax → additional payment
5. Re-lock

### Case B: duplicate expense

```
Discovered: same AWS bill of ¥5,000 was booked twice — once via CSV import and once manually
```

1. Unlock
2. Reverse the batch from [03. CSV § 5](03-csv-import_en.md#5-import-history-and-batch-reverse) or reverse the manual one
3. Confirm diff: Expenses −5,000, Income +5,000
4. File amended return → additional payment
5. Re-lock

### Case C: missed depreciation entry

```
Discovered: this year's depreciation entry for the MacBook was never generated (the 4-year useful life itself was correct)
```

1. Unlock
2. Fixed assets → review the asset → confirm the acquisition date, useful life, and account are correct
3. Generate this year's depreciation entry via [08. § 3](08-depreciation_en.md#3-year-end-depreciation-entry-generation)
4. Confirm diff
5. The missed expense means tax was over-reported, so file a **request for correction** on the e-Tax side
6. Re-lock

### Case D: deduction correction (no journal correction needed)

```
Discovered: forgot to claim medical-expense deduction
```

File a **request for correction** directly on the e-Tax side. There is no business-income change, so no journal correction or unlock is needed. If you use aoiko's [income-deductions screen](14-income-deductions_en.md) (estimation and `.xtx` prefill; not covered by the year lock), update its values too to keep your records current.

## 5. Deadlines and notes

### Amended return deadlines

- **Amended return** (additional payment): can be filed any time before a reassessment under Art. 24 (更正) becomes final (Act on General Rules for National Taxes Art. 19(1)). File early once you notice — delinquency tax accrues daily
- **Request for correction** (refund): typically within **5 years** from the original filing deadline

### Additional taxes and delinquency tax

- For amended returns, **under-reporting additional tax** (10% or 15%) and **delinquency tax** (rate varies) may apply
- Voluntary amendment before a tax-office audit notice means under-reporting additional tax does not apply (Act on General Rules for National Taxes Art. 65(6)). Conversely, failing to present or submit books when requested increases the additional tax (Art. 65(4), by ten or five percentage points)
- Confirm details with a tax accountant or tax office

### Records retention

- A blue-return filer's books must be retained for 7 years (Income Tax Act Enforcement Regulation Art. 63(1)(1)), counted from the day after March 15 of the year following the year the books were closed (Art. 63(4)). Post-amendment reversing entries are part of those books and are retained the same way
- The pre/post-amendment diff in aoiko is stored as "reversing entry history" — keep this too
- Use backups ([11. Backup and restore](11-backup_en.md)) to preserve them

## 6. Next steps

- Opening Setup → [13. Opening Setup](13-opening-setup_en.md)
- Entering income and tax deductions → [14. Income & tax deductions](14-income-deductions_en.md)
- Issuing and managing invoices → [15. Issuing invoices and quotes](15-invoices_en.md)