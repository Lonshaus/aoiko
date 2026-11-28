<script lang="ts">
  import { router } from '../router.svelte';
  import { analysis, ANALYSIS_ROUTE, type AnalysisKind } from '../stores/analysis.svelte';
  import { updateCard } from '../stores/update-card.svelte';
  import { m } from '../paraglide/messages';

  const SCREEN_NAME: Record<AnalysisKind, () => string> = {
    receipt: m.nav_receipt,
    order: m.nav_order_import,
    classify: m.nav_import,
  };

  function open(id: number, kind: AnalysisKind) {
    analysis.dismissNotice(id);
    router.goto(ANALYSIS_ROUTE[kind]);
  }
</script>

<div
  role="status"
  aria-live="polite"
  class="print:hidden pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 px-4"
  style:padding-bottom="calc(1rem + env(safe-area-inset-bottom) + {updateCard.offset > 0
    ? updateCard.offset + 8
    : 0}px)"
>
  <!-- 読み上げが拾えるよう、通知が無い間も live region 自体は残す。 -->
  {#each analysis.notices as notice (notice.id)}
    <div
      data-analysis-toast={notice.kind}
      class="pointer-events-auto flex w-full max-w-md items-stretch overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg"
    >
      <button
        type="button"
        class="flex-1 px-4 py-3 text-left text-sm hover:bg-accent/50"
        onclick={() => open(notice.id, notice.kind)}
      >
        {notice.outcome === 'done'
          ? m.analysis_toast_done({ name: SCREEN_NAME[notice.kind]() })
          : m.analysis_toast_failed({ name: SCREEN_NAME[notice.kind]() })}
      </button>
      <button
        type="button"
        class="shrink-0 px-3 text-muted-foreground hover:text-foreground"
        aria-label={m.common_close()}
        onclick={() => analysis.dismissNotice(notice.id)}
      >
        ✕
      </button>
    </div>
  {/each}
</div>
