<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { m } from '../paraglide/messages';

  interface Props {
    open: boolean;
    previewUrl: string | null;
    onconfirm: (dontAskAgain: boolean) => void;
    oncancel: () => void;
  }

  let { open, previewUrl, onconfirm, oncancel }: Props = $props();
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
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.attachment_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.attachment_confirm_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    {#if previewUrl}
      <div class="border rounded-lg overflow-hidden bg-background flex items-center justify-center">
        <img src={previewUrl} alt={m.receipt_preview_alt()} class="max-h-64 object-contain" />
      </div>
    {/if}
    <label class="flex items-center gap-2 text-sm text-muted-foreground">
      <input type="checkbox" bind:checked={dontAskAgain} />
      {m.attachment_confirm_dont_ask()}
    </label>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={() => onconfirm(dontAskAgain)}>
        {m.attachment_confirm_proceed()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>