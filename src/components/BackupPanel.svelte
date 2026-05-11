<script lang="ts">
  import { backup } from '../stores/backup.svelte';

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
      ? '初期化中…'
      : backup.status === 'unsupported'
        ? '⚠ ブラウザ非対応'
        : backup.status === 'unconfigured'
          ? '未設定'
          : backup.status === 'permission-required'
            ? '🔒 アクセス許可待ち'
            : backup.status === 'writing'
              ? '💾 書き込み中…'
              : backup.status === 'error'
                ? '⚠ エラー'
                : '✓ 正常'
  );

  const adapterLabel = $derived(
    backup.adapterKind === 'fsa'
      ? 'クラウド同期フォルダ（FSA API）'
      : backup.adapterKind === 'opfs'
        ? 'ブラウザ内 OPFS（フォルバック）'
        : '未対応'
  );
</script>

<section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
  <header class="flex items-baseline justify-between">
    <h3 class="text-lg font-semibold">バックアップ</h3>
    <span class="text-xs text-muted-foreground">{adapterLabel}</span>
  </header>

  {#if backup.adapterKind === 'fsa'}
    <p class="text-xs text-muted-foreground">
      iCloud Drive・Google Drive Desktop・Dropbox 等の同期フォルダを指定すると、仕訳を変更するたびに
      <code class="text-foreground">aoiko-ledger-YYYY-MM-DD.json</code> が自動的に書き出されます。
    </p>
  {:else if backup.adapterKind === 'opfs'}
    <p class="text-xs text-muted-foreground">
      このブラウザは外部フォルダへの書き込みに対応していないため、ブラウザ内のサンドボックス領域（OPFS）に自動保存します。<strong class="text-foreground">ブラウザのデータを消すと失われる</strong>ため、定期的に下の「JSON をダウンロード」を押して iCloud Drive 等に保存してください。
    </p>
  {:else if backup.adapterKind === 'none'}
    <p class="text-xs text-muted-foreground">
      このブラウザは自動バックアップに対応していません。「JSON をダウンロード」を頻繁に実行してください。
    </p>
  {/if}

  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
    <div>
      <div class="text-xs text-muted-foreground">状態</div>
      <div>{statusLabel}</div>
    </div>
    {#if backup.adapterKind === 'fsa'}
      <div>
        <div class="text-xs text-muted-foreground">フォルダ</div>
        <div class="font-mono text-xs break-all">{backup.folderName ?? '—'}</div>
      </div>
    {/if}
    <div>
      <div class="text-xs text-muted-foreground">最終バックアップ</div>
      <div>{lastBackupLabel}</div>
    </div>
    <div>
      <div class="text-xs text-muted-foreground">
        最終 JSON ダウンロード
        {#if downloadStale}
          <span class="text-destructive">⚠</span>
        {/if}
      </div>
      <div>{lastDownloadLabel}</div>
    </div>
    {#if backup.lastError}
      <div class="sm:col-span-2">
        <div class="text-xs text-muted-foreground">最終エラー</div>
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
          フォルダを選ぶ
        </button>
      {:else if backup.status === 'permission-required'}
        <button
          type="button"
          onclick={() => backup.grantPermission()}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          アクセスを許可
        </button>
        <button
          type="button"
          onclick={() => backup.configure()}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          フォルダを変更
        </button>
      {:else}
        <button
          type="button"
          onclick={() => backup.backup()}
          disabled={backup.status === 'writing'}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          今すぐバックアップ
        </button>
        <button
          type="button"
          onclick={() => backup.configure()}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          フォルダを変更
        </button>
      {/if}
    {:else if backup.adapterKind === 'opfs'}
      <button
        type="button"
        onclick={() => backup.backup()}
        disabled={backup.status === 'writing'}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        今すぐバックアップ
      </button>
    {/if}

    <button
      type="button"
      onclick={() => backup.downloadJson()}
      class="px-4 py-2 border rounded hover:bg-accent"
      class:bg-destructive={downloadStale}
      class:text-destructive-foreground={downloadStale}
      class:border-destructive={downloadStale}
    >
      JSON をダウンロード
    </button>
  </div>
</section>