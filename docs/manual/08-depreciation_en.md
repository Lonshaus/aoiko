# 08. Depreciation

Fixed-asset registration, straight-line / declining-balance methods, monthly proration / ¥1 residual, small-asset depreciation special rule (¥400k), year-end entry generation.

**Language**: [日本語](08-depreciation.md) | **English** | [繁體中文](08-depreciation_zh-TW.md)

> **By the end of this chapter you can**
> - Register acquired fixed assets in aoiko
> - Choose between straight-line and declining-balance (200%)
> - Determine eligibility for the small-asset depreciation special rule (Sochiho Article 28-2, ¥400k)
> - Generate year-end depreciation entries in bulk
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) — basic info and fiscal year are configured.

## 1. What is a fixed asset (in aoiko)

Business assets acquired for **¥100k or more** are registered as fixed assets and **depreciated** over multiple years.

| Acquisition cost | Treatment |
|---|---|
| < ¥100k | Fully expensed in the year (`5200 Consumables` etc.) |
| ¥100k – ¥200k | "Lump-sum depreciation" OR normal depreciation. aoiko doesn't directly support lump-sum (use normal depreciation) |
| ¥100k – ¥300k (acquired before 2026/3/31) | Small-asset special rule eligible |
| ¥100k – ¥400k (**acquired on/after 2026/4/1**) | Small-asset special rule eligible (**Reiwa 8 reform raised threshold from ¥300k to ¥400k**) |
| ¥400k+ | Normal depreciation (straight-line or declining-balance) |

## 2. Register a fixed asset

Navigation **"Settings"** → **"Fixed assets"** section.

### 2-1. Registration form

| Field | Content | Example |
|---|---|---|
| Name | Identifier label | `MacBook Pro 14"` |
| Acquisition date | When put into business use (not necessarily purchase date) | `2026-05-01` |
| Acquisition cost | Tax-inclusive amount (integer) | `350000` |
| Useful life | Statutory life from the National Tax Agency table | `4` (PCs typically 4 years) |
| Account | The debit account (Building / Vehicles / Tools etc.) | `1514 Vehicles` |
| Depreciation method | Straight-line / Declining-balance (200%) / Small-asset special (immediate) | ↓ see below |

Click **"Add"** to register.

### 2-2. Choosing a method

#### Straight-line (default)

Same amount each year. Formula: `Acquisition cost × 1/useful life × monthly proration`

- Business PCs, software, machinery, etc.
- Predictable, easy to plan
- Default for sole proprietors (no prior filing required)

#### Declining-balance (200%)

Larger amount earlier, smaller later. Formula: `Undepreciated balance × rate (200%/life) × monthly proration`, switching to equal-amount mode when `tentative amount < guaranteed minimum`.

- Vehicles, machinery, etc., when you want larger initial expense
- For sole proprietors, **prior notification** (Depreciation Method Notification) is required
- aoiko supports useful lives 2 – 20 years

#### Small-asset depreciation special rule (Sochiho Art. 28-2, immediate)

Fully expensed in the year if requirements met.

- Blue Return filers only
- Acquisition cost **below the threshold**:
  - Acquired by 2026/3/31: < ¥300k
  - **Acquired on/after 2026/4/1: < ¥400k** (Reiwa 8 reform)
- Annual cap of ¥3M (excess goes through normal depreciation)
- Expiry: through Reiwa 11/3/31 (2029-03-31)

When you select "Small-asset depreciation special rule (Sochiho Art. 28-2, immediate)", aoiko auto-checks eligibility:

| Display | Meaning |
|---|---|
| ✓ Acquisition date 2026-05-01 meets the threshold (< ¥400,000) | OK, can register |
| ⚠ Cost exceeds the threshold (< ¥400,000); cannot apply | Acquisition too high |
| ⚠ Past the rule's expiry (2029-03-31); cannot apply | Past expiry |

### 2-3. Monthly proration and ¥1 residual

Automatic behavior:

- **Monthly proration**: count the acquisition month as month 1, prorate by months in business use that year. Example: acquired in June, life 4 years, straight-line → 7/12 booked in current year
- **¥1 residual**: once accumulated depreciation reaches 95% of cost, the residual is amortized to ¥1 book value over 5 years (or remaining years). Per Corporate Tax Act and Income Tax Act.

## 3. Year-end depreciation entry generation

At year-end (or any time within), select the **"Target year"** and click **"Generate depreciation entries"**:

- Calculates the year's depreciation for every registered fixed asset
- Creates one entry per asset (Debit `5210 Depreciation` / Credit the asset account)
- Skips assets whose year's depreciation entry already exists
- Warns and skips assets exceeding the small-asset annual ¥3M cap

### Example result message

```
✓ 12 entries created
⚠ 2 entries skipped (annual ¥3M small-asset cap)
⚠ 1 entry skipped (not eligible for small-asset rule)
```

> Generated entries appear in Home's "Recent entries" and in the Reports P/L. If you ran the wrong target year, reverse the relevant entries ([02. § 3 Correcting entries](02-journal_en.md#3-correcting-reversing-entries--fixing-mistakes)), fix asset info, then run again.

## 4. Fixed assets table columns

Settings → Fixed assets table:

| Column | Content |
|---|---|
| Name | Identifier |
| Acquisition date | In-service date |
| Acquisition cost | Integer |
| Useful life | 4 years, 6 years, etc. |
| Current-year depreciation | Year's depreciation amount (after generation) |
| End book value | Acquisition cost − accumulated depreciation |

Small-asset immediate-depreciation assets show **current-year = cost / end book value = 0** (no ¥1 residual, since the rule is immediate write-off).

## 5. FAQs

### Q. How is software depreciated?

As an intangible fixed asset. Useful life 5 years (self-use software). Straight-line only.

### Q. What about used assets?

Used asset useful life formula:
`(Statutory life − years elapsed) + years elapsed × 20%` (minimum 2 years)

aoiko doesn't auto-compute; enter the resulting years.

### Q. How to handle disposal / sale?

aoiko currently has **no auto-generated disposal/sale entry**. Manually create "Loss on disposal / Asset" or "Cash / Asset" entries ([02. Creating journal entries](02-journal_en.md)).

### Q. Can I use "lump-sum depreciation" (¥200k <, equal over 3 years)?

aoiko **does not** support this directly. Use the small-asset special rule (¥300k/¥400k threshold) or normal depreciation. If lump-sum is needed, manually book three annual entries.

## 6. Next steps

- Carry over fixed-asset book values to the next year → [09. Prior-period carryover](09-carryover_en.md)
- Confirm depreciation amounts → [06. Reports § 3](06-reports_en.md#3-profit--loss-pl)