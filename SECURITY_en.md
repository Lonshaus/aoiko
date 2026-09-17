# Security Policy

**Language**: [日本語](SECURITY.md) | **English** | [繁體中文](SECURITY_zh-TW.md)

aoiko is a pure-frontend BYOK (Bring Your Own Key) app. There is no aoiko server, and your bookkeeping data stays on your device. Content is sent to the engine you selected only when you explicitly start generative AI classification or OCR — and not even then if you chose an engine that runs entirely on the device. This document outlines known risks, the support stance, and vulnerability reporting.

## Official distribution sources

aoiko is officially distributed only from:

- Source code: <https://github.com/Lonshaus/aoiko>
- Online demo: <https://aoiko.pages.dev>
<!-- only:apple -->
- The App Store (macOS and iOS editions)
<!-- /only -->
<!-- only:windows -->
- The Microsoft Store (Windows edition)
<!-- /only -->
<!-- only:browser -->

If you obtained aoiko from anywhere else (an unfamiliar site, a packaged executable, etc.), **verify it against one of the above before entering an API key or any sensitive information**.
<!-- /only -->
<!-- only:native -->

If you obtained aoiko from outside the store, **verify it against one of the sources above before entering an API key or any sensitive information**.
<!-- /only -->

aoiko is published under AGPL-3.0, so anyone can legally fork it — but that doesn't rule out someone using the name to distribute phishing or malware under a confusingly similar guise. If in doubt, check authenticity against the GitHub repository's commit history and issues.

## Supported versions

<!-- only:browser -->
The published site (<https://aoiko.pages.dev>), which tracks the latest commit on the `master` branch, is the supported version.
<!-- /only -->
<!-- only:native -->
The latest release published in the stores is the supported version. For a report filed against an older release, you may be asked to confirm whether it still reproduces on the latest one.
<!-- /only -->

## Reporting a vulnerability

For confidential reports, please use **GitHub Security Advisories**:

1. From the repo's **Security** tab → **Report a vulnerability**
2. Include scope, reproduction steps, and expected impact
3. Do **not** report via a public issue

Public issues (e.g. incorrect account codes, UI bugs) can go through regular issues.

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
- The developer / distributor **does not obtain, transmit, or retain** the user's API keys or endpoint information
<!-- only:browser -->
- External API requests are sent **directly from the user's browser to the chosen endpoint** (no proxy). Engines that read on the device have no AI API transmission at all
<!-- /only -->
<!-- only:native -->
- External API requests are sent **by the app directly to the chosen endpoint** (there is no aoiko relay server). Engines that read on the device have no AI API transmission at all
<!-- /only -->

### Storage

- Bookkeeping data, API keys, and settings are all stored in **IndexedDB (on-device)**
<!-- only:browser -->
- Backup: a sync folder (File System Access API, on browsers that support it) / OPFS (the fallback on browsers that don't) / manual export
<!-- /only -->
<!-- only:native -->
- Backup: a sync folder (the app remembers one) / manual export
<!-- /only -->
- **No transmission to any aoiko management server** (aoiko has no such server). When using AI/OCR APIs, requests go only to the external endpoint configured by the user (Gemini / OpenAI-compatible / etc.)

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
- Use on a business-only device and full-disk encryption are recommended

### 3. AI API transmission content risk

- CSV rows / receipt images are sent according to the user's selected engine:
  - **Gemini** → `generativelanguage.googleapis.com` (handled per Google's data policy; training-use depends on plan)
  - **OpenAI-compatible** (Ollama etc.) → user-specified baseURL. No off-device transmission for localhost
  - **Tesseract** → no transmission (processed in WASM on-device; the language data ships with aoiko, so no external request is made)
<!-- only:browser -->
  - **The browser's built-in AI** → nothing sent by aoiko (where inference runs is decided by the browser's implementation, not necessarily on the device)
<!-- /only -->
<!-- only:native -->
  - **The OS's built-in text recognition** → no transmission (processed entirely on-device)
<!-- /only -->
<!-- only:apple -->
  - **Apple Intelligence** → no transmission (inference runs entirely on-device)
<!-- /only -->
- Always review content with high sensitivity before sending (a pre-send confirmation dialog is shown for external engines)
- AI/OCR features are **opt-in via UI buttons** — no automatic transmission

<!-- only:browser -->
### 4. PWA cache

- Old builds may be cached by the Service Worker
- There may be a delay before bug-fix versions propagate
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

- `npm audit` in CI is planned (not yet implemented)
- High-severity CVEs are addressed promptly when found, but coverage is not guaranteed