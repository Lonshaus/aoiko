<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { m } from '../paraglide/messages';

  interface Props {
    open: boolean;
    host: string;
    onconfirm: (dontAskAgain: boolean) => void;
    oncancel: () => void;
  }

  let { open, host, onconfirm, oncancel }: Props = $props();
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
      <AlertDialog.Title>{m.cloud_send_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {@html m.cloud_send_confirm_desc_html({ host })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <label class="flex items-center gap-2 text-sm text-muted-foreground">
      <input type="checkbox" bind:checked={dontAskAgain} />
      {m.cloud_send_confirm_dont_ask()}
    </label>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={() => onconfirm(dontAskAgain)}>
        {m.cloud_send_confirm_proceed()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
