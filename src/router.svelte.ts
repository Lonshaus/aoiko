// 極小 history-API ルーター。SvelteKit を導入せずに、SPA で /journal や /settings を扱う。
// 未保存データを持つ画面が自身の状態を登録する。リンク遷移・プログラム遷移・
// ブラウザの戻る・タブを閉じる操作を、この 1 つの判定でカバーする。
//
// 判定関数ではなく「今 dirty かどうか」の値を受け取る。画面側で
// `$effect(() => { setUnsavedGuard(token, isDirty); return () => clearUnsavedGuard(token); })`
// と書けば $derived の読み取りが effect の中で完結するため、reactive graph の外
// （クリックハンドラや popstate）からは素の Set を見るだけで済む。
const dirtyOwners = new Set<object>();

export function setUnsavedGuard(owner: object, dirty: boolean): void {
  if (dirty) {
    dirtyOwners.add(owner);
  } else {
    dirtyOwners.delete(owner);
  }
}

export function clearUnsavedGuard(owner: object): void {
  dirtyOwners.delete(owner);
}

export function hasUnsavedChanges(): boolean {
  return dirtyOwners.size > 0;
}
// 状態を store に保持する画面は、app 内の移動では失われないので guard を登録しない。
// 代わりにタブを閉じる・再読み込みする場合だけ、保持している内容があるかをここで問い合わせる。
const unloadChecks = new Set<() => boolean>();

export function registerUnloadCheck(check: () => boolean): () => void {
  unloadChecks.add(check);
  return () => {
    unloadChecks.delete(check);
  };
}

export function hasUnloadRisk(): boolean {
  if (hasUnsavedChanges()) {
    return true;
  }
  for (const check of unloadChecks) {
    if (check()) {
      return true;
    }
  }
  return false;
}

class Router {
  path = $state('/');
  // 未保存の確認待ちの遷移先。App.svelte がこれを見て確認ダイアログを出す。
  pendingPath = $state<string | null>(null);

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }
    this.path = window.location.pathname;
    window.addEventListener('popstate', () => {
      const target = window.location.pathname;
      if (target !== this.path && hasUnsavedChanges()) {
        // popstate は発生後に取り消せないため、URL を現在の画面へ押し戻してから確認する。
        window.history.pushState(null, '', this.path);
        this.pendingPath = target;
        return;
      }
      this.path = target;
    });
    // 文言はブラウザ固定で自作できないため、独自メッセージは設定しない。
    window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
      if (hasUnloadRisk()) {
        e.preventDefault();
      }
    });
  }

  goto(path: string): void {
    if (this.path === path) {
      return;
    }
    if (hasUnsavedChanges()) {
      this.pendingPath = path;
      return;
    }
    this.commit(path);
  }
  // 確認ダイアログで「破棄して移動」を選んだとき。
  discardAndGo(): void {
    const path = this.pendingPath;
    this.pendingPath = null;
    if (path !== null) {
      this.commit(path);
    }
  }

  stay(): void {
    this.pendingPath = null;
  }

  private commit(path: string): void {
    window.history.pushState(null, '', path);
    this.path = path;
    window.scrollTo(0, 0);
  }
}

export const router = new Router();
// <a href='/journal' use:link> のように使う。同一オリジンの内部リンクのみを SPA 遷移にする。
export function link(node: HTMLAnchorElement) {
  function handle(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    if (e.button !== 0) {
      return;
    }
    if (node.target && node.target !== '_self') {
      return;
    }
    const href = node.getAttribute('href');
    if (!href) {
      return;
    }
    if (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('//') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return;
    }
    e.preventDefault();
    router.goto(href);
  }
  node.addEventListener('click', handle);
  return {
    destroy() {
      node.removeEventListener('click', handle);
    },
  };
}
