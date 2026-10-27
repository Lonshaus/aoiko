export function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}
// 中止できない処理を待つのをやめるための競合。元の処理は止まらず、後から失敗しても未処理の拒否にしない。
export function raceAbort<T>(signal: AbortSignal | undefined, work: Promise<T>): Promise<T> {
  if (!signal) {
    return work;
  }
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      work.catch(() => {});
      reject(abortError());
      return;
    }
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
