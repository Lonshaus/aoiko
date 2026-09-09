# 04. Receipt OCR

Generate journal candidates from photos or images of paper receipts.

**Language**: [日本語](04-receipt-ocr.md) | **English** | [繁體中文](04-receipt-ocr_zh-TW.md)

> **By the end of this chapter you can**
> - Choose per receipt between the "AI engine" and the "built-in rule engine", extract date, vendor, total, and qualified invoice registration number, and turn it into a journal entry
> - Understand what each of the built-in rule engine's sub-engines can and cannot read
> - Know which path sends data off the device and which does not
> - Understand the pre-send confirmation dialog and the "don't ask again" toggle
>
> **Prerequisites**: to use the AI engine, configure either Gemini or an OpenAI-compatible endpoint in [01. § 7](01-setup_en.md#7-prepare-ocr--ai-if-needed) first. This is not required if you only use the built-in rule engine.

## 1. Picking a reading method (summary)

The reading method (AI engine or built-in rule engine) and which sub-engine the built-in rule engine uses are both chosen on the `Receipt` page itself. Settings only chooses the AI engine's vendor (Gemini or OpenAI-compatible).

| Reading method | Accuracy | Off-device transmission | Required |
|---|---|---|---|
| **AI engine** (Gemini) | ◎ | Yes | Gemini API key |
| **AI engine** (OpenAI-compatible / Ollama etc.) | ◯〜◎ | None for localhost / Yes for remote | Endpoint + vision model |
| **Built-in rule engine** (Tesseract) | △ | None | None — always available on this device |
<!-- only:native -->
| **Built-in rule engine** (the OS's built-in text recognition) | ◯ (few samples) | None | Supported devices only; re-checked automatically every time the `Receipt` page opens |
<!-- /only -->

> Detailed AI engine setup is in [01. § 7](01-setup_en.md#7-prepare-ocr--ai-if-needed).

## 2. Import flow

Click **"Receipts"** in the navigation to open `Receipt`.

### 2-1. Choose an image

Click the file input under **"1. Choose an image"**:

- PC: pick JPG / PNG / WebP / HEIC from the file dialog
- Phone or tablet: choose from the photo library, take a photo on the spot, or pick a file

The chosen image is shown as a preview.

> **Capture tips**:
> - Flat surface, avoid shadows
> - Whole receipt in frame
> - Avoid fluorescent-light glare
> - 1–2 MP is plenty for a normal receipt; higher resolution is counterproductive vs. the AI engine's rate limits

### 2-2. Analyze

Below the preview, a two-way switch for the reading method appears: **"AI engine"** / **"Built-in rule engine"**.

- Choosing **"AI engine"** shows one line below stating the engine actually in use (Gemini or OpenAI-compatible, matching the Settings choice)
- Choosing **"Built-in rule engine"**:
  - A **"Reading engine"** dropdown appears only when this device has two or more usable sub-engines
  - When only one is usable (most devices), no dropdown appears and that one is used directly
<!-- only:native -->
  - The OS's built-in text recognition only enters the option set on supported devices. It is re-checked with the device every time the `Receipt` page opens, so adding Japanese text recognition on the OS side makes it selectable the next time the page is opened
<!-- /only -->

Once chosen, click **"Analyze"** to send to the selected reading method.

#### AI engine (Gemini / remote OpenAI-compatible): pre-send confirmation

Because data leaves the device, **CloudSendConfirmDialog** appears:

> Send image to 〇〇?
>
> ☐ Don't ask again

- **"Send"** to proceed
- **"Cancel"** to abort
- Checking "Don't ask again" before "Send" skips this dialog for all future external sends (one flag shared by OCR, CSV, and order-import AI sends)

<!-- only:browser -->
> **Think twice before checking**: this is stored as IndexedDB `skipExternalSendConfirm: true` (a single flag across engines) and there is no settings UI to undo it. If you checked it by mistake, delete that key with your browser's developer tools (IndexedDB → `aoiko` database → `settings` table). "Settings → Data management → Delete all data" also clears it but wipes your books — last resort only.
<!-- /only -->
<!-- only:native -->
> **Think twice before checking**: if you check it by mistake, undo it from Settings → "Basic info" → **"Restore hidden confirmations"**. "Settings → Data management → Delete all data" also clears it but wipes your books — last resort only.
<!-- /only -->

<!-- only:browser -->
#### Built-in rule engine (Tesseract): no dialog
<!-- /only -->
<!-- only:native -->
#### Built-in rule engine (Tesseract, the OS's built-in text recognition): no dialog
<!-- /only -->

Tesseract processes on-device only, so no confirmation appears. Its language data (`jpn.traineddata`, about 2.9 MB) is served by aoiko itself and fetched only on your first scan.
<!-- only:browser -->
The browser caches it afterwards, so no external request is ever made.
<!-- /only -->
<!-- only:native -->
It's cached inside the app afterwards, so no external request is ever made.

The OS's built-in text recognition shows no dialog either, and fetches nothing extra at all — recognition runs entirely on-device using the OS's own engine.
<!-- /only -->

### 2-3. Review and edit the extracted result

When done, **"2. Extracted result (editable)"** expands below:

| Field | Content |
|---|---|
| Transaction date | Receipt date, `YYYY-MM-DD` |
| Vendor | Store name (editable) |
| Total amount (¥) | Tax-inclusive total (editable, integer) |
| Invoice number | Shown only when a T+13 number is recognized (informational) |
| Items | Collapsible list if any (informational; not reflected in the entry) |

<!-- only:browser -->
> **AI engine path vs built-in rule engine path**:
> - The AI engine extracts vendor and total at high accuracy, and picks up line items
> - The built-in rule engine (Tesseract) only extracts **date, total, and T+13 invoice number** by deterministic rules. **Vendor and items are left blank**. Raw OCR text is held internally but not auto-copied into the journal description
<!-- /only -->
<!-- only:native -->
> **AI engine path vs built-in rule engine path**:
> - The AI engine extracts vendor and total at high accuracy, and picks up line items
> - Tesseract, one of the built-in rule engine's sub-engines, only extracts **date, total, and T+13 invoice number** by deterministic rules. **Vendor and items are left blank**
> - The OS's built-in text recognition, the other sub-engine, also extracts the **vendor** and **line items** on top of that. It returns the position and size of every word, so the largest line in the header is taken as the store name, and rows between the header and the total with a name on the left and an amount on the right are taken as items
> - For both paths, raw OCR text is held internally but not auto-copied into the journal description
<!-- /only -->

#### Built-in rule engine warning banner

For built-in rule engine output, a caution banner appears below the result header. For Tesseract:

> Result from purely-local OCR (Tesseract). Accuracy is limited; please verify and correct the total, date, and vendor before saving. OCR raw text is shown on screen only, not stored.
<!-- only:native -->

For the OS's built-in text recognition:

> Result from the OS's built-in text recognition. Please verify and correct the total, date, and vendor before saving. The raw OCR text is not saved into the note (shown on screen only).
<!-- /only -->

### 2-4. Choose counterpart account and payment source

Two dropdowns at the bottom of the result:

| Dropdown | Default | Meaning |
|---|---|---|
| **Counterpart (expense)** | `5910 Miscellaneous expenses` | The expense account for this receipt |
| **Payment source** | `1110 Cash` | What paid (cash / ordinary deposit / payable etc.) |

For a simple business expense (no home-office allocation), switch to the appropriate account (e.g. food receipt → `5170 Entertainment`; stationery → `5200 Consumables`).

For card payment, change **payment source** to `2120 Accounts payable` (or the sub-account of that specific card if you use them).

### 2-5. Save

Click **"Save entry"** to confirm. A two-line entry (debit = expense / credit = payment source) is created and shown in the Home recent list.

> If an **invoice registration number** was extracted, the line's `invoiceCompliant` flag is saved as `true` (eligible for input tax credit under general consumption taxation).

## 3. Practical tips per engine

### AI engine (Gemini Vision)

- Free tier covers hundreds of receipts per month easily; receipts are token-light
- Tolerant of slight tilt and partial shadow
- 1–2 MP is enough; higher resolution slows things down and costs more

### AI engine (OpenAI-compatible / Ollama, LM Studio etc.)

- **Vision-capable model required** (text-only models fail on image input)
- Recommended: `gemma4`, `ministral-3`, `llama3.2-vision`
<!-- only:browser -->
- On the Ollama side: add aoiko's URL (e.g. `http://localhost:31527`) to `OLLAMA_ORIGINS`
- aoiko itself must run locally too (`npm run preview`); HTTPS-served aoiko can't reach localhost
<!-- /only -->
<!-- only:native -->
- No extra setup needed for localhost either — the app relays the request
<!-- /only -->

### Built-in rule engine (Tesseract)

- The choice when the **AI engine is unavailable or undesired**
- Accept that vendor and items will be empty; this is by design
- T+13 invoice number is rock-solid (extracted by regex)
- Date and total are best-effort. Always verify manually
- The language data ships with aoiko, so it works fully offline after the first fetch
<!-- only:native -->

### Built-in rule engine (the OS's built-in text recognition)

- No AI engine and no extra download
- On top of date, total and invoice number it also extracts the **vendor** and **line items**. Position and size come back per word, so the largest line in the header becomes the store name, and rows between the header and the total with a name on the left and an amount on the right become items. Misreadings pass straight through, so still check them
- The total is the rightmost amount on the line carrying the total keyword, so a layout that prints a quantity on the same line (`合計／ 1点 ¥159`) does not yield the quantity
- Phone numbers, register numbers and slip numbers also appear as "text on the left, digits on the right". Words containing separators, and rows whose left side is a date or digits only, are not treated as items. Better to skip than to guess wrong
- Date and total read correctly on the receipts tried here, but the sample count is small. Always verify the total and date
- The leading `T` of the invoice number is sometimes dropped. Text recognition returns several candidates per word, so the candidates are searched in order for one matching `T` plus exactly 13 digits — in one measured case the third candidate was the correct one. If no candidate has the right digit count the field is left blank (a wrong number in the right format is one you cannot spot by looking)
- **Not every device can use it.** It only enters the option set when Japanese text recognition is present on the OS side. This is re-checked every time the `Receipt` page opens, so adding Japanese on the OS side makes it selectable next time you open the page
<!-- /only -->

## 4. Troubleshooting

| Symptom | Action |
|---|---|
| Total is off | Retake or edit manually. Rare with the AI engine; common with the built-in rule engine path (expected) |
| Date is empty | Try both `YYYY/MM/DD` and Reiwa-format printing. Manual entry is fine |
| Vendor garbled | Improve photo quality and resolution. Tesseract does not extract the vendor, so type it in |
| Invoice number not detected | Recapture with the number area well-lit. The AI engine can pick up even tiny print |
| Connection error | Check API key / endpoint in Settings via **"Test connection"** |

## 5. Privacy notes

- If a receipt shows third-party personal information (customer names, addresses), reconsider sending to the AI engine
- For highly confidential receipts (personal medical bills, sensitive client transactions), prefer the built-in rule engine path or Ollama on localhost
- See [PRIVACY_en.md](../../PRIVACY_en.md) for details

## 6. Next steps

- For order-page imports (Amazon / 楽天 etc.) → [05. Order import](05-order-import_en.md)
- Confirm and edit imported entries → [02. Creating journal entries § 2-3](02-journal_en.md)