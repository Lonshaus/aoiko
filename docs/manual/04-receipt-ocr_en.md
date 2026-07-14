# 04. Receipt OCR

Generate journal candidates from photos or images of paper receipts.

**Language**: [日本語](04-receipt-ocr.md) | **English** | [繁體中文](04-receipt-ocr_zh-TW.md)

> **By the end of this chapter you can**
> - Extract date, vendor, total, and qualified invoice registration number from a receipt and turn it into a journal entry
> - Choose between the three OCR engines (Gemini / OpenAI-compatible / Tesseract)
> - Understand the pre-send confirmation dialog and the "don't ask again" toggle
>
> **Prerequisites**: OCR/LLM engine is configured per [01. § 7](01-setup_en.md#7-prepare-ocr--llm-if-needed).

## 1. Picking an engine (summary)

| Engine | Accuracy | Off-device transmission | Required |
|---|---|---|---|
| **Gemini Vision** (default) | ◎ | Yes | Gemini API key |
| **OpenAI-compatible** (Ollama etc.) | ◯〜◎ | None for localhost / Yes for remote | Endpoint + vision model |
| **Tesseract** | △ | None (only `traineddata` first-fetch from CDN) | Just select in Settings |

> Detailed setup is in [01. § 7](01-setup_en.md#7-prepare-ocr--llm-if-needed).

## 2. Import flow

Click **"Receipts"** in the navigation to open `Receipt`.

### 2-1. Choose an image

Click the file input under **"1. Choose an image (camera also OK)"**:

- PC: pick JPG / PNG / WebP / HEIC from the file dialog
- Phone (PWA installed): the camera option appears, take a photo on the spot

The chosen image is shown as a preview.

> **Capture tips**:
> - Flat surface, avoid shadows
> - Whole receipt in frame
> - Avoid fluorescent-light glare
> - 1–2 MP is plenty for a normal receipt; higher resolution is counterproductive vs. LLM rate limits

### 2-2. Analyze

Click **"Analyze"** to send to the selected engine.

#### Cloud engines (Gemini / remote OpenAI-compatible): pre-send confirmation

Because data leaves the device, **CloudSendConfirmDialog** appears:

> Send image to 〇〇?
>
> ☐ Don't ask again

- **"Send"** to proceed
- **"Cancel"** to abort
- Checking "Don't ask again" before "Send" skips this dialog for all future external sends (one flag shared by OCR, CSV, and order-import LLM sends)

> **Think twice before checking**: this is stored as IndexedDB `skipExternalSendConfirm: true` (a single flag across engines) and there is no settings UI to undo it. If you checked it by mistake, delete that key with your browser's developer tools (IndexedDB → `aoiko` database → `settings` table). "Settings → Data management → Delete all data" also clears it but wipes your books — last resort only.

#### Tesseract: no dialog

WASM-on-device, so no confirmation. The first run downloads `traineddata` (several MB) from CDN.

### 2-3. Review and edit the extracted result

When done, **"2. Extracted result (editable)"** expands below:

| Field | Content |
|---|---|
| Transaction date | Receipt date, `YYYY-MM-DD` |
| Vendor | Store name (editable) |
| Total amount (¥) | Tax-inclusive total (editable, integer) |
| Invoice number | Shown only when a T+13 number is recognized (informational) |
| Items | Collapsible list if any (informational; not reflected in the entry) |

> **Vision LLM vs Tesseract**:
> - Vision LLM extracts vendor and total at high accuracy, and picks up line items
> - Tesseract only extracts **date, total, and T+13 invoice number** by deterministic rules. **Vendor and items are left blank**. Raw OCR text is held internally but not auto-copied into the journal description

#### Tesseract warning banner

For Tesseract output, a yellow caution banner appears below the result header:

> Result from purely-local OCR (Tesseract). Accuracy is limited; please verify and correct the total, date, and vendor before saving.

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

### Gemini Vision

- Free tier covers hundreds of receipts per month easily; receipts are token-light
- Tolerant of slight tilt and partial shadow
- 1–2 MP is enough; higher resolution slows things down and costs more

### OpenAI-compatible (Ollama / LM Studio etc.)

- **Vision-capable model required** (text-only models fail on image input)
- Recommended: `llama3.2-vision`, `qwen2-vl-7b`, `minicpm-v` family
- On the Ollama side: add aoiko's URL (e.g. `http://localhost:31527`) to `OLLAMA_ORIGINS`
- aoiko itself must run locally too (`npm run preview`); HTTPS-served aoiko can't reach localhost

### Tesseract

- The choice when **vision LLM is unavailable or undesired**
- Accept that vendor and items will be empty; this is by design
- T+13 invoice number is rock-solid (extracted by regex)
- Date and total are best-effort. Always verify manually
- For fully offline operation, set the `traineddata` URL to a self-hosted location in Settings

## 4. Troubleshooting

| Symptom | Action |
|---|---|
| Total is off | Retake or edit manually. LLM rarely; Tesseract often (expected) |
| Date is empty | Try both `YYYY/MM/DD` and Reiwa-format printing. Manual entry is fine |
| Vendor garbled | LLM: improve photo quality. Tesseract: vendor extraction isn't supported, type it in |
| Invoice number not detected | Recapture with the number area well-lit. LLM can pick up even tiny print |
| Connection error | Check API key / endpoint in Settings via **"Test connection"** |

## 5. Privacy notes

- If a receipt shows third-party personal information (customer names, addresses), reconsider sending to a cloud engine
- For highly confidential receipts (personal medical bills, sensitive client transactions), prefer Tesseract or Ollama on localhost
- See [PRIVACY_en.md](../../PRIVACY_en.md) for details

## 6. Next steps

- For order-page imports (Amazon / 楽天 etc.) → [05. Order import](05-order-import_en.md)
- Confirm and edit imported entries → [02. Creating journal entries § 2-3](02-journal_en.md)