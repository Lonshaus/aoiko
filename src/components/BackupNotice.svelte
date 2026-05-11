<script lang="ts">
  import { backup } from '../stores/backup.svelte';
  import { link } from '../router.svelte';

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
    <span class="text-muted-foreground">⚠ バックアップフォルダが未設定です</span>
    <a href="/settings" use:link class="text-primary hover:underline">設定で構成 →</a>
  </div>
{:else if backup.status === 'permission-required'}
  <div class="flex items-center justify-between gap-3 text-xs border rounded-lg px-3 py-2 bg-card text-card-foreground">
    <span class="text-muted-foreground">🔒 「{backup.folderName}」へのアクセス許可が必要</span>
    <a href="/settings" use:link class="text-primary hover:underline">設定で許可 →</a>
  </div>
{:else if backup.status === 'unsupported'}
  <div class="text-xs border border-destructive/50 rounded-lg px-3 py-2 bg-card text-destructive">
    ⚠ このブラウザは自動バックアップに対応していません。設定から JSON をこまめにダウンロードしてください。
  </div>
{:else if backup.status === 'error'}
  <div class="flex items-center justify-between gap-3 text-xs border border-destructive rounded-lg px-3 py-2 bg-card">
    <span class="text-destructive">バックアップエラー: {backup.lastError}</span>
    <a href="/settings" use:link class="text-primary hover:underline">設定 →</a>
  </div>
{:else if opfsStale}
  <div class="flex items-center justify-between gap-3 text-xs border border-destructive/50 rounded-lg px-3 py-2 bg-card">
    <span class="text-destructive">
      ⚠ OPFS のみで保存中、{downloadDays === null ? '一度も' : `${downloadDays} 日`} JSON をダウンロードしていません。ブラウザのデータが消えると全損します。
    </span>
    <a href="/settings" use:link class="text-primary hover:underline">設定で操作 →</a>
  </div>
{/if}