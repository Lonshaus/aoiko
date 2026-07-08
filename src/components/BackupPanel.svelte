<script lang="ts">
  import { onMount } from 'svelte';
  import { backup } from '../stores/backup.svelte';
  import { getSetting, setSetting } from '../lib/settings';
  import { m } from '../paraglide/messages';

  let includeApiKeys = $state(false);
  let includeFilerInfo = $state(false);

  onMount(async () => {
    includeApiKeys = (await getSetting('backupIncludeApiKeys')) ?? false;
    includeFilerInfo = (await getSetting('backupIncludeFilerInfo')) ?? false;
  });

  async function onToggleIncludeApiKeys(e: Event) {
    includeApiKeys = (e.target as HTMLInputElement).checked;
    await setSetting('backupIncludeApiKeys', includeApiKeys);
  }

  async function onToggleIncludeFilerInfo(e: Event) {
    includeFilerInfo = (e.target as HTMLInputElement).checked;
    await setSetting('backupIncludeFilerInfo', includeFilerInfo);
  }

  function formatTime(ts: number | null): string {
    if (!ts) {
      return '—';
    }
    return new Date(ts).toLocaleString('ja-JP');
  }

  function daysSince(ts: number | null): number | null {
    if (!ts) {
      return null;
    }
    return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  }

  const lastBackupLabel = $derived(formatTime(backup.lastBackupAt));
  const lastDownloadLabel = $derived(formatTime(backup.lastDownloadAt));
  const downloadDays = $derived(daysSince(backup.lastDownloadAt));
  const downloadStale = $derived(
    backup.adapterKind === 'opfs' && (downloadDays === null || downloadDays >= 7)
  );

  const statusLabel = $derived(
    backup.status === 'initializing'
      ? m.backup_panel_status_initializing()
      : backup.status === 'unsupported'
        ? m.backup_panel_status_unsupported()
        : backup.status === 'unconfigured'
          ? m.backup_panel_status_unconfigured()
          : backup.status === 'permission-required'
            ? m.backup_panel_status_permission_required()
            : backup.status === 'writing'
              ? m.backup_panel_status_writing()
              : backup.status === 'error'
                ? m.backup_panel_status_error()
                : m.backup_panel_status_ok()
  );

  const adapterLabel = $derived(
    backup.adapterKind === 'fsa'
      ? m.backup_panel_adapter_fsa()
      : backup.adapterKind === 'opfs'
        ? m.backup_panel_adapter_opfs()
        : m.backup_panel_adapter_none()
  );
</script>

<section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
  <header class="flex items-baseline justify-between">
    <h3 class="text-lg font-semibold">{m.backup_panel_title()}</h3>
    <span class="text-xs text-muted-foreground">{adapterLabel}</span>
  </header>

  {#if backup.adapterKind === 'fsa'}
    <p class="text-xs text-muted-foreground">
      {@html m.backup_panel_intro_fsa_html()}
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

  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
    <div>
      <div class="text-xs text-muted-foreground">{m.backup_panel_label_status()}</div>
      <div>{statusLabel}</div>
    </div>
    {#if backup.adapterKind === 'fsa'}
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
    {#if backup.adapterKind === 'fsa'}
      {#if backup.status === 'unconfigured'}
        <button
          type="button"
          onclick={() => backup.configure()}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.backup_panel_action_choose_folder()}
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
      onclick={() => backup.downloadBackup()}
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
</section>