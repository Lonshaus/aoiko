# 12. Amended filing

Filed-year snapshots, diff detection, correcting entries, submission flow.

**Language**: [日本語](12-amended.md) | **English** | [繁體中文](12-amended_zh-TW.md)

> **⚠ Correction (2026-06)**: the "e-Tax Software (web edition)" amendment steps in this chapter are wrong. **Income tax is not supported by the web edition**, so create and submit the amended return via the **Tax Return Preparation Corner** or the **e-Tax Software download edition (Windows)** (see also the correction note in [10. `.xtx` export](10-xtx-export_en.md)).

> **By the end of this chapter you can**
> - Lock a filed year and preserve a "snapshot as filed"
> - When you notice a mistake later, add correcting entries and see the diff
> - Organize what you need to file an amended return
>
> **Prerequisites**: the year is locked in [06. Reports § 8](06-reports_en.md#8-year-lock-filed).

## 1. What is an amended filing

After submitting your tax return, if you find an error:

- **Tax under-reported** (additional payment needed) → **Amended return** (修正申告)
- **Tax over-reported** (refund right) → **Request for correction** (更正の請求)

The forms and processing differ on the e-Tax side. The aoiko-side work is similar in both (enter the changes, look at the diff), but the e-Tax procedure varies.

> This tool does not directly assist with creating or submitting the return. It provides diff detection and organization of "what changed".

## 2. The filed snapshot

When you click **"Lock as Filed"** ([06. Reports § 8](06-reports_en.md#8-year-lock-filed)), aoiko saves to IndexedDB a **snapshot** of:

- Per-account totals (all P/L and BS items)
- Key reports (monthly sales, fixed-asset table, etc.)

This is the snapshot of what you reported on the return.

> Keep the **original return** (paper copy or e-Tax submission copy) separately. The aoiko snapshot is just numbers — it doesn't cover the return body (personal info, deductions, etc.).

## 3. Amendment workflow

### 3-1. Unlock

You must unlock to make changes.

1. Reports → select the year
2. Beside 🔒 Filed badge, click **"Unlock"**
3. After confirmation, the year is unlocked

> The snapshot is **not** deleted — it's preserved (important).

### 3-2. Make the changes

After unlocking:

- **Adding** entries (missed expense, omitted sales, etc.) → see [02. Creating journal entries](02-journal_en.md)
- **Correcting** entries (wrong amount / account) → reverse the wrong one and add a correct one ([02. § 3 Correcting entries](02-journal_en.md#3-correcting-reversing-entries--fixing-mistakes))
- **Re-registering** fixed assets (useful life correction, disposal, etc.) → see [08. Depreciation](08-depreciation_en.md)

> Write a clear `description` (e.g. "2026 amended return — added missed sales from XXX Co."). Future-you needs to know why.

### 3-3. Review the diff

After entering correcting entries, the Reports → **Overview** block shows:

- The **diff** between current values (post-amendment) and the snapshot
- `Before → After` for each item
- Summary of major changes (P/L income delta, BS balance changes)

> Verify the diff is what you expected. If unintended areas changed, inspect the related entries.

### 3-4. Create the amended return on e-Tax

Once the numbers are stable in aoiko:

1. Sign in to e-Tax Software (Web edition)
2. **"Create an amended return"** menu (exact name varies by year)
3. Re-enter values from the **original return** (Blue Return financial statements → tax return) — or use a re-exported `.xtx` for the import
4. Enter **the corrected amounts**
5. The diff is computed on the e-Tax side. It also shows estimated delinquency and additional penalty taxes
6. Submit (electronically)

> Re-exporting `.xtx` ([10. `.xtx` export](10-xtx-export_en.md)) from aoiko also reflects amended financial statements — useful as a reference for manual entry.

### 3-5. Re-lock after submission

After submitting the amended return:

1. Reports → year → **"Lock as Filed"** to re-lock
2. The snapshot is **overwritten** with the post-amendment values (this becomes the new "filed" reference)

> The old snapshot is lost. "Before-amendment vs after-amendment" comparison isn't possible afterward — the original return submission record is the ultimate source of truth.

## 4. Common cases

### Case A: missed sales

```
Discovered: 100,000 JPY sales for December missed after filing the 2026 return
```

1. Unlock
2. Add entry: `Debit 1320 Accounts receivable 100,000 / Credit 4110 Sales 100,000` (dated 2025-12-31 etc.)
3. Confirm diff: Income +100,000
4. File amended return on e-Tax → additional payment
5. Re-lock

### Case B: duplicate expense

```
Discovered: same AWS bill of 5,000 JPY was booked twice — once via CSV import and once manually
```

1. Unlock
2. Reverse the batch from [03. CSV § 5](03-csv-import_en.md#5-import-history-and-batch-reverse) or reverse the manual one
3. Confirm diff: Expenses −5,000, Income +5,000
4. File amended return → additional payment
5. Re-lock

### Case C: depreciation life error

```
Discovered: MacBook was depreciated over 4 years which is correct under tax law, but with under-counted expense
```

1. Unlock
2. Fixed assets → review asset → check acquisition date, useful life, account
3. Reverse the existing depreciation entry and regenerate with the correct calc
4. Confirm diff
5. File amended return
6. Re-lock

### Case D: deduction correction (outside aoiko's scope)

```
Discovered: forgot to claim medical-expense deduction
```

aoiko doesn't handle deductions. File a **request for correction** directly on the e-Tax side. No aoiko-side change needed (no business-income change).

## 5. Deadlines and notes

### Amended return deadlines

- **Amended return** (additional payment): anytime. File early once you notice — delinquency tax accrues daily
- **Request for correction** (refund): typically within **5 years** from the original filing deadline

### Additional taxes

- For amended returns, **under-reporting additional tax** (10% or 15%) and **delinquency tax** (rate varies) may apply
- Voluntary amendment before a tax-office audit notice reduces or eliminates additional taxes
- Confirm details with a tax accountant or tax office

### Records retention

- Post-amendment **correcting entries** must be retained for 7 years under the Electronic Books Preservation Act
- The pre/post-amendment diff in aoiko is stored as "correcting entry history" — also retain
- Use backups ([11. Backup and restore](11-backup_en.md)) to preserve them

## 6. Next steps

- That covers all aoiko features. Continue with day-to-day operation
- Feature requests / bug reports go to [GitHub Issues](https://github.com/Lonshaus/aoiko/issues)