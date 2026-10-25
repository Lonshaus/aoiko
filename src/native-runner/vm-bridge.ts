// テスト専用。束ねた runner.js を Node の vm で動かし、web view の外で走らせる環境の橋渡し（runAnalysis 等）の偽物にする。
// vm の中にはネイティブ側が渡すもの（aoikoHost）しか置かない。Rust の検査は通さないので、
// 結果は Rust が素通しする範囲（今回のテストの入力）に限って本物と同じになる。
import vm from 'node:vm';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNativeRunner } from '../../scripts/build-native-runner.mjs';
import type { AoikoHost } from './shims';

export type VmRequest = {
  url: string;
  method: string;
  headers: [string, string][];
  body: string | undefined;
};

export type VmReply = { status: number; body: string } | 'fail';

export async function buildRunnerScript(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'aoiko-runner-'));
  try {
    const file = join(dir, 'runner.js');
    await buildNativeRunner(file);
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type VmRunner = { run(spec: string): Promise<string>; abort(): void };
// 端末内のエンジンの関数。指定しなければ、使えない環境と同じ答えを返す。
export type VmLocalHost = Partial<
  Pick<
    AoikoHost,
    | 'appleAiAvailability'
    | 'appleAiExtract'
    | 'appleAiRun'
    | 'recognizeText'
    | 'decodeImage'
    | 'assetBuffer'
  >
>;

const UNAVAILABLE: Required<VmLocalHost> = {
  appleAiAvailability: async () => 4,
  appleAiExtract: () => Promise.reject(4),
  appleAiRun: () => Promise.reject(4),
  recognizeText: () => Promise.reject('failed'),
  decodeImage: () => Promise.reject(new Error('no image')),
  assetBuffer: () => {
    throw new Error('no asset');
  },
};

export function loadRunner(
  script: string,
  answer: (request: VmRequest) => Promise<VmReply>,
  progress: (done: number, total: number) => void = () => {},
  local: VmLocalHost = {},
): { runner: VmRunner; globals: string[] } {
  const host = {
    async fetch(request: string, body: string | undefined) {
      const parsed = JSON.parse(request) as Omit<VmRequest, 'body'>;
      const reply = await answer({ ...parsed, body });
      if (reply === 'fail') {
        throw new Error('fail');
      }
      return {
        meta: JSON.stringify({
          status: reply.status,
          statusText: '',
          headers: [['content-type', 'application/json']],
        }),
        body: reply.body,
      };
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    progress,
    ...UNAVAILABLE,
    ...local,
  };
  const context = vm.createContext({ aoikoHost: host });
  // ネイティブ側と同じく、ArrayBuffer は実行環境の側で作る（別の realm の ArrayBuffer は instanceof に通らない）。
  const allocate = vm.runInContext('(n) => new ArrayBuffer(n)', context) as (
    n: number,
  ) => ArrayBuffer;
  const copyIn = (source: ArrayBuffer): ArrayBuffer => {
    const target = allocate(source.byteLength);
    new Uint8Array(target).set(new Uint8Array(source));
    return target;
  };
  const assetBuffer = host.assetBuffer;
  const decodeImage = host.decodeImage;
  host.assetBuffer = (name) => copyIn(assetBuffer(name));
  host.decodeImage = async () => {
    const image = await decodeImage();
    return { width: image.width, height: image.height, rgba: copyIn(image.rgba) };
  };
  const globals = vm.runInContext('Object.getOwnPropertyNames(globalThis)', context) as string[];
  vm.runInContext(script, context);
  return { runner: (context as unknown as { aoikoRunner: VmRunner }).aoikoRunner, globals };
}

export function createVmBridge(
  script: string,
  answer: (request: VmRequest) => Promise<VmReply>,
  local: VmLocalHost = {},
) {
  const specs: Record<string, unknown>[] = [];
  const cancels: string[] = [];
  const takes: string[] = [];
  const jobs = new Map<string, { runner: VmRunner; result: Promise<unknown> }>();
  const bridge = {
    async runAnalysis(spec: unknown): Promise<void> {
      const value = spec as Record<string, unknown>;
      specs.push(value);
      const { runner } = loadRunner(script, answer, () => {}, local);
      const result = runner.run(JSON.stringify(spec)).then((out) => JSON.parse(out) as unknown);
      jobs.set(String(value.job), { runner, result });
    },
    async takeAnalysis(job: string): Promise<unknown> {
      takes.push(job);
      return jobs.get(job)?.result ?? { outcome: 'cancelled' };
    },
    async cancelAnalysis(job: string): Promise<void> {
      cancels.push(job);
      jobs.get(job)?.runner.abort();
    },
  };
  return { bridge, specs, cancels, takes };
}
