<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { m } from '../paraglide/messages';

  interface Props {
    open: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let { open, onconfirm, oncancel }: Props = $props();
</script>

<AlertDialog.Root
  {open}
  onOpenChange={(next: boolean) => {
    if (!next) {
      oncancel();
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.discard_candidates_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.discard_candidates_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={() => oncancel()}>
        {m.discard_candidates_stay()}
      </AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => onconfirm()}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {m.discard_candidates_discard()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
