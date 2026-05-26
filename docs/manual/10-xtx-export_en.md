# 10. `.xtx` export

Generate an e-Tax-format `.xtx` file and verify it with the e-Tax Software (Web edition).

**Language**: [日本語](10-xtx-export.md) | **English** | [繁體中文](10-xtx-export_zh-TW.md)

> **By the end of this chapter you can**
> - Export the final tax return form (KOA020) + Blue Return financial statements (KOA210) into one `.xtx`
> - Verify the `.xtx` by importing it into e-Tax Software (Web edition)
> - Understand the meaning of official XSD compliance and aoiko's scope of responsibility
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) basic info, [09. Prior-period carryover](09-carryover_en.md), [08. Depreciation](08-depreciation_en.md) year-end depreciation are done, and the year's entries are finalized.

## 1. What is `.xtx`

`.xtx` is an XML file accepted by the **e-Tax Software (Web edition)** for filing data. aoiko generates one combining both forms below, in a single file, per the **official National Tax Agency W3C XSD** (derived from e-tax19 "XML schema"):

- **KOA020-023**: Final tax return form, parts 1–4 (Reiwa 8 version)
- **KOA210-011**: Blue Return financial statements (general)
- **Procedure code**: `RKO0010` (Income Tax and Reconstruction Special Income Tax filing)

aoiko's `.xtx` structure is **xmllint-validated against the official XSD** in CI on every change, so structurally it is compliant.

## 2. What aoiko's `.xtx` includes / excludes

### Included

| Form | Source |
|---|---|
| Tax return form, part 1 (year, trade name) | Settings basic info |
| Blue Return financial statements, page 1 P/L | Reports' P/L |
| Page 2 monthly sales/purchases | Reports' monthly sales |
| Page 3 depreciation table | Fixed assets + current-year depreciation |
| Page 4 balance sheet | Reports' BS |

### Excluded (filled in via human input / e-Tax)

| Content | How to fill |
|---|---|
| Tax return form **personal info** (name, address, birthdate, individual number) | Enter on the e-Tax side |
| **Deductions** (basic, spouse, social insurance, medical etc.) | Enter on the e-Tax side |
| **Tax computation** (income tax, reconstruction special income tax) | Auto-computed on the e-Tax side |
| **Attachments** (medical-expense schedule, donation certificates etc.) | Attach on the e-Tax side |
| **Consumption tax return** (table 2-3 etc.) | Created separately on the e-Tax side. aoiko provides only estimates ([07. Consumption tax](07-consumption-tax_en.md)) |

> aoiko's `.xtx` is a **skeleton file with the financial-statements portion + year and trade name** filled in. The rest is completed on the e-Tax side.

## 3. Export procedure

> Triggered from aoiko's Reports screen or the `.xtx` export menu (exact location depends on version).

### 3-1. Pre-export checks

1. All year's **entries are finalized**
2. **Opening carryover entry** dated `2026-01-01` exists for the current year ([09. Prior-period carryover](09-carryover_en.md); manual creation for first year)
3. **Depreciation entries** are generated at year-end ([08. § 3](08-depreciation_en.md#3-year-end-depreciation-entry-generation))
4. Reports → BS: **assets total matches liabilities + equity total** (no mismatch warning)
5. Settings → basic info: **trade name, current fiscal year** are correct

### 3-2. Filename

aoiko generates filenames like `aoiko-{year}.xtx` (exact format may vary). Saved to your browser's "Downloads" folder.

> aoiko's `.gitignore` excludes `aoiko-*.xtx`, so it won't be committed to the repo by mistake.

## 4. Verifying via e-Tax Software (Web edition)

**Important**: aoiko passes the official XSD validation in CI, but **field verification is the user's responsibility**. Before filing:

1. Sign in to e-Tax Software (Web edition) at [the e-Tax site](https://www.e-tax.nta.go.jp/)
2. **"Create" → "Import from file"** or equivalent
3. Select aoiko's `.xtx`
4. After import, in the e-Tax UI confirm:
   - Blue Return financial statements (general) numbers match aoiko's Reports
   - Monthly sales per month match
   - Depreciation rows per asset match
   - Balance sheet items match
5. Fill in missing items (personal info, deductions, tax computation, etc.) on the e-Tax side
6. **If e-Tax shows errors**: there may be a defect in our output. Please report it on GitHub Issues.

> **Why field verification matters**: passing xmllint ≠ accepted by e-Tax (schema-pass doesn't guarantee passing e-Tax's business-rule checks). Verify early.

## 5. Internals (reference)

### XSD source

- Distribution: National Tax Agency e-Tax "Specifications" page
- Source CAB: `e-tax19.CAB` "XML schema"
- aoiko bundles 7 files under `docs/xtx-spec/{shotoku,general}/`:
  - `KOA020-023.xsd` (tax return form)
  - `KOA210-011.xsd` (Blue Return financial statements, general)
  - `General.xsd`, `ITdefinition.xsd`, `ITreference.xsd`, `zeimusho.xsd`, `zeimoku.xsd`

### Document model

Two-stage ID/IDREF:

- **Definition side** (IT part): value elements enumerated under `<IT VR="1.0" id="IT">` with ID attributes
- **Reference side** (form-specific part): each leaf in a form is an empty element referencing the definition via IDREF

This is the standard e-tax model. aoiko's `.xtx` generator dynamically composes the file based on JSON schemas auto-generated from XSDs.

## 6. Common errors

| Error (e-Tax side) | Likely cause |
|---|---|
| File format wrong | Not `.xtx`, or wrong-year version |
| Form mismatch | aoiko's bundled XSD diverges from the current year's (check [docs/xtx-spec/README.md](../../docs/xtx-spec/README.md) for latest version status) |
| Required field missing | Trade name unset etc.; check Settings basic info |
| Wrong digit / format | Negative or non-integer amounts in entries; review the journal |

## 7. Next steps

- Lock the year after filing → [06. Reports § 8](06-reports_en.md#8-year-lock-filed)
- If you find an error after filing → [12. Amended filing](12-amended_en.md)
- Take backups → [11. Backup and restore](11-backup_en.md)