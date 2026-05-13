// 極小 history-API ルーター。SvelteKit を導入せずに、SPA で /journal や /settings を扱う。
class Router {
  path = $state('/');

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }
    this.path = window.location.pathname;
    window.addEventListener('popstate', () => {
      this.path = window.location.pathname;
    });
  }

  goto(path: string): void {
    if (this.path === path) {
      return;
    }
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