<script lang="ts">
  import { onMount } from 'svelte';
  import { router, link } from './router.svelte';
  import Home from './routes/Home.svelte';
  import JournalList from './routes/JournalList.svelte';
  import Reports from './routes/Reports.svelte';
  import Import from './routes/Import.svelte';
  import ImportHistory from './routes/ImportHistory.svelte';
  import OrderImport from './routes/OrderImport.svelte';
  import Receipt from './routes/Receipt.svelte';
  import Settings from './routes/Settings.svelte';
  import UpdatePrompt from './components/UpdatePrompt.svelte';
  import DisclaimerConsent from './components/DisclaimerConsent.svelte';
  import { DISCLAIMER_VERSION, getSetting } from './lib/settings';
  import { m } from './paraglide/messages';

  type ConsentState = 'checking' | 'required' | 'granted';
  let consentState = $state<ConsentState>('checking');

  onMount(async () => {
    const acceptedAt = await getSetting('disclaimerAcceptedAt');
    const acceptedVersion = await getSetting('disclaimerAcceptedVersion');
    if (acceptedAt && acceptedVersion === DISCLAIMER_VERSION) {
      consentState = 'granted';
    } else {
      consentState = 'required';
    }
  });

  function onConsentAccepted() {
    consentState = 'granted';
  }

  // 使い方ページ（marked + 全マニュアル本文）は初回ロードを軽くするため遅延読み込みする。
  // 同一 promise を返してマニュアル内のページ遷移で再 import されないようにする。
  let manualModule: Promise<typeof import('./routes/Manual.svelte')> | null = null;
  function loadManual() {
    if (!manualModule) {
      manualModule = import('./routes/Manual.svelte');
    }
    return manualModule;
  }
</script>

<div class="min-h-screen flex flex-col">
  <header class="border-b bg-card text-card-foreground">
    <div class="container mx-auto max-w-3xl px-8 py-4 flex items-center justify-between">
      <a href="/" use:link class="text-xl font-bold hover:opacity-80">{m.app_name()}</a>
      <nav class="flex gap-6 text-sm">
        <a href="/" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_home()}</a>
        <a href="/journal" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_journal()}</a>
        <a href="/reports" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_reports()}</a>
        <a href="/import" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_import()}</a>
        <a href="/order-import" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_order_import()}</a>
        <a href="/receipt" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_receipt()}</a>
        <a href="/import-history" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_import_history()}</a>
        <a href="/settings" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_settings()}</a>
        <a href="/manual" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_manual()}</a>
      </nav>
    </div>
  </header>
  <main class="flex-1 container mx-auto max-w-3xl px-8 py-8">
    {#if router.path === '/journal'}
      <JournalList />
    {:else if router.path === '/reports'}
      <Reports />
    {:else if router.path === '/import'}
      <Import />
    {:else if router.path === '/order-import'}
      <OrderImport />
    {:else if router.path === '/import-history'}
      <ImportHistory />
    {:else if router.path === '/receipt'}
      <Receipt />
    {:else if router.path === '/settings'}
      <Settings />
    {:else if router.path === '/manual' || router.path.startsWith('/manual/')}
      {#await loadManual() then mod}
        {@const Manual = mod.default}
        <Manual />
      {/await}
    {:else}
      <Home />
    {/if}
  </main>
</div>

<UpdatePrompt />

{#if consentState === 'required'}
  <DisclaimerConsent onaccept={onConsentAccepted} />
{/if}