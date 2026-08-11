<script lang="ts">
  import { onMount } from 'svelte';
  import { backup } from '../stores/backup.svelte';
  import { getSetting, setSetting } from '../lib/settings';
  import { m } from '../paraglide/messages';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import {
    BACKUP_RETENTION_COUNTS,
    BLOB_RETENTION_DAYS,
    daysSince,
    isFolderBackupActive,
    needsOffsiteBackupWarning,
    shouldShowHomeScreenHint,
  } from '../backup/schedule';
  import type { BackupRetentionCount, BlobRetentionDays } from '../backup/schedule';

  let downloadSavedConfirmOpen = $state(false);
  let includeApiKeys = $state(false);
  let includeFilerInfo = $state(false);
  let retentionCount = $state<BackupRetentionCount>(0);
  let blobRetentionDays = $state<BlobRetentionDays>(0);
  // 起動後に変わらないので non-reactive でよい
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);

  onMount(async () => {
    includeApiKeys = (await getSetting('backupIncludeApiKeys')) ?? false;
    includeFilerInfo = (await getSetting('backupIncludeFilerInfo')) ?? false;
    retentionCount = (await getSetting('backupRetentionCount')) ?? 0;
    blobRetentionDays = (await getSetting('blobRetentionDays')) ?? 0;
  });

  async function onToggleIncludeApiKeys(e: Event) {
    includeApiKeys = (e.target as HTMLInputElement).checked;
    await setSetting('backupIncludeApiKeys', includeApiKeys);
  }

  async function onToggleIncludeFilerInfo(e: Event) {
    includeFilerInfo = (e.target as HTMLInputElement).checked;
    await setSetting('backupIncludeFilerInfo', includeFilerInfo);
  }

  async function onChangeRetentionCount(e: Event) {
    retentionCount = Number((e.target as HTMLSelectElement).value) as BackupRetentionCount;
    await setSetting('backupRetentionCount', retentionCount);
  }

  async function onChangeBlobRetentionDays(e: Event) {
    blobRetentionDays = Number((e.target as HTMLSelectElement).value) as BlobRetentionDays;
    await setSetting('blobRetentionDays', blobRetentionDays);
  }

  async function onDownloadBackup() {
    downloadSavedConfirmOpen = await backup.downloadBackup();
  }

  async function onDownloadSavedConfirm(dontAskAgain: boolean) {
    downloadSavedConfirmOpen = false;
    await backup.confirmDownloadSaved();
    if (dontAskAgain) {
      await setSetting('skipDownloadSavedConfirm', true);
    }
  }

  function onDownloadSavedCancel() {
    downloadSavedConfirmOpen = false;
  }

  function retentionOptionLabel(count: BackupRetentionCount): string {
    if (count === 0) {
      return m.backup_panel_retention_option_never();
    }
    return m.backup_panel_retention_option_keep({ count: String(count) });
  }

  function blobRetentionOptionLabel(days: BlobRetentionDays): string {
    if (days === 0) {
      return m.backup_panel_blob_retention_option_never();
    }
    return m.backup_panel_blob_retention_option_days({ days: String(days) });
  }

  function formatTime(ts: number | null): string {
    if (!ts) {
      return '—';
    }
    return new Date(ts).toLocaleString('ja-JP');
  }

  const lastBackupLabel = $derived(formatTime(backup.lastBackupAt));
  const lastDownloadLabel = $derived(formatTime(backup.lastDownloadAt));
  const downloadDays = $derived(daysSince(backup.lastDownloadAt));
  const downloadStale = $derived(
    needsOffsiteBackupWarning(backup.adapterKind, backup.status, downloadDays),
  );

  const statusLabel = $derived(
    backup.status === 'initializing'
      ? m.backup_panel_status_initializing()
      : backup.status === 'unsupported'
        ? m.backup_panel_status_unsupported()
        : backup.status === 'unconfigured'
          ? m.backup_panel_status_unconfigured()
          : backup.status === 'reconfigure-required'
            ? m.backup_panel_status_reconfigure_required()
            : backup.status === 'permission-required'
              ? m.backup_panel_status_permission_required()
              : backup.status === 'writing'
                ? m.backup_panel_status_writing()
                : backup.status === 'error'
                  ? m.backup_panel_status_error()
                  : m.backup_panel_status_ok(),
  );
  // fsa（ブラウザの File System Access）と native（wrapper のネイティブ層）は
  // 利用者から見て同じ機能。表示も操作も分けない。
  const folderBased = $derived(backup.adapterKind === 'fsa' || backup.adapterKind === 'native');
  // 退避の注意書きを黙らせてよいのは、フォルダへの書き出しが現に動いているときだけ。
  // 種類だけで判定すると、未設定・再選択待ちで一件も書けていない状態まで黙る。
  const folderBackupActive = $derived(isFolderBackupActive(backup.adapterKind, backup.status));

  const adapterLabel = $derived(
    folderBased
      ? m.backup_panel_adapter_folder()
      : backup.adapterKind === 'opfs'
        ? m.backup_panel_adapter_opfs()
        : m.backup_panel_adapter_none(),
  );

  const showHomeScreenHint = $derived(shouldShowHomeScreenHint(backup.adapterKind, isStandalone));
</script>

<section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
  <header class="flex items-baseline justify-between">
    <h3 class="text-lg font-semibold">{m.backup_panel_title()}</h3>
    <span class="text-xs text-muted-foreground">{adapterLabel}</span>
  </header>

  {#if folderBased}
    <p class="text-xs text-muted-foreground">
      {@html m.backup_panel_intro_folder_html()}
    </p>
  {:else if backup.adapterKind === 'opfs'}
    <p class="text-xs text-muted-foreground">
      {@html m.backup_panel_intro_opfs_html()}
    </p>
  {:else if backup.adapterKind === 'none'}
    <p class="text-xs text-muted-foreground">
      {m.backup_panel_intro_none()}
    </p>
  {/if}

  {#if backup.status === 'reconfigure-required'}
    <p class="text-xs text-destructive">
      {m.backup_panel_reconfigure_notice({ folderName: backup.folderName ?? '' })}
    </p>
  {/if}

  {#if backup.storagePersisted === false && !folderBackupActive}
    <p class="text-xs text-muted-foreground">
      {m.backup_panel_storage_evictable()}
    </p>
  {/if}

  {#if showHomeScreenHint}
    <p class="text-xs text-muted-foreground">
      {m.backup_panel_home_screen_hint()}
    </p>
  {/if}

  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
    <div>
      <div class="text-xs text-muted-foreground">{m.backup_panel_label_status()}</div>
      <div>{statusLabel}</div>
    </div>
    {#if folderBased}
      <div>
        <div class="text-xs text-muted-foreground">{m.backup_panel_label_folder()}</div>
        <div class="font-mono text-xs break-all">{backup.folderName ?? '—'}</div>
      </div>
    {/if}
    <div>
      <div class="text-xs text-muted-foreground">{m.backup_panel_label_last_backup()}</div>
      <div>{lastBackupLabel}</div>
    </div>
    <div>
      <div class="text-xs text-muted-foreground">
        {m.backup_panel_label_last_download()}
        {#if downloadStale}
          <span class="text-destructive">⚠</span>
        {/if}
      </div>
      <div>{lastDownloadLabel}</div>
    </div>
    {#if backup.lastError}
      <div class="sm:col-span-2">
        <div class="text-xs text-muted-foreground">{m.backup_panel_label_last_error()}</div>
        <div class="text-destructive text-xs break-all">{backup.lastError}</div>
      </div>
    {/if}
  </div>

  <div class="flex flex-wrap gap-2">
    {#if folderBased}
      {#if backup.status === 'unconfigured'}
        <button
          type="button"
          onclick={() => backup.configure()}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.backup_panel_action_choose_folder()}
        </button>
      {:else if backup.status === 'reconfigure-required'}
        <button
          type="button"
          onclick={() => backup.configure()}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.backup_panel_action_reselect_folder()}
        </button>
      {:else if backup.status === 'permission-required'}
        <button
          type="button"
          onclick={() => backup.grantPermission()}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.backup_panel_action_grant_access()}
        </button>
        <button
          type="button"
          onclick={() => backup.configure()}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          {m.backup_panel_action_change_folder()}
        </button>
      {:else}
        <button
          type="button"
          onclick={() => backup.backup()}
          disabled={backup.status === 'writing'}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          {m.backup_panel_action_backup_now()}
        </button>
        <button
          type="button"
          onclick={() => backup.configure()}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          {m.backup_panel_action_change_folder()}
        </button>
      {/if}
    {:else if backup.adapterKind === 'opfs'}
      <button
        type="button"
        onclick={() => backup.backup()}
        disabled={backup.status === 'writing'}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {m.backup_panel_action_backup_now()}
      </button>
    {/if}

    <button
      type="button"
      onclick={onDownloadBackup}
      class="px-4 py-2 border rounded hover:bg-accent"
      class:bg-destructive={downloadStale}
      class:text-destructive-foreground={downloadStale}
      class:border-destructive={downloadStale}
    >
      {m.backup_panel_action_download_json()}
    </button>
  </div>

  <label class="flex items-start gap-2 text-sm border-t pt-4">
    <input
      type="checkbox"
      checked={includeApiKeys}
      onchange={onToggleIncludeApiKeys}
      class="mt-0.5"
    />
    <span>
      {m.backup_panel_include_api_keys()}
      <span class="block text-xs text-muted-foreground mt-1">
        {m.backup_panel_include_api_keys_warning()}
      </span>
    </span>
  </label>

  <label class="flex items-start gap-2 text-sm">
    <input
      type="checkbox"
      checked={includeFilerInfo}
      onchange={onToggleIncludeFilerInfo}
      class="mt-0.5"
    />
    <span>{m.backup_include_filer_info()}</span>
  </label>

  <div class="text-sm border-t pt-4">
    <label class="flex items-center justify-between gap-2" for="backup-retention-count">
      <span>{m.backup_panel_retention_label()}</span>
      <select
        id="backup-retention-count"
        value={retentionCount}
        onchange={onChangeRetentionCount}
        class="border rounded px-2 py-1 bg-background"
      >
        {#each BACKUP_RETENTION_COUNTS as count (count)}
          <option value={count}>{retentionOptionLabel(count)}</option>
        {/each}
      </select>
    </label>
    <span class="block text-xs text-muted-foreground mt-1">{m.backup_panel_retention_hint()}</span>
  </div>

  <div class="text-sm">
    <label class="flex items-center justify-between gap-2" for="blob-retention-days">
      <span>{m.backup_panel_blob_retention_label()}</span>
      <select
        id="blob-retention-days"
        value={blobRetentionDays}
        onchange={onChangeBlobRetentionDays}
        class="border rounded px-2 py-1 bg-background"
      >
        {#each BLOB_RETENTION_DAYS as days (days)}
          <option value={days}>{blobRetentionOptionLabel(days)}</option>
        {/each}
      </select>
    </label>
    <span class="block text-xs text-muted-foreground mt-1">
      {m.backup_panel_blob_retention_hint()}
    </span>
  </div>
</section>

<ConfirmDialog
  open={downloadSavedConfirmOpen}
  title={m.backup_download_saved_confirm_title()}
  description={m.backup_download_saved_confirm_desc()}
  proceedLabel={m.backup_download_saved_confirm_proceed()}
  cancelLabel={m.backup_download_saved_confirm_cancel()}
  dontAskLabel={m.backup_download_saved_confirm_dont_ask()}
  onconfirm={onDownloadSavedConfirm}
  oncancel={onDownloadSavedCancel}
/>
