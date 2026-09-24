import { usageError } from '../errors.js';
import type { KeySpec } from '../credentials/resolve.js';
import type { Provider } from './types.js';
import { VERCEL_API_KEY_ENV, createVercelProvider } from './vercel.js';

export const PROVIDER_NAMES = ['vercel'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const isProviderName = (value: string): value is ProviderName =>
  (PROVIDER_NAMES as readonly string[]).includes(value);

export function parseProviderName(value: string): ProviderName {
  if (!isProviderName(value)) throw usageError(`--provider must be one of ${PROVIDER_NAMES.join(' / ')} (${value})`);
  return value;
}

// キーの環境変数名と Keychain の account はプロバイダごとに分ける (別プロバイダへキーを送らないため)
export const PROVIDER_KEYS: Record<ProviderName, KeySpec> = {
  vercel: { envName: VERCEL_API_KEY_ENV, account: 'vercel' },
};

export type ProviderContext = {
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export function createProvider(name: ProviderName, context: ProviderContext): Provider {
  switch (name) {
    case 'vercel':
      return createVercelProvider({
        apiKey: context.apiKey,
        ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }),
        ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
      });
  }
}
