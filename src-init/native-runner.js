// iOS で解析を web view の外（アプリのプロセス）で走らせる入口。web view は裏に回ると止められる。
// 実行の本体（runner.js）が埋め込まれたビルドでだけ、プラグインがページより先に目印を置く。
// 渡すのは仕様のデータとジョブの識別子だけで、検査はプラグイン側が行う。
export function createNativeRunner(invoke, platform, runnerBuild) {
  if (platform !== 'ios' || runnerBuild !== true) {
    return null;
  }
  return {
    // 拒否は 'start-failed' / 'disallowed-url' の文字列で返る。
    async runAnalysis(spec) {
      return invoke('plugin:aoiko-native|analysis_runner_start', { spec });
    },
    // ジョブが終わるまで待ち、結果を 1 度だけ返す。
    async takeAnalysis(job) {
      return invoke('plugin:aoiko-native|analysis_runner_take', { job });
    },
    async cancelAnalysis(job) {
      return invoke('plugin:aoiko-native|analysis_runner_cancel', { job });
    },
  };
}
