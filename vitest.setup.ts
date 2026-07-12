// happy-dom には IndexedDB が含まれないため、fake-indexeddb で in-memory IDB を提供する。
// Dexie は `import 'fake-indexeddb/auto'` で透過的に動作する。
import 'fake-indexeddb/auto';
