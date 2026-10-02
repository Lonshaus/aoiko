# 01. Initial setup

What to do from launching aoiko to being ready to book transactions.

**Language**: [日本語](01-setup.md) | **English** | [繁體中文](01-setup_zh-TW.md)

> **By the end of this chapter you can**
> - Accept the disclaimer and register your trade name, tax year, and consumption-tax method
> - Register the filer info, filing type (blue or white return), and blue-return deduction type required for `.xtx` submission
> - Register subaccounts (e.g. per bank account) and vendors
> - Configure an API key / endpoint for OCR/AI, if you want to use those
>
<!-- only:browser -->
> **Prerequisites**: aoiko is open in your browser.
<!-- /only -->
<!-- only:native -->
> **Prerequisites**: the app is launched.
<!-- /only -->

## 1. Accept the disclaimer

On first launch, a **disclaimer dialog** appears in the center of the screen. The figures and books aoiko produces are not guaranteed correct. For actual tax filing, always verify with a tax accountant or your tax office.

After reading, click **"I understand and agree — get started"** to proceed to the main UI. The acceptance is stored in IndexedDB and won't be shown again (unless the disclaimer is materially revised).

> See [DISCLAIMER_en.md](../../DISCLAIMER_en.md) for details.

## 2. Switch language (optional)

Click **"Settings"** in the navigation → at the top, the **"Language"** section → choose `日本語 / English / 繁體中文`. The screen reloads in the new language right away; there is no Save button.

> The initial language follows your browser/OS language setting, falling back to Japanese if that language isn't supported. This guide describes the English UI labels; switch to English here so the screen matches the labels used in this guide.

## 3. Register basic information

Open the **"Basic info"** section of Settings. These appear on the financial statements, the tax return, and `.xtx` files.

| Field | What to enter | Example |
|---|---|---|
| Business / trade name (事業名 / 屋号) | The name shown in the trade-name field of your tax return | `Aoi Web Studio` |
| Invoice registration number | Qualified invoice issuer registration number (T + 13 digits) | `T1234567890123` |
| Current tax year | The year being booked | `2026` |
| Invoice number prefix | Text at the start of invoice numbers (e.g. `INV-2026-0001`) | `INV` |
| Quote number prefix | Text at the start of quote numbers (e.g. `QUO-2026-0001`) | `QUO` |

Press **"Save"** when done. Leave the invoice number blank if you haven't registered.

## 3a. Register filer info and the blue-return deduction (required for `.xtx` submission)

Required to load the `.xtx` into e-Tax software (download edition). Register these in the **"Filer info (for e-Tax submission)"** section of Settings.

| Field | What to enter |
|---|---|
| Tax office | Search by name or code and select (5 digits) |
| User identification number | Your 16-digit e-Tax number |
| Name | The name shown on your tax return |
| Postal code (optional) | 7 digits, no hyphen |
| Address | The address shown on your tax return |

> **Stored only on this device and excluded from backups by default** (see [11. Backup and restore](11-backup_en.md)).

Then choose **Filing type** — **blue return or white return** — via the radio buttons. Switching shows a confirmation dialog (it changes which financial-statement form gets bundled into `.xtx`, and whether the blue-return deduction applies).

**If you chose blue return**, in the same Filer info section, check "Apply the cash-basis method under Income Tax Act Art. 67(1) (small businesses)" if it applies, choose a **Deduction type**, and press **"Save"** at the bottom of the section:

- **Double-entry + kept and preserved electronic records of the books (qualified e-bookkeeping, etc.); from tax year 2027 (Reiwa 9) e-Tax filing is also required (¥650,000 for tax year 2026; ¥750,000 from tax year 2027)**
- **Double-entry + e-Tax filing only (qualified e-bookkeeping not required) (¥650,000)**
- **Double-entry only, paper filing or non-qualified books (¥550,000 for tax year 2026; ¥100,000 from tax year 2027)**
- **Simple bookkeeping (¥100,000)**
- **No deduction**

> **For tax year 2026 (Reiwa 8)**: if you run a business generating business income or (business-scale) real estate income under double-entry bookkeeping, and have not elected the cash-basis special provision under Income Tax Act Art. 67(1), you get ¥650,000 by meeting **either** item 1 (the qualified e-bookkeeping requirements) **or** item 2 (on-time e-Tax submission) of the pre-reform Special Taxation Measures Act Art. 25-2(4). You do not need both.
>
> - Double-entry bookkeeping that meets neither item: ¥550,000.
> - Anything else (e.g. simple bookkeeping): ¥100,000. For this tax year there is no reduction (Para. 2) for revenue over ¥10 million two years prior.
> - The ¥550,000 tier, and the ¥650,000 tier reached through item 1, apply only if the return states that you are claiming the deduction and how it is computed, attaches a balance sheet, profit and loss statement, etc. prepared from your books, and is filed by the deadline (Special Taxation Measures Act Art. 25-2(6)).
> - For the ¥650,000 tier reached through item 2, item 2 itself already requires sending the balance sheet, P/L, etc. via e-Tax by the deadline.
>
> **From tax year 2027 (Reiwa 9) on**:
>
> - **¥650,000**: you run a business generating business income or (business-scale) real estate income under double-entry bookkeeping (a loss in business income does not change that you are "running" it), do not elect the cash-basis special provision under Income Tax Act Art. 67(1), record every transaction as the ministerial ordinance requires, and e-file the return with the balance sheet and P/L by the deadline.
> - **¥750,000**: everything required for ¥650,000, plus keeping and preserving the journal and general ledger as electronic records under Electronic Books Preservation Act Art. 4(1) or 5(1)/(3), consistently from the very first recording of the year (Special Taxation Measures Act Ministerial Ordinance Art. 9-6(3)/(6)), and meeting one of the following:
>   - **Item 1**: the Art. 8(4) qualified e-bookkeeping requirements (notified under Electronic Books Preservation Act Ministerial Ordinance Art. 5(1); no need to re-file if you already notified for the ¥650,000 tier).
>   - **Item 2**: under Special Taxation Measures Act Ministerial Ordinance Art. 9-6(9)/(10), (a) using a qualifying system to process electronic transactions in the course of business and (b) preserving that year's electronic-transaction records within that system per Electronic Books Preservation Act Ministerial Ordinance Art. 5(5), and filing the Art. 5(6) notification.
>   - Either item's notification must be filed by the filing deadline (Special Taxation Measures Act Ministerial Ordinance Art. 9-6(5)/(8)).
> - **¥100,000** (other blue-return filers): drops to zero when all of the following apply (the Para. 2 test). ① You run a business. ② You do not elect the cash-basis method. ③ You use simple bookkeeping (not falling under Para. 4). ④ Your total revenue from that income two years prior (judged separately for business and for real-estate business) exceeded ¥10 million. Double-entry filers and cash-basis filers are exempt from this Para. 2 test.
>
> If you use the cash-basis special provision for computing income, neither the ¥650,000 nor the ¥750,000 tier is available (the ¥100,000 tier still is). See [14. Income & tax deductions](14-income-deductions_en.md) and the deduction amount shown on the financial statements for details.

**If you chose white return**, the deduction type selector is hidden (white return has no blue-return special deduction). `.xtx` export bundles the income/expense breakdown statement (general) instead. See [10. `.xtx` export](10-xtx-export_en.md) for details.

## 4. Choose a consumption tax method

In the **"Consumption tax"** section, pick a method (`.xtx` output of the actual return is supported for **general taxation, the 20% special provision, and simplified taxation**; simplified taxation supports the two-category computation — including the 75% rule — for a fixed-asset sale's 4th category alongside your configured category, but does not cover a filer who actually runs multiple business categories. The 30% special provision is estimate/comparison only. See [07. Consumption tax](07-consumption-tax_en.md)).

### 4-1. Tax obligation

- **Taxable business**: you must file consumption tax. Also pick a method below.
- **Tax-exempt business (no consumption-tax filing)**: no consumption tax filing required (taxable sales in the base period [2 years prior] ≤ ¥10 million, and taxable sales [or salary payments] in the specified period [prior year Jan 1–Jun 30] ≤ ¥10 million, and no invoice registration. Current-year sales have no bearing. Once registered as a qualified invoice issuer, you're never exempt regardless of the base-period amount).

### 4-2. Method (for taxable businesses)

| Method | When it fits |
|---|---|
| General taxation (本則課税) | Lots of input purchases; want full input-tax credit |
| Simplified taxation (簡易課税) | Base-period (2 years prior) taxable sales ≤ ¥50 million, fewer inputs, simpler computation (requires advance election — see below) |
| 20% special provision (2023/10–2026/9, through the 2026 tax year for individuals) | The 3-year relief measure for periods you became taxable because of invoice registration |
| 30% special provision (tax years 2027–2028, individuals only) | New rule for base-period (2 years prior) taxable sales ≤ ¥10 million; its covered years don't overlap the 20% special provision, which it succeeds |

> Both the 20% and 30% special provisions apply only to a taxable period that would otherwise have been tax-exempt without registration. They don't apply to: a foreign business with no permanent establishment in Japan; a period where you're still under an election to be a taxable business; a period in which you acquired an asset subject to the adjusted-fixed-asset rules; a period you became taxable because of inheritance; or a period with a shortened taxable period (for the 30% provision, every case on this list except inheritance applies). See [07. Consumption tax](07-consumption-tax_en.md) for the full requirements.
>
> Simplified taxation requires an advance election (the Simplified Taxation Selection Notification), filed by the day before the taxable period it's to apply to begins (in principle, by the end of the prior year). A few exceptions, such as the period in which you started the business, can apply from that period itself.

If you chose simplified taxation, pick the category (1st–6th) in **"Simplified taxation category"**:

- 1st: wholesale
- 2nd: retail, agri/forestry/fishery (food)
- 3rd: manufacturing, construction, agri/forestry/fishery (other)
- 4th: other (restaurants etc.)
- 5th: services, finance, transport/communications
- 6th: real estate

Your choice is saved automatically as soon as you select it (there is no Save button).

> Detailed guidance on choosing a method is in [07. Consumption tax](07-consumption-tax_en.md). When in doubt, start with general taxation and use the **"Consumption tax"** section on the Reports screen at year-end to compare the methods with real numbers.

## 5. Register subaccounts (per account / per expense)

Useful when you have multiple bank accounts or want to split a single expense account by vendor.

In the **"Subaccounts"** section of Settings:

1. Choose the **"Select parent account"** dropdown (e.g. `1130 普通預金` (Ordinary deposit))
2. Enter the name in the field showing **"Subaccount name (e.g. MUFG main branch)"**
3. Click **"Add"**

Common patterns:

| Parent | Subaccount | Use |
|---|---|---|
| 1130 普通預金 | MUFG main branch | Per-account balance tracking |
| 1130 普通預金 | SBI Shinsei | Same |
| 2120 未払金 (Other payables) | Rakuten Card | Per-card payable tracking |
| 2120 未払金 | au PAY Card | Same |
| 5150 通信費 (Communications) | AWS | Expense sub-classification |
| 5150 通信費 | Mobile | Same |

> CSV import lets you choose **the statement account** with these subaccounts (e.g. "Rakuten Card CSV → 2120 未払金 / Rakuten Card").

## 6. Register vendors

Vendors are used as recipients of invoices and quotes, and you can also register an invoice registration number and a default counterpart account. With a default counterpart account set, CSV-import rows whose description contains the vendor's name and that match no auto-classification rule get that account (rules take priority; AI classification handles only the rows still left).

In the **"Vendors"** section:

1. Enter the **vendor name**
2. Choose a **type**: Corporation / Individual / Public body / Overseas entity
3. Enter an invoice number (optional): an unlabeled field whose placeholder reads `T1234567890123 (optional)`
4. Choose a **"Default account (optional)"**: the expense account this vendor usually maps to (e.g. `AWS → 5150 通信費`)
5. Click **"Add"**

> Vendor-based aggregates and journal-list filtering also reference these vendors. Note that only entries created by issuing an invoice carry a vendor (manual entry and CSV import cannot set one).

## 7. Prepare OCR / AI (if needed)

Needed for AI classification (CSV auto-classification), order import (paste Amazon / Rakuten etc.), or reading receipts with AI OCR. Skip otherwise (receipt OCR alone can always use the AI-free built-in rule engine).

In the **"AI features (optional)"** section of Settings, choose the AI engine:

### 7-A. Google Gemini (default, cloud)

Free tier available.

1. Get an API key on [Google AI Studio](https://aistudio.google.com/apikey) (requires Google account)
2. Paste it into the **"Gemini API key"** field in aoiko
3. Press **"Fetch model list"**; the API key is saved, the model list is fetched, and a usable model is selected in **"Model"** automatically (change it if needed)
4. **"Test connection"** → confirm `✓ Connection successful`

> **Note**: CSV rows and receipt images are sent to Google. A **pre-send confirmation dialog** is shown before each send. Data is handled per Google's privacy policy; the free tier may be used for training. See [PRIVACY_en.md](../../PRIVACY_en.md).

### 7-B. OpenAI-compatible / Ollama etc. (local OK)

If you run Ollama / LM Studio / llama.cpp / vLLM yourself, on your own computer or another server.

1. Choose **"OpenAI-compatible / Ollama etc."**
2. Enter the **endpoint (baseURL)**: e.g. `http://localhost:11434/v1`
3. Enter an **API key** (usually unnecessary for local Ollama; blank is fine)
4. Click **"Fetch model list"** → select an OCR model and a classification model
5. **"Save"** → **"Test connection"**

> - OCR requires a **vision-capable model** (gemma4 / ministral-3 / llama3.2-vision etc.)
<!-- only:browser -->
> - To point it at localhost, allow aoiko's public URL in Ollama's `OLLAMA_ORIGINS` setting
<!-- /only -->
<!-- only:native -->
> - No extra setup needed for localhost either. The app relays the request for you
<!-- /only -->
<!-- only:apple -->

### 7-C. Apple Intelligence (supported devices only)

No API key or endpoint setup needed. On macOS 26 / iOS 26 or later, when the device is eligible and Apple Intelligence is turned on in system settings, "**Apple Intelligence (on-device, free)**" becomes selectable in the engine picker. It doesn't appear at all on unsupported devices or older OS versions. When it's off, still downloading, or its state can't be determined, the option is shown disabled with the reason.

> For receipt OCR, AI classification (CSV auto-classification) and order import alike, both reading and structuring happen entirely on this device — neither the image nor its content is sent anywhere. ※ Apple Intelligence is a trademark of Apple Inc., registered in the U.S. and other countries.
<!-- /only -->
<!-- only:browser -->

### 7-C. Your browser's built-in AI (supported browsers only)

No API key or endpoint setup needed. **"The browser's built-in AI"** appears in the engine picker in Settings only when your browser already holds the AI model. If it doesn't appear, this engine is unavailable on this device — there is no way to have aoiko fetch the model for you.

> aoiko itself sends nothing, but whether inference runs on your device or in an external service is decided by the browser's implementation. Just like with the other engines, manual verification and correction of the results is required. See [PRIVACY_en.md](../../PRIVACY_en.md).
<!-- /only -->

### If you don't want AI: the built-in rule engine
<!-- only:browser -->

None of the setup above is needed for receipt OCR alone. The built-in rule engine (Tesseract) is always available, and images never leave your device. Its language data is served by aoiko itself; it's fetched on your first scan and saved on this device, so it works offline afterwards. It does not extract vendor or items (those fields stay empty). Manual verification is required.
<!-- /only -->
<!-- only:apple -->
None of the setup above is needed for receipt OCR alone. The built-in rule engine (Tesseract, or the OS's built-in text recognition) is always available, and images never leave your device. Tesseract does not extract vendor or items (those fields stay empty). The OS's built-in recognition also attempts to extract vendor and items. Both need manual verification.
<!-- /only -->
<!-- only:windows -->
None of the setup above is needed for receipt OCR alone. The built-in rule engine (Tesseract, or on supported devices the OS's built-in text recognition) is always available, and images never leave your device. Tesseract does not extract vendor or items (those fields stay empty). The OS's built-in recognition also attempts to extract vendor and items. Both need manual verification.
<!-- /only -->

The reading method (AI engine or built-in rule engine) and the rule engine's sub-engine are chosen on the Receipt OCR screen, not in Settings; Settings only chooses which AI engine is used. See [04. Receipt OCR](04-receipt-ocr_en.md) for details.

## 8. Optional: other Settings sections

The following Settings sections have their own dedicated chapters and are covered when you need them:

| Section | Chapter |
|---|---|
| Fixed assets | [08. Depreciation](08-depreciation_en.md) |
| Prior-period carryover (opening balances) | [09. Prior-period carryover](09-carryover_en.md) |
| Auto-classification rules | [03. CSV import](03-csv-import_en.md) |
| Accounts | The standard chart of accounts, where you can hide or show each account with its "Active" checkbox (hidden accounts drop out of the journal-entry picker). There is no UI to add or delete accounts themselves (use the subaccounts in § 5 for finer detail) |
| Home-office allocation default ratios | [02. Creating journal entries](02-journal_en.md#1-3-use-the-home-office-mixed-use-allocation) |
| Qualified e-bookkeeping requirements | Self-check display for the search-capability requirements |
| Restore | [11. Backup and restore](11-backup_en.md) |
| Backup | [11. Backup and restore](11-backup_en.md) (zip export, automatic backup folder) |
| Export for your accountant | [11. Backup and restore § 8](11-backup_en.md#8-handing-data-off-to-your-accountant) |
| Data management | Wipe all data ([11. Backup and restore](11-backup_en.md)) |

## 9. Sanity check: create your first journal entry

Once setup is done, go back to **"Home"** in the navigation and try a simple entry.

Example: contribute ¥100,000 cash to the business

| Date | Description | Debit | Credit | Amount |
|---|---|---|---|---|
| Today | Initial contribution | 1110 現金 (Cash) | 3110 元入金 (Owner's capital) | 100,000 |

For the full procedure, see [02. Creating journal entries](02-journal_en.md).