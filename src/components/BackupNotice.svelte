<script lang="ts">
  import { backup } from '../stores/backup.svelte';
  import { link } from '../router.svelte';
  import { m } from '../paraglide/messages';

  function daysSince(ts: number | null): number | null {
    if (!ts) {
      return null;
    }
    return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  }

  const downloadDays = $derived(daysSince(backup.lastDownloadAt));
  const opfsStale = $derived(
    backup.adapterKind === 'opfs' &&
      (downloadDays === null || downloadDays >= 7)
  );
</script>

{#if backup.status === 'unconfigured'}
  <div class="flex items-center justify-between gap-3 text-xs border rounded-lg px-3 py-2 bg-card text-card-foreground">
    <span class="text-muted-foreground">{m.backup_notice_unconfigured()}</span>
    <a href="/settings" use:link class="text-primary hover:underline">{m.backup_notice_action_configure()}</a>
  </div>
{:else if backup.status === 'permission-required'}
  <div class="flex items-center justify-between gap-3 text-xs border rounded-lg px-3 py-2 bg-card text-card-foreground">
    <span class="text-muted-foreground">{m.backup_notice_permission_required({ folderName: backup.folderName ?? '' })}</span>
    <a href="/settings" use:link class="text-primary hover:underline">{m.backup_notice_action_grant()}</a>
  </div>
{:else if backup.status === 'unsupported'}
  <div class="text-xs border border-destructive/50 rounded-lg px-3 py-2 bg-card text-destructive">
    {m.backup_notice_unsupported()}
  </div>
{:else if backup.status === 'error'}
  <div class="flex items-center justify-between gap-3 text-xs border border-destructive rounded-lg px-3 py-2 bg-card">
    <span class="text-destructive">{m.backup_notice_error({ error: backup.lastError ?? '' })}</span>
    <a href="/settings" use:link class="text-primary hover:underline">{m.backup_notice_action_settings()}</a>
  </div>
{:else if opfsStale}
  <div class="flex items-center justify-between gap-3 text-xs border border-destructive/50 rounded-lg px-3 py-2 bg-card">
    <span class="text-destructive">
      {downloadDays === null ? m.backup_notice_opfs_stale_never() : m.backup_notice_opfs_stale_days({ days: downloadDays })}
    </span>
    <a href="/settings" use:link class="text-primary hover:underline">{m.backup_notice_action_operate()}</a>
  </div>
{/if}