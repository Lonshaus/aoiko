# Security Policy

**Language**: [日本語](SECURITY.md) | **English** | [繁體中文](SECURITY_zh-TW.md)

aoiko is a pure-frontend BYOK (Bring Your Own Key) app. It has no servers; all sensitive user data stays inside the browser. This document outlines known risks, the support stance, and vulnerability reporting.

## Supported versions

Only the latest commit on the `master` branch is supported. Release tags are not yet in use (planned after Phase 4 is complete).

## Reporting a vulnerability

For confidential reports, please use **GitHub Security Advisories**:

1. From the repo's **Security** tab → **Report a vulnerability**
2. Include scope, reproduction steps, and expected impact
3. Do **not** report via a public issue

Public issues (e.g. incorrect account codes, UI bugs) can go through regular issues.

A response within 7 days is the goal but cannot be guaranteed (volunteer-based).

## Security design assumptions

### BYOK model

- The API keys / endpoint settings of the OCR/LLM engine (Google Gemini API / OpenAI-compatible / Tesseract) chosen by the user are **registered by the user and kept in the user's browser IndexedDB**
- The developer / distributor **does not obtain, transmit, or retain** the user's API keys or endpoint information
- External API requests are sent **directly from the user's browser to the chosen endpoint** (no proxy). Tesseract has no LLM API transmission at all

### Storage

- Bookkeeping data, API keys, and settings are all stored in **IndexedDB (on-device)**
- Backup: File System Access API (Chromium) / OPFS (Safari, Firefox) / manual JSON download
- **No transmission to any aoiko management server** (aoiko has no such server). When using LLM/OCR APIs, requests go only to the external endpoint configured by the user (Gemini / OpenAI-compatible / etc.)

## Known risks

### 1. No server-side audit log

- There are **no detection mechanisms** for unauthorized access or data leaks
- Device compromise = data leak

### 2. Browser storage leakage

- IndexedDB may be read by other users on the same device, malware, or browser extensions
- Personal information, transaction history, and API keys can be read directly
- Use on a business-only device and full-disk encryption are recommended

### 3. LLM API transmission content risk

- CSV rows / receipt images are sent according to the user's selected engine:
  - **Gemini** → `generativelanguage.googleapis.com` (handled per Google's data policy; training-use depends on plan)
  - **OpenAI-compatible** (Ollama etc.) → user-specified baseURL. No off-device transmission for localhost
  - **Tesseract** → no transmission (processed in WASM on-device; only traineddata fetched once)
- Always review content with high sensitivity before sending (a pre-send confirmation dialog is shown for external engines)
- LLM/OCR features are **opt-in via UI buttons** — no automatic transmission

### 4. PWA cache

- Old builds may be cached by the Service Worker
- There may be a delay before bug-fix versions propagate

## Hardening recommendations

- Enable full-disk encryption on the device
- Separate browser profiles for business and personal use
- Don't install untrusted browser extensions
- Run backups regularly
- **Always revoke** unused API keys on Google's side

## Dependency vulnerabilities

- `npm audit` in CI is planned (not yet implemented)
- High-severity CVEs are addressed promptly when found, but coverage is not guaranteed