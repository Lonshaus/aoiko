<script lang="ts">
  import { onMount } from 'svelte';
  import { support } from '../stores/support.svelte';
  import { stampRotation, type StampTier } from '../domain/stamps';
  import type { IapProductKind } from '../lib/native-bridge';
  import { m } from '../paraglide/messages';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  let notice = $state('');

  const TIERS: { kind: IapProductKind; tier: StampTier; label: () => string }[] = [
    { kind: 'tip-small', tier: 'bronze', label: m.support_tip_small },
    { kind: 'tip-medium', tier: 'silver', label: m.support_tip_medium },
    { kind: 'tip-large', tier: 'gold', label: m.support_tip_large },
  ];

  // 消耗型を 1 つも売っていない商店（ある環境 は支援者バッジだけ）では、金額ボタンも
  // スタンプ帳も出さない。押せない枠と、永久に 0 個のままの帳面が残るため。
  const hasTips = $derived(TIERS.some((t) => support.productFor(t.kind) !== undefined));

  onMount(() => {
    void support.load();
  });

  // showModal / close は命令的な API しか無く、宣言的に開閉できない。open を唯一の
  // 真とし、DOM 側をそれに合わせる一方向だけにする。
  $effect(() => {
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  async function buy(kind: IapProductKind): Promise<void> {
    notice = '';
    const result = await support.purchase(kind);
    if (result === 'pending') {
      notice = m.support_purchase_pending();
    }
  }

  async function restore(): Promise<void> {
    notice = '';
    const restored = await support.restore();
    if (restored !== 'unavailable' && restored.length === 0) {
      notice = m.support_restore_none();
    }
  }
</script>

<dialog bind:this={dialog} class="support" {onclose}>
  <svg style="display: none" aria-hidden="true">
    <!-- aoiko のロゴにある肉球。PNG の輪郭を実測して起こしたもの。 -->
    <symbol id="support-paw" viewBox="0 -3 64 64">
      <ellipse cx="8.4" cy="26.9" rx="7.1" ry="9.9" transform="rotate(160.9 8.4 26.9)" />
      <ellipse cx="22.1" cy="11.0" rx="7.2" ry="10.1" transform="rotate(173.4 22.1 11.0)" />
      <ellipse cx="41.7" cy="11.0" rx="7.2" ry="10.2" transform="rotate(10.5 41.7 11.0)" />
      <ellipse cx="55.4" cy="27.0" rx="7.2" ry="10.0" transform="rotate(21.5 55.4 27.0)" />
      <path
        d="M51.7 43.7C52.3 44.8 52.7 45.9 52.9 47.1C53.0 48.2 52.9 49.4 52.7 50.5C52.4 51.6 52.0 52.8 51.3 53.7C50.6 54.6 49.6 55.4 48.5 55.9C47.5 56.5 46.3 57.0 45.1 57.1C43.9 57.3 42.5 57.1 41.3 56.9C40.1 56.7 38.9 56.1 37.9 55.9C36.9 55.6 36.2 55.4 35.5 55.3C34.7 55.1 34.1 55.0 33.5 54.9C32.8 54.8 32.3 54.7 31.7 54.7C31.1 54.7 30.6 54.8 29.9 54.9C29.3 54.9 28.7 54.9 28.0 55.1C27.3 55.2 26.6 55.4 25.6 55.7C24.7 55.9 23.5 56.5 22.3 56.7C21.1 56.9 19.6 57.2 18.3 57.1C17.1 57.0 15.7 56.7 14.7 56.1C13.7 55.5 12.8 54.6 12.1 53.7C11.5 52.8 10.9 51.7 10.7 50.6C10.4 49.5 10.3 48.2 10.5 47.1C10.6 46.0 11.1 44.8 11.7 43.7C12.3 42.7 13.3 41.8 14.1 40.9C14.9 40.1 15.9 39.5 16.5 38.8C17.2 38.1 17.6 37.5 18.1 36.8C18.6 36.1 19.0 35.5 19.4 34.8C19.8 34.1 20.2 33.3 20.6 32.7C21.1 32.0 21.7 31.4 22.3 30.7C22.9 30.1 23.5 29.4 24.1 28.9C24.8 28.3 25.6 27.8 26.4 27.4C27.2 27.0 28.1 26.7 29.0 26.4C29.8 26.2 30.8 26.0 31.7 26.0C32.6 26.0 33.6 26.2 34.4 26.4C35.3 26.6 36.2 26.9 37.0 27.3C37.9 27.7 38.6 28.2 39.3 28.7C40.0 29.3 40.7 30.0 41.2 30.6C41.8 31.3 42.3 32.0 42.7 32.7C43.2 33.4 43.6 34.1 44.0 34.8C44.4 35.5 44.8 36.1 45.3 36.8C45.8 37.5 46.2 38.1 46.9 38.8C47.6 39.5 48.5 40.1 49.3 40.9C50.1 41.8 51.1 42.7 51.7 43.7Z"
      />
    </symbol>
  </svg>

  <h2>{m.support_title()}</h2>
  <p class="lead">{m.support_lead()}</p>

  {#if hasTips}
    <div class="tiers">
      {#each TIERS as t (t.kind)}
        {@const product = support.productFor(t.kind)}
        {#if product}
          <button
            type="button"
            class="tier {t.tier}"
            disabled={support.busy}
            onclick={() => buy(t.kind)}
          >
            <span class="chip"></span>
            <span class="amount">{product.displayPrice}</span>
            <span class="label">{t.label()}</span>
          </button>
        {/if}
      {/each}
    </div>
    <p class="note">{m.support_tiers_note()}</p>

    <div class="book">
      <div class="book-head">
        <strong>{m.support_book_title()}</strong>
        <span class="tally">{m.support_book_count({ count: support.stamps.length })}</span>
      </div>
      <div class="slots">
        {#each support.slots as stamp, i (i)}
          <div class="slot">
            {#if stamp}
              <span
                class="stamp {stamp.tier}"
                class:just={stamp.id === support.justStamped}
                style="--rot: {stampRotation(support.page * support.slots.length + i)}deg"
              >
                <svg class="paw" aria-hidden="true"><use href="#support-paw" /></svg>
                <span class="date">{stamp.at.replaceAll('-', '.')}</span>
              </span>
            {/if}
          </div>
        {/each}
      </div>
      <div class="pager">
        <button
          type="button"
          aria-label={m.support_book_prev()}
          disabled={support.page === 0}
          onclick={() => (support.page -= 1)}>‹</button
        >
        <span>{m.support_book_page({ page: support.page + 1, total: support.pageCount })}</span>
        <button
          type="button"
          aria-label={m.support_book_next()}
          disabled={support.page === support.pageCount - 1}
          onclick={() => (support.page += 1)}>›</button
        >
      </div>
    </div>
    <p class="note">{m.support_book_note()}</p>
  {/if}

  {#if support.productFor('supporter-badge')}
    {@const badge = support.productFor('supporter-badge')}
    <div class="badge-block" class:owned={support.badgeAt !== null}>
      <strong>{m.support_badge_title()}</strong>
      {#if support.badgeAt === null}
        <button
          type="button"
          class="buy"
          disabled={support.busy}
          onclick={() => buy('supporter-badge')}
        >
          {badge?.displayPrice}
        </button>
        <span class="badge-desc">{m.support_badge_desc()}</span>
      {:else}
        <span class="badge-desc">
          {m.support_badge_desc_owned({ date: support.badgeAt.replaceAll('-', '.') })}
        </span>
      {/if}
    </div>
  {/if}

  {#if notice}
    <p class="notice" role="status">{notice}</p>
  {/if}

  <div class="actions">
    <button type="button" class="link" title={m.support_restore_tip()} onclick={restore}>
      {m.support_restore()}
    </button>
    <button type="button" class="close" onclick={onclose}>{m.support_close()}</button>
  </div>
</dialog>

<style>
  /* スタンプ帳の紙と印章は Tailwind の語彙に無いので、この画面の中だけで組む。 */
  .support {
    --ink-bronze: oklch(0.58 0.11 55);
    --ink-silver: oklch(0.64 0.012 250);
    --ink-gold: oklch(0.72 0.14 85);
    --paper: oklch(0.985 0.008 90);
    --paper-line: oklch(0.9 0.012 90);
    /* showModal() の中央寄せはブラウザ既定の margin: auto に頼っている。Tailwind の
       preflight が全要素の margin を 0 にするのでそれが消え、左上へ寄る。 */
    margin: auto;
    width: min(30rem, calc(100vw - 2rem));
    max-height: 85vh;
    overflow-y: auto;
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--card);
    color: var(--card-foreground);
  }
  /* 暗色は app.css と同じく prefers-color-scheme で切り替える。クラスは付けていない。 */
  @media (prefers-color-scheme: dark) {
    .support {
      --paper: oklch(0.336 0.043 236);
      --paper-line: oklch(1 0 0 / 14%);
      --ink-bronze: oklch(0.74 0.1 55);
      --ink-silver: oklch(0.84 0.012 250);
      --ink-gold: oklch(0.86 0.14 88);
    }
  }
  .support::backdrop {
    background: rgb(0 0 0 / 45%);
  }
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.05rem;
    font-weight: 600;
  }
  .lead {
    margin: 0 0 1rem;
    font-size: 0.85rem;
    line-height: 1.7;
  }
  .note {
    margin: 0.5rem 0 1rem;
    font-size: 0.75rem;
    line-height: 1.7;
    color: var(--muted-foreground);
  }
  .notice {
    margin: 0 0 0.75rem;
    font-size: 0.8rem;
  }
  .tiers {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }
  .tier {
    display: grid;
    justify-items: center;
    gap: 0.25rem;
    padding: 0.75rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    background: var(--card);
    cursor: pointer;
  }
  .tier:hover:not(:disabled) {
    background: var(--accent);
  }
  .tier:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .chip {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
  }
  .bronze .chip {
    background: linear-gradient(150deg, #ffe6cc, #b8763a 42%, #8b5222 58%, #7a4419);
  }
  .silver .chip {
    background: linear-gradient(150deg, #ffffff, #b6bfcd 42%, #8b94a4 58%, #79828f);
  }
  .gold .chip {
    background: linear-gradient(150deg, #fff8dc, #d1a52c 42%, #9c7415 58%, #8a6512);
  }
  .amount {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .label {
    font-size: 0.7rem;
    color: var(--muted-foreground);
  }
  .book {
    padding: 0.75rem;
    border: 1px solid var(--paper-line);
    border-radius: 0.625rem;
    background: var(--paper);
  }
  .book-head {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
  }
  .slots {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin: 0.625rem 0;
  }
  .slot {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    border: 1px dashed var(--paper-line);
    border-radius: 0.5rem;
  }
  .stamp {
    display: grid;
    justify-items: center;
    gap: 0.125rem;
    transform: rotate(var(--rot));
  }
  /* 押した直後だけ跳ねる。集まった物を見るたびに動くと落ち着かない。 */
  .stamp.just {
    animation: press 320ms ease-out;
  }
  @keyframes press {
    from {
      transform: rotate(var(--rot)) scale(1.6);
      opacity: 0;
    }
    to {
      transform: rotate(var(--rot)) scale(1);
      opacity: 1;
    }
  }
  .paw {
    width: 1.5rem;
    height: 1.5rem;
  }
  .bronze .paw {
    fill: var(--ink-bronze);
  }
  .silver .paw {
    fill: var(--ink-silver);
  }
  .gold .paw {
    fill: var(--ink-gold);
  }
  .date {
    font-size: 0.55rem;
    color: var(--muted-foreground);
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    font-size: 0.75rem;
  }
  .pager button {
    padding: 0 0.375rem;
    cursor: pointer;
  }
  .pager button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .badge-block {
    display: grid;
    justify-items: center;
    gap: 0.375rem;
    padding: 0.875rem;
    border: 1px solid var(--border);
    border-radius: 0.625rem;
  }
  .badge-block.owned {
    border-color: var(--ink-gold);
  }
  .badge-desc {
    font-size: 0.7rem;
    color: var(--muted-foreground);
    text-align: center;
  }
  .buy {
    padding: 0.25rem 0.875rem;
    border-radius: 0.375rem;
    background: var(--primary);
    color: var(--primary-foreground);
    cursor: pointer;
  }
  .buy:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 1rem;
  }
  .link {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    text-decoration: underline;
    cursor: pointer;
  }
  .close {
    padding: 0.25rem 0.875rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    cursor: pointer;
  }
</style>
