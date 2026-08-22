<script lang="ts">
  import { onMount } from 'svelte';
  import { support } from '../stores/support.svelte';
  import { stampRotation } from '../domain/stamps';
  import type { IapProductKind } from '../lib/native-bridge';
  import { m } from '../paraglide/messages';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  let notice = $state('');

  // 投げっぱなしにすると未捕捉の例外としてエラーバナーが点く。
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

<dialog bind:this={dialog} class="support" {onclose}>
  <svg style="display: none" aria-hidden="true">
    <!-- aoiko のロゴにある肉球。PNG の輪郭を実測して起こしたもの。 -->
    <symbol id="support-cat" viewBox="0 0 64 64">
      <path
        d="M26.8 26.1 L27.5 26.4 L30.0 28.8 L31.4 28.6 L32.7 28.6 L34.0 28.8 L36.6 26.3 L37.0 26.1 L37.4 26.3 L37.4 28.9 L37.1 30.4 L37.6 31.7 L37.7 33.4 L37.1 35.3 L36.0 36.8 L37.1 38.6 L38.1 41.4 L38.9 44.9 L39.2 46.8 L39.2 48.1 L38.8 49.5 L38.1 50.2 L37.2 50.5 L36.1 50.8 L33.9 51.0 L30.2 51.0 L27.9 50.8 L27.0 50.6 L25.9 50.2 L25.2 49.5 L25.0 49.0 L24.8 48.2 L24.8 46.6 L25.2 43.8 L26.5 39.7 L27.4 37.7 L28.0 36.7 L27.0 35.4 L26.6 34.5 L26.3 33.5 L26.3 32.1 L26.8 30.5 L26.5 28.1 L26.6 26.5Z"
      />
      <path
        d="M31.7 18.2 L32.8 18.3 L33.6 18.8 L34.0 19.1 L34.8 20.5 L36.1 21.8 L36.4 22.5 L36.4 23.3 L36.1 24.0 L35.3 24.6 L34.2 24.7 L32.3 24.3 L31.4 24.3 L29.9 24.7 L29.0 24.7 L28.3 24.5 L27.8 23.9 L27.6 23.4 L27.6 22.5 L27.9 21.8 L29.2 20.5 L29.7 19.5 L30.4 18.8Z"
      />
      <path
        d="M36.9 16.4 L37.8 16.5 L38.4 17.1 L38.6 17.7 L38.6 18.4 L38.2 19.4 L37.5 20.2 L37.0 20.4 L36.5 20.5 L35.9 20.2 L35.4 19.3 L35.4 18.2 L35.6 17.7 L36.3 16.7Z"
      />
      <path
        d="M26.5 16.4 L27.1 16.4 L27.6 16.6 L28.2 17.3 L28.6 18.1 L28.6 19.4 L28.3 20.0 L27.7 20.4 L27.2 20.5 L26.4 20.1 L25.8 19.4 L25.5 18.7 L25.4 17.9 L25.6 17.2 L26.1 16.6Z"
      />
      <path
        d="M29.7 13.0 L30.4 13.1 L31.0 13.7 L31.3 14.1 L31.5 14.9 L31.5 15.6 L31.1 16.6 L30.7 17.0 L30.3 17.2 L29.6 17.1 L29.0 16.5 L28.5 15.3 L28.6 14.1 L28.9 13.6 L29.3 13.2Z"
      />
      <path
        d="M34.0 13.0 L34.4 13.0 L34.9 13.3 L35.5 14.3 L35.4 15.9 L35.1 16.4 L34.6 17.0 L34.1 17.2 L33.4 17.1 L32.9 16.6 L32.5 15.3 L32.6 14.6 L33.0 13.7 L33.5 13.2Z"
      />
    </symbol>
    <symbol id="support-paw" viewBox="0 -3 64 64">
      <ellipse cx="8.4" cy="26.9" rx="7.1" ry="9.9" transform="rotate(160.9 8.4 26.9)" />
      <ellipse cx="22.1" cy="11.0" rx="7.2" ry="10.1" transform="rotate(173.4 22.1 11.0)" />
      <ellipse cx="41.7" cy="11.0" rx="7.2" ry="10.2" transform="rotate(10.5 41.7 11.0)" />
      <ellipse cx="55.4" cy="27.0" rx="7.2" ry="10.0" transform="rotate(21.5 55.4 27.0)" />
      <path
        d="M51.7 43.7C52.3 44.8 52.7 45.9 52.9 47.1C53.0 48.2 52.9 49.4 52.7 50.5C52.4 51.6 52.0 52.8 51.3 53.7C50.6 54.6 49.6 55.4 48.5 55.9C47.5 56.5 46.3 57.0 45.1 57.1C43.9 57.3 42.5 57.1 41.3 56.9C40.1 56.7 38.9 56.1 37.9 55.9C36.9 55.6 36.2 55.4 35.5 55.3C34.7 55.1 34.1 55.0 33.5 54.9C32.8 54.8 32.3 54.7 31.7 54.7C31.1 54.7 30.6 54.8 29.9 54.9C29.3 54.9 28.7 54.9 28.0 55.1C27.3 55.2 26.6 55.4 25.6 55.7C24.7 55.9 23.5 56.5 22.3 56.7C21.1 56.9 19.6 57.2 18.3 57.1C17.1 57.0 15.7 56.7 14.7 56.1C13.7 55.5 12.8 54.6 12.1 53.7C11.5 52.8 10.9 51.7 10.7 50.6C10.4 49.5 10.3 48.2 10.5 47.1C10.6 46.0 11.1 44.8 11.7 43.7C12.3 42.7 13.3 41.8 14.1 40.9C14.9 40.1 15.9 39.5 16.5 38.8C17.2 38.1 17.6 37.5 18.1 36.8C18.6 36.1 19.0 35.5 19.4 34.8C19.8 34.1 20.2 33.3 20.6 32.7C21.1 32.0 21.7 31.4 22.3 30.7C22.9 30.1 23.5 29.4 24.1 28.9C24.8 28.3 25.6 27.8 26.4 27.4C27.2 27.0 28.1 26.7 29.0 26.4C29.8 26.2 30.8 26.0 31.7 26.0C32.6 26.0 33.6 26.2 34.4 26.4C35.3 26.6 36.2 26.9 37.0 27.3C37.9 27.7 38.6 28.2 39.3 28.7C40.0 29.3 40.7 30.0 41.2 30.6C41.8 31.3 42.3 32.0 42.7 32.7C43.2 33.4 43.6 34.1 44.0 34.8C44.4 35.5 44.8 36.1 45.3 36.8C45.8 37.5 46.2 38.1 46.9 38.8C47.6 39.5 48.5 40.1 49.3 40.9C50.1 41.8 51.1 42.7 51.7 43.7Z"
      />
    </symbol>
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

  {#if support.productFor('tip')}
    {@const tip = support.productFor('tip')}
    <div class="tiers">
      <button type="button" class="tier" disabled={support.busy} onclick={() => buy('tip')}>
        <svg class="chip" aria-hidden="true"><use href="#support-paw" /></svg>
        <span class="amount">{tip?.displayPrice}</span>
        <span class="label">{m.support_tip_label()}</span>
      </button>
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
                class="stamp {stamp.color}"
                class:just={stamp.id === support.justStamped}
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
        <div class="badge-face">
          <svg class="emblem" aria-hidden="true"><use href="#support-cat" /></svg>
        </div>
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
  .tiers {
    display: grid;
    justify-content: start;
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
    fill: var(--muted-foreground);
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
  /* 縁の形を差し替えられるよう、外周と盤面を別の層に分ける。border で縁を作ると
     多角形にしたとき幅が一定にならない。未購入のあいだは灰へ落として沈ませる。 */
  .badge {
    grid-area: badge;
    position: relative;
    width: 3.375rem;
    height: 3.375rem;
    filter: grayscale(1) brightness(0.72);
    opacity: 0.38;
  }
  .badge::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: linear-gradient(
      135deg,
      #ffffff 0%,
      #e7e9ff 10%,
      #6f7ab4 24%,
      #ffffff 38%,
      #b3bbe6 50%,
      #4f5a92 62%,
      #f2f4ff 78%,
      #8f99cf 90%,
      #ffffff 100%
    );
  }
  .badge::before,
  .badge-face,
  .badge-face::after {
    border-radius: 50%;
  }
  .badge-face {
    position: absolute;
    inset: 0.22rem;
    display: grid;
    place-items: center;
    overflow: hidden;
    background-image: radial-gradient(
      125% 125% at 30% 20%,
      #ffffff 0%,
      #f2f0ff 22%,
      #c4c9f0 48%,
      #8b93cc 74%,
      #dfe2fb 100%
    );
    box-shadow:
      inset 0 1px 1px rgb(255 255 255 / 60%),
      inset 0 -2px 4px rgb(40 48 96 / 32%);
  }
  /* 放射状の磨き跡。白金だけの飾り。 */
  .badge-face::before {
    content: '';
    position: absolute;
    inset: 0;
    background: conic-gradient(
      from 208deg,
      rgb(255 255 255 / 0) 0deg,
      rgb(255 255 255 / 60%) 22deg,
      rgb(255 255 255 / 0) 54deg,
      rgb(120 132 200 / 38%) 112deg,
      rgb(190 235 255 / 30%) 150deg,
      rgb(255 255 255 / 0) 172deg,
      rgb(255 255 255 / 66%) 206deg,
      rgb(255 255 255 / 0) 244deg,
      rgb(178 150 230 / 32%) 296deg,
      rgb(120 132 200 / 30%) 322deg,
      rgb(255 255 255 / 0) 360deg
    );
  }
  .badge-face::after {
    content: '';
    position: absolute;
    inset: 0.19rem;
    border: 1px solid rgb(255 255 255 / 60%);
    box-shadow: inset 0 0 0 1.5px rgb(72 82 138 / 30%);
  }
  .emblem {
    position: relative;
    display: block;
    width: 2.75rem;
    height: 2.75rem;
    fill: rgb(38 42 78 / 52%);
    filter: drop-shadow(0 1px 0 rgb(255 255 255 / 78%));
  }
  /* 1 行目は徽章と買うボタンで固定幅が埋まる。狭いとき見出しが 1 字ずつ折れるので、
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
  .badge-block.owned .badge {
    filter: drop-shadow(0 2px 6px rgb(78 92 180 / 50%));
    opacity: 1;
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
