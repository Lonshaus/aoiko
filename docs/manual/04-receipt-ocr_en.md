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

The reading method (AI engine or built-in rule engine) and which sub-engine the built-in rule engine uses are both chosen on the `Receipt` page itself. Settings only chooses which AI engine is used.

| Reading method | Off-device transmission | Required |
|---|---|---|
| **AI engine** (Gemini) | Yes | Gemini API key |
| **AI engine** (OpenAI-compatible / Ollama etc.) | None for localhost / Yes for remote | Endpoint + vision model |
<!-- only:apple -->
| **AI engine** (Apple Intelligence) | None | Appears only on a supported device with macOS 26 / iOS 26 or later and the system setting turned on |
<!-- /only -->
<!-- only:browser -->
| **AI engine** (your browser's built-in AI) | None | Appears only when the browser already holds the AI model |
<!-- /only -->
| **Built-in rule engine** (Tesseract) | None | None — always available on this device |
<!-- only:apple -->
| **Built-in rule engine** (the OS's built-in text recognition) | None | None — always available on every OS aoiko supports |
<!-- /only -->
<!-- only:windows -->
| **Built-in rule engine** (the OS's built-in text recognition) | None | Supported devices only; re-checked automatically every time the `Receipt` page opens |
<!-- /only -->
<!-- only:android -->
| **Built-in rule engine** (on-device text recognition) | No image or text sent (ML Kit reports usage information to Google) | Always available on this device; the text recognition ships with the app |
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
> - 1–2 MP is plenty for a normal receipt

### 2-2. Analyze

Below the preview, a two-way switch for the reading method appears: **"AI engine"** / **"Built-in rule engine"**.

- Choosing **"AI engine"** shows one line below stating the engine actually in use (matching the Settings choice)
- Choosing **"Built-in rule engine"**:
  - A **"Reading engine"** dropdown appears only when this device has two or more usable sub-engines
<!-- only:browser -->
  - Only one sub-engine (Tesseract) is ever usable here, so no dropdown appears and it is used directly
<!-- /only -->
<!-- only:apple -->
  - Tesseract and the OS's built-in text recognition are both always usable, so the dropdown always appears
<!-- /only -->
<!-- only:windows -->
  - When only one is usable (most devices), no dropdown appears and that one is used directly
<!-- /only -->
<!-- only:apple -->
  - Whether the OS's built-in text recognition includes Japanese depends on the OS version, and it is already included in every macOS / iOS·iPadOS aoiko supports
<!-- /only -->
<!-- only:windows -->
  - The OS's built-in text recognition only enters the option set on supported devices. It is re-checked with the device every time the `Receipt` page opens, so adding Japanese text recognition on the OS side makes it selectable the next time the page is opened
<!-- /only -->
<!-- only:android -->
  - On-device text recognition is always in the option set. The text recognition ships with the app, so nothing has to be added on the OS side
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

> **Think twice before checking**: if you check it by mistake, undo it from Settings → "Basic info" → **"Restore hidden confirmations"**. "Settings → Data management → Delete all data" also clears it but wipes your books — last resort only.
<!-- only:browser -->

#### AI engine (your browser's built-in AI): no dialog

Inference runs entirely on-device, so no confirmation dialog appears. This engine is selectable only when your browser already holds the AI model (aoiko never fetches it).
<!-- /only -->
<!-- only:browser -->

#### Built-in rule engine (Tesseract): no dialog
<!-- /only -->
<!-- only:apple -->
#### Built-in rule engine (Tesseract, the OS's built-in text recognition): no dialog
<!-- /only -->
<!-- only:windows -->
#### Built-in rule engine (Tesseract, the OS's built-in text recognition): no dialog
<!-- /only -->
<!-- only:android -->
#### Built-in rule engine (Tesseract, on-device text recognition): no dialog
<!-- /only -->

Tesseract processes on-device only, so no confirmation appears.
<!-- only:browser -->
Its language data (`jpn.traineddata`, about 2.9 MB) is served by aoiko itself and fetched over the network only on your first scan; the browser caches it afterwards, so no external request is ever made again.
<!-- /only -->
<!-- only:native -->
Its language data (`jpn.traineddata`, about 2.9 MB) is bundled with the app itself, so no external request is ever made, even on your first scan.
<!-- /only -->
<!-- only:apple -->

The OS's built-in text recognition shows no dialog either, and fetches nothing extra at all — recognition runs entirely on-device using the OS's own engine.
<!-- /only -->
<!-- only:windows -->

The OS's built-in text recognition shows no dialog either, and fetches nothing extra at all — recognition runs entirely on-device using the OS's own engine.
<!-- /only -->
<!-- only:android -->

On-device text recognition shows no dialog either and fetches nothing extra, but ML Kit, which powers the recognition, reports usage information (device model, app version, a per-install identifier, timing, and error codes) to Google. The receipt image and the recognized text are never sent.
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
> - The AI engine extracts vendor and total, and picks up line items
> - The built-in rule engine (Tesseract) only extracts **date, total, and T+13 invoice number** by deterministic rules. **Vendor and items are left blank**. Raw OCR text is held internally but not auto-copied into the journal description
<!-- /only -->
<!-- only:apple -->
> **AI engine path vs built-in rule engine path**:
> - The AI engine extracts vendor and total, and picks up line items
> - Tesseract, one of the built-in rule engine's sub-engines, only extracts **date, total, and T+13 invoice number** by deterministic rules. **Vendor and items are left blank**
> - The OS's built-in text recognition, the other sub-engine, also extracts the **vendor** and **line items** on top of that. It returns the position and size of every word, so the largest line in the header is taken as the store name, and rows between the header and the total with a name on the left and an amount on the right are taken as items
> - For both paths, raw OCR text is held internally but not auto-copied into the journal description
<!-- /only -->
<!-- only:windows -->
> **AI engine path vs built-in rule engine path**:
> - The AI engine extracts vendor and total, and picks up line items
> - Tesseract, one of the built-in rule engine's sub-engines, only extracts **date, total, and T+13 invoice number** by deterministic rules. **Vendor and items are left blank**
> - The OS's built-in text recognition, the other sub-engine, also extracts the **vendor** and **line items** on top of that. It returns the position and size of every word, so the largest line in the header is taken as the store name, and rows between the header and the total with a name on the left and an amount on the right are taken as items
> - For both paths, raw OCR text is held internally but not auto-copied into the journal description
<!-- /only -->
<!-- only:android -->
> **AI engine path vs built-in rule engine path**:
> - The AI engine extracts vendor and total, and picks up line items
> - Tesseract, one of the built-in rule engine's sub-engines, only extracts **date, total, and T+13 invoice number** by deterministic rules. **Vendor and items are left blank**
> - On-device text recognition, the other sub-engine, also extracts the **vendor** and **line items** on top of that. It returns the position and size of every word, so the largest line in the header is taken as the store name, and rows between the header and the total with a name on the left and an amount on the right are taken as items
> - For both paths, raw OCR text is held internally but not auto-copied into the journal description
<!-- /only -->

#### Built-in rule engine warning banner

For built-in rule engine output, a caution banner appears below the result header. For Tesseract:

> Result from purely-local OCR (Tesseract). Please verify and correct the total, date and vendor before saving. OCR raw text is shown on screen only, not stored.
<!-- only:apple -->

For the OS's built-in text recognition:

> These results come from the OS's built-in text recognition. Please check and correct the total, date and vendor. The full OCR text is not saved to the notes field (it is only shown here).
<!-- /only -->
<!-- only:windows -->

For the OS's built-in text recognition:

> These results come from the OS's built-in text recognition. Please check and correct the total, date and vendor. The full OCR text is not saved to the notes field (it is only shown here).
<!-- /only -->
<!-- only:android -->

For on-device text recognition:

> These results come from on-device text recognition (ML Kit). Please check and correct the total, date and vendor. The full OCR text is not saved to the notes field (it is only shown here).
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

### AI engine (OpenAI-compatible / Ollama, LM Studio etc.)

- **Vision-capable model required** (text-only models fail on image input)
<!-- only:browser -->
- To point it at localhost, allow aoiko's public URL in Ollama's `OLLAMA_ORIGINS` setting
<!-- /only -->
<!-- only:native -->
- No extra setup needed for localhost either — the app relays the request
<!-- /only -->
<!-- only:apple -->

### AI engine (Apple Intelligence)

- No API key or endpoint setup needed. Appears when the device is supported, macOS 26 / iOS 26 or later, and the system setting is on
- Reading and structuring run entirely on-device; neither the image nor its contents are sent externally
- Always verify and correct manually
<!-- /only -->
<!-- only:browser -->

### AI engine (your browser's built-in AI)

- No API key or endpoint setup needed. Appears in the picker only when your browser already holds the AI model
- Images and text share one context window, so full-size images may not fit; they're downscaled before sending
- Always verify and correct manually
<!-- /only -->

### Built-in rule engine (Tesseract)

- Vendor and items are never extracted (those fields stay empty)
- T+13 invoice number is extracted by regex (`T` + 13 digits)
- Date and total are filled in only when the matching pattern is detected; otherwise the field stays empty. Always verify manually
<!-- only:browser -->
- The language data is served by aoiko itself and fetched over the network only on your first scan (no external communication afterwards)
<!-- /only -->
<!-- only:native -->
- The language data is bundled with the app itself, so there is no external communication, even on your first scan
<!-- /only -->
<!-- only:apple -->

### Built-in rule engine (the OS's built-in text recognition)

- No AI engine and no extra download
- On top of date, total and invoice number it also extracts the **vendor** and **line items**. Position and size come back per word, so the largest line in the header becomes the store name, and rows between the header and the total with a name on the left and an amount on the right become items. Misreadings pass straight through, so still check them
- The total is the rightmost amount on the line carrying the total keyword, so a layout that prints a quantity on the same line (`合計／ 1点 ¥159`) does not yield the quantity
- Phone numbers, register numbers and slip numbers also appear as "text on the left, digits on the right"; those rows, rows whose words contain separators, and rows whose left side is a date or digits only, are not treated as items
- Always verify the total and date
<!-- /only -->
<!-- only:windows -->

### Built-in rule engine (the OS's built-in text recognition)

- No AI engine and no extra download
- On top of date, total and invoice number it also extracts the **vendor** and **line items**. Position and size come back per word, so the largest line in the header becomes the store name, and rows between the header and the total with a name on the left and an amount on the right become items. Misreadings pass straight through, so still check them
- The total is the rightmost amount on the line carrying the total keyword, so a layout that prints a quantity on the same line (`合計／ 1点 ¥159`) does not yield the quantity
- Phone numbers, register numbers and slip numbers also appear as "text on the left, digits on the right"; those rows, rows whose words contain separators, and rows whose left side is a date or digits only, are not treated as items
- Always verify the total and date
<!-- /only -->
<!-- only:android -->

### Built-in rule engine (on-device text recognition)

- No AI engine and no extra download
- On top of date, total and invoice number it also extracts the **vendor** and **line items**. Position and size come back per word, so the largest line in the header becomes the store name, and rows between the header and the total with a name on the left and an amount on the right become items. Misreadings pass straight through, so still check them
- The total is the rightmost amount on the line carrying the total keyword, so a layout that prints a quantity on the same line (`合計／ 1点 ¥159`) does not yield the quantity
- Phone numbers, register numbers and slip numbers also appear as "text on the left, digits on the right"; those rows, rows whose words contain separators, and rows whose left side is a date or digits only, are not treated as items
- Always verify the total and date
<!-- /only -->
<!-- only:apple -->
- The leading `T` of the invoice number is sometimes dropped. Text recognition returns several candidates per word, so the candidates are searched in order for one matching `T` plus exactly 13 digits. If no candidate has the right digit count the field is left blank (a wrong number in the right format is one you cannot spot by looking)
- Whether this text recognition includes Japanese depends on the OS version, and it is already included in every macOS / iOS·iPadOS aoiko supports
<!-- /only -->
<!-- only:windows -->
- The leading `T` of the invoice number is sometimes dropped. Text recognition returns only one result per word, with no second candidate to fall back on. If it does not match `T` plus exactly 13 digits, the field is left blank (a wrong number in the right format is one you cannot spot by looking)
- **Not every device can use it.** It only enters the option set when Japanese text recognition is present on the OS side. This is re-checked every time the `Receipt` page opens, so adding Japanese text recognition on the OS side makes it selectable next time you open the page
<!-- /only -->
<!-- only:android -->
- The leading `T` of the invoice number is sometimes dropped. Text recognition returns only one result per word, with no second candidate to fall back on. If it does not match `T` plus exactly 13 digits, the field is left blank (a wrong number in the right format is one you cannot spot by looking)
<!-- /only -->

## 4. Troubleshooting

| Symptom | Action |
|---|---|
| Total is off | Retake or edit manually |
| Date is empty | Both `YYYY/MM/DD` and Reiwa-format were already tried. Manual entry is fine |
| Vendor garbled | Improve photo quality and resolution. Tesseract does not extract the vendor, so type it in |
| Invoice number not detected | Recapture with the number area well-lit |
| Connection error | Check API key / endpoint in Settings via **"Test connection"** |

## 5. Privacy notes

- If a receipt shows third-party personal information (customer names, addresses), reconsider sending to the AI engine
- See [PRIVACY_en.md](../../PRIVACY_en.md) for details

## 6. Next steps

- For order-page imports (Amazon / 楽天 etc.) → [05. Order import](05-order-import_en.md)
- Confirm and edit imported entries → [02. Creating journal entries](02-journal_en.md)