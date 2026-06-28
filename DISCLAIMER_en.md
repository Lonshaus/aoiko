# Disclaimer

**Language**: [日本語](DISCLAIMER.md) | **English** | [繁體中文](DISCLAIMER_zh-TW.md)

aoiko is a tool that helps Japanese sole proprietors with Blue Return (青色申告) bookkeeping. By using this tool, you agree to the following.

## 1. Use at your own risk

- The **accuracy is not guaranteed** for any figures, books, or `.xtx` files produced by this tool.
- The developer assumes **no liability** for any damages (additional tax, additions tax, delinquent tax, understatement tax, or otherwise) arising from a final tax return, amended return, or tax audit response.
- Always verify the final numbers with a **tax accountant or tax office**.

## 2. Tax law and bookkeeping requirements change every year

- Account codes, tax rates, deduction amounts, and ledger storage requirements **change every year**.
- The bundled `tax-schema/{year}` reflects **understanding at that point in time** and may diverge from the latest National Tax Agency notices.
- Before using, verify that `tax-schema/` for your current year matches the latest published version.

## 3. `.xtx` output and field verification

- `.xtx` output is generated using the official National Tax Agency W3C XSD (derived from e-tax19 "XML schema") as a two-stage ID/IDREF document model, embedding the final tax return form (KOA020) and Blue Return financial statements – general (KOA210) into one submission (procedure `RKO0010`, Income Tax and Reconstruction Special Income Tax filing). Each form's reference side passes the official xsd validation (xmllint) in CI.
- The return side carries the filer info (tax office, user ID, name, address) and the business **revenue, income, and blue-return special deduction**. **Income deductions and tax computation are out of aoiko's scope** — complete them yourself in e-Tax. The financial-statement side carries the P/L, balance sheet, and monthly sales (purchases).
- **Before using in an actual filing, always load it into e-Tax Software (download edition) and review the content** (loading the income-tax procedure is not supported in the web edition). Procedure codes, attachment requirements, and deductions depend on your situation. The developer assumes no liability for any outcome from submitting this tool's output as-is (see Section 1).

## 3a. Consumption tax filing forms are out of scope

- The consumption tax computation provided by this tool is **limited to estimates and method comparison (general / simplified / 2% special / 3% special)**.
- **Generating the consumption tax filing form body (the consumption tax return + supporting tables 2-3 etc.) is out of scope**. Use e-Tax Software (Web edition) or a tax accountant for actual filing.
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