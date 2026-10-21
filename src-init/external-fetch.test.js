import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExternalFetch } from './external-fetch.js';

function replyFrame(head, payload) {
  const metaBytes = new TextEncoder().encode(JSON.stringify(head));
  const frame = new Uint8Array(4 + metaBytes.byteLength + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, metaBytes.byteLength, true);
  frame.set(metaBytes, 4);
  frame.set(payload, 4 + metaBytes.byteLength);
  return frame;
}

test('応答が戻らない invoke でも中止で AbortError になる', async () => {
  const externalFetch = createExternalFetch(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = externalFetch('https://api.example.com/x', {
    method: 'POST',
    body: 'a',
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { name: 'AbortError' });
});

test('中止後に戻った応答は捨てられ、未処理の拒否も出ない', async () => {
  let release;
  const invoke = () =>
    new Promise((_, reject) => {
      release = () => reject('late failure');
    });
  const externalFetch = createExternalFetch(invoke);
  const controller = new AbortController();
  const pending = externalFetch('https://api.example.com/x', { signal: controller.signal });
  await new Promise((r) => setTimeout(r, 10));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  release();
  await new Promise((r) => setTimeout(r, 10));
});

test('中止済みの signal では invoke を呼ばずに拒否する', async () => {
  let calls = 0;
  const externalFetch = createExternalFetch(async () => {
    calls += 1;
    return new Uint8Array();
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(externalFetch('https://api.example.com/x', { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(calls, 0);
});

test('中止されなければ応答を Response へ変換する', async () => {
  const calls = [];
  const invoke = async (cmd, frame) => {
    calls.push({ cmd, frame });
    return replyFrame(
      { status: 201, statusText: 'Created', headers: [['content-type', 'application/json']] },
      new TextEncoder().encode('{"ok":true}'),
    );
  };
  const externalFetch = createExternalFetch(invoke);
  const controller = new AbortController();
  const res = await externalFetch('https://api.example.com/x', {
    method: 'POST',
    body: '{}',
    signal: controller.signal,
  });
  assert.equal(calls[0].cmd, 'aoiko_fetch');
  assert.equal(res.status, 201);
  assert.equal(res.statusText, 'Created');
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(await res.json(), { ok: true });
});

test('signal を渡さない呼び出しも従来どおり通る', async () => {
  const externalFetch = createExternalFetch(async () =>
    replyFrame({ status: 204, statusText: '', headers: [] }, new Uint8Array()),
  );
  const res = await externalFetch('https://api.example.com/x');
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
});

test('invoke の拒否は TypeError に揃える', async () => {
  const externalFetch = createExternalFetch(async () => {
    throw 'connection refused';
  });
  await assert.rejects(externalFetch('https://api.example.com/x'), {
    name: 'TypeError',
    message: 'connection refused',
  });
});
