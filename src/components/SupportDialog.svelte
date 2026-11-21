<script lang="ts">
  import { onMount } from 'svelte';
  import { support } from '../stores/support.svelte';
  import { stampRotation } from '../domain/stamps';
  import SupporterBadge from './SupporterBadge.svelte';
  import type { IapProductKind } from '../lib/native-bridge';
  import { m } from '../paraglide/messages';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  let notice = $state('');
  // 投げっぱなしにすると未捕捉の例外としてエラーバナーが表示される。
  onMount(() => {
    void support.load().catch(() => {
      notice = m.support_purchase_failed();
    });
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
  // 背後の暗幕は dialog 自身が受け取るので、押された座標が箱の外かどうかで見分ける。
  // padding の内側も target は dialog になるため、target の比較だけでは足りない。
  function closeOnBackdrop(event: MouseEvent): void {
    // detail が 0 なのはキーボード操作由来。座標を持たないので箱の外と誤判定する。
    if (dialog === null || event.target !== dialog || event.detail === 0) {
      return;
    }
    const box = dialog.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    if (outside) {
      onclose();
    }
  }

  async function buy(kind: IapProductKind): Promise<void> {
    notice = '';
    let result;
    try {
      result = await support.purchase(kind);
    } catch {
      notice = m.support_purchase_failed();
      return;
    }
    if (result === 'pending') {
      notice = m.support_purchase_pending();
    }
  }

  async function retryProducts(): Promise<void> {
    notice = '';
    try {
      await support.loadProducts();
    } catch {
      notice = m.support_purchase_failed();
    }
  }

  async function restore(): Promise<void> {
    notice = '';
    let restored;
    try {
      restored = await support.restore();
    } catch {
      notice = m.support_purchase_failed();
      return;
    }
    if (restored !== 'unavailable' && restored.length === 0) {
      notice = m.support_restore_none();
    }
  }
</script>

<dialog bind:this={dialog} class="support" {onclose} onclick={closeOnBackdrop}>
  <svg style="display: none" aria-hidden="true">
    <symbol id="stamp-yarn" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="25" />
      <path fill="var(--paper)" d="M16 23.5C24 17.5 40 17.5 48 23.5L48 27C40 21 24 21 16 27Z" />
      <path fill="var(--paper)" d="M12 33.5C22 25.5 42 25.5 52 33.5L52 37C42 29 22 29 12 37Z" />
      <path fill="var(--paper)" d="M14 44C23 36.5 41 36.5 50 44L50 47.5C41 40 23 40 14 47.5Z" />
    </symbol>
    <symbol id="stamp-mouse" viewBox="0 0 64 64">
      <circle cx="24" cy="17" r="10" />
      <circle fill="var(--paper)" cx="24" cy="17" r="4.6" />
      <path
        d="M55 43C51 34 44 27 33 27C22 27 13 32 13 39C13 45 19 49 28 49L49 49C53 49 57 47 55 43Z"
      />
      <path
        d="M13 41C4 44 3 53 12 53"
        fill="none"
        stroke="currentColor"
        stroke-width="4.5"
        stroke-linecap="round"
      />
      <circle fill="var(--paper)" cx="45" cy="38" r="2.8" />
    </symbol>
    <symbol id="stamp-bell" viewBox="0 0 64 64">
      <circle cx="32" cy="36" r="20" />
      <path d="M32 17V10" fill="none" stroke="currentColor" stroke-width="4.5" />
      <circle cx="32" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="4" />
      <rect fill="var(--paper)" x="14" y="42" width="36" height="4.5" rx="2.2" />
      <circle fill="var(--paper)" cx="32" cy="50" r="4.2" />
    </symbol>
    <symbol id="stamp-feather" viewBox="0 0 64 64">
      <path d="M32 5C46 15 50 30 46 42C43 51 37 56 32 58C27 56 21 51 18 42C14 30 18 15 32 5Z" />
      <path
        d="M32 9V56"
        fill="none"
        stroke="var(--paper)"
        stroke-width="3"
        stroke-linecap="round"
      />
      <path
        fill="none"
        stroke="var(--paper)"
        d="M32 22L21 18M32 34L19 32M32 45L22 46M32 22L43 18M32 34L45 32M32 45L42 46"
        stroke-width="2.4"
        stroke-linecap="round"
      />
    </symbol>
    <symbol id="stamp-fish" viewBox="0 0 64 64">
      <path d="M13 32C19 20 32 16 42 20C50 23 55 27 58 32C55 37 50 41 42 44C32 48 19 44 13 32Z" />
      <path d="M14 32L3 21L6 32L3 43Z" />
      <circle fill="var(--paper)" cx="48" cy="29" r="2.8" />
      <path
        fill="none"
        stroke="var(--paper)"
        d="M38 22C35 27 35 37 38 42"
        stroke-width="2.6"
        stroke-linecap="round"
      />
    </symbol>
    <symbol id="stamp-butterfly" viewBox="0 0 64 64">
      <ellipse cx="21" cy="24" rx="13" ry="10" transform="rotate(-28 21 24)" />
      <ellipse cx="43" cy="24" rx="13" ry="10" transform="rotate(28 43 24)" />
      <ellipse cx="24" cy="42" rx="10" ry="8" transform="rotate(20 24 42)" />
      <ellipse cx="40" cy="42" rx="10" ry="8" transform="rotate(-20 40 42)" />
      <rect x="30.2" y="16" width="3.6" height="33" rx="1.8" />
      <path
        d="M32 18C29 12 26 9 22 7M32 18C35 12 38 9 42 7"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
      <circle fill="var(--paper)" cx="20" cy="23" r="3.2" />
      <circle fill="var(--paper)" cx="44" cy="23" r="3.2" />
    </symbol>
    <symbol id="stamp-teaser" viewBox="0 0 64 64">
      <path
        d="M9 55L36 28"
        fill="none"
        stroke="currentColor"
        stroke-width="5"
        stroke-linecap="round"
      />
      <circle cx="44" cy="20" r="10" />
      <circle cx="52" cy="12" r="5" />
      <circle cx="36" cy="12" r="5" />
      <circle cx="53" cy="27" r="4.5" />
      <circle cx="36" cy="28" r="4.5" />
      <circle cx="44" cy="6" r="5" />
    </symbol>
  </svg>

  <h2>{m.support_title()}</h2>
  <p class="lead">{m.support_lead()}</p>

  {#if support.hasStamps}
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
                class="stamp {stamp.color}"
                style="--rot: {stampRotation(support.page * support.slots.length + i)}deg"
              >
                <svg class="toy" aria-hidden="true"><use href="#stamp-{stamp.shape}" /></svg>
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

  {#if support.productsMissing}
    <div class="missing">
      <span>{m.support_products_missing()}</span>
      <button type="button" disabled={support.busy} onclick={retryProducts}>
        {m.support_products_retry()}
      </button>
    </div>
  {/if}

  {#if support.productFor('supporter-badge')}
    {@const badge = support.productFor('supporter-badge')}
    <div class="badge-block" class:owned={support.badgeAt !== null}>
      <div class="badge">
        <SupporterBadge owned={support.badgeAt !== null} />
      </div>
      <strong class="badge-title">{m.support_badge_title()}</strong>
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
    --ink-red: oklch(0.72 0.14 25);
    --ink-orange: oklch(0.76 0.13 62);
    --ink-yellow: oklch(0.8 0.13 95);
    --ink-green: oklch(0.74 0.12 150);
    --ink-blue: oklch(0.72 0.11 220);
    --ink-indigo: oklch(0.66 0.13 275);
    --ink-violet: oklch(0.7 0.14 330);
    --ink-badge: oklch(0.72 0.14 85);
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
      --ink-red: oklch(0.79 0.13 25);
      --ink-orange: oklch(0.83 0.12 62);
      --ink-yellow: oklch(0.87 0.12 95);
      --ink-green: oklch(0.82 0.11 150);
      --ink-blue: oklch(0.8 0.1 220);
      --ink-indigo: oklch(0.75 0.12 275);
      --ink-violet: oklch(0.78 0.13 330);
      --ink-badge: oklch(0.86 0.14 88);
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
  .toy {
    width: 1.5rem;
    height: 1.5rem;
    fill: currentColor;
    /* 判子は紙にべた塗りされない。わずかに透かしてインクの乗りを出す。 */
    opacity: 0.92;
  }
  .red {
    color: var(--ink-red);
  }
  .orange {
    color: var(--ink-orange);
  }
  .yellow {
    color: var(--ink-yellow);
  }
  .green {
    color: var(--ink-green);
  }
  .blue {
    color: var(--ink-blue);
  }
  .indigo {
    color: var(--ink-indigo);
  }
  .violet {
    color: var(--ink-violet);
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
  .missing {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.75rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    font-size: 0.85rem;
  }
  .missing button {
    flex: none;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .badge-block {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'badge title buy'
      'desc desc desc';
    align-items: center;
    column-gap: 0.875rem;
    row-gap: 0.375rem;
    padding: 0.875rem;
    border: 1px solid var(--border);
    border-radius: 0.625rem;
  }
  .badge-title {
    grid-area: title;
  }
  .badge-block .buy {
    grid-area: buy;
  }
  .badge-desc {
    grid-area: desc;
  }
  .badge {
    grid-area: badge;
  }
  /* 1 行目はバッジと買うボタンで固定幅が埋まる。狭いとき見出しが 1 字ずつ折れるので、
     ボタンを下の行へ逃がす。 */
  @media (max-width: 23.4375rem) {
    .badge-block {
      grid-template-columns: auto 1fr;
      grid-template-areas:
        'badge title'
        'desc desc';
    }
    .badge-block .buy {
      grid-area: desc;
      justify-self: start;
    }
  }
  .badge-block.owned {
    border-color: var(--ink-badge);
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
