# 05. Order import

Create item-level journal entries by pasting text from EC order pages (Amazon, 楽天, etc.).

**Language**: [日本語](05-order-import.md) | **English** | [繁體中文](05-order-import_zh-TW.md)

> **By the end of this chapter you can**
> - Paste an order-page text and generate per-item journal candidates
> - Assign different expense accounts per item within one entry
> - Handle discount lines (negative amounts) as credit-side adjustments
> - Reconcile the item-sum / total mismatch
>
<!-- only:browser -->
> **Prerequisites**: [01. § 7](01-setup_en.md#7-prepare-ocr--ai-if-needed) has set up **Gemini API key** or **OpenAI-compatible endpoint** (the built-in rule engine is not supported here).
<!-- /only -->
<!-- only:apple -->
> **Prerequisites**: [01. § 7](01-setup_en.md#7-prepare-ocr--ai-if-needed) has set up **Gemini API key**, **OpenAI-compatible endpoint**, or **Apple Intelligence** on a supported device (the built-in rule engine is not supported here).
<!-- /only -->
<!-- only:windows -->
> **Prerequisites**: [01. § 7](01-setup_en.md#7-prepare-ocr--ai-if-needed) has set up **Gemini API key** or **OpenAI-compatible endpoint** (the built-in rule engine is not supported here).
<!-- /only -->
<!-- only:android -->
> **Prerequisites**: [01. § 7](01-setup_en.md#7-prepare-ocr--ai-if-needed) has set up **Gemini API key**, **OpenAI-compatible endpoint**, or **on-device Gemini Nano** on a supported device (the built-in rule engine is not supported here).
<!-- /only -->

## 1. Why this feature exists

Card CSV only shows "楽天市場 ¥3,280" — fine for the payment side, but it doesn't help when you need to split by line item (book → news/books expense; consumable → office supplies; computer → fixed asset).

**Order import** asks an AI to extract line items from a pasted order page.

## 2. Import flow

Click **"Orders"** in the navigation to open `OrderImport`.

### 2-1. Get the order page text

Open the **individual order detail** page (not the order history list). Examples:

- **Amazon**: Your Orders → individual **"Order details"**
- **Rakuten Ichiba**: Purchase history → detail page for each order
- **Yahoo! Shopping**: Order history → click an order ID

On that page, select all (PC: `Cmd+A` / `Ctrl+A` on Windows and Linux; phone or tablet: long-press the text and choose "Select All") → copy (PC: `Cmd+C` / `Ctrl+C`; phone or tablet: "Copy" from the menu).

> Headers, navigation, recommendations, footers, etc. are fine in the clipboard. The AI filters out noise. You don't need to be precise about selection range.

### 2-2. Paste and analyze

Paste into the textarea under **"1. Paste the order page text"** (PC: `Cmd+V` / `Ctrl+V`; phone or tablet: long-press and choose "Paste").

Click **"Analyze"** to send to the selected AI engine.

#### When using a cloud engine

Same as [04. § 2-2](04-receipt-ocr_en.md#2-2-analyze) — a pre-send confirmation dialog appears. The "don't ask again" toggle is shared with receipt OCR.
<!-- only:android -->
#### When using on-device Gemini Nano (Android)

The pasted text and the inference content never leave the device, so no confirmation dialog appears. However, ML Kit reports API usage (device model, app version, per-install identifier, processing time, error codes) to Google.
<!-- /only -->

### 2-3. Review and edit the extracted result

After analysis, **"2. Extracted result (editable)"** expands.

#### Header section (editable)

| Field | Content | Example |
|---|---|---|
| Order date | Order confirmation date | `2026-05-20` |
| Vendor | Site + store | `Amazon.co.jp` / `Rakuten Ichiba - Yodobashi.com` |
| Order number | Site's order ID (optional) | `250-1234567-1234567` |
| Total amount (¥) | Final payment total (shipping, tax, discounts applied) | `4,580` |

#### Items table (editable)

Each item is one row:

| Column | Content |
|---|---|
| **Item** | Item name (model / spec included; editable) |
| **Amount** | Unit × qty (integer; editable; discount lines are negative, e.g. `-300`) |
| **Account** | Expense account for this item (default `5200 Consumables`, dropdown) |
| ✕ | Delete the row |

A **"Add row"** button below the table lets you add items the AI missed.

#### Payment source

Below the table, **"Payment source (default: accounts payable)"** dropdown. For credit card payment, `2120 Accounts payable` (use a sub-account per card if you have them). For PayPay balance, `1110 Cash` or your configured account.

### 2-4. Item-sum / total mismatch

When you press **"Save entry"**, aoiko checks whether the item subtotal matches the entered total. If it doesn't, the entry is not saved and an error message is shown instead:

> Item subtotal does not match the total (items ¥4,280 / total ¥4,580). Correct one of them before saving.

Because each item becomes a debit line and the total becomes the single payable credit line, the entry can't balance while the two disagree. Fix either the item amounts (common causes: the AI missed a "-300 yen point use" line, shipping wasn't included as an item, tax rounding differs) or the "Total amount" field, then press **"Save entry"** again.

### 2-5. What entry is created

Example: 3 items + shipping, total ¥4,580, credit card paid:

```
2026-05-20  Amazon.co.jp 250-1234567-1234567
  Debit   5200 Consumables       ¥1,580   Screw set
  Debit   5200 Consumables       ¥2,580   USB-C hub
  Debit   5120 Packing/freight   ¥420     Shipping
  Credit  2120 Accounts payable  ¥4,580   Total
```

If there are discount lines (negative), they're routed to the credit side:

```
2026-05-20  Rakuten Ichiba - Yodobashi.com
  Debit   5200 Consumables       ¥3,000   Item A
  Credit  5200 Consumables       ¥500     Coupon discount
  Credit  2120 Accounts payable  ¥2,500   Total
```

> The entry's **source** field is `paste` (handy if you want to filter by source in [02. § 2-1](02-journal_en.md#2-1-filters)).

## 3. Practical tips

### Suggested account by item type

| Item example | Recommended account |
|---|---|
| Books / e-books | `5910 Miscellaneous expenses` (add a sub-account such as `News & books` under **Settings → Subaccounts** if you want to separate it out) |
| Stationery / cables / USB hubs | `5200 Consumables` |
| Business PC / monitor | `1510 Tools & equipment` → register separately as a fixed asset ([08. Depreciation](08-depreciation_en.md)) |
| AWS / SaaS monthly | `5150 Communications` (sub-account: service name) |
| Shipping | `5120 Packing/freight` or roll into the item |
| Coupon discount | Same account as the item, negative (or `4910 Misc. income` as positive) |

### Pasting tips

- Paste the **individual order detail**, not the order history list (the list mixes multiple orders and confuses the AI)
- Paste **one order** at a time, and check that the extracted items and amounts match the order you pasted
- Long pages with extensive recommendation noise are OK as long as the order summary block is included

### Amazon Business / Rakuten Business

Their business-focused portals may offer **"Order history report CSV"** for direct download. If you can get that, you can also import it via [03. CSV import](03-csv-import_en.md) instead of order import, as a separate layer from card statements (there's no dedicated format support for Amazon Business / Rakuten Business, so enter it row by row manually).

## 4. Troubleshooting

| Symptom | Action |
|---|---|
| "Analyze" doesn't progress | Settings → "AI features" → "Test connection" to verify API key / endpoint |
| Output isn't in English/Japanese | The prompt is in Japanese, so this is uncommon. For local AI, switch to a model with better Japanese support |
| Some items missing | AI extraction limitation. Use **"Add row"** to add manually |
| Amount wrong | Edit the row. If items don't sum to the total, saving fails with an error; fix either the item amounts or the total |
| Empty order number | Optional field — ignore. Entry description will use vendor only |
| Shipping / fees not in items | Add a row for shipping with the right amount and account |

## 5. Privacy notes

- Order pages often contain **shipping address, name, phone number**. Double-check before sending to a cloud AI
- For sensitive addresses, remove personal-info lines from the textarea before clicking Analyze
- See [PRIVACY_en.md](../../PRIVACY_en.md)

## 6. Next steps

- Confirm/edit imported entries → [02. Creating journal entries](02-journal_en.md)
- Aggregate / verify → [06. Reports](06-reports_en.md)
- Reconciling with card statements: [03. CSV import](03-csv-import_en.md) — be careful not to double-count the same transaction (order import + card CSV)