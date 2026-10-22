// 解析完了の通知をクリックしたときの処理。workbox.importScripts で読み込まれる classic script なので、
// ES module の構文は使えない。種別→経路の表は src/stores/analysis.svelte.ts の ANALYSIS_ROUTE と同じ内容に保つ
// （src/lib/analysis-notify-sw.test.ts が突き合わせる）。
(() => {
  const ROUTES = { receipt: '/receipt', order: '/order-import', classify: '/import' };
  // 通知のデータは信用せず、表にある種別だけを受け付ける。開く先は常に表から引く。
  self.aoikoNotificationClick = async (data, clients) => {
    const kind = typeof data === 'object' && data !== null ? data.kind : undefined;
    if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(ROUTES, kind)) {
      return;
    }
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windowClients[0];
    if (client === undefined) {
      await clients.openWindow(ROUTES[kind]);
      return;
    }
    client.postMessage({ type: 'aoiko-open-route', kind });
    // 画面の移動は focus の成否に依存させない。
    try {
      await client.focus();
    } catch {
      // 前面化できなくても移動の指示は済んでいる。
    }
  };
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(self.aoikoNotificationClick(event.notification.data, self.clients));
  });
})();
