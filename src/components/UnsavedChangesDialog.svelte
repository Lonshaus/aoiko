<script lang="ts">
  import { router } from '../router.svelte';
  import { m } from '../paraglide/messages';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';

  const open = $derived(router.pendingPath !== null);
</script>

<AlertDialog.Root
  {open}
  onOpenChange={(next: boolean) => {
    if (!next) {
      router.stay();
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.unsaved_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.unsaved_confirm_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={() => router.stay()}>
        {m.unsaved_confirm_stay()}
      </AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => router.discardAndGo()}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {m.unsaved_confirm_discard()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
