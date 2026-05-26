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

The hosting provider's **HTTP access logs** (e.g. GitHub Pages / Vercel / Cloudflare Pages when published) may exist per that service's policy. aoiko cannot control this.

## Data stored on your device

The following is stored in your browser's **IndexedDB** (database `aoiko`):

| Data | Storage | Sent to |
|---|---|---|
| Journal entries, lines, vendors, sub-accounts | IndexedDB | Not sent |
| Fixed assets, home-office allocation rules | IndexedDB | Not sent |
| Filed-year snapshots | IndexedDB | Not sent |
| Gemini API key | IndexedDB | Only when you start an LLM/OCR feature, sent to the Gemini API |
| OpenAI-compatible API key, baseURL | IndexedDB | Only when you start an LLM/OCR feature, sent to your specified baseURL (not sent off-device when localhost is specified) |
| Business profile (trade name, invoice number) | IndexedDB | Not sent |
| Backup folder handle | IndexedDB | Not sent |
| Import history (file hashes) | IndexedDB | Not sent |

All of the above exists only locally on your device. **Clearing browser site data wipes it completely**.

## Data sent off-device

### OCR / LLM engines (optional, BYOK, selected in Settings)

Only when you **explicitly invoke** LLM classification or receipt OCR, content is sent to the selected engine:

- **Vision LLM path (Gemini / OpenAI-compatible)**: LLM classification = CSV row text (amount, description, etc.) + chart of accounts. OCR = receipt image (Base64) + extraction prompt
- **Tesseract path (OCR only)**: no LLM. The image is processed inside WASM on the device — never sent externally. Only `jpn.traineddata` / `eng.traineddata` are fetched once from the CDN (the image is not sent)

| Engine (selected in Settings) | Destination | Off-device transmission |
|---|---|---|
| Google Gemini (default) | `generativelanguage.googleapis.com` | Yes (cloud) |
| OpenAI-compatible / Ollama etc. when localhost | On-device (e.g. `http://localhost:11434`) | **None** |
| OpenAI-compatible / Ollama etc. when remote | The host you specified | Yes |
| Tesseract (purely-local WASM OCR) | Image never leaves device. Only `jpn.traineddata` / `eng.traineddata` fetched once from CDN (self-host configurable, fully offline possible) | **None for images** (only traineddata DL) |

- Requests go **directly** from your browser to the destination — aoiko has no management server in the path
- For **cloud (external) engines, a pre-send confirmation dialog** is shown
- Gemini: data handling follows Google's privacy policy and your API plan contract; whether data is used for training depends on your plan (free vs. paid)
- When using local (e.g. Ollama on localhost), data stays on-device — the most privacy-protective option (vision-capable model required for OCR)
- Tesseract: no LLM is used. Extraction from WASM OCR text is deterministic (T+13 registration number, date, total only). Accuracy is limited; vendor and items are not guessed. Manual verification by the user is required

### Backup (your choice)

| Method | Destination |
|---|---|
| File System Access API (Chromium) | The **local** folder you choose |
| OPFS (Safari / Firefox) | Browser-managed **on-device** storage |
| Manual JSON download | Your "Downloads" folder |
| Google Drive sync (future) | Your Google Drive |

**Nothing** is sent to any aoiko server.

## Cookies and trackers

- aoiko itself uses no cookies
- No third-party advertising or analytics tags
- Referer header behavior follows your browser's defaults

## Legal alignment

- Intended for use within Japan. The "Personal Information Handling Operator" requirement under the Personal Information Protection Act is considered **inapplicable** because aoiko's developer / distributor does not collect personal information from users.
- The user is responsible for managing third-party personal information (vendor names, customer names on receipts, etc.) that they handle via aoiko.
- Use in the EU is not contemplated; from a GDPR standpoint, with no data collected, the data-controller relevance is considered low.

## Change history

This policy may change without notice. Material changes can be tracked in the GitHub commit log.