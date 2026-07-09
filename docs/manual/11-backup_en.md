# 11. Backup and restore

File System Access API, OPFS, manual zip download / restore.

**Language**: [日本語](11-backup.md) | **English** | [繁體中文](11-backup_zh-TW.md)

> **By the end of this chapter you can**
> - Configure a backup folder for automatic backups
> - Manually export a backup file
> - Restore from a backup (including receipt photos)
> - Understand the data-loss risks and your countermeasures
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) done; data is accumulating from bookkeeping.

## 1. Why backups matter

aoiko's data lives in the browser's **IndexedDB** (device-local). This means:

- ✅ No server transmission, no external leak (privacy)
- ❌ Browser site-data clear → **complete loss**
- ❌ Device failure → unrecoverable
- ❌ Browser profile deletion → lost

Regular backup is **the user's responsibility**. "I'll back up when I remember" is a path to disaster — set up automatic backups.

## 2. Backup mechanism comparison

| Method | API | Browser support | Recommendation |
|---|---|---|---|
| **File System Access API (FSA)** | `showDirectoryPicker` | Chrome / Edge / Brave (Chromium) | ◎ Auto, choose any folder |
| **OPFS (Origin Private File System)** | `navigator.storage.getDirectory` | Safari / Firefox + most | ◯ Auto but browser-managed |
| **Manual JSON download** | `<a download>` | All browsers | △ Only when you remember |

aoiko auto-falls back: FSA when available, otherwise OPFS, otherwise manual download only.

## 3. Configure automatic backup (recommended)

Settings → **"Backup"** section.

### 3-1. Chromium (FSA supported)

1. Click **"Choose backup folder"**
2. Browser opens a folder picker
3. Choose **any location** (e.g. `Documents/aoiko-backup/`, a Google Drive sync folder, a Dropbox folder, etc.)
4. **"Allow"** on the access-permission dialog
5. The Settings screen shows **"Current folder: 〇〇"** on success

From then on, on every entry add/edit, a file like `aoiko-ledger-{date}.zip` is automatically written to that folder. The zip bundles the ledger data (JSON) together with the original receipt photo images ([02. § 1-7](02-journal_en.md#1-7-attaching-a-receipt-photo)).

> **Google Drive / iCloud / Dropbox integration tip**: if the FSA folder you chose is on a cloud-synced path, this effectively gives you cloud backup. Example: `~/Google Drive/My Drive/aoiko-backup/` → local writes auto-sync to Google Drive.
>
> **Caution**: an iCloud Drive "Download On Demand" item as the FSA folder will trigger online sync on every backup write; for stability, choose a folder with ample local space.

### 3-2. Safari / Firefox (OPFS only)

On non-FSA browsers, the only option is **OPFS**. OPFS is **a private storage managed internally by the browser** — you cannot inspect it from Finder or Explorer.

OPFS backup:
- Written automatically (same trigger as FSA — every entry update)
- Browser site-data clear **wipes OPFS** along with IndexedDB
- The "device/browser-independent" purpose of a backup is **not fulfilled**

> Safari / Firefox users: strongly combine with **manual JSON download**.

### 3-3. Confirming last backup time

Settings → "Backup" section shows **"Last backup: 2026-05-26 14:23"**. If it's stale for long, supplement with a manual export.

## 4. Manual export

Settings → **"Backup"** section → **"Download backup"**:

- All data (entries, sub-accounts, vendors, fixed assets, settings, receipt photos, etc.) bundled into one zip file
- Saved to your browser's "Downloads" folder
- Filename like `aoiko-ledger-{timestamp}.zip`

> **API keys and filer info are excluded by default**. Unless you turn on "Include API keys in backups" and "Include filer info", no plaintext API key or personal info gets written out to a cloud-synced folder. Only enable these if you're deliberately carrying that data along too, e.g. when migrating to another device.

Then:

- Copy to a separate physical storage (external SSD, USB)
- Email it to yourself
- Save in cloud storage

…to **diversify** storage locations is robust.

> Manual download at **milestones** (month-end, quarter-end, year-end) on top of automatic backup gives extra safety.

## 5. Restore from a backup

### 5-1. When to restore

- Accidentally cleared the browser cache
- Migrating to a new PC
- Switching browsers (Chrome → Safari etc.)

### 5-2. Procedure

1. Settings → **"Restore from backup"** section
2. **"Choose file"** to pick a zip (new format) or JSON (legacy format) — the format is auto-detected from the extension/content, so there's only one button
3. A summary is shown:
   > version 1 · 12 tables · 5,432 rows
   > Includes 38 receipt photo(s) (only shown for zip backups that contain photos)
4. Click **"Replace all data and restore"**
5. Confirmation dialog:
   > Replace all data?
   > Current data will be deleted and replaced with the contents of the selected file. This cannot be undone.
6. **"Replace and restore"** to execute
7. Success message → **"Reload"** to reload the app

### 5-3. Cautions

- **Full replacement**: IndexedDB is entirely overwritten. If you misclick, there's no undo
- **Always export manually first** if work is in progress
- After restoring, do the BS consistency check ([06. § 4-1](06-reports_en.md#4-1-mismatch-warning))
- **Restoring a legacy (plain-JSON) backup does not restore receipt photos** (older backups never contained them). The ledger data itself — entries, amounts, etc. — restores normally

## 6. Delete all data (careful)

Settings → "Data management" → **"Delete all data"**:

- Physically deletes all IndexedDB data (backup files are preserved)
- Confirmation dialog before execution
- After deletion, returns to initial state — disclaimer accept + basic info entry start over

> **When to use?**: clean restart with test data, transferring aoiko, etc. Not routine.

## 7. Recommended backup strategy

Three layers:

| Layer | Purpose | Implementation |
|---|---|---|
| **Layer 1**: Always automatic | Short-term (operational mistakes) | FSA pointing to a cloud-synced folder |
| **Layer 2**: Milestone manual | Mid-term (month/year-end snapshots) | Manual JSON export → store separately |
| **Layer 3**: Periodic check | Health verification | Twice a year, test a restore on a separate browser profile |

> Especially important for years you've already filed. Combine with year lock ([06. § 8](06-reports_en.md#8-year-lock-filed)) for change detection.

## 8. Handing data off to your accountant

Settings → **"Open accountant export"** takes you to a dedicated screen where you can export journal entries as CSV for handing off to your tax accountant (this is separate from the backup zip — the backup is for restoring aoiko itself; this is for importing into other accounting software).

| File | Format | Purpose |
|---|---|---|
| Yayoi-format CSV | Shift-JIS, CRLF, 25 columns | **Default, recommended.** Readable by most Japanese accounting software (Yayoi, freee, Money Forward, etc.) via their "Yayoi format import" option |
| Generic CSV | UTF-8, one row per journal line | Fallback for accounting software that doesn't support Yayoi format |
| Correction (cancellation) history CSV | UTF-8 | List of correcting entries (original + reversal). The two main CSVs exclude correction pairs from totals, so use this if you need to see what was cancelled |

The target year is whichever year is currently selected under "Basic info" in Settings.

> **About tax category codes**: The "tax category" column in the Yayoi-format CSV (taxable sales, taxable purchase, etc.) is inferred by aoiko itself. It is not an officially guaranteed spec, especially around reduced tax rates, invoice-deduction rates, and simplified-taxation business categories — please have your accountant verify these before importing.

## 9. Next steps

- Amend a previously-filed year → [12. Amended filing](12-amended_en.md)
- Also store `.xtx` outputs in multiple places → [10. `.xtx` export](10-xtx-export_en.md)