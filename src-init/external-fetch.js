// 外部 API への fetch を IPC へ回す部分。invoke を引数で受けるので node --test から素で呼べる。
import { frameRequest, parseReplyFrame, requestMeta } from './frame.js';

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

async function rawIpcFetch(invoke, req, body) {
  let reply;
  try {
    reply = new Uint8Array(await invoke('aoiko_fetch', frameRequest(requestMeta(req), body)));
  } catch (e) {
    // 素の fetch は通信の失敗を TypeError で投げる。公開 repo の判定（describeLlmError）が
    // それ前提で書かれているので、invoke の拒否をここで同じ形に揃える。
    throw new TypeError(typeof e === 'string' ? e : String(e));
  }
  const { head, payload } = parseReplyFrame(reply);
  return new Response(payload.byteLength > 0 ? payload : null, {
    status: head.status,
    statusText: head.statusText,
    headers: head.headers,
  });
}
// IPC 自体は止められない。中止したら待つのをやめ、あとから戻る応答は捨てる。
function raceAbort(signal, promise) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function createExternalFetch(invoke) {
  return async function externalFetch(input, init) {
    // 入力の形（文字列 / URL / Request、headers も Headers / object / 配列）を Request 1 つへ
    // 潰してから読む。body を文字列で渡されたときの content-type もここで確定する。
    const req = new Request(input, init);
    if (req.signal.aborted) {
      throw abortError();
    }
    const body = await req.arrayBuffer();
    if (req.signal.aborted) {
      throw abortError();
    }
    return raceAbort(req.signal, rawIpcFetch(invoke, req, body));
  };
}
