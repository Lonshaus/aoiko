# 11. Backup and restore

Automatic backup, and manual zip export / restore.

**Language**: [日本語](11-backup.md) | **English** | [繁體中文](11-backup_zh-TW.md)

> **By the end of this chapter you can**
> - Configure a backup folder for automatic backups
> - Manually export a backup file
> - Restore from a backup (including receipt photos)
> - Understand the data-loss risks and your countermeasures
>
> **Prerequisites**: [01. Initial setup](01-setup_en.md) done; data is accumulating from bookkeeping.

## 1. Why backups matter

aoiko's data lives **only on this device**. Nothing is sent to a server, so nothing leaks — but the flip side is that **if it is lost from this device, it is gone**.

- ✅ No server transmission, no external leak (privacy)
- ❌ Device failure, loss or theft → unrecoverable
- ❌ Moving to a new device → you need a backup to migrate
- ❌ **In the browser**: clearing site data or deleting the profile → **complete loss**
- ❌ **In the app**: uninstalling → depends on the OS (below)

### What uninstalling does (app only)

| OS | When you uninstall |
|---|---|
| **macOS** | The app's data area stays. Reinstall and your data is still there |
| **Windows** | **The data is deleted with it** (standard behaviour for store-distributed apps) |

> **Before you remove or reinstall the app on Windows, always take a backup with [§ 4 Manual export](#4-manual-export).** If you remove it without one, the books do not come back.

Regular backup is **the user's responsibility**. "I'll back up when I remember" is a path to disaster — use automatic backups together with a manual export at each milestone.

## 2. Backup mechanism comparison

| Method | Where it works | Recommendation |
|---|---|---|
| **App folder writing** | The app (Windows / macOS / iPadOS / iOS) | ◎ Auto, any folder, cloud-synced folders too |
| **File System Access API (FSA)** | Chrome / Edge / Brave (Chromium) browsers | ◎ Auto, choose any folder |
| **OPFS (Origin Private File System)** | Firefox / Safari 26 and later browsers | ◯ Auto but browser-managed |
| **Manual export** | Every environment | △ Only when you remember |

aoiko picks in that order: folder writing in the app, FSA in the browser, otherwise OPFS, otherwise manual export only.

> **Safari below 26 and iOS in the browser do not support automatic backup** (this does not apply to the app)**.** They lack `createWritable`, the API required to write into OPFS, so the backup status in Settings reads "⚠ Browser not supported". Rely on manual JSON download instead.

## 3. Configure automatic backup (recommended)

Settings → **"Backup"** section. The steps differ slightly by environment.

### 3-1. The app (Windows / macOS / iPadOS / iOS)

Enabled by default. Pick a destination with **"Choose folder"** and every backup from then on is written there automatically. On iPhone and iPad you can pick a folder inside iCloud Drive.

> **The folder you pick matters.** If you pick a folder on the device itself, losing the device loses the automatic backups with it. Pick a cloud-synced folder (iCloud Drive, Google Drive, Dropbox, …) and it effectively becomes a cloud backup too.

What gets written is the same format as 3-2.

### 3-2. Chromium browsers (FSA supported)

1. Click **"Choose backup folder"**
2. Browser opens a folder picker
3. Choose **any location** (e.g. `Documents/aoiko-backup/`, a Google Drive sync folder, a Dropbox folder, etc.)
4. **"Allow"** on the access-permission dialog
5. The Settings screen shows **"Current folder: 〇〇"** on success

From then on, on every entry add/edit, the ledger data is written automatically. Instead of a zip, it's written as loose files: one snapshot (JSON) per backup under `snapshots/`, and receipt photos ([02. § 1-7](02-journal_en.md#1-7-attaching-a-receipt-photo)) under `attachments/`, each named by the SHA-256 of its content. A photo stored once is reused wherever it's attached, so pasting the same photo into several entries doesn't duplicate it, and a photo that hasn't changed is never rewritten by a later backup.

> **Google Drive / iCloud / Dropbox integration tip**: if the FSA folder you chose is on a cloud-synced path, this effectively gives you cloud backup. Example: `~/Google Drive/My Drive/aoiko-backup/` → local writes auto-sync to Google Drive.
>
> **Caution**: an iCloud Drive "Download On Demand" item as the FSA folder will trigger online sync on every backup write; for stability, choose a folder with ample local space.

### 3-3. Firefox / Safari 26 and later (OPFS only)

In a browser without FSA, the only option is **OPFS**. OPFS is **a private storage managed internally by the browser** — you cannot inspect it from Finder or Explorer.

OPFS backup:
- Written automatically (same trigger as FSA — every entry update)
- Browser site-data clear **wipes OPFS** along with IndexedDB
- The "device/browser-independent" purpose of a backup is **not fulfilled**

> OPFS users: strongly combine with **manual JSON download**.

### 3-4. Safari below 26 and iOS (manual only)

Automatic backup does not run. Settings → "Backup" shows "⚠ Browser not supported" and offers no folder picker. Run [§ 4 Manual export](#4-manual-export) on a regular schedule.

If you keep books on an iPhone / iPad, decide up front on a rhythm — monthly, quarterly — and download manually every time.

### 3-5. Confirming last backup time

Settings → "Backup" section shows **"Last backup: 2026-05-26 14:23"**. If it's stale for long, supplement with a manual export.

### 3-6. Deleting old backups and unused receipt photos

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
- Saved to your browser's "Downloads" folder; in the app a dialog opens so you can choose where
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

- Accidentally cleared the browser cache
- Uninstalled the app on Windows (the data goes with it)
- Migrating to a new PC
- Switching browsers (Chrome → Safari etc.), or moving from the browser to the app

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

- Physically deletes every piece of data stored on this device (backups in a folder you chose yourself are preserved)
- In a browser using OPFS, the automatic backups held there are deleted too
- Confirmation dialog before execution
- After deletion, returns to initial state — disclaimer accept + basic info entry start over

> **When to use?**: clean restart with test data, transferring aoiko, etc. Not routine.

## 7. Recommended backup strategy

Three layers:

| Layer | Purpose | Implementation |
|---|---|---|
| **Layer 1**: Always automatic | Short-term (operational mistakes) | Point the backup folder at a cloud-synced location |
| **Layer 2**: Milestone manual | Mid-term (month/year-end snapshots) | Manual export → store separately |
| **Layer 3**: Periodic check | Health verification | Twice a year, test a restore on a separate browser profile or another device |

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
