// 解析完了の通知をクリックしたときの処理。workbox.importScripts で読み込まれる classic script なので、
// ES module の構文は使えず、アプリ側の検証関数も import できない。種別→経路の表と検証は
// src/stores/analysis.svelte.ts の ANALYSIS_ROUTE・analysisRouteFor と同じ規則の写しで、
// src/lib/analysis-notify-sw.test.ts が結果の一致を突き合わせる。
(function () {
  const ROUTES = { receipt: '/receipt', order: '/order-import', classify: '/import' };
  // vite.config.ts の navigateFallbackDenylist と同じ。SPA ではない実ファイルを開いているタブには送らない。
  const NON_APP_PATHS = [/^\/api\//, /^\/THIRD_PARTY_LICENSES\.txt$/];

  function routeOf(data) {
    if (typeof data !== 'object' || data === null) {
      return null;
    }
    const kind = data.kind;
    if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(ROUTES, kind)) {
      return null;
    }
    const path = ROUTES[kind];
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      return null;
    }
    return { kind: kind, path: path };
  }

  function isAppClient(client) {
    try {
      const pathname = new URL(client.url).pathname;
      return !NON_APP_PATHS.some(function (pattern) {
        return pattern.test(pathname);
      });
    } catch {
      return false;
    }
  }
  // 前面のタブ、次に見えているタブを選ぶ。解析を走らせたタブとは限らない。
  function pickClient(windowClients) {
    const candidates = windowClients.filter(isAppClient);
    return (
      candidates.find(function (client) {
        return client.focused === true;
      }) ??
      candidates.find(function (client) {
        return client.visibilityState === 'visible';
      }) ??
      candidates[0]
    );
  }
  // 通知のデータは信用せず、表にある種別だけを受け付ける。開く先は常に表から引く。
  self.aoikoNotificationClick = async function (data, clients) {
    const target = routeOf(data);
    if (target === null) {
      return;
    }
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = pickClient(windowClients);
    if (client === undefined) {
      await clients.openWindow(target.path);
      return;
    }
    client.postMessage({ type: 'aoiko-open-route', kind: target.kind });
    // 画面の移動は focus の成否に依存させない。
    try {
      await client.focus();
    } catch {
      // 前面化できなくても移動の指示は済んでいる。
    }
  };
  self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(self.aoikoNotificationClick(event.notification.data, self.clients));
  });
})();
