# 11. Backup and restore
<!-- only:browser -->

File System Access API, OPFS, manual zip export / restore.
<!-- /only -->
<!-- only:native -->
Pick a folder once, and it's written automatically from then on — plus how to do a manual export and restore.
<!-- /only -->

**Language**: [日本語](11-backup.md) | **English** | [繁體中文](11-backup_zh-TW.md)

> **By the end of this chapter you can**
> - Configure a backup folder for automatic backups
> - Manually export a backup file
> - Restore from a backup (including receipt photos)
> - Understand the data-loss risks and your countermeasures
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) done; data is accumulating from bookkeeping.

## 1. Why backups matter
<!-- only:browser -->

aoiko's data lives in the browser's **IndexedDB** (device-local). This means:
<!-- /only -->
<!-- only:native -->
aoiko's data lives in **the app's own storage area** (device-local). This means:
<!-- /only -->

- ✅ No server transmission, no external leak (privacy)
<!-- only:browser -->
- ❌ Browser site-data clear → **complete loss**
<!-- /only -->
<!-- only:native -->
- ❌ Removing the app → whether it's lost depends on the platform (Windows and iOS delete it right along with the app; macOS keeps the storage area even across a reinstall)
<!-- /only -->
- ❌ Device failure → unrecoverable
<!-- only:browser -->
- ❌ Browser profile deletion → lost
<!-- /only -->
<!-- only:native -->
- ❌ The backup folder gets moved, deleted, or loses access → automatic writes stop until you choose it again
<!-- /only -->

Regular backup is **the user's responsibility**. "I'll back up when I remember" is a path to disaster — set up automatic backups.
<!-- only:browser -->

## 2. Backup mechanism comparison

| Method | API | Browser support |
|---|---|---|
| **File System Access API (FSA)** | `showDirectoryPicker` | Chrome / Edge / Brave (Chromium) |
| **OPFS (Origin Private File System)** | `navigator.storage.getDirectory` + `createWritable` | Firefox / Safari 26 and later |
| **Manual zip export** | `<a download>` | All browsers |

aoiko auto-falls back: FSA when available, otherwise OPFS, otherwise manual export only.

> **Safari below 26 and iOS do not support automatic backup.** They lack `createWritable`, the API required to write into OPFS, so the backup **"Status"** in Settings reads **"⚠ Not supported"**. Rely on manual zip export instead.
<!-- /only -->
<!-- only:native -->
## 2. How backups work

There's no method to choose between. Pick a destination folder once, and everything is written automatically from then on. The steps are the same on every supported platform, not just desktop.
<!-- /only -->

## 3. Configure automatic backup (recommended)

**Settings > Backup** section.
<!-- only:browser -->

### 3-1. Chromium (FSA supported)

1. Click **"Choose folder"**
2. Browser opens a folder picker
3. Choose **any location** (e.g. `Documents/aoiko-backup/`, a Google Drive sync folder, a Dropbox folder, etc.)
4. **"Allow"** on the access-permission dialog
5. On success, the **"Folder"** field in Settings shows the folder you chose and **"Status"** reads **"✓ OK"**

From then on, on every entry add/edit, the items you chose under [§ 3-6, "Items to include in backups"](#3-6-items-to-include-in-backups) are written automatically. Instead of a zip, it's written as loose files: one snapshot (JSON) per backup under `snapshots/`, and, when "Receipt photos" is selected, receipt photos ([02. § 1-7](02-journal_en.md#1-7-attaching-a-receipt-photo)) under `attachments/`, each named by the SHA-256 of its content. A photo stored once is reused wherever it's attached, so pasting the same photo into several entries doesn't duplicate it, and a photo that hasn't changed is never rewritten by a later backup.

> **Google Drive / iCloud / Dropbox integration tip**: if the FSA folder you chose is on a cloud-synced path, this effectively gives you cloud backup. Example: `~/Google Drive/My Drive/aoiko-backup/` → local writes auto-sync to Google Drive.
>
> **Caution**: an iCloud Drive "Download On Demand" item as the FSA folder will trigger online sync on every backup write; for stability, choose a folder with ample local space.
<!-- /only -->
<!-- only:native -->
### 3-1. Choose a folder

1. Click **"Choose folder"**
2. A folder picker opens
3. Choose **any location**
4. On success, the **"Folder"** field in Settings shows the folder you chose and **"Status"** reads **"✓ OK"**

From then on, on every entry add/edit, the items you chose under [§ 3-4, "Items to include in backups"](#3-4-items-to-include-in-backups) are written automatically. Instead of a zip, it's written as loose files: one snapshot (JSON) per backup under `snapshots/`, and, when "Receipt photos" is selected, receipt photos ([02. § 1-7](02-journal_en.md#1-7-attaching-a-receipt-photo)) under `attachments/`, each named by the SHA-256 of its content. A photo stored once is reused wherever it's attached, so pasting the same photo into several entries doesn't duplicate it, and a photo that hasn't changed is never rewritten by a later backup.

> **Cloud-sync folder tip**: if the folder you chose is on a cloud-synced path, this effectively gives you cloud backup. Example: choose `iCloud Drive/aoiko-backup/` → the written JSON auto-syncs to iCloud.
<!-- /only -->
<!-- only:browser -->

### 3-2. Firefox / Safari 26 and later (OPFS only)

On non-FSA browsers, the only option is **OPFS**. OPFS is **a private storage area managed internally by the browser** — you cannot inspect it from Finder or Explorer.

OPFS backup:
- Written automatically (same trigger as FSA — every entry update)
- Browser site-data clear **wipes OPFS** along with IndexedDB
- It **does not protect against device or browser loss**, which is a backup's real purpose

> OPFS users: strongly combine with **manual zip export**.

### 3-3. Safari below 26 and iOS (manual only)

Automatic backup does not run. The **"Status"** under **Settings > Backup** reads **"⚠ Not supported"** and offers no folder picker. Run [§ 4 Manual export](#4-manual-export) on a regular schedule.

If you keep books on an iPhone / iPad, decide up front on a rhythm — monthly, quarterly — and export manually every time.
<!-- /only -->
<!-- only:browser -->

### 3-4. Confirming last backup time
<!-- /only -->
<!-- only:native -->
### 3-2. Confirming last backup time
<!-- /only -->

The **"Last backup"** field in **Settings > Backup** shows the date and time of the most recent backup. If it's stale for long, supplement with a manual export.
<!-- only:browser -->

### 3-5. Deleting old backups and unused receipt photos
<!-- /only -->
<!-- only:native -->
### 3-3. Deleting old backups and unused receipt photos
<!-- /only -->

**Settings > Backup** section has two independent deletion settings with different targets.

| Setting | What it deletes | Default |
|---|---|---|
| **Delete old backups** | Snapshot files under `snapshots/` | Never delete |
| **Delete unused receipt photos** | Attachment files under `attachments/` | Never delete |

**"Delete old backups"** removes old snapshots once they exceed the number you keep (7 / 30 / 90). Deletion cannot be undone. This setting deletes only the snapshot files themselves; it does not delete receipt photo files, since other dates may still reference them. However, when "Delete unused receipt photos" is on, photos that only the deleted snapshots referenced can be deleted in the same backup run (see below).

**"Delete unused receipt photos"** removes receipt photo files from `attachments/` that no snapshot references any more. Only snapshots left in the folder that are the newest one, or within the number of days you choose (30 / 90 / 180), count as references. Older snapshots do not count, even if they are still in the folder. Deletion happens in a cleanup after a backup, and the cleanup runs only when at least 24 hours have passed since the last completed cleanup. A photo is therefore deleted at one of the following times, and there is no guaranteed minimum period for which it is kept:

- At the first cleanup after the newest snapshot that references the photo is neither the newest snapshot overall nor within the chosen number of days (that is, after the chosen number of days has passed since the last snapshot that referenced it)
- When "Delete old backups" is on, in the cleanup of the backup run that deletes every snapshot referencing the photo (if at least 24 hours have passed since the previous cleanup)

This applies to receipt photos you removed from the books and, when automatic backup does not include "Receipt photos", to photos the books still use. Without that item, new snapshots reference no photos at all. In that case, restoring from the folder later does not bring the deleted photos back.

If several devices share the same folder, a photo another device still uses could be removed, so choose a generous number of days.
<!-- only:browser -->

### 3-6. Items to include in backups
<!-- /only -->
<!-- only:native -->
### 3-4. Items to include in backups
<!-- /only -->

Under **Settings > Backup > "Items to include in backups"**, choose what automatic backup saves. Your choice applies from the next backup. The screen opened by "Export backup" also starts with this selection (changes made there are not written back here).

| Item | Contents | Default |
|---|---|---|
| **Bookkeeping data** | Journal entries, accounts, vendors, fixed assets, deductions, budgets, receivables and payables, invoices, import rules, and more | Always on (cannot be unchecked) |
| **Receipt photos** | Available only together with bookkeeping data | Included |
| **Business and filing settings** | Working year, filing method, consumption tax, business details, home-office ratios, and more | Included |
| **AI and external sending settings** | AI engine, endpoint, models, and receipt reading method | Included |
| **API keys** | Gemini and OpenAI-compatible API keys | Not included |
| **Filer info (user identification number, name, address, tax office)** | The filer info from [01. § 3a](01-setup_en.md#3a-register-filer-info-and-the-blue-return-deduction-required-for-xtx-submission) | Not included |

If you select "API keys", the keys go into the backup unencrypted (a warning appears next to the item). When selected for automatic backup, they are written to the backup folder on every backup, and uploaded to the sync service as well if the folder is inside a sync folder. Unchecking it later does not remove the keys from snapshots that were already written. They stay until those snapshots are deleted by "Delete old backups" or by hand. If the sync service keeps past versions, they can stay there even longer. If you cannot confirm that every backup containing an API key is gone, revoke the key with its issuer. Snapshots already written also stay as they are after you uncheck "Filer info".
<!-- only:browser -->

Backups stored in the browser (OPFS) can be neither viewed as files nor deleted by hand. They are deleted only by "Delete old backups" or "Delete unused receipt photos", by "Delete all data" in Settings ([§ 6](#6-delete-all-data-careful)), or by clearing the browser's site data.
<!-- /only -->

If you uncheck "Receipt photos", new snapshots no longer reference any photos. If "Delete unused receipt photos" is on at that point, photos the books still use also become subject to deletion (see the previous section).

If you uncheck "Receipt photos", "Business and filing settings", or "AI and external sending settings", the automatic backup snapshots can no longer be restored by aoiko versions earlier than this one. "Bookkeeping data" cannot be unchecked, so these three are the ones that count.

## 4. Manual export

**Settings > Backup > "Export backup"** opens the **"Choose what to export"** screen. Choose the items to export and press **"Export"** (it stays disabled while every item is unchecked):

- The items you chose (entries, subaccounts, vendors, fixed assets, settings, receipt photos, etc.) are bundled into one zip file. The initial selection is the same as [§ 3, "Items to include in backups"](#3-configure-automatic-backup-recommended)
<!-- only:browser -->
- Saved to your browser's "Downloads" folder
<!-- /only -->
<!-- only:native -->
- On desktop, a save dialog lets you choose the destination. On iPad/iPhone, it's saved inside the app's own storage area, retrievable from the Files app etc.
<!-- /only -->
- File name like `aoiko-ledger-{date}.zip` (no time component, so repeated exports on the same day all share one name)

> **API keys and filer info are excluded by default**. Unless you select "API keys" and "Filer info (user identification number, name, address, tax office)" under "Items to include in backups" or on the "Choose what to export" screen, no plaintext API key or personal info gets written out to a cloud-synced folder. Only select these if you're deliberately carrying that data along too, e.g. when migrating to another device. Selecting them under "Items to include in backups" writes them on every automatic backup, and unchecking them later leaves them in backups already written ([§ 3](#3-configure-automatic-backup-recommended)).

> A file that leaves out "Bookkeeping data", "Receipt photos", "Business and filing settings", or "AI and external sending settings" cannot be restored with aoiko versions earlier than this one. Even a file with all four can wipe settings when restored with an earlier version: that version first clears all settings of the device and then writes the file's contents back. An API key that is not in the file disappears from the device, and the disclaimer consent and the "Don't ask again" settings return to their initial state. "Restore from backup folder" in an earlier version also stops at the newest snapshot if it is in a format that version cannot restore, and does not look further back to older snapshots.

Keep this file in **several places** to be safe, for example by:

- Copying it to a separate physical storage (external SSD, USB)
- Emailing it to yourself (a file with "API keys" or "Filer info" selected contains unencrypted API keys and personal info)
- Saving it in cloud storage

> Manual export at **milestones** (month-end, quarter-end, year-end) on top of automatic backup gives extra safety.

## 5. Restore from a backup

### 5-1. When to restore
<!-- only:browser -->

- Accidentally cleared the browser cache
<!-- /only -->
<!-- only:native -->
- Accidentally removed the app
<!-- /only -->
- Migrating to a new device
<!-- only:browser -->
- Switching browsers (Chrome → Safari etc.)
<!-- /only -->
<!-- only:native -->
- Switching to a different device
<!-- /only -->

### 5-2. Restore from the backup folder

If a backup folder is already configured, click **"Restore from backup folder"** to load the newest restorable backup. After it loads, choose the **"Items to restore"** and press **"Replace selected items and restore"** (the same as step 4 onward in [§ 5-3](#5-3-restore-from-a-file)).

- It scans `snapshots/` newest first and picks the first one whose referenced photos are all present in `attachments/`. If cloud sync has only delivered part of your photos, it keeps looking back until it finds a snapshot it can restore completely, so you never have to hunt for the right file yourself
- A receipt photo whose content no longer matches its SHA-256 name is skipped individually — the ledger itself still restores fine — and the number skipped is shown as a warning
- Receipt photos that cloud sync hasn't downloaded to this device yet are reported separately from corrupt ones, as a "not downloaded" count. Wait a moment while online, then try again

### 5-3. Restore from a file

1. **Settings > Restore from backup** section
2. **"Choose file"** to pick a zip (new format) or JSON (legacy format) — the format is auto-detected from the extension/content, so there's only one button
3. A summary is shown:
   > version 1 · 12 tables · 5,432 rows
   >
   > Includes 38 receipt photo(s) (only shown for zip backups that contain photos)
4. Under **"Items to restore"**, check the items to replace. Only the items contained in the backup are listed, and the ones selected at first are, among those contained, "Bookkeeping data", "Receipt photos", "Business and filing settings", and "Filer info". "AI and external sending settings" and "API keys" are not selected at first, so select them yourself only when you need them. A warning is always shown next to these two:
   > The settings on this device will be replaced with the backup's. Select this only for a backup you made yourself.
5. Click **"Replace selected items and restore"** (it stays disabled while no item is selected)
6. Confirmation dialog:
   > Replace the selected items with this backup?
   >
   > For the selected items, the data on this device is deleted and replaced with the backup's. Items you didn't select stay as they are. This cannot be undone.
7. **"Replace and restore"** to execute
8. On success the app reloads itself automatically, and the Settings screen then shows the result, such as "Restored 12 tables / 5,432 rows." (plus a warning if any receipt photos had no image data). You do not need to reload manually

### 5-4. Cautions

- **Selected items are replaced**: for each item selected under "Items to restore", all current data on this device is deleted and then replaced with the backup's. If you misclick, there's no undo. Items you didn't select keep the data on this device
- **Values missing from the backup disappear too**: replacing means "delete, then write", so values that are not in the backup are removed from this device as well. Example: selecting "API keys" from a backup that contains only a Gemini key also deletes this device's OpenAI-compatible key (the working year alone keeps this device's value if the backup has no valid one)
- **When you don't select receipt photos**: if you replace only "Bookkeeping data" and leave "Receipt photos" unselected, only the photos on this device whose journal entry still exists after the restore are kept, and the rest are deleted
- **Backups without item information**: for a backup written by an earlier version, the contained items are worked out from its contents. "Bookkeeping data", "Business and filing settings", and "AI and external sending settings" are always listed, "Receipt photos" when it has a receipts table, and "API keys" and "Filer info" when it has those setting values. So selecting "AI and external sending settings" from a backup that has no AI settings returns the AI engine and endpoint to their defaults
- **Receipt photos in a legacy (plain-JSON) backup**: a legacy plain-JSON backup does not contain the photo files themselves. If it holds only the photo records, "Receipt photos" is selected from the start, and restoring as is replaces this device's photos with empty ones. Uncheck "Receipt photos" to keep this device's photos. The ledger data itself — entries, amounts, etc. — restores normally
- **Device-specific settings do not move**: the disclaimer consent, confirmations you turned off with "Don't ask again" and similar, the backup folder and the choice of items to include in backups, the "Got it" of the stored data check, and the like are not in backups, and restoring leaves this device's values unchanged
- **Always export manually first** if work is in progress
- After restoring, do the BS consistency check ([06. § 4-1](06-reports_en.md#4-1-mismatch-warning))

### 5-5. Stored data check

The **Settings > "Stored data check"** section checks the data stored on this device with the same rules used when restoring a backup. It looks for values that can be restored but are not counted correctly, such as entries with unreadable dates. The check itself never changes your data.

- The result is shown as "No values that break the rules were found." or "N values don't match the rules.", with the count and examples per table, and **"Check again"** runs it again
- If any value breaks the rules, the Home screen shows a notice: "N stored values can't be handled correctly by this version of aoiko." **"View details"** opens this section, and after you have looked, press **"Got it"**. The notice then stops appearing for that check result, and appears again if the result changes
- Entries with unreadable dates (entries that the receipt reader of an earlier version saved with a date not in YYYY-MM-DD form) can be fixed in the list in the same section: choose the correct date and press **"Register again"**. The original entry is cancelled by a correcting entry and kept on record, and its receipt photos are attached to the re-registered entry too
- Other values that break the rules can't be fixed from this screen. If you have a backup exported with valid data, you can restore from it

## 6. Delete all data (careful)

**Settings > Data management > "Delete all data"**:

- Physically deletes all IndexedDB data
<!-- only:browser -->
- The in-browser (OPFS) automatic backup is deleted too. Files in a backup folder you picked via FSA are not deleted
<!-- /only -->
<!-- only:native -->
- Files in the backup folder you picked are not deleted
<!-- /only -->
- Confirmation dialog before execution
- After deletion, returns to initial state — disclaimer accept + basic info entry start over

> **When to use?**: clean restart with test data, transferring aoiko, etc. Not routine.

## 7. Recommended backup strategy

Three layers:

| Layer | Purpose | Implementation |
|---|---|---|
<!-- only:browser -->
| **Layer 1**: Always automatic | Short-term (operational mistakes) | FSA pointing to a cloud-synced folder |
<!-- /only -->
<!-- only:native -->
| **Layer 1**: Always automatic | Short-term (operational mistakes) | Point the backup folder at a cloud-synced location |
<!-- /only -->
| **Layer 2**: Milestone manual | Mid-term (month/year-end snapshots) | Manual zip export → store separately |
<!-- only:browser -->
| **Layer 3**: Periodic check | Health verification | Twice a year, test a restore on a separate browser profile |
<!-- /only -->
<!-- only:native -->
| **Layer 3**: Periodic check | Health verification | Twice a year, choose the folder again and test a restore |
<!-- /only -->

> Especially important for years you've already filed. Combine with year lock ([06. § 8](06-reports_en.md#8-year-lock-filed)) for change detection.

## 8. Handing data off to your accountant

**Settings > Export for your accountant** lets you export journal entries as CSV for handing off to your tax accountant (this is separate from the backup zip — the backup is for restoring aoiko itself; this is for importing into other accounting software).

| File | Format | Purpose |
|---|---|---|
| Yayoi-format CSV | Yayoi import format (Shift-JIS, CRLF, 25 items) | Readable by Yayoi Kaikei, Yayoi no Aoiro Shinkoku Online, and the "Yayoi Kaikei journal import" of Money Forward Cloud Accounting / Tax Return |
| Generic CSV | UTF-8, one row per journal line | Fallback for accounting software that doesn't support Yayoi format |
| Reversal (cancellation) history CSV | UTF-8 | List of reversing entries (original + reversal). The two main CSVs exclude correction pairs from totals, so use this if you need to see what was canceled |

The target year is whichever year is currently selected under "Basic info" in Settings.

**How the export behaves**

- For the Yayoi-format CSV, if the year has no journal entries, no file is exported and the screen shows "There are no journal entries for N, so no file was exported."
- If the Yayoi-format CSV would exceed 1,000 lines or 1.0 MB (1,000,000 bytes), it is split into several CSV files and bundled as a zip (`aoiko-yayoi-{year}.zip`). Unzip it and import the files one at a time. A single entry is never split across files
- After the export, the entries that hit an import restriction of Yayoi Kaikei Online or Yayoi no Aoiro Shinkoku Online are listed with their date, description, and reason. They are included in the file as is, so check them before importing. The entries listed are: those with more than 20 lines; those that include 元入金 (owner's capital), which Yayoi no Aoiro Shinkoku Online cannot import; those with an amount over 9 digits; those with taxable sales recorded on 事業主借 (owner's contributions); those in a filed year where debits to cash, bank deposits, accounts receivable and similar accounts carry a purchase tax category; and those with a long account, subaccount, or department name

**Restrictions of Yayoi Kaikei Online and Yayoi no Aoiro Shinkoku Online**

- A half-width comma inside an item cannot be imported even when the item is wrapped in double quotes (aoiko replaces it with a full-width one in the Yayoi-format CSV only; see below)
- When a restriction on entering transactions is set, transactions dated before the first day of the previous fiscal year, counted from the day you import (January 1 of the previous year for Yayoi no Aoiro Shinkoku Online), cannot be imported
- Descriptions are cut off after 30 characters, account names after 12 characters (10 for Yayoi no Aoiro Shinkoku Online), and subaccount names after 15. Departments are not imported
- In the installed edition of Yayoi Kaikei, descriptions are cut off after 64 half-width digits (a full-width character counts as 2)

**How the Yayoi-format CSV treats text**

- A half-width comma `,` becomes a full-width "，", `"` becomes "”", and `;` becomes "；". Line breaks and tabs become a half-width space
- Spaces (including full-width spaces) and tabs before and after account, subaccount, and department names are removed. Invisible characters such as a zero-width space are not removed
- Departments are not written by default. Only when you have entries with departments, an **"Export departments"** checkbox appears in Settings, and checking it writes them (Yayoi Kaikei Standard and Yayoi no Aoiro Shinkoku cannot import departments, and a file containing departments fails to import as a whole)
- The 4 bad-debt allowance accounts and 4220 are written with shorter names in the Yayoi-format CSV (5810 → 貸倒引当金繰入一括, 5811 → 貸倒引当金繰入個別, 5410 → 貸倒引当金繰入不動産, 4230 → 貸倒引当金繰戻不動産, 4220 → 礼金・権利金等不動産). aoiko's chart of accounts itself does not change

> **About tax category codes**: The "tax category" column in the Yayoi-format CSV (taxable sales, taxable purchase, etc.) is inferred by aoiko itself. It is not an officially guaranteed spec, especially around reduced tax rates and simplified-taxation business categories — please have your accountant verify these before importing. The credit rate for a non-qualified-invoice purchase is shown using Yayoi's own published notation (100% / 80% / 70% / 50% / 30% / 控不 [not creditable]). An entry that sells a fixed asset carries one line with the sales-side tax category on the proceeds (always 4th category under simplified taxation).

> **More on the Yayoi-format tax categories**
>
> - Non-taxable purchases, and lines that aoiko's calculation does not count as purchases (debits to cash, bank deposits, accounts receivable, other receivables, and loans receivable, and so on; see [07. § 4-3](07-consumption-tax_en.md#4-3-what-aoiko-aggregates-for-input-tax)), are written as "対象外" (outside scope)
> - Import consumption tax is written like "課対輸税7.8%" or "課対輸税軽減6.24%" (with "共対" or "非対" if you chose a usage category). The tax amount column is left empty
> - Under simplified taxation, the usage category of purchases and import consumption tax is not reflected, and "課対" is always written
> - An entry that sells a lump-sum depreciable asset that is essential to the business has its taxable sales written on the account of the asset that was sold. If that asset cannot be identified, the line stays on 事業主借 and appears in the list after export
> - A year filed before debits to cash, bank deposits, and receivables stopped counting as purchases is written under the same rule as at filing. In that year, debits to these accounts carry a purchase tax category too, and appear in the list after export

> **When opening in a spreadsheet**: in the 3 CSVs for your accountant, a value that starts with `=`, `+`, `-`, or `@` (including full-width forms and `−`, also after leading spaces), or with a tab or line break, gets a `'` in front so that a spreadsheet does not run it as a formula. When an account, subaccount, or department name starts with one of these characters, Yayoi shows a list of name matches during import.

## 9. Next steps

- Amend a previously-filed year → [12. Amended filing](12-amended_en.md)
- Also store `.xtx` outputs in multiple places → [10. `.xtx` export](10-xtx-export_en.md)