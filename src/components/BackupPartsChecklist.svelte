<script lang="ts">
  import { m } from '../paraglide/messages';
  import { sortBackupParts, type BackupPartId } from '../backup/parts';

  interface Props {
    available: readonly BackupPartId[];
    selected: readonly BackupPartId[];
    locked?: readonly BackupPartId[];
    mode: 'export' | 'import';
    namePrefix: string;
    onchange: (next: BackupPartId[]) => void;
  }

  let { available, selected, locked = [], mode, namePrefix, onchange }: Props = $props();

  const LABELS: Record<BackupPartId, () => string> = {
    books: m.backup_part_books,
    attachments: m.backup_part_attachments,
    business: m.backup_part_business,
    ai: m.backup_part_ai,
    apiKeys: m.backup_part_api_keys,
    filer: m.backup_part_filer,
  };
  const HINTS: Record<BackupPartId, (() => string) | null> = {
    books: m.backup_part_books_hint,
    attachments: m.backup_part_attachments_hint,
    business: m.backup_part_business_hint,
    ai: m.backup_part_ai_hint,
    apiKeys: null,
    filer: null,
  };

  const shown = $derived(sortBackupParts(available));
  const lockedSet = $derived(new Set(locked));
  const selectedSet = $derived(new Set([...selected, ...locked]));
  // 証憑写真は帳簿データと一緒のときだけ意味を持つ（復元側も単独では受け付けない）。
  const booksOn = $derived(selectedSet.has('books'));

  function isChecked(id: BackupPartId): boolean {
    return selectedSet.has(id) && (id !== 'attachments' || booksOn);
  }

  function isDisabled(id: BackupPartId): boolean {
    return lockedSet.has(id) || (id === 'attachments' && !booksOn);
  }

  function toggle(id: BackupPartId, on: boolean): void {
    const next = new Set(selectedSet);
    if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }
    if (!next.has('books')) {
      next.delete('attachments');
    }
    onchange(sortBackupParts(next));
  }

  function warningFor(id: BackupPartId): string | null {
    if (mode === 'export' && id === 'apiKeys') {
      return m.backup_parts_api_keys_export_warning();
    }
    if (mode === 'import' && (id === 'ai' || id === 'apiKeys')) {
      return m.backup_parts_import_overwrite_warning();
    }
    return null;
  }
</script>

<div class="space-y-2">
  {#each shown as id (id)}
    {@const hint = HINTS[id]}
    {@const warning = warningFor(id)}
    <label class="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        name="{namePrefix}-{id}"
        checked={isChecked(id)}
        disabled={isDisabled(id)}
        onchange={(e) => toggle(id, e.currentTarget.checked)}
        class="mt-0.5"
      />
      <span>
        {LABELS[id]()}
        {#if hint}
          <span class="block text-xs text-muted-foreground mt-1">{hint()}</span>
        {/if}
        {#if warning}
          <span class="block text-xs text-destructive mt-1">{warning}</span>
        {/if}
      </span>
    </label>
  {/each}
</div>
