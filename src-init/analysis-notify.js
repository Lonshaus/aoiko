// 解析の完了通知と、解析中の「作業中」宣言。実装のある環境でだけ入口を用意する
// （無い環境で用意すると、設定画面に押しても何も起きないトグルが出る）。
// 渡せる値は種別・結果・言語の列挙値とジョブの識別子だけで、通知の文面はネイティブ側が持つ。
const PLATFORMS = ['macos', 'windows'];
const OPEN_EVENT = 'aoiko-analysis-open';

export function createAnalysisNotify(invoke, listen, platform) {
  if (!PLATFORMS.includes(platform)) {
    return null;
  }
  return {
    // 'unsupported' | 'default' | 'denied' | 'granted'
    async notificationStatus() {
      return invoke('plugin:aoiko-native|notification_status');
    },
    // 利用者の操作の中で呼ぶ。応答は notificationStatus と同じ値。
    async requestNotification() {
      return invoke('plugin:aoiko-native|notification_request');
    },
    async notifyAnalysis(kind, outcome, locale) {
      return invoke('plugin:aoiko-native|analysis_notify', { kind, outcome, locale });
    },
    async analysisActivityBegin(job) {
      return invoke('plugin:aoiko-native|analysis_activity_begin', { job });
    },
    async analysisActivityEnd(job) {
      return invoke('plugin:aoiko-native|analysis_activity_end', { job });
    },
    // 通知が押されたときの合図。中身は信用せず、受け取る側で検証する。
    // 戻り値は購読を解く関数。
    async onAnalysisOpen(callback) {
      return listen(OPEN_EVENT, (event) => callback(event.payload));
    },
  };
}
