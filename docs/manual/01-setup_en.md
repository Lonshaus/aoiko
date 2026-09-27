# 01. Initial setup

What to do from launching aoiko to being ready to book transactions.

**Language**: [日本語](01-setup.md) | **English** | [繁體中文](01-setup_zh-TW.md)

> **By the end of this chapter you can**
> - Accept the disclaimer and register your trade name, fiscal year, and consumption-tax method
> - Register the filer info, filing type (blue or white return), and blue-return deduction type required for `.xtx` submission
> - Register sub-accounts (e.g. per bank account) and vendors
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

After reading, click **"I understand and agree — let me start"** to proceed to the main UI. The acceptance is stored in IndexedDB and won't be shown again (unless the disclaimer is materially revised).

> See [DISCLAIMER_en.md](../../DISCLAIMER_en.md) for details.

## 2. Switch language (optional)

Click **"Settings"** in the navigation → at the top, the **"Language"** section → choose `日本語 / English / 繁體中文` → **"Save"**.

> The initial language follows your browser/OS language setting, falling back to Japanese if that language isn't supported. This guide describes the English UI labels; switch to English here so the screen matches the labels used in this guide.

## 3. Register basic information

Open the **"Basic info"** section of Settings. These appear on financial statements, the tax return form, and `.xtx` files.

| Field | What to enter | Example |
|---|---|---|
| Trade name (屋号) | The name shown in the trade-name field of your tax return | `Aoi Web Studio` |
| Qualified invoice issuer registration number | T + 13 digits | `T1234567890123` |
| Current fiscal year | The year being booked | `2026` |

Press **"Save"** when done. Leave the invoice number blank if you haven't registered.

## 3a. Register filer info and the blue-return deduction (required for `.xtx` submission)

Required to load the `.xtx` into e-Tax software (download edition). Register these in the **"Filer Info (for e-Tax submission)"** section of Settings.

| Field | What to enter |
|---|---|
| Tax office | Search by name or code and select (5 digits) |
| User identification number | Your 16-digit e-Tax number |
| Name | The name shown on your tax return |
| Postal code (optional) | 7 digits, no hyphen |
| Address | The address shown on your tax return |

> **Stored only on this device and excluded from backups by default** (see [11. Backup and restore](11-backup_en.md)).

Then choose **Filing type** — **blue return or white return** — via the radio buttons. Switching shows a confirmation dialog (it changes which financial-statement form gets bundled into `.xtx`, and whether the blue-return deduction applies).

**If you chose blue return**, next check "Apply the cash-basis method under Income Tax Act Art. 67(1) (small businesses)" if it applies, and choose a **deduction type** in the **"Blue-return special deduction"** section:

- **Double-entry + kept and preserved electronic records (qualified e-books, etc.); from 2027 e-Tax filing is also required (¥650,000 for 2026; ¥750,000 from 2027)**
- **Double-entry + e-Tax filing only (qualified e-books not required) (¥650,000)**
- **Double-entry only, paper filing/non-qualified (¥550,000 for 2026; ¥100,000 from 2027)**
- **Simple bookkeeping (100,000 yen)**
- **No deduction**

> **For the 2026 tax year (Reiwa 8)**: if you run a business generating business income or (business-scale) real estate income under double-entry bookkeeping, without electing the cash-basis special provision under Income Tax Act Art. 67(1), you get ¥650,000 by meeting **either** item 1 (the qualified-e-book requirements) **or** item 2 (on-time e-Tax submission) of the pre-reform Sochiho Art. 25-2(4) — you don't need both. Double-entry bookkeeping meeting neither item gets ¥550,000. Anything else (e.g. simple bookkeeping) gets ¥100,000, and this tax year has no reduction (Para. 2) for exceeding ¥10M in revenue two years prior. The ¥550,000 tier, and the ¥650,000 tier when reached through item 1, apply only if the return states that you are claiming the deduction and how it's computed, attaches a balance sheet, profit & loss statement, etc. prepared from your books, and is filed by the deadline (Sochiho Art. 25-2(6)). For the ¥650,000 tier reached through item 2, item 2 itself already requires sending the balance sheet, P/L, etc. via e-Tax by the deadline.
>
> **From the 2027 tax year (Reiwa 9) on**: ¥650,000 requires double-entry bookkeeping for a business running an enterprise generating business income or (business-scale) real estate income (a loss in business income doesn't change that you're "running" it), not electing the cash-basis special provision under Income Tax Act Art. 67(1), recording every transaction as the ministerial ordinance requires, and e-filing the return with the balance sheet and P/L by the deadline. ¥750,000 additionally requires, under Sochiho Ministerial Ordinance Art. 9-6(3)/(6), keeping and preserving the journal and general ledger as electronic records — consistently from the very first recording — under Electronic Books Storage Act Art. 4(1) or 5(1)/(3), plus meeting one of: **item 1** — the Art. 8(4) qualified-e-book requirements (notified under Storage Ministerial Ordinance Art. 5(1); no need to re-file if already notified for the ¥650,000 tier), or **item 2** — under Sochiho Ministerial Ordinance Art. 9-6(9)/(10), (イ) using a qualifying system to process electronic transactions in the course of business and (ロ) preserving that year's electronic-transaction records within that system per Storage Ministerial Ordinance Art. 5(5), filing the Art. 5(6) notification. Either item's notification must be filed by the filing deadline (Sochiho Ministerial Ordinance Art. 9-6(5)/(8)). ¥100,000 (other blue-return filers) drops to zero for a simple-bookkeeping filer (condition ③, not falling under item 4) who is running a business (condition ①) without electing the cash-basis method (condition ②), whose total revenue from that income (judged separately for business and for real-estate business), two years prior, exceeded ¥10M (condition ④, the Para. 2 test); double-entry filers and cash-basis filers are exempt from this Para. 2 test.
>
> If you use the cash-basis special provision for computing income, neither the ¥650,000 nor the ¥750,000 tier is available (the ¥100,000 tier still is). See [14. Income & tax deductions](14-income-deductions_en.md) and the deduction amount shown on the financial statements for details.

**If you chose white return**, the deduction type selector is hidden (white return has no blue-return special deduction). `.xtx` export bundles the income/expense breakdown statement (general) instead. See [10. `.xtx` export](10-xtx-export_en.md) for details.

## 4. Choose a consumption tax method

In the **"Consumption tax"** section, pick a method (`.xtx` output of the actual return is supported for **general taxation, the 20% special provision, and simplified taxation**; simplified taxation supports the two-category computation — including the 75% special rule — for a fixed-asset sale's 4th category alongside your set category, but not a filer who actually runs multiple business categories. The 30% special provision is estimate/comparison only. See [07. Consumption tax](07-consumption-tax_en.md)).

### 4-1. Tax obligation

- **Taxable business**: you must file consumption tax. Also pick a method below.
- **Tax-exempt business**: no consumption tax filing required (taxable sales in the base period [2 years prior] ≤ ¥10M, and taxable sales [or salary payments] in the specified period [prior year Jan 1–Jun 30] ≤ ¥10M, and no invoice registration. Current-year sales have no bearing. Once registered as a qualified invoice issuer, you're never exempt regardless of the base-period amount).

### 4-2. Method (for taxable businesses)

| Method | When it fits |
|---|---|
| General taxation (本則課税) | Lots of input purchases; want full input-tax credit |
| Simplified taxation (簡易課税) | Base-period (2 years prior) taxable sales ≤ ¥50M, fewer inputs, simpler computation (requires advance election — see below) |
| 20% special provision (2023/10–2026/9, through the 2026 tax year for individuals) | The 3-year softening measure for periods you became taxable because of invoice registration |
| 30% special provision (Reiwa 9 & 10, individuals only) | New rule for base-period (2 years prior) taxable sales ≤ ¥10M; its covered years don't overlap the 20% special provision, which it succeeds |

> Both the 20% and 30% special provisions apply only to a taxable period that would otherwise have been tax-exempt without registration. They don't apply to: a foreign business with no permanent establishment in Japan; a period where you're still under an election to be a taxable business; a period in which you acquired an asset subject to the adjusted-fixed-asset rules; a period you became taxable because of inheritance; or a period with a shortened taxable period (the 30% provision excludes only the inheritance case from this list). See [07. Consumption tax](07-consumption-tax_en.md) for the full requirements.
>
> Simplified taxation requires an advance election (the Simplified Taxation Selection Notification), filed by the day before the taxable period it's to apply to begins (in principle, by the end of the prior fiscal year). A few exceptions, such as the period in which you started the business, can apply from that period itself.

If you chose simplified taxation, pick the category (1st–6th) in **"Simplified-method category"**:

- 1st: wholesale
- 2nd: retail, agri/forestry/fishery (food)
- 3rd: manufacturing, construction, agri/forestry/fishery (other)
- 4th: other (restaurants etc.)
- 5th: services, finance, transport/communications
- 6th: real estate

Press **"Save"**.

> Detailed guidance on choosing a method is in [07. Consumption tax](07-consumption-tax_en.md). When in doubt, start with general taxation and use the **"Consumption tax"** section on the Reports screen at year-end to compare the methods with real numbers.

## 5. Register sub-accounts (per account / per expense)

Useful when you have multiple bank accounts or want to split a single expense account by vendor.

In the **"Subaccounts"** section of Settings:

1. Choose the **"Select parent account"** dropdown (e.g. `1130 Ordinary deposit`)
2. Enter the name in the field showing **"Subaccount name (e.g. Mitsubishi UFJ — Honten)"**
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
2. Choose a **type**: Corporation / Individual / Public / Foreign
3. Enter an invoice number (optional): an unlabeled field whose placeholder reads `T1234567890123 (optional)`
4. Enter a **default account** (optional): the expense account this vendor usually maps to (e.g. `AWS → 5150 Communications`)
5. Click **"Add"**

> Vendor-based aggregates and journal-list filtering also reference these vendors.

## 7. Prepare OCR / AI (if needed)

Needed for AI classification (CSV auto-classification), order import (paste Amazon / 楽天 etc.), or reading receipts with AI OCR. Skip otherwise (receipt OCR alone can always use the AI-free built-in rule engine).

In the **"AI features (optional)"** section of Settings, choose the AI engine:

### 7-A. Google Gemini (default, cloud)

Free tier available.

1. Get an API key on [Google AI Studio](https://aistudio.google.com/apikey) (requires Google account)
2. Paste it into the **"Gemini API key"** field in aoiko
3. **"Save"** → **"Test connection"** → confirm `✓ Connected`

> **Note**: CSV lines and receipt images are sent to Google. A **pre-send confirmation dialog** is shown before each send. Data is handled per Google's privacy policy; the free tier may be used for training. See [PRIVACY_en.md](../../PRIVACY_en.md).

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

> Inference and data both stay on-device; nothing is sent externally. Just like with the other engines, manual verification and correction of the results is required. See [PRIVACY_en.md](../../PRIVACY_en.md).
<!-- /only -->

### If you don't want AI: the built-in rule engine
<!-- only:browser -->

None of the setup above is needed for receipt OCR alone. The built-in rule engine (Tesseract) is always available, and neither images nor language data leave your device (the language data is served by aoiko itself). It does not extract vendor or items (those fields stay empty). Manual verification is required.
<!-- /only -->
<!-- only:apple -->
None of the setup above is needed for receipt OCR alone. The built-in rule engine (Tesseract, or the OS's built-in text recognition) is always available, and images never leave your device. Tesseract does not extract vendor or items (those fields stay empty). The OS's built-in recognition also attempts to extract vendor and items. Both need manual verification.
<!-- /only -->
<!-- only:windows -->
None of the setup above is needed for receipt OCR alone. The built-in rule engine (Tesseract, or on supported devices the OS's built-in text recognition) is always available, and images never leave your device. Tesseract does not extract vendor or items (those fields stay empty). The OS's built-in recognition also attempts to extract vendor and items. Both need manual verification.
<!-- /only -->
<!-- only:android -->
None of the setup above is needed for receipt OCR alone. The built-in rule engine (Tesseract, or on-device text recognition) is always available, and images never leave your device. Tesseract does not extract vendor or items (those fields stay empty). On-device text recognition also attempts to extract vendor and items. Both need manual verification.
<!-- /only -->

You choose the engine, and its sub-engine, on the `Receipt` page itself, not in Settings. See [04. Receipt OCR](04-receipt-ocr_en.md) for details.

## 8. Optional: other Settings sections

The following Settings sections have their own dedicated chapters and are covered when you need them:

| Section | Chapter |
|---|---|
| Fixed assets | [08. Depreciation](08-depreciation_en.md) |
| Prior-period carryover (opening balances) | [09. Prior-period carryover](09-carryover_en.md) |
| Auto-classification rules | [03. CSV import](03-csv-import_en.md) |
| Accounts | Read-only view of the standard chart of accounts. No add UI |
| Home-office allocation default ratios | [02. Creating journal entries](02-journal_en.md#1-3-use-the-home-office-mixed-use-allocation) |
| Qualified electronic ledger | Self-check display for the search-capability requirements |
| Restore | [11. Backup and restore](11-backup_en.md) |
| Data management | [11. Backup and restore](11-backup_en.md) (zip export / wipe everything) |

## 9. Sanity check: create your first journal entry

Once setup is done, go back to **"Home"** in the navigation and try a simple entry.

Example: contribute ¥100,000 cash to the business

| Date | Description | Debit | Credit | Amount |
|---|---|---|---|---|
| Today | Initial contribution | 1110 Cash | 3110 Owner's capital | 100,000 |

For the full procedure, see [02. Creating journal entries](02-journal_en.md).