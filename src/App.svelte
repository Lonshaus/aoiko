<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { router, link } from './router.svelte';
  import logoWordmark from './assets/logo-wordmark.png';
  import Home from './routes/Home.svelte';
  import UpdatePrompt from './components/UpdatePrompt.svelte';
  import DisclaimerConsent from './components/DisclaimerConsent.svelte';
  import UnsavedChangesDialog from './components/UnsavedChangesDialog.svelte';
  import FiledYearWarningDialog from './components/FiledYearWarningDialog.svelte';
  import { DISCLAIMER_VERSION, getSetting } from './lib/settings';
  import { pathToChapter } from './lib/manual-routes';
  import { isOpaqueError } from './lib/opaque-error';
  import { ledger } from './stores/ledger.svelte';
  import { m } from './paraglide/messages';

  const helpChapter = $derived(pathToChapter(router.path));
  const isManual = $derived(router.path === '/manual' || router.path.startsWith('/manual/'));
  // 器の幅は画面が抱える表の実寸で決める。狭すぎると表がはみ出し、列が一文字ずつ折り返して
  // 縦書きのようになる。器の内寸は max-w から左右 padding 64px を引いた値。
  // - /reports：決算書の表が実測 1002px。カードの内側 48px も引くので max-w-6xl（内寸 1040px）
  // - /journal：仕訳一覧の表が min-w-[720px]。max-w-5xl（内寸 960px）
  // - /manual：長文なので広げると読みにくい。表は無いので max-w-5xl のまま
  const PAGE_MAX_WIDTH: Record<string, string> = {
    '/reports': 'max-w-6xl',
    '/journal': 'max-w-5xl',
  };
  const mainMaxWidth = $derived(
    isManual ? 'max-w-5xl' : (PAGE_MAX_WIDTH[router.path] ?? 'max-w-3xl'),
  );

  type ConsentState = 'checking' | 'required' | 'granted';
  let consentState = $state<ConsentState>('checking');

  onMount(async () => {
    const acceptedAt = await getSetting('disclaimerAcceptedAt');
    const acceptedVersion = await getSetting('disclaimerAcceptedVersion');
    // 配布形態ごとに文面が進む速さが違い、こちらより新しい版に同意した記録が
    // バックアップ経由で入ってくる。厳密一致だと同意済みの利用者へ再同意を求めてしまう。
    if (
      acceptedAt &&
      typeof acceptedVersion === 'number' &&
      acceptedVersion >= DISCLAIMER_VERSION
    ) {
      consentState = 'granted';
    } else {
      consentState = 'required';
    }
  });

  function onConsentAccepted() {
    consentState = 'granted';
  }
  // svelte:boundary は描画・effect 中の例外しか捕捉しない。イベントハンドラや async の
  // 未捕捉例外はここで拾い、画面を殺さずに非破壊的なバナーで知らせる。連発しても
  // 単一バナーに畳むため boolean 一つで管理する。
  let showErrorBanner = $state(false);
  onMount(() => {
    const onError = (event: Event) => {
      if (isOpaqueError(event)) {
        return;
      }
      showErrorBanner = true;
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
    };
  });
  // liveQuery 購読の失敗（ledger ストア集約）も同じバナーで知らせる。
  $effect(() => {
    if (ledger.lastError !== null) {
      showErrorBanner = true;
    }
  });
  // 初回ロードを軽くするため、ホーム以外の画面は遅延読み込みする。
  // memo で同一 promise を返し、画面遷移のたびに再 import されないようにする。
  function memo(
    importer: () => Promise<{ default: Component }>,
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
  };
  const routeLoader = $derived(ROUTE_COMPONENT[router.path] ?? null);
  const NAV_ITEMS: { href: string; label: () => string }[] = [
    { href: '/', label: m.nav_home },
    { href: '/journal', label: m.nav_journal },
    { href: '/reports', label: m.nav_reports },
    { href: '/income-deductions', label: m.nav_income_deductions },
    { href: '/import', label: m.nav_import },
    { href: '/order-import', label: m.nav_order_import },
    { href: '/receipt', label: m.nav_receipt },
    { href: '/invoices', label: m.nav_invoices },
    { href: '/import-history', label: m.nav_import_history },
    { href: '/settings', label: m.nav_settings },
    { href: '/manual', label: m.nav_manual },
  ];
  let mobileNavOpen = $state(false);
</script>

<div class="min-h-screen flex flex-col">
  {#if showErrorBanner}
    <div
      class="print:hidden sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-destructive/40 bg-destructive/10 px-4 md:px-8 py-2 text-sm text-destructive pt-[calc(0.5rem+env(safe-area-inset-top))]"
    >
      <span>{m.error_banner_message()}</span>
      <button
        type="button"
        class="shrink-0 rounded px-2 py-1 hover:bg-destructive/20"
        onclick={() => (showErrorBanner = false)}
      >
        {m.common_close()}
      </button>
    </div>
  {/if}
  <header
    class="print:hidden sticky top-0 z-10 border-b bg-card text-card-foreground pt-[env(safe-area-inset-top)]"
  >
    <div
      class="container mx-auto max-w-5xl px-4 md:px-8 py-4 flex items-center justify-between gap-6"
    >
      <a href="/" use:link class="shrink-0 hover:opacity-80">
        <img src={logoWordmark} alt={m.app_name()} class="h-9 w-auto" />
      </a>
      <nav class="hidden md:flex flex-wrap justify-end gap-x-4 gap-y-1 text-sm">
        {#each NAV_ITEMS as item (item.href)}
          <a
            href={item.href}
            use:link
            class="whitespace-nowrap text-muted-foreground hover:text-foreground transition-colors py-2 -my-2"
            >{item.label()}</a
          >
        {/each}
      </nav>
      <button
        type="button"
        class="md:hidden shrink-0 rounded p-2 text-muted-foreground hover:text-foreground"
        aria-label={m.nav_menu()}
        aria-expanded={mobileNavOpen}
        onclick={() => (mobileNavOpen = !mobileNavOpen)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          {#if mobileNavOpen}
            <path d="M18 6 6 18M6 6l12 12" />
          {:else}
            <path d="M4 6h16M4 12h16M4 18h16" />
          {/if}
        </svg>
      </button>
    </div>
    {#if mobileNavOpen}
      <nav class="md:hidden border-t px-4 py-2 flex flex-col text-sm">
        {#each NAV_ITEMS as item (item.href)}
          <a
            href={item.href}
            use:link
            class="rounded px-2 py-2.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            onclick={() => (mobileNavOpen = false)}>{item.label()}</a
          >
        {/each}
      </nav>
    {/if}
  </header>
  <main
    class="flex-1 container mx-auto px-4 md:px-8 py-8 pb-[calc(2rem+env(safe-area-inset-bottom))] {mainMaxWidth}"
  >
    {#if helpChapter}
      <div class="print:hidden mb-4 flex justify-end">
        <a
          href="/manual/{helpChapter}"
          use:link
          class="text-sm text-muted-foreground hover:text-foreground transition-colors py-2 -my-2"
        >
          ？{m.nav_manual()}
        </a>
      </div>
    {/if}
    <svelte:boundary>
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
          <a href="/" use:link class="text-primary hover:underline py-2 -my-2">{m.nav_home()}</a>
        </div>
      {/if}
      {#snippet failed(error)}
        <div class="space-y-4 py-12">
          <h2 class="text-lg font-semibold text-destructive">{m.error_boundary_title()}</h2>
          <p class="text-muted-foreground">{m.error_boundary_body()}</p>
          <button
            type="button"
            class="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
            onclick={() => location.reload()}
          >
            {m.error_reload()}
          </button>
          <details class="text-sm text-muted-foreground">
            <summary class="cursor-pointer">{m.error_detail_summary()}</summary>
            <pre
              class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{error instanceof
              Error
                ? (error.stack ?? error.message)
                : String(error)}</pre>
          </details>
        </div>
      {/snippet}
    </svelte:boundary>
  </main>
</div>

<UpdatePrompt />
<UnsavedChangesDialog />
<FiledYearWarningDialog />

{#if consentState === 'required'}
  <DisclaimerConsent onaccept={onConsentAccepted} />
{/if}
