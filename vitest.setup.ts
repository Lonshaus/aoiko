// happy-dom には IndexedDB が含まれないため、fake-indexeddb で in-memory IDB を提供する。
// Dexie は `import 'fake-indexeddb/auto'` で透過的に動作する。
import 'fake-indexeddb/auto';
// 表示言語を ja に固定する。paraglide の strategy は localStorage → preferredLanguage →
// baseLocale で、指定しないと happy-dom の navigator.language（en-US）を拾って英語になる。
// 文言を突き合わせるテストが環境で揺れるため、ここで釘を打つ。個別に別の言語を見たい
// テストは getLocale を差し替える。
localStorage.setItem('PARAGLIDE_LOCALE', 'ja');
