// happy-dom には IndexedDB が含まれないため、fake-indexeddb で in-memory IDB を提供する。
// Dexie は `import 'fake-indexeddb/auto'` で透過的に動作する。
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
// 表示言語を ja に固定する。paraglide の strategy は localStorage → preferredLanguage →
// baseLocale で、指定しないと happy-dom の navigator.language（en-US）を拾って英語になる。
// 文言を突き合わせるテストが環境で揺れるため、ここで釘を打つ。個別に別の言語を見たい
// テストは getLocale を差し替える。
localStorage.setItem('PARAGLIDE_LOCALE', 'ja');
// AlertDialog のスクロール解除は実 setTimeout で遅れて走り、CI の負荷次第で環境の片付けより後になって document 未定義で落ちるため、解除まで待つ。
afterEach(async () => {
  if (typeof document === 'undefined') {
    return;
  }
  const timeoutMs = 5000;
  const start = Date.now();
  while (document.body.style.overflow === 'hidden') {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        'body-scroll-lock の解除タイマーが 5 秒以内に実行されなかった（bits-ui AlertDialog）',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
});
