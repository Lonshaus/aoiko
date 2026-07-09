<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { router, link } from './router.svelte';
  import logoWordmark from './assets/logo-wordmark.png';
  import Home from './routes/Home.svelte';
  import UpdatePrompt from './components/UpdatePrompt.svelte';
  import DisclaimerConsent from './components/DisclaimerConsent.svelte';
  import { DISCLAIMER_VERSION, getSetting } from './lib/settings';
  import { pathToChapter } from './lib/manual-routes';
  import { m } from './paraglide/messages';

  const helpChapter = $derived(pathToChapter(router.path));
  const isManual = $derived(router.path === '/manual' || router.path.startsWith('/manual/'));

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
  // 初回ロードを軽くするため、ホーム以外の画面は遅延読み込みする。
  // memo で同一 promise を返し、画面遷移のたびに再 import されないようにする。
  function memo(
    importer: () => Promise<{ default: Component }>
  ): () => Promise<{ default: Component }> {
    let p: Promise<{ default: Component }> | null = null;
    return () => (p ??= importer());
  }
  const loadManual = memo(() => import('./routes/Manual.svelte'));
  const ROUTE_COMPONENT: Record<string, () => Promise<{ default: Component }>> = {
    '/journal': memo(() => import('./routes/JournalList.svelte')),
    '/reports': memo(() => import('./routes/Reports.svelte')),
    '/income-deductions': memo(() => import('./routes/IncomeDeductions.svelte')),
    '/import': memo(() => import('./routes/Import.svelte')),
    '/order-import': memo(() => import('./routes/OrderImport.svelte')),
    '/import-history': memo(() => import('./routes/ImportHistory.svelte')),
    '/receipt': memo(() => import('./routes/Receipt.svelte')),
    '/invoices': memo(() => import('./routes/Invoices.svelte')),
    '/settings': memo(() => import('./routes/Settings.svelte')),
    '/opening-setup': memo(() => import('./routes/OpeningSetup.svelte')),
    '/accountant-export': memo(() => import('./routes/AccountantExport.svelte')),
  };
  const routeLoader = $derived(ROUTE_COMPONENT[router.path] ?? null);
</script>

<div class="min-h-screen flex flex-col">
  <header class="print:hidden sticky top-0 z-10 border-b bg-card text-card-foreground">
    <div class="container mx-auto max-w-3xl px-8 py-4 flex items-center justify-between">
      <a href="/" use:link class="hover:opacity-80">
        <img src={logoWordmark} alt={m.app_name()} class="h-9 w-auto" />
      </a>
      <nav class="flex gap-6 text-sm">
        <a href="/" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_home()}</a>
        <a href="/journal" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_journal()}</a>
        <a href="/reports" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_reports()}</a>
        <a href="/income-deductions" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_income_deductions()}</a>
        <a href="/import" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_import()}</a>
        <a href="/order-import" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_order_import()}</a>
        <a href="/receipt" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_receipt()}</a>
        <a href="/invoices" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_invoices()}</a>
        <a href="/import-history" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_import_history()}</a>
        <a href="/settings" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_settings()}</a>
        <a href="/manual" use:link class="text-muted-foreground hover:text-foreground transition-colors">{m.nav_manual()}</a>
      </nav>
    </div>
  </header>
  <main class="flex-1 container mx-auto px-8 py-8 {isManual ? 'max-w-5xl' : 'max-w-3xl'}">
    {#if helpChapter}
      <div class="print:hidden mb-4 flex justify-end">
        <a
          href="/manual/{helpChapter}"
          use:link
          class="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ？{m.nav_manual()}
        </a>
      </div>
    {/if}
    {#if router.path === '/' || router.path === ''}
      <Home />
    {:else if router.path === '/manual' || router.path.startsWith('/manual/')}
      {#await loadManual() then mod}
        {@const Manual = mod.default}
        <Manual />
      {/await}
    {:else if routeLoader}
      {#await routeLoader() then mod}
        {@const Route = mod.default}
        <Route />
      {/await}
    {:else}
      <div class="space-y-4 py-12 text-center">
        <h2 class="text-lg font-semibold">{m.manual_not_found()}</h2>
        <p class="text-muted-foreground">{m.not_found_body()}</p>
        <a href="/" use:link class="text-primary hover:underline">{m.nav_home()}</a>
      </div>
    {/if}
  </main>
</div>

<UpdatePrompt />

{#if consentState === 'required'}
  <DisclaimerConsent onaccept={onConsentAccepted} />
{/if}