import { describe, expect, it } from 'vitest';
import { SAMPLE_RESPONSE } from './fixtures.js';
import type { EvaluateRequest } from './types.js';
import { VERCEL_ENDPOINT, createVercelProvider, parseAnswer } from './vercel.js';

const request: EvaluateRequest = {
  model: 'typesafe-ai/jev',
  state: { a: 1 },
  questions: {
    refund: { type: 'boolean', instructions: 'x' },
    route: { type: 'choice', instructions: 'x', criteria: { billing: 'b', shipping: 's' } },
    quality: { type: 'score', instructions: 'x', criteria: ['a', 'b', 'c', 'd'] },
    missing: { type: 'boolean', instructions: 'x' },
  },
};

const fakeFetch = (status: number, body: string, calls: { url: string; init: RequestInit | undefined }[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(body, { status });
  }) as typeof fetch;

const clock = () => {
  let t = 0;
  return () => (t += 500);
};

describe('createVercelProvider', () => {
  it('公式の形でPOSTし、応答を正規化する', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const provider = createVercelProvider({
      apiKey: 'test-key',
      fetch: fakeFetch(200, JSON.stringify(SAMPLE_RESPONSE), calls),
      now: clock(),
    });
    const result = await provider.evaluate(request);

    expect(calls[0]?.url).toBe(VERCEL_ENDPOINT);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer test-key');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(request);

    expect(result.answers).toEqual({
      refund: { type: 'boolean', probability: 0.98 },
      route: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, shipping: 0.1 }, confidence: 0.8 },
      quality: { type: 'score', score: 2.97, probabilities: { '0': 0, '1': 0, '2': 0.02, '3': 0.98 } },
      missing: undefined,
    });
    expect(result.meta).toEqual({
      provider: 'vercel',
      model: 'typesafe-ai/jev',
      elapsedMs: 500,
      providerMs: 192,
      inputTokens: 275,
      outputTokens: 20,
      marketCost: '0.00001155',
      generationId: 'gen_test',
    });
  });

  it('メタデータが無い応答でも落ちない', async () => {
    const provider = createVercelProvider({ apiKey: 'k', fetch: fakeFetch(200, '{"answers":{}}'), now: clock() });
    const result = await provider.evaluate(request);
    expect(result.meta).toEqual({ provider: 'vercel', elapsedMs: 500 });
  });

  it.each([
    [401, 3],
    [403, 3],
    [429, 1],
    [500, 1],
  ])('HTTP %i は exit %i', async (status, exitCode) => {
    const provider = createVercelProvider({ apiKey: 'k', fetch: fakeFetch(status, 'error body') });
    await expect(provider.evaluate(request)).rejects.toMatchObject({ exitCode });
  });

  it('JSONでない応答とネットワークエラーは exit 1', async () => {
    const notJson = createVercelProvider({ apiKey: 'k', fetch: fakeFetch(200, '<html>') });
    await expect(notJson.evaluate(request)).rejects.toMatchObject({ exitCode: 1 });

    const failing = createVercelProvider({
      apiKey: 'k',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(failing.evaluate(request)).rejects.toMatchObject({ exitCode: 1 });
  });
});

describe('parseAnswer', () => {
  it('形が崩れた回答は undefined', () => {
    expect(parseAnswer({ type: 'boolean' })).toBeUndefined();
    expect(parseAnswer({ type: 'choice', choice: 'a', probabilities: { a: 'high' } })).toBeUndefined();
    expect(parseAnswer({ type: 'unknown' })).toBeUndefined();
    expect(parseAnswer(null)).toBeUndefined();
  });
});

describe('エラーとメタデータ', () => {
  it('fetch のエラー文に含まれるキーを伏せる', async () => {
    const provider = createVercelProvider({
      apiKey: 'sk-secret-value',
      fetch: (async () => {
        throw new TypeError('Headers.append: "Bearer sk-secret-value" is an invalid header value.');
      }) as typeof fetch,
    });
    const error = await provider.evaluate(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ exitCode: 1 });
    expect(String((error as Error).message)).not.toContain('sk-secret-value');
    expect(String((error as Error).message)).toContain('<redacted>');
  });

  it('試行が複数あれば、最後の試行の所要時間を使う', async () => {
    const body = {
      ...SAMPLE_RESPONSE,
      providerMetadata: {
        gateway: {
          routing: {
            modelAttempts: [
              { providerAttempts: [{ startTime: 0, endTime: 12 }] },
              { providerAttempts: [{ startTime: 100, endTime: 150 }, { startTime: 200, endTime: 290 }] },
            ],
          },
        },
      },
    };
    const provider = createVercelProvider({ apiKey: 'k', fetch: fakeFetch(200, JSON.stringify(body)), now: clock() });
    expect((await provider.evaluate(request)).meta.providerMs).toBe(90);
  });
});
