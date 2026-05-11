<script lang="ts">
  import { DISCLAIMER_VERSION, setSetting } from '../lib/settings';

  type Props = {
    onaccept: () => void;
  };
  let { onaccept }: Props = $props();

  let accepting = $state(false);

  async function accept() {
    accepting = true;
    try {
      await setSetting('disclaimerAcceptedAt', Date.now());
      await setSetting('disclaimerAcceptedVersion', DISCLAIMER_VERSION);
      onaccept();
    } finally {
      accepting = false;
    }
  }
</script>

<div
  class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
  role="dialog"
  aria-modal="true"
  aria-labelledby="disclaimer-title"
>
  <div class="bg-card text-card-foreground rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-8 space-y-6 shadow-xl">
    <header class="space-y-2">
      <h2 id="disclaimer-title" class="text-2xl font-bold">aoiko へようこそ</h2>
      <p class="text-sm text-muted-foreground">
        ご利用前に以下の <strong>免責事項</strong> をご確認ください。
      </p>
    </header>

    <section class="space-y-3 text-sm">
      <div class="rounded border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-3">
        <p class="font-medium">aoiko は <span class="underline">試作段階</span> のツールです。</p>
        <p class="text-xs mt-1">実申告での使用は利用者の自己責任となります。</p>
      </div>

      <ul class="space-y-2 list-disc list-inside">
        <li>
          出力する数値・<code>.xtx</code> ファイルの <strong>正確性は保証されません</strong>。最終的な数字は <strong>税理士・税務署</strong> に確認してください。
        </li>
        <li>
          税法・帳簿要件は <strong>年度ごとに改正</strong> されます。同梱の <code>tax-schema/</code> が最新の国税庁公告と一致しているかは利用者が確認してください。
        </li>
        <li>
          <code>.xtx</code> 出力は仮実装です。<strong>実申告での `.xtx` 利用は禁止</strong>。e-Tax ソフトで別途作成してください。
        </li>
        <li>
          LLM 分類・OCR を使う場合、CSV 行・領収書画像が <strong>Google Gemini</strong> に送信されます。機微情報の送信前にご確認ください。
        </li>
        <li>
          データは <strong>ブラウザ IndexedDB</strong> に保存されます。ブラウザのキャッシュクリアで消失するため、バックアップは利用者の責任で運用してください。
        </li>
        <li>
          確定申告・修正申告・税務調査対応で発生した <strong>いかなる損害</strong> についても開発者は責任を負いません。
        </li>
      </ul>

      <p class="text-xs text-muted-foreground pt-2 border-t">
        全文：<a
          href="https://github.com/Lonshaus/aoiko/blob/master/DISCLAIMER.md"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground"
        >DISCLAIMER.md</a>
        ／ <a
          href="https://github.com/Lonshaus/aoiko/blob/master/PRIVACY.md"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground"
        >PRIVACY.md</a>
        ／ <a
          href="https://github.com/Lonshaus/aoiko/blob/master/SECURITY.md"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground"
        >SECURITY.md</a>
        ／ <a
          href="https://github.com/Lonshaus/aoiko/blob/master/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground"
        >LICENSE (AGPL-3.0)</a>
      </p>
    </section>

    <footer class="flex justify-end pt-2">
      <button
        type="button"
        onclick={accept}
        disabled={accepting}
        data-testid="disclaimer-accept"
        class="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 font-medium"
      >
        {accepting ? '保存中…' : '上記を理解し、同意して開始する'}
      </button>
    </footer>
  </div>
</div>