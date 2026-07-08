# 15. Issuing invoices and quotes

Create and issue invoices and quotes for your customers from the "Invoices" screen.

**Language**: [日本語](15-invoices.md) | **English** | [繁體中文](15-invoices_zh-TW.md)

> **By the end of this chapter you can**
> - Create and issue invoices and quotes
> - Understand how issuing auto-generates a journal entry and a receivable
> - Correct an issued document (via a reversing entry)
> - One-click convert a quote into an invoice
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) done. Register your customer beforehand under Settings → "Vendors".

## 1. Invoices vs. quotes

| | Invoice | Quote |
|---|---|---|
| Number series | Independent (e.g. INV-2026-0001) | Independent (e.g. QUO-2026-0001) |
| Accounting effect on issue | Auto-generates a journal entry (debit accounts receivable, credit sales) + a receivable (ArApEntry) | None — it's a pre-deal proposal |
| Correction | Reversing entry (same philosophy as [12. Amended filing](12-amended_en.md)) | Content can't be changed after issue — void only |

A quote is only a proposal that hasn't become a deal yet, so issuing it never touches the ledger. Once the deal is confirmed, one-click convert the quote into an invoice (§ 4).

## 2. Creating an invoice or quote

1. Go to **"Invoices"** in the nav and pick the "Invoices" or "Quotes" tab
2. Click **"New"**
3. Enter the customer, transaction date, and (invoices only) due date
4. Enter item name, quantity, unit price (excl. tax), and tax rate per line. Use **"+ Add line"** for more rows
5. Consumption tax is calculated once per tax-rate group (per the invoice system's "round fractions once per rate" rule — not per line item)
6. Review, then click **"Save draft"** (to keep editing later) or **"Issue"**

> **To show the customer's address on the invoice**: register a mailing address for that customer under Settings → "Vendors" (optional field).

## 3. What happens on issue

**Issuing an invoice:**

- Assigns the number (the prefix set in Settings + year + sequence, e.g. `INV-2026-0001`)
- Auto-generates a journal entry: debit accounts receivable (tax-inclusive total), credit sales (per tax-rate group, tax-inclusive amount)
- Creates a receivable (ArApEntry), which feeds the expected-inflow forecast ([06. Reports § 10-2](06-reports_en.md#10-2-receivablespayables-and-cash-flow-forecast))
- Locks the content (can't go back to draft)

**Issuing a quote:**

- Only assigns the number. No journal entry or receivable is created

## 4. Converting a quote to an invoice

From the quotes list, click **"Convert to invoice"** to create a new invoice draft with the line items copied over (transaction date defaults to today; the number isn't assigned yet). Review and adjust before issuing.

## 5. Printing to send

For an issued document, click **"Print"** in the list to open the browser's print dialog. To save as a PDF, choose "Save as PDF" as the destination in the print dialog.

The printed layout automatically includes the fields required under the qualified invoice retention system:

- Issuer's name and registration number (from Settings → "Basic info"; the registration-number line is omitted for tax-exempt businesses without one)
- Transaction date
- Description of the transaction (line items)
- Subtotal and applicable rate, grouped by tax rate
- Consumption tax amount, grouped by tax rate
- Name of the recipient business (customer)

> aoiko has no built-in PDF generation or sending (e.g. email). Use the browser's print function to produce a PDF, then send it yourself (email attachment, mail, etc.).

## 6. Correcting or voiding an issued invoice

An issued invoice's content can't be edited directly (immutable-confirmed-entry principle, same philosophy as [12. Amended filing](12-amended_en.md)).

1. Click **"Void"** in the invoice list
2. A reversing entry (debit/credit swapped from the original) is created; the original entry is kept, marked as voided
3. The receivable (ArApEntry) is also deleted
4. Create and issue a new invoice with the correct content

> **An invoice with recorded payments can't be voided.** This would break payment-reconciliation consistency — first void the payment record ([06. Reports § 10-2](06-reports_en.md#10-2-receivablespayables-and-cash-flow-forecast)), then void the invoice.
>
> Quotes carry no journal entry, so a mistake can simply be voided and recreated.

## 7. Next steps

- Reconciling and tracking payments on issued invoices → [06. Reports](06-reports_en.md)
- Handing data off to your accountant → [11. Backup and restore § 8](11-backup_en.md#8-handing-data-off-to-your-accountant)