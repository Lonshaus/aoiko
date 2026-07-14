# Disclaimer

**Language**: [日本語](DISCLAIMER.md) | **English** | [繁體中文](DISCLAIMER_zh-TW.md)

aoiko is a tool that helps Japanese sole proprietors with Blue Return (青色申告) and White Return (白色申告) bookkeeping. By using this tool, you agree to the following.

## 1. Use at your own risk

- The **accuracy is not guaranteed** for any figures, books, or `.xtx` files produced by this tool.
- The developer assumes **no liability** for any damages (additional tax, additions tax, delinquent tax, understatement tax, or otherwise) arising from a final tax return, amended return, or tax audit response.
- Always verify the final numbers with a **tax accountant or tax office**.

## 2. Tax law and bookkeeping requirements change every year

- Account codes, tax rates, deduction amounts, and ledger storage requirements **change every year**.
- The bundled `tax-schema/{year}` reflects **understanding at that point in time** and may diverge from the latest National Tax Agency notices.
- Before using, verify that `tax-schema/` for your current year matches the latest published version.

## 3. `.xtx` output and field verification

- `.xtx` output is generated using the official National Tax Agency W3C XSD (derived from e-tax19 "XML schema") as a two-stage ID/IDREF document model, embedding the final tax return form (KOA020) plus whichever financial statement matches your filing type in Settings &gt; Filer info (Blue Return financial statements – general, KOA210, or the income/expense breakdown statement – general, KOA110, for White Return) into one submission (procedure `RKO0010`, Income Tax and Reconstruction Special Income Tax filing). Each form's reference side passes the official xsd validation (xmllint) in CI.
- The return side carries the filer info (tax office, user ID, name, address) and the business **revenue and income** (Blue Return only: also the **blue-return special deduction**). **Income deductions and tax computation are output only when entered on the Deductions screen** (category "kubun" codes such as the spouse-deduction category are out of scope); otherwise complete them yourself in e-Tax. The financial-statement side carries the P/L, balance sheet, and monthly sales (purchases) — the White Return breakdown statement does not include a balance sheet.
- **The White Return family-employee deduction** (a flat ¥860,000 for a spouse or ¥500,000 per other relative) is not calculated by aoiko since it depends on relationship data aoiko does not track. Only the pre-deduction income is output — **you must enter the deduction amount and post-deduction income yourself in e-Tax**.
- **Before using in an actual filing, always load it into e-Tax Software (download edition) and review the content** (loading the income-tax procedure is not supported in the web edition). Procedure codes, attachment requirements, and deductions depend on your situation. The developer assumes no liability for any outcome from submitting this tool's output as-is (see Section 1).

## 3a. Consumption tax filing form coverage

- The consumption tax computation provided by this tool is estimates and method comparison (general / simplified / 2% special / 3% special).
- **`.xtx` export is supported for general taxation, the 20% special provision, and simplified taxation (single business category only)** (general: the consumption tax return, general form, + attachments 1-3 and 2-3; 20% special: the return, simplified-taxation form, + attachment 6; simplified: the return, simplified-taxation form, + attachments 4-3 and 5-3). General taxation assumes a 100% taxable-sales ratio (no non-taxable sales or export exemptions). **Generating the filing form body for simplified taxation across multiple business categories or the 30% special provision is out of scope**. Use the online preparation corner ("作成コーナー") or a tax accountant for those.
- The transitional input tax credit rates (80/70/50/30%) and the deemed input rates of simplified taxation are applied via tables embedded in the tool, but special cases (mixed business, non-creditable inputs, adjustment amounts, etc.) are not supported.

## 4. Compliance with the Electronic Books Preservation Act and the Qualified Invoice System is the user's responsibility

- This tool **does not guarantee full compliance with the scanner-storage or electronic-transaction requirements of the Electronic Books Preservation Act** (only parts of timestamping, search capability, and audit history are implemented).
- The validity of qualified invoices (e.g. verifying T-numbers against the National Tax Agency public registry) **is the user's responsibility**. The tool marking an entry as "invoice-compliant" does not constitute legal validation.

## 5. LLM / OCR risks

- The engine for LLM classification and OCR is selectable in Settings.
  - **Google Gemini (default, cloud)**: data sent (CSV rows, receipt images) is handled per **Google's privacy policy** and your API plan contract (the free tier may be used for training).
  - **OpenAI-compatible / Ollama etc. (local)**: when the endpoint is localhost, data does not leave your device. When a remote endpoint is specified, the policies of that service apply.
  - **Tesseract (purely-local WASM OCR, OCR only)**: images never leave your device. No LLM is used; only T+13-digit registration number, date, and total are extracted from OCR text by deterministic rules. Vendor and items are not guessed. **Accuracy is significantly lower than the other engines** — manual verification and correction by the user are mandatory. On first use, `jpn.traineddata` / `eng.traineddata` are fetched from a CDN (self-host configurable, fully offline operation possible).
- For cloud (external) engines, a confirmation dialog is shown right before sending. Always review the content beforehand if it may contain sensitive information or third-party personal information.
- Local AI (Ollama etc.) requires **a vision-capable model for OCR**. aoiko must also run locally (HTTPS-served aoiko cannot reach localhost), and `OLLAMA_ORIGINS` must be configured on the Ollama side.
- LLM output **may contain errors**. Always have a human verify before confirmation.

## 6. Data loss risk

- Data is stored in your browser's IndexedDB and is **completely lost when you clear browser cache or site data**.
- Backup (File System Access API / OPFS / manual JSON download) operates **at the user's responsibility**.

## 7. License

This software is distributed under the **GNU Affero General Public License v3.0** (AGPL-3.0). See [LICENSE](LICENSE) for details.

## Revision history

Corresponds to the version number shown in the consent status.

| version | Date | Changes |
| --- | --- | --- |
| 4 | 2026-07-14 | Income deductions and tax computation revised to conditional output (only when entered on the Deductions screen); reflected consumption tax return `.xtx` support (general / 20% special / simplified) (§3, §3a) |
| 3 | 2026-07-05 | Added White Return support (income/expense breakdown statement KOA110; family-employee deduction completed in e-Tax) |
| 2 | 2026-06-28 | `.xtx` revised from "provisional — do not use for actual filing" to "covers the business portion; loadable into e-Tax Software (download edition)" |
| 1 | 2026-05-11 | Initial version |