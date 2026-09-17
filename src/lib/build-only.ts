// build ごとに出し分ける区画の印。web の産物に別配布形態向けの記述を一切残さないため、
// 表示時ではなくビルド時に取り除く（vite.config.ts の load フックから呼ぶ）。
//
//   <!-- only:browser -->
//   ブラウザで開いているときだけの説明
//   <!-- /only -->
//
// 入れ子は扱わない。印の数が合わない・知らない種別が来たら例外にする。黙って通すと、
// 閉じ忘れ 1 つで反対側の build 向けの文章がそのまま出てしまう。
const BLOCK =
  /^[ \t]*<!--[ \t]*only:([a-z]+)[ \t]*-->[ \t]*\r?\n([\s\S]*?)^[ \t]*<!--[ \t]*\/only[ \t]*-->[ \t]*\r?\n?/gm;
const OPEN = /^[ \t]*<!--[ \t]*only:([a-z]+)[ \t]*-->/gm;
const CLOSE = /^[ \t]*<!--[ \t]*\/only[ \t]*-->/gm;
const ANY = /<!--[ \t]*\/?only[^>]*-->/g;
const KINDS = ['browser', 'native'];

function atLineStart(text: string, index: number): boolean {
  const head = text.lastIndexOf('\n', index - 1) + 1;
  return text.slice(head, index).trim() === '';
}

export function stripBuildOnly(markdown: string, native: boolean, label = 'markdown'): string {
  const opens = [...markdown.matchAll(OPEN)];
  const closes = [...markdown.matchAll(CLOSE)];
  // 行頭に無い印は上の 2 つに拾われない。数だけ見ると釣り合って見えるので、
  // 素通りして反対側の build に文章が残る。引用の中（`> <!-- only:… -->`）で実際に起きた。
  const loose = [...markdown.matchAll(ANY)].filter(
    (m) => m.index !== undefined && !atLineStart(markdown, m.index),
  );
  if (loose.length > 0) {
    const line = markdown.slice(0, loose[0]!.index).split('\n').length;
    throw new Error(
      `${label}:${line}: 印は行頭に単独で置く（\`${loose[0]![0]}\` の前に文字がある）`,
    );
  }
  if (opens.length !== closes.length) {
    throw new Error(
      `${label}: only: の印が ${opens.length} 個、閉じが ${closes.length} 個で合わない`,
    );
  }
  for (const [, kind] of opens) {
    if (!KINDS.includes(kind!)) {
      throw new Error(`${label}: 知らない種別 only:${kind}（${KINDS.join(' / ')} のみ）`);
    }
  }
  const keep = native ? 'native' : 'browser';
  return markdown.replace(BLOCK, (_all, kind: string, body: string) => (kind === keep ? body : ''));
}
