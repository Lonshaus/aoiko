<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { filedYearGuard } from '../lib/filed-year-guard.svelte';
  import { m } from '../paraglide/messages';

  const pending = $derived(filedYearGuard.pending);
  let dontAskAgain = $state(false);
</script>

<AlertDialog.Root
  open={pending !== null}
  onOpenChange={(next: boolean) => {
    if (!next) {
      dontAskAgain = false;
      void filedYearGuard.resolve(false);
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.filed_year_warning_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.filed_year_warning_desc({ years: (pending?.years ?? []).join('、') })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    {#if pending?.detail}
      <p class="rounded bg-muted p-3 text-sm">{pending.detail}</p>
    {/if}
    {#if pending?.suppressible}
      <label class="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" bind:checked={dontAskAgain} />
        {m.filed_year_warning_dont_ask()}
      </label>
    {/if}
    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={() => void filedYearGuard.resolve(false)}>
        {m.common_cancel()}
      </AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => {
          const suppress = dontAskAgain;
          dontAskAgain = false;
          void filedYearGuard.resolve(true, suppress);
        }}
      >
        {m.filed_year_warning_proceed()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
