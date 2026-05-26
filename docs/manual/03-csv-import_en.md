# 03. CSV import

How to bulk-create journal entries from bank or credit card CSV statements.

**Language**: [日本語](03-csv-import.md) | **English** | [繁體中文](03-csv-import_zh-TW.md)

> **By the end of this chapter you can**
> - Download a supported bank/card CSV and import it
> - Understand how duplicate-file detection works
> - Set up auto-classification rules to pre-fill counterpart accounts
> - Use LLM auto-classification
> - Reverse an entire batch from import history when needed
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) is done. If you use card-specific sub-accounts (e.g. `2120 Accounts payable / Rakuten Card`), register them first.

## 1. Supported banks and cards

| Type | Supported |
|---|---|
| Banks | MUFG / SMBC / SBI Shinsei / PayPay (credit-route only; balance not supported) |
| Credit cards | Rakuten / JCB (incl. Recruit Card) / Saison / SMBC / MUFG / au PAY / PayPay / View (JRE CARD) / Life |

> All parsers have been validated against real CSVs. To add support for a new bank/card, see [CONTRIBUTING.md](../../CONTRIBUTING.md).

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

> **PayPay Card**: the web flow varies by account. Accounts where the web has no CSV option are stuck with OCR or manual entry.
>
> **Encoding**: parsers auto-detect (Shift_JIS / UTF-8). If you see mojibake, check the export encoding of the source.

## 3. The 3-step import flow

Click **"Import"** in the navigation to open the `Import` screen.

### 3-1. Step 1: choose a parser

In the **"1. Parser"** dropdown, pick the source. The **"Known-side account"** is auto-shown (e.g. `Rakuten Card` → `2120 Accounts payable`).

If you keep multiple accounts/cards distinguished by sub-accounts, select the relevant **"Sub-account (optional)"** (e.g. `Rakuten Card`).

> The known-side account is the side every row in the CSV shares (payable for cards, ordinary deposit for banks). The **counterpart** (expense, revenue, etc.) is chosen per row in the next step.

### 3-2. Step 2: pick the CSV file

Click the **"2. CSV file"** field to choose a file.

aoiko reads it automatically and shows a preview.

#### Duplicate detection

aoiko records a **file hash** (fingerprint of file contents). If you try to import the same file again, a red banner appears:
> This file was already imported on {date} ({name})

This prevents accidental duplicate imports.

> A re-downloaded CSV for the same period has the same hash and is caught. CSVs with partially overlapping date ranges (e.g. last month-end to this month-end vs. this month) have different hashes and won't be detected — check for overlapping rows manually.

### 3-3. Step 3: choose the counterpart account for each row

Each CSV row appears as a **candidate** in the table. Per row:

| Column | What |
|---|---|
| Date / Description / Amount | Read from CSV |
| Counterpart account | The other side of the entry (you choose) |
| Sub-account (optional) | If the counterpart has one |
| Skip | Tick to exclude this row from the import |

#### Auto-fill badges

The header shows **"{valid} / {total} planned"** and each row may show one of these badges:

| Badge | Meaning |
|---|---|
| **Rule** | Matched an auto-classification rule (see [§ 6](#6-auto-classification-rules)) |
| **LLM↑** | LLM suggested a counterpart with high confidence |
| **LLM↓** | LLM suggested with low confidence — please verify |
| (no badge) | Not auto-filled; pick manually |

Hover over a badge for details. LLM badges appear only when LLM integration is enabled.

#### Review pattern

- **Rule**: usually trustworthy as-is
- **LLM↑**: glance at it and confirm
- **LLM↓**: always verify
- No badge: pick the counterpart yourself

### 3-4. Submit

Click **"{count} entries"** to import all unticked rows at once.

> Double-check the count and badges before submitting. Corrections are possible afterward but tedious if many entries are wrong. For bulk mistakes, the import history's **"Reverse this batch"** is far more efficient (see [§ 5](#5-import-history-and-batch-reverse)).

A success message **"{count} entries imported"** appears at the top.

## 4. LLM auto-classification (optional)

If you set up a Gemini API key or an OpenAI-compatible endpoint in [01. Initial setup § 7](01-setup_en.md#7-prepare-ocr--llm-if-needed), then during CSV import:

- Rows that **didn't match any rule** are sent to the LLM, which proposes a counterpart account
- Badges **"LLM↑"** / **"LLM↓"** indicate confidence

> **What's sent**: CSV row text (amount, description) + list of accounts
> **Where it goes**: the selected engine (`generativelanguage.googleapis.com` for Gemini, your baseURL for local)
> **Confirmation**: a pre-send dialog is shown for cloud engines (with a "don't ask again" option)

Leaving LLM off is fine — you just see more "no badge" rows that you fill in by hand.

## 5. Import history and batch reverse

Click **"Import history"** in the navigation to open `ImportHistory`. Past imports are listed chronologically.

Each batch row shows:

| Column | What |
|---|---|
| Imported at | When you imported |
| Parser | Which parser was used |
| Filename | The original CSV filename |
| Count | Number of entries created |
| Status | `Active N` / `All reversed` / `Active X / Reversed Y` |

### Reverse the whole batch

Expand a row (click it) → click **"Reverse this batch ({count})"**.

> Confirmation: "All active entries created in this batch will be marked 'Reversed'. A reversing entry is created for each, and both are retained as history."

Click to bulk-create reversing entries; the batch status becomes **"All reversed"**. Originals are kept as history (legal requirement).

> Use this when you imported the wrong CSV or chose the wrong known-side account — undo all at once and re-import.

## 6. Auto-classification rules

The **"Auto-classification rules"** section of Settings lets you register rules that **pre-fill counterpart accounts** for rows matching a description string.

### 6-1. Rule fields

| Field | What |
|---|---|
| Match type | `Contains` / `Vendor name` / `Regex` |
| Pattern | String to match (e.g. `amazon`, `/^Electricity/`) |
| Counterpart account | Account to fill (e.g. `5200 Consumables`) |
| Sub-account (optional) | Sub-account for the above |
| Vendor (optional) | Vendor ID to attach on match |
| Priority | Higher priorities are evaluated first; on multiple matches, highest priority wins |

### 6-2. Examples

| Pattern | Counterpart | Use |
|---|---|---|
| `amazon` | 5200 Consumables | Map Amazon purchases to consumables |
| `AWS` | 5150 Communications (sub: AWS) | AWS monthly bill |
| `Netflix` | 5150 Communications | Subscription |
| `Adobe` | 5150 Communications | Creative Cloud monthly |
| Regex `/Electricity|TEPCO/` | 5130 Utilities | Bundle utility companies |

### 6-3. Where rules apply

- **On CSV import**: matched rows get the **Rule** badge and the counterpart pre-filled
- Rule matches **skip the LLM** (saves cost, speed, and accuracy)

> The more rules you register, the less manual work you do. Add them based on what shows up most often.

## 7. Next steps

- See aggregates of what you booked → [06. Reports](06-reports_en.md)
- Import paper receipts → "Receipt OCR" (TBD)
- Import order details from Amazon / 楽天 etc. → "Order import" (TBD)