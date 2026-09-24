import { CliError, EXIT, usageError } from '../errors.js';
import type { Provider } from './types.js';
import { VERCEL_API_KEY_ENV, createVercelProvider } from './vercel.js';

export const PROVIDER_NAMES = ['vercel'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const isProviderName = (value: string): value is ProviderName =>
  (PROVIDER_NAMES as readonly string[]).includes(value);

export type ProviderContext = {
  env: Record<string, string | undefined>;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

// キーはプロバイダごとの環境変数からだけ読む (フラグでは受けない)
export function createProvider(name: string, context: ProviderContext): Provider {
  if (!isProviderName(name)) throw usageError(`--provider must be one of ${PROVIDER_NAMES.join(' / ')} (${name})`);
  switch (name) {
    case 'vercel': {
      const apiKey = context.env[VERCEL_API_KEY_ENV];
      if (apiKey === undefined || apiKey === '') throw new CliError(`${VERCEL_API_KEY_ENV} is not set`, EXIT.auth);
      return createVercelProvider({
        apiKey,
        ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }),
        ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
      });
    }
  }
}
