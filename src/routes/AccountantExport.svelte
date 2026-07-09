<script lang="ts">
  import { link } from '../router.svelte';
  import { ledger } from '../stores/ledger.svelte';
  import { m } from '../paraglide/messages';
  import { exportCorrectionHistoryCsv, exportGenericCsv, exportYayoiCsv } from '../domain/accountant-export';

  let accountantExportError = $state('');

  function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
    const blob = new Blob([bytes.slice()], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function downloadYayoiCsv() {
    accountantExportError = '';
    try {
      const bytes = await exportYayoiCsv(ledger.currentYear);
      downloadBytes(bytes, `aoiko-yayoi-${ledger.currentYear}.csv`, 'text/csv');
    } catch (err) {
      accountantExportError = err instanceof Error ? err.message : String(err);
    }
  }

  async function downloadGenericCsv() {
    accountantExportError = '';
    try {
      const bytes = await exportGenericCsv(ledger.currentYear);
      downloadBytes(bytes, `aoiko-journal-${ledger.currentYear}.csv`, 'text/csv');
    } catch (err) {
      accountantExportError = err instanceof Error ? err.message : String(err);
    }
  }

  async function downloadCorrectionHistoryCsv() {
    accountantExportError = '';
    try {
      const bytes = await exportCorrectionHistoryCsv(ledger.currentYear);
      downloadBytes(bytes, `aoiko-corrections-${ledger.currentYear}.csv`, 'text/csv');
    } catch (err) {
      accountantExportError = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold">{m.settings_accountant_export_title()}</h2>
    <a href="/settings" use:link class="text-sm text-muted-foreground hover:text-foreground">
      {m.nav_settings()}
    </a>
  </div>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <p class="text-xs text-muted-foreground">{m.settings_accountant_export_intro({ year: ledger.currentYear })}</p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        onclick={downloadYayoiCsv}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_accountant_export_yayoi()}
      </button>
      <button
        type="button"
        onclick={downloadGenericCsv}
        class="px-4 py-2 border rounded hover:bg-accent"
      >
        {m.settings_accountant_export_generic()}
      </button>
      <button
        type="button"
        onclick={downloadCorrectionHistoryCsv}
        class="px-4 py-2 border rounded hover:bg-accent"
      >
        {m.settings_accountant_export_corrections()}
      </button>
    </div>
    <p class="text-xs text-muted-foreground border-t pt-2">
      {m.settings_accountant_export_disclaimer()}
    </p>
    {#if accountantExportError}
      <div class="text-sm text-destructive">{accountantExportError}</div>
    {/if}
  </section>
</div>