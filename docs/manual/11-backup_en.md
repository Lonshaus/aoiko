# 11. Backup and restore

<!-- only:browser -->
File System Access API, OPFS, manual zip download / restore.
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
- ❌ Removing the app → whether it's lost depends on the platform (Windows and Android delete it right along with the app; macOS keeps the storage area even across a reinstall)
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

| Method | API | Browser support | Recommendation |
|---|---|---|---|
| **File System Access API (FSA)** | `showDirectoryPicker` | Chrome / Edge / Brave (Chromium) | ◎ Auto, choose any folder |
| **OPFS (Origin Private File System)** | `navigator.storage.getDirectory` + `createWritable` | Firefox / Safari 26 and later | ◯ Auto but browser-managed |
| **Manual JSON download** | `<a download>` | All browsers | △ Only when you remember |

aoiko auto-falls back: FSA when available, otherwise OPFS, otherwise manual download only.

> **Safari below 26 and iOS do not support automatic backup.** They lack `createWritable`, the API required to write into OPFS, so the backup status in Settings reads "⚠ Browser not supported". Rely on manual JSON download instead.
<!-- /only -->
<!-- only:native -->
## 2. How backups work

There's no method to choose between. Pick a destination folder once, and everything is written automatically from then on. The steps are the same on every supported platform, including iPad and iPhone.
<!-- /only -->

## 3. Configure automatic backup (recommended)

Settings → **"Backup"** section.

<!-- only:browser -->
### 3-1. Chromium (FSA supported)

1. Click **"Choose backup folder"**
2. Browser opens a folder picker
3. Choose **any location** (e.g. `Documents/aoiko-backup/`, a Google Drive sync folder, a Dropbox folder, etc.)
4. **"Allow"** on the access-permission dialog
5. The Settings screen shows **"Current folder: 〇〇"** on success

From then on, on every entry add/edit, the ledger data is written automatically. Instead of a zip, it's written as loose files: one snapshot (JSON) per backup under `snapshots/`, and receipt photos ([02. § 1-7](02-journal_en.md#1-7-attaching-a-receipt-photo)) under `attachments/`, each named by the SHA-256 of its content. A photo stored once is reused wherever it's attached, so pasting the same photo into several entries doesn't duplicate it, and a photo that hasn't changed is never rewritten by a later backup.

> **Google Drive / iCloud / Dropbox integration tip**: if the FSA folder you chose is on a cloud-synced path, this effectively gives you cloud backup. Example: `~/Google Drive/My Drive/aoiko-backup/` → local writes auto-sync to Google Drive.
>
> **Caution**: an iCloud Drive "Download On Demand" item as the FSA folder will trigger online sync on every backup write; for stability, choose a folder with ample local space.
<!-- /only -->
<!-- only:native -->
### 3-1. Choose a folder

1. Click **"Choose backup folder"**
2. A folder picker opens
3. Choose **any location**
4. The Settings screen shows **"Current folder: 〇〇"** on success

From then on, on every entry add/edit, the ledger data is written automatically. Instead of a zip, it's written as loose files: one snapshot (JSON) per backup under `snapshots/`, and receipt photos ([02. § 1-7](02-journal_en.md#1-7-attaching-a-receipt-photo)) under `attachments/`, each named by the SHA-256 of its content. A photo stored once is reused wherever it's attached, so pasting the same photo into several entries doesn't duplicate it, and a photo that hasn't changed is never rewritten by a later backup.

> **Cloud-sync folder tip**: if the folder you chose is on a cloud-synced path, this effectively gives you cloud backup. Example: choose `iCloud Drive/aoiko-backup/` → the written JSON auto-syncs to iCloud.
<!-- /only -->

<!-- only:browser -->
### 3-2. Firefox / Safari 26 and later (OPFS only)

On non-FSA browsers, the only option is **OPFS**. OPFS is **a private storage managed internally by the browser** — you cannot inspect it from Finder or Explorer.

OPFS backup:
- Written automatically (same trigger as FSA — every entry update)
- Browser site-data clear **wipes OPFS** along with IndexedDB
- The "device/browser-independent" purpose of a backup is **not fulfilled**

> OPFS users: strongly combine with **manual JSON download**.
<!-- /only -->

<!-- only:browser -->
### 3-3. Safari below 26 and iOS (manual only)

Automatic backup does not run. Settings → "Backup" shows "⚠ Browser not supported" and offers no folder picker. Run [§ 4 Manual export](#4-manual-export) on a regular schedule.

If you keep books on an iPhone / iPad, decide up front on a rhythm — monthly, quarterly — and download manually every time.
<!-- /only -->

<!-- only:browser -->
### 3-4. Confirming last backup time
<!-- /only -->
<!-- only:native -->
### 3-2. Confirming last backup time
<!-- /only -->

Settings → "Backup" section shows **"Last backup: 2026-05-26 14:23"**. If it's stale for long, supplement with a manual export.

<!-- only:browser -->
### 3-5. Deleting old backups and unused receipt photos
<!-- /only -->
<!-- only:native -->
### 3-3. Deleting old backups and unused receipt photos
<!-- /only -->

Settings → "Backup" section has two independent deletion settings with different targets.

| Setting | What it deletes | Default |
|---|---|---|
| **Delete old backups** | Snapshot files under `snapshots/` | Never delete |
| **Delete unused receipt photos** | Attachment files under `attachments/` | Never delete |

**"Delete old backups"** removes old snapshots once they exceed the number you keep (7 / 30 / 90). Deletion cannot be undone. Only the snapshot files themselves are affected — receipt photo files are left alone, since other dates may still reference them.

**"Delete unused receipt photos"** removes a receipt photo file from the backup folder once no snapshot has referenced it for the number of days you choose (30 / 90 / 180). If several devices share the same folder, a photo another device still uses could be removed, so choose a generous number of days.

## 4. Manual export

Settings → **"Backup"** section → **"Download backup"**:

- All data (entries, sub-accounts, vendors, fixed assets, settings, receipt photos, etc.) bundled into one zip file
<!-- only:browser -->
- Saved to your browser's "Downloads" folder
<!-- /only -->
<!-- only:native -->
- On desktop, a save dialog lets you choose the destination. On iPad/iPhone, it's saved inside the app's own storage area, retrievable from the Files app etc.
<!-- /only -->
- Filename like `aoiko-ledger-{date}.zip` (no time component, so repeated exports on the same day all share one name)

> **API keys and filer info are excluded by default**. Unless you turn on "Include API keys in backups" and "Include filer info", no plaintext API key or personal info gets written out to a cloud-synced folder. Only enable these if you're deliberately carrying that data along too, e.g. when migrating to another device.

Then:

- Copy to a separate physical storage (external SSD, USB)
- Email it to yourself
- Save in cloud storage

…to **diversify** storage locations is robust.

> Manual download at **milestones** (month-end, quarter-end, year-end) on top of automatic backup gives extra safety.

## 5. Restore from a backup

### 5-1. When to restore

<!-- only:browser -->
- Accidentally cleared the browser cache
<!-- /only -->
<!-- only:native -->
- Accidentally removed the app
<!-- /only -->
- Migrating to a new PC
<!-- only:browser -->
- Switching browsers (Chrome → Safari etc.)
<!-- /only -->
<!-- only:native -->
- Switching to a different device (e.g. iPad to iPhone)
<!-- /only -->

### 5-2. Restore from the backup folder

If a backup folder is already configured, click **"Restore from backup folder"** and restore in one step.

- It scans `snapshots/` newest first and picks the first one whose referenced photos are all present in `attachments/`. If cloud sync has only delivered part of your photos, it keeps looking back until it finds a snapshot it can restore completely, so you never have to hunt for the right file yourself
- A receipt photo whose content no longer matches its SHA-256 name is skipped individually — the ledger itself still restores fine — and the number skipped is shown as a warning
- Receipt photos that cloud sync hasn't downloaded to this device yet are reported separately from corrupt ones, as a "not downloaded" count. Wait a moment while online, then try again

### 5-3. Restore from a file

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

### 5-4. Cautions

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
<!-- only:browser -->
| **Layer 1**: Always automatic | Short-term (operational mistakes) | FSA pointing to a cloud-synced folder |
<!-- /only -->
<!-- only:native -->
| **Layer 1**: Always automatic | Short-term (operational mistakes) | Point the backup folder at a cloud-synced location |
<!-- /only -->
| **Layer 2**: Milestone manual | Mid-term (month/year-end snapshots) | Manual JSON export → store separately |
<!-- only:browser -->
| **Layer 3**: Periodic check | Health verification | Twice a year, test a restore on a separate browser profile |
<!-- /only -->
<!-- only:native -->
| **Layer 3**: Periodic check | Health verification | Twice a year, choose the folder again and test a restore |
<!-- /only -->

> Especially important for years you've already filed. Combine with year lock ([06. § 8](06-reports_en.md#8-year-lock-filed)) for change detection.

## 8. Handing data off to your accountant

Settings → **"Export for your accountant"** lets you export journal entries as CSV for handing off to your tax accountant (this is separate from the backup zip — the backup is for restoring aoiko itself; this is for importing into other accounting software).

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
