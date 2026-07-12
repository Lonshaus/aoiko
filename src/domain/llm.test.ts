import { afterEach, describe, expect, test, vi } from 'vitest';
import { hostOf, isLocalHost, listOpenAiModels, LlmError, OpenAICompatibleAdapter } from './llm';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const r = impl(url, init);
      return {
        ok: true,
        status: 200,
        json: async () => r,
        text: async () => JSON.stringify(r),
      } as unknown as Response;
    }),
  );
}

describe('hostOf / isLocalHost', () => {
  test('host 抽出', () => {
    expect(hostOf('http://localhost:11434/v1')).toBe('localhost:11434');
    expect(hostOf('https://api.openai.com/v1')).toBe('api.openai.com');
  });
  test('ローカル判定', () => {
    expect(isLocalHost('localhost:11434')).toBe(true);
    expect(isLocalHost('127.0.0.1:1234')).toBe(true);
    expect(isLocalHost('mybox.local')).toBe(true);
    expect(isLocalHost('api.openai.com')).toBe(false);
  });
});

describe('OpenAICompatibleAdapter', () => {
  test('localhost は external=false（送信前確認スキップ対象）', () => {
    const a = new OpenAICompatibleAdapter('http://localhost:11434/v1', 'qwen2-vl');
    expect(a.external).toBe(false);
    expect(a.destinationHost).toBe('localhost:11434');
  });

  test('リモートは external=true', () => {
    const a = new OpenAICompatibleAdapter('https://api.openai.com/v1', 'gpt-4o');
    expect(a.external).toBe(true);
  });

  test('画像つきリクエストは image_url content を含み、応答 JSON を返す', async () => {
    let captured: { body: string; url: string } | null = null;
    mockFetch((url, init) => {
      captured = { url, body: String(init?.body) };
      return {
        choices: [{ message: { content: '{"totalAmount":"1500"}' } }],
      };
    });
    const a = new OpenAICompatibleAdapter('http://localhost:11434/v1/', 'minicpm-v', 'sk-x');
    const out = await a.generateJson('読み取れ', {
      base64: 'QUJD',
      mimeType: 'image/png',
    });
    expect(out).toEqual({ totalAmount: '1500' });
    expect(captured!.url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(captured!.body);
    expect(body.model).toBe('minicpm-v');
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,QUJD');
  });

  test('```json フェンス付き応答も解析できる', async () => {
    mockFetch(() => ({
      choices: [{ message: { content: '```json\n{"a":1}\n```' } }],
    }));
    const a = new OpenAICompatibleAdapter('http://localhost:11434/v1', 'm');
    expect(await a.generateJson('x')).toEqual({ a: 1 });
  });

  test('モデル未指定はエラー', async () => {
    const a = new OpenAICompatibleAdapter('http://localhost:11434/v1', '');
    await expect(a.generateJson('x')).rejects.toBeInstanceOf(LlmError);
  });
});

describe('listOpenAiModels', () => {
  test('/models の id 一覧をソートして返す', async () => {
    mockFetch((url) => {
      expect(url).toBe('http://localhost:11434/v1/models');
      return { data: [{ id: 'qwen2-vl' }, { id: 'llama3' }, {}] };
    });
    expect(await listOpenAiModels('http://localhost:11434/v1/')).toEqual(['llama3', 'qwen2-vl']);
  });
});
