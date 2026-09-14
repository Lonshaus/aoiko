<script lang="ts">
  import type { Snippet } from 'svelte';
  import { m } from '../paraglide/messages';
  interface Props {
    children: Snippet;
    class?: string;
  }

  let { children, class: className }: Props = $props();
  let el = $state<HTMLDivElement | null>(null);
  let moreLeft = $state(false);
  let moreRight = $state(false);

  function update() {
    if (!el) {
      return;
    }
    // 端で 1px 残る環境があるため、余りを切り捨ててから比べる。
    const max = el.scrollWidth - el.clientWidth;
    moreLeft = el.scrollLeft > 1;
    moreRight = max > 1 && el.scrollLeft < max - 1;
  }

  $effect(() => {
    const node = el;
    if (!node) {
      return;
    }
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    for (const child of node.children) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  });
</script>

<div class={['relative', className]}>
  {#if moreRight}
    <div
      aria-hidden="true"
      data-scroll-hint="right"
      class="pointer-events-none absolute -top-5 right-1 text-xs text-muted-foreground"
    >
      {m.common_scroll_more_right()} ›
    </div>
  {/if}
  <div bind:this={el} onscroll={update} class="scroll-x">
    {@render children()}
  </div>
  {#if moreLeft}
    <div
      class="pointer-events-none absolute inset-y-0 left-0 w-10 rounded-[inherit] bg-gradient-to-r from-card to-transparent"
    ></div>
  {/if}
  {#if moreRight}
    <div
      class="pointer-events-none absolute inset-y-0 right-0 w-16 rounded-[inherit] bg-gradient-to-l from-card to-transparent"
    ></div>
  {/if}
</div>

<style>
  /* 環境によってはスクロールバーが触るまで現れず、横に続くこと自体に気付けない。細く常時出す。 */
  .scroll-x {
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: rgb(128 128 128 / 0.45) transparent;
  }
  .scroll-x::-webkit-scrollbar {
    height: 8px;
  }
  .scroll-x::-webkit-scrollbar-thumb {
    background: rgb(128 128 128 / 0.45);
    border-radius: 4px;
  }
  .scroll-x::-webkit-scrollbar-track {
    background: transparent;
  }
</style>
