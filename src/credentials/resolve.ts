import { CliError, EXIT } from '../errors.js';

export const KEYCHAIN_SERVICE = 'jev-cli';

export type KeySource =
  | { kind: 'env'; name: string }
  | { kind: 'file'; name: string; path: string }
  | { kind: 'keychain'; service: string; account: string };

export type ResolvedKey = { key: string; source: KeySource };

export type Keychain = {
  available: boolean;
  find(service: string, account: string): Promise<string | undefined>;
  add(service: string, account: string): Promise<void>;
  remove(service: string, account: string): Promise<boolean>;
};

export type CredentialContext = {
  env: Record<string, string | undefined>;
  readFile(path: string): Promise<string>;
  fileMode(path: string): Promise<number | undefined>;
  keychain: Keychain;
  warn(message: string): void;
};

export type KeySpec = { envName: string; account: string };

export const fileEnvName = (envName: string): string => `${envName}_FILE`;

export function describeSource(source: KeySource): string {
  switch (source.kind) {
    case 'env':
      return `environment variable ${source.name}`;
    case 'file':
      return `file ${source.path} (from ${source.name})`;
    case 'keychain':
      return `macOS Keychain (service ${source.service}, account ${source.account})`;
  }
}

// 優先順位: 環境変数 > <環境変数>_FILE > Keychain。上位で見つかったら下位は見ない
export async function resolveApiKey(spec: KeySpec, context: CredentialContext): Promise<ResolvedKey | undefined> {
  const direct = context.env[spec.envName];
  if (direct !== undefined && direct !== '') return { key: direct, source: { kind: 'env', name: spec.envName } };

  const fileName = fileEnvName(spec.envName);
  const path = context.env[fileName];
  if (path !== undefined && path !== '') {
    let text: string;
    try {
      text = await context.readFile(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(`cannot read ${fileName} (${path}): ${message}`, EXIT.auth);
    }
    const key = text.trim();
    if (key === '') throw new CliError(`${fileName} (${path}) is empty`, EXIT.auth);
    const mode = await context.fileMode(path);
    // 所有者以外が読めるキーファイルは漏れている可能性があるので知らせる。止めはしない
    if (mode !== undefined && (mode & 0o077) !== 0) {
      context.warn(`${path} is readable by other users (mode ${(mode & 0o777).toString(8)}); run 'chmod 600 ${path}'`);
    }
    return { key, source: { kind: 'file', name: fileName, path } };
  }

  if (context.keychain.available) {
    const key = await context.keychain.find(KEYCHAIN_SERVICE, spec.account);
    if (key !== undefined && key !== '') {
      return { key, source: { kind: 'keychain', service: KEYCHAIN_SERVICE, account: spec.account } };
    }
  }
  return undefined;
}

export function missingKeyMessage(spec: KeySpec, keychainAvailable: boolean): string {
  const ways = [spec.envName, fileEnvName(spec.envName)];
  const keychain = keychainAvailable ? `, or run 'jev auth set'` : '';
  return `no API key found: set ${ways.join(' or ')}${keychain}`;
}
