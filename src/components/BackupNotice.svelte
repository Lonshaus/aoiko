<script lang="ts">
  import { backup } from '../stores/backup.svelte';
  import { daysSince, needsOffsiteBackupWarning } from '../backup/schedule';
  import { link } from '../router.svelte';
  import { m } from '../paraglide/messages';

  const downloadDays = $derived(daysSince(backup.lastDownloadAt));
  const noOffsiteBackup = $derived(
    needsOffsiteBackupWarning(backup.adapterKind, backup.status, downloadDays),
  );
</script>

{#if backup.status === 'unconfigured'}
  <div
    class="flex items-center justify-between gap-3 text-xs border rounded-lg px-3 py-2 bg-card text-card-foreground"
  >
    <span class="text-muted-foreground">{m.backup_notice_unconfigured()}</span>
    <a href="/settings" use:link class="text-primary hover:underline"
      >{m.backup_notice_action_configure()}</a
    >
  </div>
{:else if backup.status === 'permission-required'}
  <div
    class="flex items-center justify-between gap-3 text-xs border rounded-lg px-3 py-2 bg-card text-card-foreground"
  >
    <span class="text-muted-foreground"
      >{m.backup_notice_permission_required({ folderName: backup.folderName ?? '' })}</span
    >
    <a href="/settings" use:link class="text-primary hover:underline"
      >{m.backup_notice_action_grant()}</a
    >
  </div>
{:else if backup.status === 'unsupported'}
  <div class="text-xs border border-destructive/50 rounded-lg px-3 py-2 bg-card text-destructive">
    {m.backup_notice_unsupported()}
  </div>
{:else if backup.status === 'error'}
  <div
    class="flex items-center justify-between gap-3 text-xs border border-destructive rounded-lg px-3 py-2 bg-card"
  >
    <span class="text-destructive">{m.backup_notice_error({ error: backup.lastError ?? '' })}</span>
    <a href="/settings" use:link class="text-primary hover:underline"
      >{m.backup_notice_action_settings()}</a
    >
  </div>
{/if}

{#if noOffsiteBackup}
  <div
    class="flex items-center justify-between gap-3 text-xs border border-destructive/50 rounded-lg px-3 py-2 bg-card"
  >
    <span class="text-destructive">
      {downloadDays === null
        ? m.backup_notice_no_offsite_never()
        : m.backup_notice_no_offsite_days({ days: downloadDays })}
    </span>
    <a href="/settings" use:link class="text-primary hover:underline"
      >{m.backup_notice_action_operate()}</a
    >
  </div>
{/if}
