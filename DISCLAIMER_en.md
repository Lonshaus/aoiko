# Disclaimer

**Language**: [日本語](DISCLAIMER.md) | **English** | [繁體中文](DISCLAIMER_zh-TW.md)

aoiko is a tool that helps Japanese sole proprietors with blue return (青色申告) and white return (白色申告) bookkeeping. By using aoiko, you agree to the following.

## 1. Use at your own risk

- The **accuracy is not guaranteed** for any figures, books, or `.xtx` files produced by aoiko.
- The developer assumes **no liability** for any damages (back taxes, penalty taxes including the understatement penalty, delinquency tax, or otherwise) arising from a final tax return, amended return, or tax audit response.
- Always verify the final numbers with a **tax accountant or tax office**.

## 2. Tax law and bookkeeping requirements change every year

- Account codes, tax rates, deduction amounts, and ledger storage requirements **change every year**.
- The tax-law data aoiko uses reflects **our understanding as of the time it was written** and may diverge from the latest National Tax Agency notices.
- Before using, verify that the tax-law data for your current year matches the latest published version.

## 3. `.xtx` output and field verification

- `.xtx` output is generated from the official National Tax Agency W3C XSD (derived from the e-tax19 "XML schema") as a two-stage ID/IDREF document model. It bundles the final tax return form (KOA020) and the financial statement that matches the filing type in Settings > Filer info into one submission (procedure `RKO0010`, Income Tax and Reconstruction Special Income Tax filing). The financial statement is the blue-return financial statements (general, KOA210) or, for white return, the income/expense breakdown statement (general, KOA110).
- The return side carries the filer info (tax office, user identification number, name, address) and the business **revenue and income** (blue return only: also the **blue-return special deduction**). **Income deductions and tax computation are output only when entered on the Deductions screen** (classification codes such as the spouse-deduction classification are out of scope); otherwise complete them yourself in e-Tax. The financial-statement side carries the P/L, balance sheet, and monthly sales (purchases) — the white return breakdown statement does not include a balance sheet.
- **The white return family employee deduction** is calculated by aoiko under Income Tax Act Art. 57(3): the lower of (¥860,000 for a spouse or ¥500,000 per other relative) and (pre-deduction income ÷ (number of family employees + 1)), and is recorded on the return (Art. 57(5)).
- **Before using in an actual filing, always load it into e-Tax software (download edition) and review the content** (loading the income-tax procedure is not supported in the web edition). Procedure codes, attachment requirements, and deductions depend on your situation. The developer assumes no liability for any outcome from submitting aoiko's output as-is (see Section 1).

## 3a. Consumption tax filing form coverage

- The consumption tax computation provided by aoiko consists of estimates and method comparison (general / simplified / 20% special provision / 30% special provision).
- **`.xtx` export is supported for general taxation, the 20% special provision, and simplified taxation** (general: the consumption tax return, general form, + Attachments 1-3 and 2-3; 20% special provision: the return, simplified-taxation form, + Attachment 6; simplified: the return, simplified-taxation form, + Attachments 4-3 and 5-3). General taxation assumes a 100% taxable-sales ratio (no non-taxable sales or export exemptions). Simplified taxation covers your configured business category and, when a fixed asset is sold, the two-category calculation with the 4th category (including the 75% rule). **Generating the filing form body for simplified taxation when you actually run multiple businesses, or for the 30% special provision, is out of scope**. Use the Return Preparation Corner (確定申告書等作成コーナー) or a tax accountant for those.
- The transitional input tax credit rates (80/70/50/30%) and the deemed input rates of simplified taxation are applied via tables embedded in aoiko, but special cases (actually running multiple businesses [except the two-category calculation with a fixed-asset sale], non-creditable inputs, adjustment amounts, etc.) are not supported.

## 4. Compliance with the Electronic Books Preservation Act and the Qualified Invoice System is the user's responsibility

- aoiko **does not guarantee full compliance with the scanner-storage or electronic-transaction requirements of the Electronic Books Preservation Act** (only parts of timestamping, search capability, and audit history are implemented).
- The validity of qualified invoices (e.g. verifying T-numbers against the National Tax Agency public registry) **is the user's responsibility**. aoiko marking an entry as "invoice-compliant" does not constitute legal validation.

## 5. Generative AI / OCR risks

- The engine for generative AI classification and OCR is selectable in Settings.
  - **Google Gemini (default, cloud)**: data sent (CSV rows, receipt images) is handled per **Google's privacy policy** and your API plan contract (the free tier may be used for training).
  - **OpenAI-compatible / Ollama etc. (local)**: when the endpoint is localhost, data does not leave your device. When a remote endpoint is specified, the policies of that service apply.
  - **Tesseract (purely local WASM OCR, OCR only)**: images never leave your device. No generative AI is used; only T+13-digit registration number, date, and total are extracted from OCR text by rule-based extraction. Vendor and items are not guessed. Manual verification and correction by the user are mandatory. `jpn.traineddata` is served by aoiko itself, so no external request is made.
<!-- only:apple -->
  - **The OS's built-in text recognition (purely local OCR, OCR only)**: images never leave your device. The text is read with the recognition your operating system provides, and aoiko guesses the vendor from it and writes it to the description field. Item names are guessed too, but shown on screen only — never written to the journal entry. Nothing extra is downloaded and no external request is made. **Accuracy is not guaranteed** — manual verification and correction by the user are mandatory.
<!-- /only -->
<!-- only:windows -->
  - **The OS's built-in text recognition (purely local OCR, OCR only)**: images never leave your device. The text is read with the recognition your operating system provides, and aoiko guesses the vendor from it and writes it to the description field. Item names are guessed too, but shown on screen only — never written to the journal entry. Nothing extra is downloaded and no external request is made. **Accuracy is not guaranteed** — manual verification and correction by the user are mandatory.
<!-- /only -->
<!-- only:android -->
  - **On-device text recognition (on-device OCR, OCR only)**: images never leave your device. ML Kit, bundled with the app, reads the text on-device. aoiko then guesses the vendor from the text and writes it to the description field. Item names are guessed too, but shown on screen only — never written to the journal entry. Nothing extra is downloaded, but ML Kit, which performs the recognition, sends usage information (device model, app version, a per-install identifier, timing, and error codes) to Google. The receipt image and the recognized text are not sent. **Accuracy is not guaranteed** — manual verification and correction by the user are mandatory.
  - **On-device Gemini Nano (purely local inference)**: inference and data stay entirely on-device, and it needs neither an API key nor any endpoint setting. It appears as an option only when this device supports it. Inference content itself is never sent, but ML Kit sends usage information to Google. **Accuracy is not guaranteed** — manual verification and correction by the user are mandatory.
<!-- /only -->
<!-- only:apple -->
  - **Apple Intelligence (purely local inference)**: images and text never leave your device, and inference itself makes no request. It needs neither an API key nor any endpoint setting, and appears as an option only when this device supports it. Nothing extra is downloaded either. **Accuracy is not guaranteed** — manual verification and correction by the user are mandatory.
<!-- /only -->
<!-- only:browser -->
  - **Your browser's built-in AI (where inference runs is up to the browser)**: aoiko itself does not send the content you give this engine anywhere, but whether inference runs on your device or in an external service is decided by the browser's implementation. The API specification permits cloud-backed implementations, so aoiko cannot guarantee that the content stays on your device. This engine can be used only when your browser already holds the AI model. aoiko does not fetch that model, nor does it prompt the browser to — whether and when the browser obtains it is the browser's own behavior and your own browser setting, outside aoiko's involvement. **Accuracy is not guaranteed** — manual verification and correction by the user are mandatory.
<!-- /only -->
- For cloud (external) engines, a confirmation dialog is shown right before sending (skippable via the setting's checkbox or "Don't ask again" in each dialog; "Restore hidden confirmations" brings them all back). Always review the content beforehand if it may contain sensitive information or third-party personal information.
- Local AI (Ollama etc.) requires **a vision-capable model for OCR**.
<!-- only:browser -->
- To use a local AI (Ollama etc.) on localhost, allow aoiko's public URL in Ollama's `OLLAMA_ORIGINS` setting.
<!-- /only -->
- Generative AI output **may contain errors**. Always have a human verify before confirmation.

## 6. Data loss risk
<!-- only:browser -->

- Data is stored in your browser's IndexedDB and is **completely lost when you clear browser cache or site data**.
<!-- /only -->
<!-- only:native -->
- Data is stored in the app's managed storage and is **completely lost if you uninstall the app or delete its data**.
<!-- /only -->
- **Your data can be deleted automatically, with no action from you.** Example: automatic eviction when the device runs low on free space.
<!-- only:browser -->
- Another example is removal by WebKit's tracking prevention (ITP) of storage that has gone untouched for a period. That period is **30 days counted in days the browser actually ran**; the 7-day figure applies only when the site was reached through a specific navigation path.
<!-- /only -->
<!-- only:apple -->
- Another example is removal by WebKit's tracking prevention (ITP) of storage that has gone untouched for a period. That period is **30 days counted in days the app actually ran**. **This is on by default in the app edition too — being an app does not mean the data is safe from it.**
<!-- /only -->
<!-- only:browser -->
- **Automatic backup to OPFS is not protection against the deletions above.** OPFS sits in the same partition as the ledger data and is removed along with it.
<!-- /only -->
- As a result, **your data can disappear one day with no warning unless you keep backups**.
<!-- only:browser -->
- Running backups (a sync folder / OPFS / manual export) is **the user's responsibility**.
<!-- /only -->
<!-- only:native -->
- Running backups (a sync folder / manual export) is **the user's responsibility**.
<!-- /only -->
<!-- only:browser -->
- **If your browser holds this AI model, storage-pressure risk is higher still.** The model itself (several gigabytes) sits in the same partition as your ledger data, so the tighter your free space gets, the more likely automatic eviction becomes.
<!-- /only -->

## 7. License

This software is distributed under the **GNU Affero General Public License v3.0** (AGPL-3.0). See [LICENSE](LICENSE) for details.

## Revision history

Revision numbers form a single sequence, the same as the version shown on the consent screen. Only the revisions that apply to your edition are listed here.

| Version | Date | Changes |
| --- | --- | --- |
<!-- only:android -->
| 10 | 2026-09-28 | Added the disclaimer for on-device Gemini Nano, and stated that ML Kit sends API usage information to Google (§5) |
<!-- /only -->
<!-- only:browser -->
| 9 | 2026-09-26 | Revised the white return family employee deduction: aoiko now calculates it and records it on the return (§3). Stated that the confirmation dialog can be skipped via the setting's checkbox or "Don't ask again" (§5). Corrected the bundled Tesseract language data to `jpn.traineddata` only, and removed the wording that compared its accuracy with other engines (§5). Removed references to the development process from the tax-data and `.xtx` statements (§2, §3). Corrected the local-AI note: Ollama and similar work on localhost once `OLLAMA_ORIGINS` on the Ollama side allows aoiko's public URL (§5). Corrected the simplified-taxation scope to cover your configured business category plus the two-category calculation with a fixed-asset sale (4th category), and adjusted the unsupported special cases to match (§3a) |
<!-- /only -->
<!-- only:native -->
| 9 | 2026-09-26 | Revised the white return family employee deduction: aoiko now calculates it and records it on the return (§3). Stated that the confirmation dialog can be skipped via the setting's checkbox or "Don't ask again" (§5). Corrected the bundled Tesseract language data to `jpn.traineddata` only, and removed the wording that compared its accuracy with other engines (§5). Removed references to the development process from the tax-data and `.xtx` statements (§2, §3). Corrected the OS's built-in text recognition to state that it guesses the vendor and items (§5). Corrected the simplified-taxation scope to cover your configured business category plus the two-category calculation with a fixed-asset sale (4th category), and adjusted the unsupported special cases to match (§3a) |
<!-- /only -->
<!-- only:browser -->
| 8 | 2026-09-16 | Brought the engine list in line with the engines this edition can actually select, and revised the destination wording to depend on the engine you selected (§5). Statements that do not apply to every edition — storage location, backup mechanisms, the request path, and the official distribution sources — are now shown per edition (§6, PRIVACY and SECURITY). Revised the browser's built-in AI to state that on-device inference cannot be guaranteed, and removed the claim that the language data source can be changed in Settings (§5) |
<!-- /only -->
<!-- only:native -->
| 8 | 2026-09-16 | Brought the engine list in line with the engines this edition can actually select, and revised the destination wording to depend on the engine you selected (§5). Statements that do not apply to every edition — storage location, backup mechanisms, the request path, and the official distribution sources — are now shown per edition (§6, PRIVACY and SECURITY). Removed the claim that the language data source can be changed in Settings (§5) |
<!-- /only -->
<!-- only:browser -->
| 7 | 2026-09-13 | Added your browser's built-in AI as a generative-AI/OCR engine. Stated that it is usable only when the browser already holds the model, and that aoiko never fetches it (§5); also that the model itself raises storage-pressure risk (§6) |
<!-- /only -->
<!-- only:native -->
| 6 | 2026-08-22 | Added the OS's built-in text recognition as an OCR engine (§5) |
<!-- /only -->
| 5 | 2026-08-15 | Added a note that data can be deleted automatically with no action from the user, and corrected the period to match the implementation (30 days counted in days the browser or app actually ran). Added the backup folder to the list of backup destinations (§6). Revised the Tesseract entry to state that no external request is made, now that the language data ships with aoiko (§5) |
| 4 | 2026-07-14 | Income deductions and tax computation revised to conditional output (only when entered on the Deductions screen); reflected consumption tax return `.xtx` support (general / 20% special provision / simplified) (§3, §3a) |
| 3 | 2026-07-05 | Added white return support (income/expense breakdown statement KOA110; family employee deduction calculated and recorded on the return) |
| 2 | 2026-06-28 | `.xtx` revised from "provisional — do not use for actual filing" to "covers the business portion; loadable into e-Tax software (download edition)" |
| 1 | 2026-05-11 | Initial version |