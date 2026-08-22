import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameRequest, parseReplyFrame, requestMeta } from './frame.js';
// Node の Request は undici 実装。Chromium と同じ 6 形状で meta が一致することを
// 実測して確かめてある（method の導出・ヘッダーの並び・content-type の補完・バイト数）。
// アプリが実際に載る WKWebView / WebView2 は別実装だが、ここで固定するのは fetch 仕様の側。
function decode(frame) {
  const metaLength = new DataView(frame.buffer, frame.byteOffset).getUint32(0, true);
  return {
    frameBytes: frame.byteLength,
    metaLength,
    meta: JSON.parse(new TextDecoder().decode(frame.subarray(4, 4 + metaLength))),
    body: frame.subarray(4 + metaLength),
  };
}

async function build(input, init) {
  const req = new Request(input, init);
  const body = await req.arrayBuffer();
  return decode(frameRequest(requestMeta(req), body));
}

test('method を省いた取得は GET になり body を持たない', async () => {
  // 公開 repo の llm.ts、モデル一覧の取得がこの形。
  const got = await build('https://api.example.com/v1/models', {
    headers: { authorization: 'Bearer k' },
  });
  assert.equal(got.meta.method, 'GET');
  assert.equal(got.body.byteLength, 0);
  assert.deepEqual(got.meta.headers, [['authorization', 'Bearer k']]);
});

test('Headers インスタンスでもプレーンオブジェクトでも同じ meta になる', async () => {
  const plain = await build('https://api.example.com/v1/models', {
    headers: { authorization: 'Bearer k' },
  });
  const instance = await build('https://api.example.com/v1/models', {
    headers: new Headers({ authorization: 'Bearer k' }),
  });
  assert.deepEqual(instance.meta, plain.meta);
});

test('文字列 body には content-type が補われる', async () => {
  const got = await build('https://api.example.com/x', { method: 'POST', body: 'plain text' });
  assert.deepEqual(got.meta.headers, [['content-type', 'text/plain;charset=UTF-8']]);
  assert.equal(got.body.byteLength, 10);
});

test('多バイト文字が UTF-8 のまま載る', async () => {
  const payload = JSON.stringify({ prompt: '領収書' });
  const got = await build('https://api.example.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
  });
  // 「領収書」は 1 文字 3 バイト。文字数で数えると合わない。
  assert.equal(got.body.byteLength, new TextEncoder().encode(payload).byteLength);
  assert.equal(new TextDecoder().decode(got.body), payload);
});

test('query 文字列は URL に残る', async () => {
  // Gemini は API キーを query に載せる。ここで落ちると認証だけが失敗する。
  const got = await build(
    'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=K',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  );
  assert.ok(got.meta.url.endsWith('?key=K'), got.meta.url);
});

test('大きい body が欠けない', async () => {
  const sent = new Uint8Array(200 * 1024).fill(7);
  const got = await build('https://api.example.com/ocr', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: sent,
  });
  assert.equal(got.body.byteLength, sent.byteLength);
  assert.deepEqual(got.body, sent);
});

test('枠の長さは常に 4 + meta + body に一致する', async () => {
  for (const init of [
    { headers: { authorization: 'Bearer k' } },
    { method: 'POST', body: 'x' },
    { method: 'POST', body: new Uint8Array(70 * 1024) },
  ]) {
    const got = await build('https://api.example.com/x', init);
    assert.equal(got.frameBytes, 4 + got.metaLength + got.body.byteLength);
  }
});

test('応答の枠を解いて status と body が戻る', async () => {
  const head = { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } };
  const meta = new TextEncoder().encode(JSON.stringify(head));
  const payload = new TextEncoder().encode('{"ok":true}');
  const reply = new Uint8Array(4 + meta.byteLength + payload.byteLength);
  new DataView(reply.buffer).setUint32(0, meta.byteLength, true);
  reply.set(meta, 4);
  reply.set(payload, 4 + meta.byteLength);
  const parsed = parseReplyFrame(reply);
  assert.equal(parsed.head.status, 200);
  assert.equal(new TextDecoder().decode(parsed.payload), '{"ok":true}');
});
