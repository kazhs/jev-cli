// Vercel AI Gateway の HTTP API
// https://vercel.com/docs/ai-gateway/modalities/evaluation
// https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev
import { CliError, EXIT } from '../errors.js';
import type { Answer, EvaluateMeta, EvaluateRequest, EvaluateResult, Provider } from './types.js';
import { errorMessage, isRecord } from '../shared.js';

export const VERCEL_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/evaluate';
export const VERCEL_API_KEY_ENV = 'AI_GATEWAY_API_KEY';

export type VercelProviderOptions = {
  apiKey: string;
  endpoint?: string | undefined;
  timeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
  now?: (() => number) | undefined;
};

const numberAt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const stringAt = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const probabilitiesAt = (value: unknown): Record<string, number> | undefined => {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every(([, v]) => numberAt(v) !== undefined)) return undefined;
  return Object.fromEntries(entries) as Record<string, number>;
};

// 形が崩れている回答は undefined にして「未取得」として出す
export function parseAnswer(value: unknown): Answer | undefined {
  if (!isRecord(value)) return undefined;
  const confidence = numberAt(value.confidence);
  switch (value.type) {
    case 'boolean': {
      const probability = numberAt(value.probability);
      return probability === undefined ? undefined : { type: 'boolean', probability };
    }
    case 'choice': {
      const choice = stringAt(value.choice);
      const probabilities = probabilitiesAt(value.probabilities);
      if (choice === undefined || probabilities === undefined) return undefined;
      return { type: 'choice', choice, probabilities, ...(confidence === undefined ? {} : { confidence }) };
    }
    case 'score': {
      const score = numberAt(value.score);
      const probabilities = probabilitiesAt(value.probabilities);
      if (score === undefined || probabilities === undefined) return undefined;
      return { type: 'score', score, probabilities, ...(confidence === undefined ? {} : { confidence }) };
    }
    default:
      return undefined;
  }
}

// プロバイダ側の所要時間。公式docsの応答例には無いが、実際の応答には
// routing.modelAttempts[].providerAttempts[].startTime / endTime が入っていた。
// リトライ・フォールバックで試行が複数あるときは、最後 (応答を返した) の試行を使う
function providerMsAt(routing: unknown): number | undefined {
  if (!isRecord(routing) || !Array.isArray(routing.modelAttempts)) return undefined;
  const modelAttempt: unknown = routing.modelAttempts.at(-1);
  if (!isRecord(modelAttempt) || !Array.isArray(modelAttempt.providerAttempts)) return undefined;
  const attempt: unknown = modelAttempt.providerAttempts.at(-1);
  if (!isRecord(attempt)) return undefined;
  const start = numberAt(attempt.startTime);
  const end = numberAt(attempt.endTime);
  return start === undefined || end === undefined ? undefined : end - start;
}

export function parseResponse(body: unknown, questionNames: string[], elapsedMs: number): EvaluateResult {
  const root = isRecord(body) ? body : {};
  const answersRoot = isRecord(root.answers) ? root.answers : {};
  const usage = isRecord(root.usage) ? root.usage : {};
  const providerMetadata = isRecord(root.providerMetadata) ? root.providerMetadata : {};
  const gateway = isRecord(providerMetadata.gateway) ? providerMetadata.gateway : {};

  const meta: EvaluateMeta = { provider: 'vercel', elapsedMs };
  const assign = <K extends keyof EvaluateMeta>(key: K, value: EvaluateMeta[K] | undefined) => {
    if (value !== undefined) meta[key] = value;
  };
  assign('model', stringAt(root.model));
  assign('providerMs', providerMsAt(gateway.routing));
  assign('inputTokens', numberAt(usage.inputTokens));
  assign('outputTokens', numberAt(usage.outputTokens));
  assign('marketCost', stringAt(gateway.marketCost));
  assign('generationId', stringAt(gateway.generationId));

  return {
    answers: Object.fromEntries(questionNames.map((name) => [name, parseAnswer(answersRoot[name])])),
    meta,
    raw: body,
  };
}

export function createVercelProvider(options: VercelProviderOptions): Provider {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => performance.now());
  return {
    name: 'vercel',
    async evaluate(request: EvaluateRequest): Promise<EvaluateResult> {
      const startedAt = now();
      let res: Response;
      let text: string;
      try {
        res = await doFetch(options.endpoint ?? VERCEL_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
        text = await res.text();
      } catch (error) {
        // fetch のエラー文はヘッダの値を含むことがあるので、キーを伏せてから出す
        const message = errorMessage(error).replaceAll(options.apiKey, '<redacted>');
        throw new CliError(`request failed: ${message}`, EXIT.api);
      }
      // 手元で測るのは送信から応答本文の受信完了まで (ネットワーク往復を含む)
      const elapsedMs = now() - startedAt;

      if (res.status === 401 || res.status === 403) {
        throw new CliError(`authentication failed (HTTP ${res.status})\n${text}`, EXIT.auth);
      }
      if (!res.ok) throw new CliError(`HTTP ${res.status}\n${text}`, EXIT.api);

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new CliError(`response is not JSON\n${text}`, EXIT.api);
      }
      return parseResponse(body, Object.keys(request.questions), elapsedMs);
    },
  };
}
