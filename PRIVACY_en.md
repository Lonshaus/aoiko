# Privacy Policy

**Language**: [日本語](PRIVACY.md) | **English** | [繁體中文](PRIVACY_zh-TW.md)

aoiko is a pure-frontend app with **no servers**. As a rule, user data **never leaves your device**. This document spells out what data is collected and sent.

## Information collected: none

The developer / distributor **collects none of the following** from users:

- Personally identifiable information (name, address, phone, email)
- Bookkeeping data, journal entries, transaction history
- API keys, credentials
- Device information, IP address
- Usage analytics (telemetry, analytics)
- Cookies, local-storage trackers
<!-- only:apple -->

In-app purchases (the supporter feature) are processed by the store (App Store / Microsoft Store etc.) itself — payment details such as card numbers never reach aoiko. All that is stored on your device is one stamp per purchase (its design, the purchase date, and a purchase time used for ordering) and the supporter-badge purchase date; none of it identifies you personally.

The iOS edition's `PrivacyInfo.xcprivacy` declares tracking (NSPrivacyTracking) as false and lists no collected data types. The only required-reason API it declares is file-timestamp access (C617.1).
<!-- /only -->
<!-- only:windows -->

In-app purchases (the supporter feature) are processed by the store (App Store / Microsoft Store etc.) itself — payment details such as card numbers never reach aoiko. All that is stored on your device is one stamp per purchase (its design, the purchase date, and a purchase time used for ordering) and the supporter-badge purchase date; none of it identifies you personally.
<!-- /only -->
<!-- only:android -->

In-app purchases (the supporter feature) are processed by the store (Google Play) itself — payment details such as card numbers never reach aoiko. All that is stored on your device is one stamp per purchase (its design, the purchase date, and a purchase time used for ordering) and the supporter-badge purchase date; none of it identifies you personally.
<!-- /only -->
<!-- only:browser -->

The **HTTP access logs** of the host serving <https://aoiko.pages.dev> may exist per that service's policy. aoiko cannot control this.
<!-- /only -->

## Data stored on your device
<!-- only:browser -->

The following is stored in your browser's **IndexedDB** (database `aoiko`):
<!-- /only -->
<!-- only:native -->

The following is stored in the app's managed storage (database `aoiko`):
<!-- /only -->

| Data | Storage | Sent to |
|---|---|---|
| Journal entries, lines, chart of accounts, vendors, subaccounts | IndexedDB | Not sent |
| Fixed assets | IndexedDB | Not sent |
| Receipt photos (attached images) | IndexedDB | Not sent (no screen to update or delete them; always included in backups) |
| Per-account home-office allocation ratios (in settings) | IndexedDB | Not sent |
| Invoices and quotes | IndexedDB | Not sent |
| Simple inventory item master | IndexedDB | Not sent |
| Budgets | IndexedDB | Not sent |
| Receivables and payables | IndexedDB | Not sent |
| Income and tax deduction inputs (names, ages, and income of dependents and family employees; the spouse's income and age; disability, single-parent, and similar statuses; salary, pension, and other income; medical expenses and insurance premiums; names and addresses of real-estate payees, etc.) | IndexedDB | Not sent (always included in backups) |
| CSV-import classification rules | IndexedDB | Not sent |
| Filed-year snapshots | IndexedDB | Not sent |
<!-- only:native -->
| Stamps (design and purchase date/time) and the supporter-badge purchase date | IndexedDB | Not sent (excluded from backup; kept as-is across restore) |
<!-- /only -->
| Gemini API key | IndexedDB | When you start generative AI classification, OCR, or order import (via the confirmation dialog), and also when you press "Fetch model list" (which also saves the key) or "Test connection" in Settings (these two skip the dialog), sent to the Gemini API as a URL query parameter. Not included in backups by default (turning on "Include API keys in backups" writes it in plain text; restoring a backup without it removes the key from the device, so you need to enter it again) |
| OpenAI-compatible API key, baseURL | IndexedDB | When you start generative AI classification, OCR, or order import (via the confirmation dialog), and also when you press "Fetch model list" or "Test connection" in Settings (these two skip the dialog; "Save" sends nothing), sent to your specified baseURL via an `Authorization: Bearer` header (not sent off-device when localhost is specified). In backups the API key is handled like the Gemini API key (the baseURL is always included) |
| Business profile (trade name, invoice registration number) | IndexedDB | Not sent |
| Filer info (user identification number, name, address, tax office) | IndexedDB | Not sent (whether backups include it is set by "Include filer info (user identification number, name, address, tax office)", off by default; restoring a backup without it keeps the filer info already on the device) |
| Backup folder handle | IndexedDB | Not sent |
| Import history (file hashes) | IndexedDB | Not sent |
<!-- only:browser -->

Besides these, the display language is kept in localStorage, and short-lived hand-offs such as the result notice right after a backup restore and the destination when moving between screens are kept in sessionStorage. sessionStorage is cleared when the tab is closed, but if the browser restores a closed tab or a previous session, its contents may come back as well. None of this is sent.
<!-- /only -->
<!-- only:native -->

Besides these, the display language is kept in localStorage, and short-lived hand-offs such as the result notice right after a backup restore and the destination when moving between screens are kept in sessionStorage (cleared when the app is closed). None of this is sent.
<!-- /only -->
<!-- only:browser -->

The browser edition also keeps the app's own files (so it works offline) and, if you use Tesseract, its recognition program and language data in Cache Storage. All of the above exists only locally on your device. **Clearing browser site data wipes it completely**.
<!-- /only -->
<!-- only:native -->

All of the above exists only locally on your device. **Deleting the app's data wipes it completely**.
<!-- /only -->
<!-- only:windows -->

Uninstalling the app deletes the data too.
<!-- /only -->
<!-- only:apple -->

On iPhone and iPad, deleting the app deletes the data too. On a Mac, the storage area remains after you delete the app.
<!-- /only -->
<!-- only:android -->

On Android, uninstalling the app deletes the data too.
<!-- /only -->

## Data sent off-device

### OCR / generative AI engines (optional, BYOK, selected in Settings)

When you **explicitly invoke** generative AI classification, receipt OCR, or order import, and also when you press "Fetch model list" (for Gemini this also saves the API key) or "Test connection" in Settings, content or the API key is sent to the selected engine (the OpenAI-compatible "Save" button sends nothing):

- **Vision-capable generative AI path (Gemini / OpenAI-compatible)**: generative AI classification = the description and amount of each CSV-import row that is not marked "Skip" and has no counterpart account yet, plus the import source's account code and side and the list of candidate counterpart accounts (code, name, category). OCR = receipt image (Base64) + extraction prompt (images whose long edge exceeds 2048px are downscaled and re-encoded as JPEG before sending, unless that does not make them smaller; anything else is sent as the original file, so any Exif data such as the shooting date and location goes with it). Order import = the full pasted text (including the delivery name, address, phone number, etc. if they were in the part you pasted) + extraction prompt
<!-- only:browser -->
- **Tesseract path (OCR only)**: no generative AI. The image is processed inside WASM on the device — never sent externally. The recognition program (worker and WASM) and the Japanese language data (`jpn.traineddata`) are fetched from aoiko's own server (<https://aoiko.pages.dev>) the first time you read a receipt with Tesseract, stored in the browser's Cache Storage, and reused after that. No request goes anywhere other than aoiko's own server
<!-- /only -->
<!-- only:native -->
- **Tesseract path (OCR only)**: no generative AI. The image is processed inside WASM on the device — never sent externally. The recognition program and the Japanese language data (`jpn.traineddata`) are built into the app, so no request is made
<!-- /only -->
<!-- only:apple -->
- **The OS's built-in text recognition path (OCR only)**: no generative AI. The image is processed on-device by the recognition your operating system provides; aoiko guesses the vendor from the text and writes it to the description field. Item names are guessed too, but shown on screen only — never written to the journal entry. Nothing extra is downloaded either
<!-- /only -->
<!-- only:windows -->
- **The OS's built-in text recognition path (OCR only)**: no generative AI. The image is processed on-device by the recognition your operating system provides; aoiko guesses the vendor from the text and writes it to the description field. Item names are guessed too, but shown on screen only — never written to the journal entry. Nothing extra is downloaded either
<!-- /only -->
<!-- only:android -->
- **On-device text recognition path (OCR only)**: no generative AI. The image is processed on-device by ML Kit, which is bundled with the app; aoiko guesses the vendor from the text and writes it to the description field. Item names are guessed too, but shown on screen only — never written to the journal entry. Nothing extra is downloaded, but ML Kit, which performs the recognition, sends usage information (device model, app version, a per-install identifier, timing, and error codes) to Google. The receipt image and the recognized text are not sent
<!-- /only -->
<!-- only:apple -->
- **Apple Intelligence path (generative AI classification and OCR alike)**: inference runs entirely on the device and neither images nor text are sent externally. Nothing extra is downloaded either
<!-- /only -->
<!-- only:browser -->
- **Your browser's built-in AI path (generative AI classification and OCR alike)**: aoiko itself sends nothing, but whether inference runs on the device or in an external service is decided by the browser's implementation (the API specification permits cloud-backed implementations, so aoiko cannot guarantee the content stays on the device). This engine can be used only when your browser already holds the AI model — aoiko never fetches that model itself
<!-- /only -->

| Engine (selected in Settings) | Destination | Off-device transmission |
|---|---|---|
| Google Gemini (default) | `generativelanguage.googleapis.com` | Yes (cloud) |
| OpenAI-compatible / Ollama etc. when localhost | On-device (e.g. `http://localhost:11434`) | **None** |
| OpenAI-compatible / Ollama etc. when remote | The host you specified | Yes |
<!-- only:browser -->
| Tesseract (purely local WASM OCR) | The image never leaves the device. The program and `jpn.traineddata` are fetched from aoiko's own server on first use and stored | **None** (no request goes anywhere other than aoiko's own server) |
<!-- /only -->
<!-- only:native -->
| Tesseract (purely local WASM OCR) | The image never leaves the device. `jpn.traineddata` is built into the app | **None** (no request is made) |
<!-- /only -->
<!-- only:apple -->
| The OS's built-in text recognition | The image never leaves the device | **None** (no external request is made) |
<!-- /only -->
<!-- only:windows -->
| The OS's built-in text recognition | The image never leaves the device | **None** (no external request is made) |
<!-- /only -->
<!-- only:android -->
| On-device text recognition | The image and text never leave the device | **Image and text: none** (ML Kit's usage information alone is sent to Google) |
<!-- /only -->
<!-- only:apple -->
| Apple Intelligence | Images and text never leave the device | **None** (no external request is made) |
<!-- /only -->
<!-- only:browser -->
| Your browser's built-in AI | Decided by the browser's implementation (not necessarily on the device). Usable only when your browser already holds the AI model (aoiko never fetches it) | None from aoiko. **Whether the browser sends it externally is something aoiko cannot guarantee** |
<!-- /only -->
<!-- only:browser -->

- Requests go **directly** from your browser to the destination — aoiko has no management server in the path
<!-- /only -->
<!-- only:native -->
- Requests go **directly** from the app to the destination — aoiko has no management server in the path
<!-- /only -->
- For **cloud (external) engines, a pre-send confirmation dialog** is shown. You can turn it off with the setting's checkbox or "Don't ask again" in each dialog, but this is a single setting: it applies to generative AI classification, receipt OCR, and order import alike, and also to sending after you later change the engine or destination. The setting is included in backups and carried over on restore. "Restore hidden confirmations" in Settings turns the dialog back on
- Gemini: data handling follows Google's privacy policy and your API plan contract; whether data is used for training depends on your plan (free vs. paid)
<!-- only:browser -->
- When using a local engine (e.g. Ollama on localhost), data stays on the device (vision-capable model required for OCR). The engines that run entirely on the device send nothing either
<!-- /only -->
<!-- only:apple -->
- When using a local engine (e.g. Ollama on localhost), data stays on the device (vision-capable model required for OCR). The engines that run entirely on the device send nothing either
<!-- /only -->
<!-- only:windows -->
- When using a local engine (e.g. Ollama on localhost), data stays on the device (vision-capable model required for OCR). The engines that run entirely on the device send nothing either
<!-- /only -->
<!-- only:android -->
- When using a local engine (e.g. Ollama on localhost), data stays on the device (vision-capable model required for OCR). Tesseract sends nothing. On-device text recognition doesn't send images or text, but usage information is sent to Google
<!-- /only -->
- Tesseract: no generative AI is used. Extraction from WASM OCR text is rule-based (T+13-digit registration number, date, total only). Vendor and items are not guessed. Manual verification by the user is required
<!-- only:apple -->
- The OS's built-in text recognition: no generative AI is used. Extraction from the OS recognition text is rule-based (T+13-digit registration number, date, total). In addition, aoiko guesses the vendor and writes it to the description field; item names are guessed too but shown on screen only, never written to the journal entry. Manual verification by the user is required
<!-- /only -->
<!-- only:windows -->
- The OS's built-in text recognition: no generative AI is used. Extraction from the OS recognition text is rule-based (T+13-digit registration number, date, total). In addition, aoiko guesses the vendor and writes it to the description field; item names are guessed too but shown on screen only, never written to the journal entry. Manual verification by the user is required
<!-- /only -->
<!-- only:android -->
- On-device text recognition: no generative AI is used. Extraction from the text recognized by ML Kit, which is bundled with the app, is rule-based (T+13-digit registration number, date, total). In addition, aoiko guesses the vendor and writes it to the description field; item names are guessed too but shown on screen only, never written to the journal entry. Manual verification by the user is required. ML Kit, which performs the recognition, sends usage information to Google, but the image and the recognized text are not sent
<!-- /only -->
<!-- only:apple -->
- Apple Intelligence: inference runs on the device and none of your data is sent externally. It appears as an option only when this device supports Apple Intelligence
<!-- /only -->
<!-- only:browser -->
- Your browser's built-in AI: aoiko never sends your data anywhere, but whether inference runs on the device is up to the browser's implementation (the specification permits cloud-backed implementations). This engine can be used only when your browser already holds the AI model, and whether or when the browser obtains that model is outside aoiko's control
<!-- /only -->

### Backup (your choice)

| Method | Destination |
|---|---|
<!-- only:browser -->
| A sync folder (File System Access API, on browsers that support it) | The **local** folder you choose |
| OPFS (the fallback on browsers that don't) | Browser-managed **on-device** storage |
| Manual export | Your "Downloads" folder |
<!-- /only -->
<!-- only:native -->
| A sync folder (the app remembers one) | The **local** folder you choose |
<!-- /only -->
<!-- only:windows -->
| Manual export | The location you choose |
<!-- /only -->
<!-- only:apple -->
| Manual export | On a Mac, the location you choose. On iPhone and iPad there is no location picker; the file is saved to this app's Documents folder (you can get it from the Files app) |
<!-- /only -->
<!-- only:android -->
| Manual export | The location you choose |
<!-- /only -->

<!-- only:browser -->
**Nothing** is sent to any aoiko server. However, if the backup destination is inside a folder synced by Google Drive, iCloud Drive, Dropbox, OneDrive, or a similar service, that service's sync app uploads the backup to the service. Backups contain your receipt photos and, if you chose to include them, your API keys (in plain text) and filer info.
<!-- /only -->
<!-- only:apple -->
**Nothing** is sent to any aoiko server. However, if the backup destination is inside a folder synced by Google Drive, iCloud Drive, Dropbox, OneDrive, or a similar service, that service's sync app uploads the backup to the service. Backups contain your receipt photos and, if you chose to include them, your API keys (in plain text) and filer info.
<!-- /only -->
<!-- only:windows -->
**Nothing** is sent to any aoiko server. However, if the backup destination is inside a folder synced by Google Drive, iCloud Drive, Dropbox, OneDrive, or a similar service, that service's sync app uploads the backup to the service. Backups contain your receipt photos and, if you chose to include them, your API keys (in plain text) and filer info.
<!-- /only -->
<!-- only:android -->
**Nothing** is sent to any aoiko server. However, if the backup destination is inside a folder synced by a cloud service, that service's sync app uploads the backup to the service. Backups contain your receipt photos and, if you chose to include them, your API keys (in plain text) and filer info.
<!-- /only -->

## Cookies and trackers

- aoiko itself uses no cookies
- No third-party advertising or analytics tags
<!-- only:browser -->
- aoiko's server sends `Referrer-Policy: no-referrer`, so requests from aoiko to outside services (such as AI APIs) and links you open from aoiko carry no Referer header
<!-- /only -->

## Legal alignment

- Intended for use within Japan. The "personal information handling business operator" requirement under the Act on the Protection of Personal Information is considered **not applicable** because aoiko's developer / distributor does not collect personal information from users.
- The user is responsible for managing third-party personal information (vendor names, customer names on receipts, etc.) that they handle via aoiko.
- Use in the EU is not contemplated; aoiko is unlikely to count as a data controller under the GDPR, since no data is collected.

## Change history

This policy may change without notice. Material changes can be tracked in aoiko's CHANGELOG.