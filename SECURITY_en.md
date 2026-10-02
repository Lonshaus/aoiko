# Security Policy

**Language**: [日本語](SECURITY.md) | **English** | [繁體中文](SECURITY_zh-TW.md)
<!-- only:browser -->

aoiko is a pure-frontend BYOK (Bring Your Own Key) app. There is no aoiko server, and your bookkeeping data stays on your device. Content and API keys are sent to the engine you selected when you explicitly start generative AI classification or OCR, and also when you save an API key, fetch the model list, or test the connection (nothing is sent if you chose an engine that runs entirely on the device). This document outlines known risks, the support stance, and vulnerability reporting.
<!-- /only -->
<!-- only:apple -->

aoiko is a pure-frontend BYOK (Bring Your Own Key) app. There is no aoiko server, and your bookkeeping data stays on your device. Content and API keys are sent to the engine you selected when you explicitly start generative AI classification or OCR, and also when you save an API key, fetch the model list, or test the connection (nothing is sent if you chose an engine that runs entirely on the device). This document outlines known risks, the support stance, and vulnerability reporting.
<!-- /only -->
<!-- only:windows -->

aoiko is a pure-frontend BYOK (Bring Your Own Key) app. There is no aoiko server, and your bookkeeping data stays on your device. Content and API keys are sent to the engine you selected when you explicitly start generative AI classification or OCR, and also when you save an API key, fetch the model list, or test the connection (nothing is sent if you chose an engine that runs entirely on the device). This document outlines known risks, the support stance, and vulnerability reporting.
<!-- /only -->
<!-- only:android -->

aoiko is a pure-frontend BYOK (Bring Your Own Key) app. There is no aoiko server, and your bookkeeping data stays on your device. Content and API keys are sent to the engine you selected when you explicitly start generative AI classification or OCR, and also when you save an API key, fetch the model list, or test the connection (nothing is sent if you choose Tesseract; with on-device text recognition or on-device Gemini Nano, images and text are not sent, but usage information is sent to Google). This document outlines known risks, the support stance, and vulnerability reporting.
<!-- /only -->

## Official distribution sources

aoiko is officially distributed only from:

- Online demo: <https://aoiko.pages.dev>
<!-- only:apple -->
- The App Store (macOS and iOS editions)
<!-- /only -->
<!-- only:windows -->
- The Microsoft Store (Windows edition)
<!-- /only -->
<!-- only:android -->
- Google Play (Android edition)
<!-- /only -->
<!-- only:browser -->

If you obtained aoiko from anywhere else (an unfamiliar site, a packaged executable, etc.), **verify it against the online demo above before entering an API key or any sensitive information**.
<!-- /only -->
<!-- only:native -->

If you obtained aoiko from outside the store, **verify it against one of the sources above before entering an API key or any sensitive information**.
<!-- /only -->

Beware of phishing or malware distributed under the aoiko name or a confusingly similar name. If in doubt, check authenticity against the official distribution sources listed above.

## Supported versions
<!-- only:browser -->

The version published at <https://aoiko.pages.dev> is the supported version.
<!-- /only -->
<!-- only:native -->
The latest release published in the stores is the supported version. For a report filed against an older release, you may be asked to confirm whether it still reproduces on the latest one.
<!-- /only -->

## Reporting a vulnerability

For confidential reports, please use **GitHub Security Advisories**:

1. From the repo's **Security** tab → **Report a vulnerability**
2. Include scope, reproduction steps, and expected impact
3. Do **not** report via a public issue

Issues that are not security-sensitive (e.g. incorrect account codes, UI bugs) can be filed as regular public issues.

A response within 7 days is the goal but cannot be guaranteed (volunteer-based).

## Security design assumptions

### BYOK model
<!-- only:browser -->

- The API keys / endpoint settings of the OCR/AI engine (Google Gemini API / OpenAI-compatible / Tesseract / the browser's built-in AI) chosen by the user are **registered by the user and kept in the user's browser IndexedDB** (Tesseract and the browser's built-in AI need neither a key nor any setting)
<!-- /only -->
<!-- only:apple -->
- The API keys / endpoint settings of the OCR/AI engine (Google Gemini API / OpenAI-compatible / Tesseract / the OS's built-in text recognition / Apple Intelligence) chosen by the user are **registered by the user and kept in the app's managed storage** (Tesseract, the OS's built-in text recognition and Apple Intelligence need neither a key nor any setting)
<!-- /only -->
<!-- only:windows -->
- The API keys / endpoint settings of the OCR/AI engine (Google Gemini API / OpenAI-compatible / Tesseract / the OS's built-in text recognition) chosen by the user are **registered by the user and kept in the app's managed storage** (Tesseract and the OS's built-in text recognition need neither a key nor any setting)
<!-- /only -->
<!-- only:android -->
- The API keys / endpoint settings of the OCR/AI engine (Google Gemini API / OpenAI-compatible / Tesseract / on-device text recognition / on-device Gemini Nano) chosen by the user are **registered by the user and kept in the app's managed storage** (Tesseract, on-device text recognition, and on-device Gemini Nano need neither a key nor any setting)
<!-- /only -->
- The developer / distributor **does not obtain, transmit, or retain** the user's API keys or endpoint information
<!-- only:browser -->
- External API requests are sent **directly from the user's browser to the chosen endpoint** (no proxy). Engines that run on the device make no AI API requests
<!-- /only -->
<!-- only:apple -->
- External API requests are sent **by the app directly to the chosen endpoint** (there is no aoiko relay server). Engines that run on the device make no AI API requests
<!-- /only -->
<!-- only:windows -->
- External API requests are sent **by the app directly to the chosen endpoint** (there is no aoiko relay server). Engines that run on the device make no AI API requests
<!-- /only -->
<!-- only:android -->
- External API requests are sent **by the app directly to the chosen endpoint** (there is no aoiko relay server). Engines that run on the device make no AI API (Gemini / OpenAI-compatible) requests. When you use on-device text recognition or on-device Gemini Nano, however, ML Kit sends usage information to Google in each case (never the image or text content)
<!-- /only -->

### Storage

- Bookkeeping data, API keys, and settings are all stored in **IndexedDB (on-device)**
<!-- only:browser -->
- Backup: a sync folder (File System Access API, on browsers that support it) / OPFS (the fallback on browsers that don't) / manual export
<!-- /only -->
<!-- only:native -->
- Backup: a sync folder (the app remembers one) / manual export
<!-- /only -->
<!-- only:browser -->
- **No transmission to any aoiko management server** (aoiko has no such server). When using AI/OCR APIs, requests go only to the external endpoint configured by the user (Gemini / OpenAI-compatible / etc.)
<!-- /only -->
<!-- only:apple -->
- **No transmission to any aoiko management server** (aoiko has no such server). When using AI/OCR APIs, requests go only to the external endpoint configured by the user (Gemini / OpenAI-compatible / etc.)
<!-- /only -->
<!-- only:windows -->
- **No transmission to any aoiko management server** (aoiko has no such server). When using AI/OCR APIs, requests go only to the external endpoint configured by the user (Gemini / OpenAI-compatible / etc.)
<!-- /only -->
<!-- only:android -->
- **No transmission to any aoiko management server** (aoiko has no such server). When using AI/OCR APIs, requests go only to the external endpoint configured by the user (Gemini / OpenAI-compatible / etc.). When you use on-device text recognition or on-device Gemini Nano, ML Kit separately sends usage information to Google
<!-- /only -->

## Known risks

### 1. No server-side audit log

- There are **no detection mechanisms** for unauthorized access or data leaks
- Device compromise = data leak

### 2. On-device storage leakage
<!-- only:browser -->

- IndexedDB may be read by other users on the same device, malware, or browser extensions
<!-- /only -->
<!-- only:native -->

- The app's storage may be read by other users on the same device or by malware
<!-- /only -->
- Personal information, transaction history, and API keys can be read directly
- Using a business-only device and enabling full-disk encryption are recommended

### 3. AI API transmission content risk

- CSV rows / receipt images are sent according to the user's selected engine:
  - **Gemini** → `generativelanguage.googleapis.com` (handled per Google's data policy; whether it is used for training depends on your plan)
  - **OpenAI-compatible** (Ollama etc.) → user-specified baseURL. No off-device transmission for localhost
  - **Tesseract** → no transmission (processed in WASM on-device; the language data ships with aoiko, so no external request is made)
<!-- only:browser -->
  - **The browser's built-in AI** → nothing sent by aoiko (where inference runs is decided by the browser's implementation, not necessarily on the device)
<!-- /only -->
<!-- only:apple -->
  - **The OS's built-in text recognition** → no transmission (processed entirely on-device)
<!-- /only -->
<!-- only:windows -->
  - **The OS's built-in text recognition** → no transmission (processed entirely on-device)
<!-- /only -->
<!-- only:android -->
  - **On-device text recognition** → no image or text transmission (processed on-device; ML Kit, which performs the recognition, sends usage information to Google)
  - **On-device Gemini Nano** → no image or text transmission (processed on-device; ML Kit sends usage information to Google)
<!-- /only -->
<!-- only:apple -->
  - **Apple Intelligence** → no transmission (inference runs entirely on-device)
<!-- /only -->
- Always review content with high sensitivity before sending (a pre-send confirmation dialog is shown for external engines; skippable via a setting)
- AI/OCR features and their API-key saving, model listing, and connection testing are all **actions you take** (UI buttons) — no automatic transmission
<!-- only:browser -->

### 4. PWA cache

- If an old build is still cached by the Service Worker, there can be a delay before a bug-fix version reaches you
<!-- /only -->

## Hardening recommendations

- Enable full-disk encryption on the device
<!-- only:browser -->
- Separate browser profiles for business and personal use
- Don't install untrusted browser extensions
<!-- /only -->
- Run backups regularly
- **Always revoke** unused API keys on Google's side

## Dependency vulnerabilities

- High-severity CVEs are addressed promptly when found, but coverage is not guaranteed