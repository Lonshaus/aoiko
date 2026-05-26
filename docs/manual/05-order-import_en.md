# 05. Order import

Create item-level journal entries by pasting text from EC order pages (Amazon, 楽天, etc.).

**Language**: [日本語](05-order-import.md) | **English** | [繁體中文](05-order-import_zh-TW.md)

> **By the end of this chapter you can**
> - Paste an order-page text and generate per-item journal candidates
> - Assign different expense accounts per item within one entry
> - Handle discount lines (negative amounts) as credit-side adjustments
> - Reconcile the item-sum / total mismatch
>
> **Prerequisites**: [01. § 7](01-setup_en.md#7-prepare-ocr--llm-if-needed) has set up **Gemini API key** or **OpenAI-compatible endpoint** (Tesseract is not supported here).

## 1. Why this feature exists

Card CSV only shows "楽天市場 ¥3,280" — fine for the payment side, but it doesn't help when you need to split by line item (book → news/books expense; consumable → office supplies; computer → fixed asset).

**Order import** asks an LLM to extract line items from a pasted order page.

## 2. Import flow

Click **"Orders"** in the navigation to open `OrderImport`.

### 2-1. Get the order page text

Open the **individual order detail** page (not the order history list). Examples:

- **Amazon**: Your Orders → individual **"Order details"**
- **Rakuten Ichiba**: Purchase history → detail page for each order
- **Yahoo! Shopping**: Order history → click an order ID

On that page, `Cmd+A` (Win: `Ctrl+A`) to select all → `Cmd+C` to copy.

> Headers, navigation, recommendations, footers, etc. are fine in the clipboard. The LLM filters out noise. You don't need to be precise about selection range.

### 2-2. Paste and analyze

Paste with `Cmd+V` into the textarea under **"1. Paste the order page text"**.

Click **"Analyze"** to send to the selected LLM engine.

#### When using a cloud engine

Same as [04. § 2-2](04-receipt-ocr_en.md#2-2-analyze) — a pre-send confirmation dialog appears. The "don't ask again" toggle is shared with receipt OCR.

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

A **"+ Add row"** button below the table lets you add items the LLM missed.

#### Payment source

Below the table, **"Payment source (default: accounts payable)"** dropdown. For credit card payment, `2120 Accounts payable` (use a sub-account per card if you have them). For PayPay balance, `1110 Cash` or your configured account.

### 2-4. Item-sum / total mismatch warning

When you press **"Save entry"**, aoiko checks if items sum to the entered total. If not, a confirmation dialog appears:

> Item subtotal does not match the total (items ¥4,280 / total ¥4,580). Trust the total and continue?

- **OK**: total is used for the payable credit; items are debits. The difference appears as the gap between credit (payable) and total debits
- **Cancel**: fix the items first, then save again

> Typical causes: LLM missed a "-300 yen point use" line, shipping wasn't in items, tax rounding differs. If the gap is small and you don't want to chase, OK and continue — a correcting entry later is also fine.

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
| Books / e-books | `5xxx News & books` (add to seed if not present in the default chart) |
| Stationery / cables / USB hubs | `5200 Consumables` |
| Business PC / monitor | `1514 Tools & equipment` → register separately as a fixed asset ([08. Depreciation](08-depreciation_en.md)) |
| AWS / SaaS monthly | `5150 Communications` (sub-account: service name) |
| Shipping | `5120 Packing/freight` or roll into the item |
| Coupon discount | Same account as the item, negative (or `4910 Misc. income` as positive) |

### Pasting tips

- Paste the **individual order detail**, not the order history list (the list mixes multiple orders and confuses the LLM)
- One paste = one order. The LLM is instructed to extract only the first order
- Long pages with extensive recommendation noise are OK as long as the order summary block is included

### Amazon Business / Rakuten Business

Their business-focused portals may offer **"Order history report CSV"** for direct download. If you can get that, it might be more reliable than order import + card statement reconciliation. aoiko currently has no dedicated parser for these — manual entry per row is the workaround.

## 4. Troubleshooting

| Symptom | Action |
|---|---|
| "Analyze" doesn't progress | Settings → "LLM integration" → "Test connection" to verify API key / endpoint |
| Output isn't in English/Japanese | The prompt is in Japanese, so this is uncommon. For local LLM, switch to a model with better Japanese support |
| Some items missing | LLM extraction limitation. Use **"+ Add row"** to add manually |
| Amount wrong | Edit the row. If items don't sum to the total, choose OK or revise via the dialog |
| Empty order number | Optional field — ignore. Entry description will use vendor only |
| Shipping / fees not in items | Add a row for shipping with the right amount and account |

## 5. Privacy notes

- Order pages often contain **shipping address, name, phone number**. Double-check before sending to a cloud LLM
- For sensitive addresses, prefer localhost Ollama, or remove personal-info lines from the textarea before clicking Analyze
- See [PRIVACY_en.md](../../PRIVACY_en.md)

## 6. Next steps

- Confirm/edit imported entries → [02. Creating journal entries § 2-3](02-journal_en.md)
- Aggregate / verify → [06. Reports](06-reports_en.md)
- Reconciling with card statements: [03. CSV import](03-csv-import_en.md) — be careful not to double-count the same transaction (order import + card CSV)