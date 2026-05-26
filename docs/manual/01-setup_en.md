# 01. Initial setup

What to do from launching aoiko to being ready to book transactions.

**Language**: [日本語](01-setup.md) | **English** | [繁體中文](01-setup_zh-TW.md)

> **By the end of this chapter you can**
> - Accept the disclaimer and register your trade name, fiscal year, and consumption-tax method
> - Register sub-accounts (e.g. per bank account) and vendors
> - Configure an API key / endpoint for OCR/LLM, if you want to use those
>
> **Prerequisites**: aoiko is started per the [main README](../../README_en.md) and open in your browser.

## 1. Accept the disclaimer

On first launch, a **disclaimer dialog** appears in the center of the screen. aoiko is experimental; the figures and books it produces are not guaranteed correct. For actual tax filing, always verify with a tax accountant or your tax office.

After reading, click **"I agree"** to proceed to the main UI. The acceptance is stored in IndexedDB and won't be shown again (unless the disclaimer is materially revised).

> See [DISCLAIMER_en.md](../../DISCLAIMER_en.md) for details.

## 2. Switch language (optional)

Click **"Settings"** in the navigation → at the top, the **"Language"** section → choose `日本語 / English / 繁體中文` → **"Save"**.

> The default is Japanese. This guide is written based on the Japanese UI labels (English equivalents shown alongside).

## 3. Register basic information

Open the **"Basic info"** section of Settings. These appear on financial statements, the tax return form, and `.xtx` files.

| Field | What to enter | Example |
|---|---|---|
| Trade name (屋号) | The name shown in the trade-name field of your tax return | `Aoi Web Studio` |
| Qualified invoice issuer registration number | T + 13 digits | `T1234567890123` |
| Current fiscal year | The year being booked | `2026` |

Press **"Save"** when done. Leave the invoice number blank if you haven't registered.

## 4. Choose a consumption tax method

In the **"Consumption tax"** section, pick a method (this tool only provides **estimates and comparisons**; the actual tax return form is out of scope).

### 4-1. Tax obligation

- **Taxable business**: you must file consumption tax. Also pick a method below.
- **Tax-exempt business**: no consumption tax filing required (sales ≤ ¥10M & no invoice registration).

### 4-2. Method (for taxable businesses)

| Method | When it fits |
|---|---|
| General taxation (本則課税) | Lots of input purchases; want full input-tax credit |
| Simplified taxation (簡易課税) | Sales ≤ ¥50M, fewer inputs, simpler computation |
| 2% special (2023/10–2026/9) | The 3-year invoice-system softening measure |
| 3% special (Reiwa 9 & 10) | New rule for sales ≤ ¥50M |

If you chose simplified taxation, pick a **business category** (1st–6th):

- 1st: wholesale
- 2nd: retail, agri/forestry/fishery (food)
- 3rd: manufacturing, construction, agri/forestry/fishery (other)
- 4th: other (restaurants etc.)
- 5th: services, finance, transport/communications
- 6th: real estate

Press **"Save"**.

> Detailed guidance on choosing a method is in the "Consumption tax" chapter (TBD). When in doubt, start with general taxation and use the **Consumption tax 4-method comparison** on the Reports screen at year-end to compare real numbers.

## 5. Register sub-accounts (per account / per expense)

Useful when you have multiple bank accounts or want to split a single expense account by vendor.

In the **"Sub-accounts"** section of Settings:

1. Choose the **"Parent account"** from the dropdown (e.g. `1130 Ordinary deposit`)
2. Enter a **sub-account name** (e.g. `MUFG main branch`)
3. Click **"Add"**

Common patterns:

| Parent | Sub-account | Use |
|---|---|---|
| 1130 Ordinary deposit | MUFG main branch | Per-account balance tracking |
| 1130 Ordinary deposit | SBI Shinsei | Same |
| 2120 Accounts payable | Rakuten Card | Per-card payable tracking |
| 2120 Accounts payable | au PAY Card | Same |
| 5150 Communications | AWS | Expense sub-classification |
| 5150 Communications | Mobile | Same |

> CSV import lets you choose **the known-side account** with these sub-accounts (e.g. "Rakuten Card CSV → 2120 Accounts payable / Rakuten Card").

## 6. Register vendors

Linking an invoice number or a default counterpart account to a vendor lets the **auto-classification rules** apply "this vendor → this account" automatically on CSV import.

In the **"Vendors"** section:

1. Enter the **vendor name**
2. Choose a **type**: Corporation / Individual / Public / Foreign / Unknown
3. Enter an **invoice number** (optional): `T` + 13 digits
4. Enter a **default counterpart account** (optional): the expense account this vendor usually maps to (e.g. `AWS → 5150 Communications`)
5. Click **"Add"**

> Vendor-based aggregates and journal-list filtering also reference these vendors.

## 7. Prepare OCR / LLM (if needed)

Only needed if you'll use OCR (receipts), LLM classification (CSV auto-classification), or order import (paste Amazon / 楽天 etc.). Skip otherwise.

In the **"LLM integration"** section of Settings, choose an **OCR/LLM engine**:

### 7-A. Google Gemini (default, cloud)

Free tier available; easiest setup.

1. Get an API key on [Google AI Studio](https://aistudio.google.com/apikey) (requires Google account)
2. Paste it into the **"Gemini API key"** field in aoiko
3. **"Save"** → **"Test connection"** → confirm `✓ Connected`

> **Note**: CSV lines and receipt images are sent to Google. A **pre-send confirmation dialog** is shown before each send. Data is handled per Google's privacy policy; the free tier may be used for training. See [PRIVACY_en.md](../../PRIVACY_en.md).

### 7-B. OpenAI-compatible / Ollama etc. (local OK)

If you run Ollama / LM Studio / llama.cpp / vLLM yourself, either locally or on another server.

1. Choose **"OpenAI-compatible / Ollama etc."**
2. Enter the **endpoint (baseURL)**: e.g. `http://localhost:11434/v1`
3. Enter an **API key** (usually unnecessary for local Ollama; blank is fine)
4. Click **"Fetch model list"** → select an OCR model and a classification model
5. **"Save"** → **"Test connection"**

> - OCR requires a **vision-capable model** (llama3.2-vision / qwen2-vl / minicpm-v etc.)
> - To use localhost, aoiko must also run **locally** (`pnpm run preview`); aoiko served over HTTPS cannot reach `http://localhost`
> - Set `OLLAMA_ORIGINS` on the Ollama side to allow aoiko's URL

### 7-C. Tesseract (purely-local WASM OCR)

OCR that runs entirely in the browser, with no LLM. **Accuracy is limited**; manual verification required.

1. Choose **"Tesseract"**
2. **"Save"**
3. (Optional) Specify a **self-hosted langPath URL** for `traineddata` (defaults to a CDN)

> - Images never leave your device (only `traineddata` is fetched once from the CDN)
> - Only T+13 registration number, date, and total are extracted; vendor and items are NOT guessed
> - OCR only — not usable for CSV classification or order import

## 8. Optional: other Settings sections

The following Settings sections have their own dedicated chapters and are covered when you need them:

| Section | Chapter |
|---|---|
| Fixed assets | "Depreciation" (TBD) |
| Prior-period carryover (opening balances) | "Prior-period carryover" (TBD) |
| Auto-classification rules | [CSV import](03-csv-import_en.md) |
| Accounts | Read-only view of the standard chart of accounts. No add UI ([seed.ts](../../src/tax-schema/2026/accounts.ts) is the source) |
| Qualified electronic ledger | Self-check display for the search-capability requirements |
| Restore | "Backup and restore" (TBD) |
| Data management | JSON export / wipe everything (TBD) |

## 9. Sanity check: create your first journal entry

Once setup is done, go back to **"Home"** in the navigation and try a simple entry.

Example: contribute ¥100,000 cash to the business

| Date | Description | Debit | Credit | Amount |
|---|---|---|---|---|
| Today | Initial contribution | 1110 Cash | 3110 Owner's capital | 100,000 |

For the full procedure, see [02. Creating journal entries](02-journal_en.md).