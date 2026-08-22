<script lang="ts">
  import { flushSync } from 'svelte';
  import type { AccountGroup } from '../stores/ledger.svelte';

  interface Props {
    value: string;
    groups: AccountGroup[];
    placeholder?: string;
    disabled?: boolean;
    class?: string;
    onchange?: () => void;
  }

  let {
    value = $bindable(),
    groups,
    placeholder,
    disabled = false,
    class: className = '',
    onchange,
  }: Props = $props();

  const selectedName = $derived(
    groups.flatMap((g) => g.items).find((a) => a.code === value)?.name ?? '',
  );
  // 勘定科目は 57 件あるため、行ごとにこの <select> を持つ画面（CSV 取込・注文取込）で
  // 全行分の <option> を先に作ると 1000 行規模で描画が破綻する。開くまでは選択済みの
  // 1 件だけを持ち、pointerdown / focus で本体を挿入する。flushSync がないと Svelte の
  // 更新はマイクロタスクに回され、ブラウザがポップアップを組み立てた後に反映されてしまう。
  let expanded = $state(false);

  function expand() {
    if (expanded) {
      return;
    }
    expanded = true;
    flushSync();
  }
</script>

<select bind:value {disabled} {onchange} onpointerdown={expand} onfocus={expand} class={className}>
  {#if expanded}
    {#if placeholder !== undefined}
      <option value="">{placeholder}</option>
    {/if}
    {#each groups as group (group.category)}
      <optgroup label={group.label}>
        {#each group.items as a (a.code)}
          <option value={a.code}>{a.code} {a.name}</option>
        {/each}
      </optgroup>
    {/each}
  {:else if value}
    <option {value}>{value} {selectedName}</option>
  {:else if placeholder !== undefined}
    <option value="">{placeholder}</option>
  {/if}
</select>
