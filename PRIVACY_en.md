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
| Journal entries, lines, vendors, sub-accounts | IndexedDB | Not sent |
| Fixed assets, home-office allocation rules | IndexedDB | Not sent |
| Filed-year snapshots | IndexedDB | Not sent |
| Gemini API key | IndexedDB | Only when you start a generative-AI/OCR feature, sent to the Gemini API |
| OpenAI-compatible API key, baseURL | IndexedDB | Only when you start a generative-AI/OCR feature, sent to your specified baseURL (not sent off-device when localhost is specified) |
| Business profile (trade name, invoice number) | IndexedDB | Not sent |
| Backup folder handle | IndexedDB | Not sent |
| Import history (file hashes) | IndexedDB | Not sent |
<!-- only:browser -->

All of the above exists only locally on your device. **Clearing browser site data wipes it completely**.
<!-- /only -->
<!-- only:native -->

All of the above exists only locally on your device. **Uninstalling the app, or deleting its data, wipes it completely**.
<!-- /only -->

## Data sent off-device

### OCR / generative AI engines (optional, BYOK, selected in Settings)

Only when you **explicitly invoke** generative AI classification or receipt OCR, content is sent to the selected engine:

- **Vision generative AI path (Gemini / OpenAI-compatible)**: generative AI classification = CSV row text (amount, description, etc.) + chart of accounts. OCR = receipt image (Base64) + extraction prompt
- **Tesseract path (OCR only)**: no generative AI. The image is processed inside WASM on the device — never sent externally. `jpn.traineddata` / `eng.traineddata` are served by aoiko itself, so no external request is made
<!-- only:native -->
- **The OS's built-in text recognition path (OCR only)**: no generative AI. The image is processed on-device by the recognition your operating system provides — never sent externally. Nothing extra is downloaded either
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
| Tesseract (purely-local WASM OCR) | Image never leaves device. `jpn.traineddata` / `eng.traineddata` are bundled too | **None** (no external request is made) |
<!-- only:native -->
| The OS's built-in text recognition | Image never leaves device | **None** (no external request is made) |
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
- For **cloud (external) engines, a pre-send confirmation dialog** is shown
- Gemini: data handling follows Google's privacy policy and your API plan contract; whether data is used for training depends on your plan (free vs. paid)
- When using local (e.g. Ollama on localhost), data stays on-device (vision-capable model required for OCR). The engines that run entirely on the device send nothing either
- Tesseract: no generative AI is used. Extraction from WASM OCR text is deterministic (T+13 registration number, date, total only). Accuracy is limited; vendor and items are not guessed. Manual verification by the user is required
<!-- only:native -->
- The OS's built-in text recognition: no generative AI is used. Extraction from the OS recognition text is deterministic (T+13 registration number, date, total only). Vendor and items are not guessed. Manual verification by the user is required
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
| Manual export | The location you choose |
<!-- /only -->

**Nothing** is sent to any aoiko server.

## Cookies and trackers

- aoiko itself uses no cookies
- No third-party advertising or analytics tags
<!-- only:browser -->
- Referer header behavior follows your browser's defaults
<!-- /only -->

## Legal alignment

- Intended for use within Japan. The "Personal Information Handling Operator" requirement under the Personal Information Protection Act is considered **inapplicable** because aoiko's developer / distributor does not collect personal information from users.
- The user is responsible for managing third-party personal information (vendor names, customer names on receipts, etc.) that they handle via aoiko.
- Use in the EU is not contemplated; from a GDPR standpoint, with no data collected, the data-controller relevance is considered low.

## Change history

This policy may change without notice. Material changes can be tracked in the GitHub commit log.