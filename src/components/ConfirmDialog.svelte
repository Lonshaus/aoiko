<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { m } from '../paraglide/messages';

  interface Props {
    open: boolean;
    title: string;
    description?: string;
    descriptionHtml?: string;
    proceedLabel: string;
    cancelLabel?: string;
    dontAskLabel: string;
    preview?: Snippet;
    onconfirm: (dontAskAgain: boolean) => void;
    oncancel: () => void;
  }

  let {
    open,
    title,
    description,
    descriptionHtml,
    proceedLabel,
    cancelLabel,
    dontAskLabel,
    preview,
    onconfirm,
    oncancel,
  }: Props = $props();
  let dontAskAgain = $state(false);
</script>

<AlertDialog.Root
  {open}
  onOpenChange={(o) => {
    if (!o) {
      oncancel();
    }
  }}
>
  <AlertDialog.Content class={preview ? 'max-h-[85vh] overflow-y-auto' : undefined}>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description>
        {#if descriptionHtml}
          {@html descriptionHtml}
        {:else}
          {description}
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    {#if preview}
      {@render preview()}
    {/if}
    <label class="flex items-center gap-2 text-sm text-muted-foreground">
      <input type="checkbox" bind:checked={dontAskAgain} />
      {dontAskLabel}
    </label>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{cancelLabel ?? m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={() => onconfirm(dontAskAgain)}>
        {proceedLabel}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
