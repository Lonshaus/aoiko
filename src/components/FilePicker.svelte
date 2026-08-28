<script lang="ts">
  import { m } from '../paraglide/messages';
  import { nativeBridge } from '../lib/native-bridge';

  interface Props {
    accept?: string;
    onchange: (event: Event) => void;
    // JournalList では行の開閉と重なるため、呼び出し側が伝播を止める。
    onclick?: (event: MouseEvent) => void;
    // 撮影の入口も出すか。領収書と証憑だけが true で、CSV と復元は渡さない。
    camera?: boolean;
  }

  let { accept, onchange, onclick, camera = false }: Props = $props();

  // 相機の無い端末で押せないボタンを生やさないため、平台だけでは決めない。
  let cameraReady = $state(false);
  $effect(() => {
    if (!camera) {
      return;
    }
    let alive = true;
    void nativeBridge()
      ?.isCameraAvailable?.()
      .then((ok) => {
        if (alive) {
          cameraReady = ok;
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });
</script>

<!-- ボタンの文字はブラウザ自身の UI 言語で決まり、app の表示言語では変えられない。
     本物の input を label で包んで見た目だけ隠し、文字はこちらで出す。input を消さないので
     キーボード操作・読み上げ・環境ごとの選択シートはブラウザの実装のまま。 -->
<span class="inline-flex flex-wrap items-center gap-2">
  <label class="inline-flex cursor-pointer items-center">
    <input type="file" {accept} {onchange} {onclick} class="peer sr-only" />
    <span
      class="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
    >
      {m.file_picker_choose()}
    </span>
  </label>
  <!-- capture が付くと wry の onShowFileChooser が ACTION_IMAGE_CAPTURE へ回す。
       選ぶ側の入口は上に残すので、撮影を足しても相簿から選ぶ道は塞がらない。 -->
  {#if cameraReady}
    <label class="inline-flex cursor-pointer items-center">
      <input type="file" {accept} {onchange} {onclick} capture="environment" class="peer sr-only" />
      <span
        class="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
      >
        {m.file_picker_camera()}
      </span>
    </label>
  {/if}
</span>
