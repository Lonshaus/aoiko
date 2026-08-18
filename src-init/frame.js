// aoiko_fetch との唯一の契約。往復とも [4 バイト LE: meta 長][meta JSON][body] の 1 本の
// バッファ。分けて渡すと片側でコピーが増える。invoke の引数が ArrayBuffer（かそのビュー）の
// ときだけ octet-stream のまま届き、JSON 化を通らない。
//
// invoke も window も参照しない。ここだけ node --test から素で呼べるようにするため。
export function requestMeta(req) {
  return { url: req.url, method: req.method, headers: Array.from(req.headers) };
}

export function frameRequest(meta, body) {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const frame = new Uint8Array(4 + metaBytes.byteLength + body.byteLength);
  new DataView(frame.buffer).setUint32(0, metaBytes.byteLength, true);
  frame.set(metaBytes, 4);
  frame.set(new Uint8Array(body), 4 + metaBytes.byteLength);
  return frame;
}

export function parseReplyFrame(reply) {
  const metaLength = new DataView(reply.buffer).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(reply.subarray(4, 4 + metaLength)));
  return { head, payload: reply.subarray(4 + metaLength) };
}
