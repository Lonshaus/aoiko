import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  describeLlmError,
  hostOf,
  isLocalHost,
  listOpenAiModels,
  LlmError,
  OpenAICompatibleAdapter,
} from './llm';

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
    expect(isLocalHost('[::1]:11434')).toBe(true);
    expect(isLocalHost('api.openai.com')).toBe(false);
  });
  // mDNS の .local は LAN 上の別マシン。192.168.x.x と同じく端末外なので
  // 送信前確認を省略してはいけない。
  test('.local は端末外として扱う', () => {
    expect(isLocalHost('mybox.local')).toBe(false);
    expect(isLocalHost('mybox.local:11434')).toBe(false);
    expect(isLocalHost('192.168.1.5:11434')).toBe(false);
  });
});

describe('OpenAICompatibleAdapter', () => {
  test('localhost は external=false（送信前確認スキップ対象）', () => {
    const a = new OpenAICompatibleAdapter('http://localhost:11434/v1', 'gemma3');
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
    const a = new OpenAICompatibleAdapter('http://localhost:11434/v1/', 'llama3.2-vision', 'sk-x');
    const out = await a.generateJson('読み取れ', {
      base64: 'QUJD',
      mimeType: 'image/png',
    });
    expect(out).toEqual({ totalAmount: '1500' });
    expect(captured!.url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(captured!.body);
    expect(body.model).toBe('llama3.2-vision');
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
      return { data: [{ id: 'mistral' }, { id: 'llama3' }, {}] };
    });
    expect(await listOpenAiModels('http://localhost:11434/v1/')).toEqual(['llama3', 'mistral']);
  });
});

function mockErrorResponse(status: number, body: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      status,
      text: async () => body,
    })),
  );
}

describe('HTTP エラーの status 伝播', () => {
  test('401 は LlmError.status に反映される', async () => {
    mockErrorResponse(401, '{"error":"invalid api key"}');
    const a = new OpenAICompatibleAdapter('http://localhost:11434/v1', 'm');
    await expect(a.generateJson('x')).rejects.toMatchObject({ status: 401 });
  });

  test('listOpenAiModels の 429 も status に反映される', async () => {
    mockErrorResponse(429, 'rate limited');
    await expect(listOpenAiModels('http://localhost:11434/v1')).rejects.toMatchObject({
      status: 429,
    });
  });
});

describe('describeLlmError', () => {
  test('401/403 は認証エラーの文言に変換される', () => {
    const msg = describeLlmError(new LlmError('raw body', undefined, 401));
    expect(msg).not.toBe('raw body');
    expect(msg).toContain('raw body');
  });

  test('404 はエンドポイント/モデル誤りの文言に変換される', () => {
    const msg = describeLlmError(new LlmError('not found body', undefined, 404));
    expect(msg).toContain('not found body');
  });

  test('429 はレート制限の文言に変換される', () => {
    const msg = describeLlmError(new LlmError('quota body', undefined, 429));
    expect(msg).toContain('quota body');
  });

  test('5xx はサーバ側エラーの文言に変換される', () => {
    const msg = describeLlmError(new LlmError('server body', undefined, 503));
    expect(msg).toContain('server body');
  });

  test('status のない LlmError は message をそのまま返す', () => {
    expect(describeLlmError(new LlmError('plain'))).toBe('plain');
  });

  test('LlmError 以外の Error は message をそのまま返す', () => {
    expect(describeLlmError(new Error('boom'))).toBe('boom');
  });

  test('Error でない値は文字列化して返す', () => {
    expect(describeLlmError('oops')).toBe('oops');
  });
});

describe('オフライン時の fetch 失敗', () => {
  test('navigator.onLine === false の場合はオフライン向け文言になる', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const a = new OpenAICompatibleAdapter('http://localhost:11434/v1', 'm');
    await expect(a.generateJson('x')).rejects.toThrow(/インターネット/);
  });
});

describe('接続失敗の理由の併記', () => {
  // wrapper 版はネイティブ側の拒否理由をそのまま投げてくる。捨てると利用者は
  // 「サーバ起動・CORS を確認」という、この状況では解決しない助言だけを見る。
  test('下位のエラーメッセージを助言に併記する', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('許可されていない URL です: http://192.168.1.50');
      }),
    );
    const a = new OpenAICompatibleAdapter('http://192.168.1.50:11434/v1', 'm');
    await expect(a.generateJson('x')).rejects.toThrow(/許可されていない URL です/);
    await expect(a.generateJson('x')).rejects.toThrow(/CORS/);
  });

  test('モデル一覧の取得でも併記する', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('許可されていない URL です: http://192.168.1.50');
      }),
    );
    await expect(listOpenAiModels('http://192.168.1.50:11434/v1')).rejects.toThrow(
      /許可されていない URL です/,
    );
  });
  // オフラインの一次判定は今までどおり優先する。回線が落ちているときに
  // 下位の理由を並べても、最初に見るべきものが埋もれる。
  test('オフライン時は理由を併記せずオフライン文言のみ', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('許可されていない URL です: http://192.168.1.50');
      }),
    );
    const a = new OpenAICompatibleAdapter('http://192.168.1.50:11434/v1', 'm');
    await expect(a.generateJson('x')).rejects.not.toThrow(/許可されていない/);
  });
});
