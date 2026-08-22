<script lang="ts">
  import { m } from '../paraglide/messages';

  interface Props {
    accept?: string;
    onchange: (event: Event) => void;
    // JournalList では行の開閉と重なるため、呼び出し側が伝播を止める。
    onclick?: (event: MouseEvent) => void;
  }

  let { accept, onchange, onclick }: Props = $props();
</script>

<!-- ボタンの文字はブラウザ自身の UI 言語で決まり、app の表示言語では変えられない。
     本物の input を label で包んで見た目だけ隠し、文字はこちらで出す。input を消さないので
     キーボード操作・読み上げ・iOS の選択シートはブラウザの実装のまま。 -->
<label class="inline-flex cursor-pointer items-center">
  <input type="file" {accept} {onchange} {onclick} class="peer sr-only" />
  <span
    class="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
  >
    {m.file_picker_choose()}
  </span>
</label>
