<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';
  import { m } from '../paraglide/messages';
  import { nativeBridge } from '../lib/native-bridge';
  import { classifyNeedRefresh, refreshAction } from '../lib/update-prompt';

  let updateAvailable = $state(false);
  let offlineReady = $state(false);
  let dismissOffline = $state(false);
  let registerFailed = $state(false);
  let dismissRegisterFailed = $state(false);
  let cardHeight = $state(0);
  const cardShown = $derived(
    updateAvailable ||
      (offlineReady && !dismissOffline) ||
      (registerFailed && !dismissRegisterFailed),
  );
  let updateFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
  let registration: ServiceWorkerRegistration | undefined;
  let controlledAtRegister = false;

  onMount(() => {
    // ネイティブのシェルの中では Service Worker を登録しない。シェルが使う
    // HTTP family 以外のスキームでは web view が登録を明確に拒否するため、登録を試みると
    // 起動のたびに onRegisterError の警告が出る。更新は配布元（ストア）が担うので、
    // ここでの更新提示自体が要らない。
    //
    // `virtual:pwa-register` の import はここで使っているので残る。使っていないと
    // VitePWA の injectRegister: 'auto' が index.html へ登録スクリプトを自動注入する。
    if (nativeBridge() !== null) {
      return;
    }
    controlledAtRegister =
      'serviceWorker' in navigator && navigator.serviceWorker.controller !== null;
    updateFn = registerSW({
      onNeedRefresh() {
        // controller が無いページはネットワークから最新を取得済みで、waiting は初回インストール中の自分の worker に過ぎない。
        if (classifyNeedRefresh(navigator.serviceWorker.controller !== null) === 'update') {
          updateAvailable = true;
        } else {
          offlineReady = true;
        }
      },
      onRegisteredSW(_swUrl, reg) {
        registration = reg;
      },
      onOfflineReady() {
        offlineReady = true;
      },
      // オフライン動作の要となる Service Worker が登録できない場合。今回のセッションは
      // オンラインのまま使えるので警告どまりに留め、原因追跡用に console にも残す。
      onRegisterError(error) {
        console.error('[aoiko] Service Worker の登録に失敗しました', error);
        registerFailed = true;
      },
    });
  });

  async function refresh() {
    // 登録時に controller が無いと workbox-window が isUpdate=false で固定し自動再読み込みされないため、こちらで一度だけ再読み込みする。
    const action = refreshAction(registration?.waiting != null, controlledAtRegister);
    if (action === 'reload') {
      location.reload();
      return;
    }
    if (action === 'skip-waiting-then-reload') {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
        once: true,
      });
    }
    if (updateFn) {
      await updateFn(true);
    }
  }
</script>

{#if updateAvailable}
  <div
    bind:offsetHeight={cardHeight}
    class="print:hidden fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-50 bg-card text-card-foreground border rounded-lg shadow-lg p-4 max-w-sm"
  >
    <p class="text-sm font-medium mb-1">{m.update_available_title()}</p>
    <p class="text-xs text-muted-foreground mb-3">
      {m.update_available_hint()}
    </p>
    <div class="flex gap-2 justify-end">
      <button
        type="button"
        onclick={() => (updateAvailable = false)}
        class="px-3 py-1 text-xs border rounded hover:bg-accent"
      >
        {m.update_action_later()}
      </button>
      <button
        type="button"
        onclick={refresh}
        class="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.update_action_now()}
      </button>
    </div>
  </div>
{:else if offlineReady && !dismissOffline}
  <div
    bind:offsetHeight={cardHeight}
    class="print:hidden fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-50 bg-card text-card-foreground border rounded-lg shadow-sm p-3 max-w-sm flex items-center gap-3"
  >
    <span class="text-xs text-muted-foreground">
      {m.update_offline_ready()}
    </span>
    <button
      type="button"
      onclick={() => (dismissOffline = true)}
      aria-label={m.common_close()}
      class="text-muted-foreground hover:text-foreground"
    >
      ×
    </button>
  </div>
{:else if registerFailed && !dismissRegisterFailed}
  <div
    bind:offsetHeight={cardHeight}
    class="print:hidden fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-50 bg-card text-card-foreground border rounded-lg shadow-sm p-3 max-w-sm flex items-center gap-3"
  >
    <span class="text-xs text-muted-foreground">
      {m.update_register_error()}
    </span>
    <button
      type="button"
      onclick={() => (dismissRegisterFailed = true)}
      aria-label={m.common_close()}
      class="text-muted-foreground hover:text-foreground"
    >
      ×
    </button>
  </div>
{/if}
{#if cardShown}
  <!-- 固定カードが文書末尾の操作部品に被らないよう、カードの高さ＋上下の余白（1rem）＋下端の safe area ぶんだけスクロール領域を延ばす。 -->
  <div
    aria-hidden="true"
    class="print:hidden"
    style:height="calc({cardHeight}px + 2rem + env(safe-area-inset-bottom))"
  ></div>
{/if}
