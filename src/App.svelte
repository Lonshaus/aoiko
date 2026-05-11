<script lang="ts">
  import { onMount } from 'svelte';
  import { router, link } from './router.svelte';
  import Home from './routes/Home.svelte';
  import JournalList from './routes/JournalList.svelte';
  import Reports from './routes/Reports.svelte';
  import Import from './routes/Import.svelte';
  import ImportHistory from './routes/ImportHistory.svelte';
  import Receipt from './routes/Receipt.svelte';
  import Settings from './routes/Settings.svelte';
  import UpdatePrompt from './components/UpdatePrompt.svelte';
  import DisclaimerConsent from './components/DisclaimerConsent.svelte';
  import { DISCLAIMER_VERSION, getSetting } from './lib/settings';

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
</script>

<div class="min-h-screen flex flex-col">
  <header class="border-b bg-card text-card-foreground">
    <div class="container mx-auto max-w-3xl px-8 py-4 flex items-center justify-between">
      <a href="/" use:link class="text-xl font-bold hover:opacity-80">aoiko</a>
      <nav class="flex gap-6 text-sm">
        <a href="/" use:link class="text-muted-foreground hover:text-foreground transition-colors">ホーム</a>
        <a href="/journal" use:link class="text-muted-foreground hover:text-foreground transition-colors">一覧</a>
        <a href="/reports" use:link class="text-muted-foreground hover:text-foreground transition-colors">レポート</a>
        <a href="/import" use:link class="text-muted-foreground hover:text-foreground transition-colors">インポート</a>
        <a href="/receipt" use:link class="text-muted-foreground hover:text-foreground transition-colors">領収書</a>
        <a href="/import-history" use:link class="text-muted-foreground hover:text-foreground transition-colors">履歴</a>
        <a href="/settings" use:link class="text-muted-foreground hover:text-foreground transition-colors">設定</a>
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
    {:else if router.path === '/import-history'}
      <ImportHistory />
    {:else if router.path === '/receipt'}
      <Receipt />
    {:else if router.path === '/settings'}
      <Settings />
    {:else}
      <Home />
    {/if}
  </main>
</div>

<UpdatePrompt />

{#if consentState === 'required'}
  <DisclaimerConsent onaccept={onConsentAccepted} />
{/if}