# 03. CSV import

How to bulk-create journal entries from bank or credit card CSV statements.

**Language**: [日本語](03-csv-import.md) | **English** | [繁體中文](03-csv-import_zh-TW.md)

> **By the end of this chapter you can**
> - Download a supported bank/card CSV and import it
> - Understand how duplicate-file detection works
> - Set up auto-classification rules to pre-fill counterpart accounts
> - Use AI classification
> - Reverse an entire batch from import history when needed
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) is done. If you use card-specific subaccounts (e.g. `2120 未払金 (Other payables) / Rakuten Card`), register them first.

## 1. Supported banks and cards

| Type | Supported |
|---|---|
| Banks | MUFG / SMBC / SBI Shinsei |
| Credit cards | Rakuten / JCB (incl. Recruit Card) / Saison / SMBC / MUFG / au PAY / PayPay / View (JRE CARD) / Life |
| Payment apps | PayPay (credit-card payments only; balance not supported) |

## 2. Downloading a CSV

Get the CSV from each provider's member portal. Quick guide:

| Service | Where to download |
|---|---|
| MUFG Bank | Direct login → Transaction history → date range → CSV download |
| SMBC Bank | SMBC Direct → Transaction history → CSV |
| SBI Shinsei | Power Direct → Transaction inquiry → CSV |
| Rakuten Card | e-NAVI login → Statement → CSV download |
| JCB / Recruit Card | MyJCB → Statement → CSV |
| Saison Card | Net Answer → Statement → CSV |
| SMBC Card | Vpass → Statement → CSV |
| MUFG Card | Member site → Statement → CSV |
| au PAY Card | Member site → Statement → CSV |
| View Card | VIEW's NET → Statement → CSV |
| Life Card | LIFE-Web Desk → Statement → CSV |

> **PayPay Card**: the member site's navigation changes over time. Accounts where the web version offers no CSV must use OCR or manual entry.
>
> **Encoding**: each source has a fixed encoding (Shift_JIS or UTF-8); there is no auto-detection. If you get an error that the file cannot be decoded, check that you selected the right source.

## 3. The 3-step import flow

Click **"Import"** in the navigation to open the CSV import screen.

### 3-1. Step 1: choose a parser

In the **"1. Parser"** dropdown, pick the source. The statement account is shown automatically (e.g. picking `Rakuten Card` shows **"Statement account: 2120 未払金"**).

If you keep multiple accounts/cards distinguished by subaccounts, select the relevant **"Subaccount (optional)"** (e.g. `Rakuten Card`).

> The statement account is the side every row in the CSV shares (payable for cards, ordinary deposit for banks). The **counterpart** (expense, revenue, etc.) is chosen per row in the next step.

### 3-2. Step 2: pick the CSV file

Click the **"2. CSV file"** field to choose a file.

aoiko reads it automatically and shows a preview.

#### Duplicate detection

aoiko records a **file hash** (fingerprint of file contents). If you try to import the same file again, a red banner appears:
> This file was already imported on 2026/7/1 (rakuten-2026-06.csv)

This prevents accidental duplicate imports.

> A re-downloaded CSV for the same period has the same hash and is caught by this check. CSVs with partially overlapping date ranges (e.g. last month-end to this month-end vs. this month) have different hashes, so instead each row is matched against existing CSV-derived entries by (date, account, debit/credit side, amount), and likely duplicates are auto-marked as **"Skip"** (a notice at the top shows the count). A genuine separate transaction with the same date and amount can be flagged by mistake — review the skipped rows and untick **"Skip"** on any that are real.

### 3-3. Step 3: choose the counterpart account for each row

Each CSV row appears as a **candidate** in the table. Per row:

| Column | What |
|---|---|
| Date / Description / Amount | Read from CSV |
| Counterpart account | The other side of the entry (you choose). If the account has subaccounts, a subaccount picker appears below it |
| Tax | Choose Out of scope / Reduced 8% / Standard 10%. Taxable rows also show a "Qualified" checkbox |
| Skip | Tick to exclude this row from the import |

#### Auto-fill badges

The header shows a count such as **"48 / 50 rows will be registered"** and each row may show one of these badges:

| Badge | Meaning |
|---|---|
| **Rule** | Matched an auto-classification rule (see [§ 6](#6-auto-classification-rules)) |
| **Vendor** | The description contains a registered vendor's name; that vendor's default counterpart account was filled in |
| **AI↑** | AI suggested a counterpart with high confidence |
| **AI↓** | AI suggested with low confidence — please verify |
| (no badge) | Not auto-filled; pick manually |

Hover over a badge for details. AI badges appear only on rows filled by **"Fill missing accounts with AI"**.

#### Review pattern

- **Rule**: usually trustworthy as-is
- **AI↑**: glance at it and confirm
- **AI↓**: always verify
- No badge: pick the counterpart yourself

### 3-4. Submit

Click the button with the row count (e.g. **"Register 48"**) to convert all unticked rows into journal entries at once, with no further confirmation.

> Double-check the count and badges before submitting. Corrections are possible afterward but tedious if many entries are wrong. For bulk mistakes, the import history's **"Reverse batch"** is far more efficient (see [§ 5](#5-import-history-and-batch-reverse)).

A message such as **"Created 48 journal entries"** appears at the top.

## 4. AI classification (optional)
<!-- only:browser -->

If you set up a Gemini API key, an OpenAI-compatible endpoint, or the browser's built-in AI in [01. Initial setup § 7](01-setup_en.md#7-prepare-ocr--ai-if-needed), then pressing **"Fill missing accounts with AI"** on the CSV import screen:
<!-- /only -->
<!-- only:apple -->
If you set up a Gemini API key, an OpenAI-compatible endpoint, or Apple Intelligence on a supported device in [01. Initial setup § 7](01-setup_en.md#7-prepare-ocr--ai-if-needed), then pressing **"Fill missing accounts with AI"** on the CSV import screen:
<!-- /only -->
<!-- only:windows -->
If you set up a Gemini API key or an OpenAI-compatible endpoint in [01. Initial setup § 7](01-setup_en.md#7-prepare-ocr--ai-if-needed), then pressing **"Fill missing accounts with AI"** on the CSV import screen:
<!-- /only -->
<!-- only:android -->
If you set up a Gemini API key or an OpenAI-compatible endpoint in [01. Initial setup § 7](01-setup_en.md#7-prepare-ocr--ai-if-needed), then pressing **"Fill missing accounts with AI"** on the CSV import screen:
<!-- /only -->

- Rows whose **counterpart account is still empty** (skipped rows excluded) are sent to the AI, which proposes a counterpart account
- Badges **"AI↑"** / **"AI↓"** indicate confidence

> - **What's sent**: CSV row text (amount, description) + list of accounts
> - **Where it goes**: the selected engine (`generativelanguage.googleapis.com` for Gemini, your baseURL for local)
> - **Confirmation**: a pre-send dialog is shown for cloud engines (with a "Don't ask again" option)

Leaving AI off is fine — you just see more "no badge" rows that you fill in by hand.

## 5. Import history and batch reverse

Click **"Import history"** in the navigation to open the import history screen. Past imports are listed chronologically.

Each batch row shows:

| Column | What |
|---|---|
| Imported at | When you imported |
| Parser | Which parser was used |
| File name | The original CSV filename |
| Rows | Number of entries created |
| Status | `Active N` / `All reversed` / `Active X / Reversed Y` |

### Reverse the whole batch

Expand a row (click it) → click the **"Reverse batch"** button (shown with the count, e.g. "Reverse batch (48)").

> Confirmation: "All active entries in this batch will be marked "Reversed". A reversing entry will be created for each; both will be retained as history."

Click **"Reverse batch"** to bulk-create reversing entries; the batch status becomes **"All reversed"**. Originals are kept as history (legal requirement).

> Use this when you imported the wrong CSV or chose the wrong statement account — undo all at once and re-import.

## 6. Auto-classification rules

The **"Auto-classification rules"** section of Settings lets you register rules that **pre-fill counterpart accounts** for rows matching a description string.

### 6-1. Rule fields

| Field | What |
|---|---|
| Match type | `Description contains` / `Vendor name equals` / `Regex` |
| Pattern | String to match (e.g. `amazon`, `^Electricity`) |
| Counterpart account | Account to fill (e.g. `5200 消耗品費` (Consumables)) |
| Priority | Higher priorities are evaluated first; on multiple matches, highest priority wins |

### 6-2. Examples

| Pattern | Counterpart | Use |
|---|---|---|
| `amazon` | 5200 消耗品費 | Map Amazon purchases to consumables |
| `AWS` | 5150 通信費 (Communications) | AWS monthly bill |
| `Netflix` | 5150 通信費 | Subscription |
| `Adobe` | 5150 通信費 | Creative Cloud monthly |
| Regex `Electricity\|TEPCO` | 5130 水道光熱費 (Utilities) | Bundle utility companies |

### 6-3. Where rules apply

- **On CSV import**: matched rows get the **Rule** badge and the counterpart pre-filled
- Rule matches **skip the AI** (saves cost and time, and is more accurate)
- A row that matches no rule gets the default counterpart account of a registered vendor whose name appears in its description (set it on the vendor in [01. Initial setup](01-setup_en.md); rules take priority). Such rows skip the AI too

> The more rules you register, the less manual work you do. Add them based on what shows up most often.

## 7. Next steps

- See aggregates of what you booked → [06. Reports](06-reports_en.md)
- Import paper receipts → [04. Receipt OCR](04-receipt-ocr_en.md)
- Import order details from Amazon / Rakuten etc. → [05. Order import](05-order-import_en.md)