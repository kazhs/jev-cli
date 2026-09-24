import { parseArgs } from 'node:util';
import { CliError, EXIT, usageError } from '../errors.js';
import {
  KEYCHAIN_SERVICE,
  type CredentialContext,
  describeSource,
  fileEnvName,
  missingKeyMessage,
  resolveApiKey,
} from '../credentials/resolve.js';
import type { Io } from '../io/node-io.js';
import { DEFAULT_PROVIDER, PROVIDER_KEYS, parseProviderName } from '../providers/index.js';
import type { KeySpec } from '../credentials/resolve.js';
import { errorMessage } from '../shared.js';

export const AUTH_HELP = `usage: jev auth <set|status|delete> [--provider <name>]

  set       Save the API key to the macOS Keychain (prompts for the key)
  status    Show where the API key would be read from (never prints the key)
  delete    Remove the API key from the macOS Keychain

The key is looked up in this order:
  1. AI_GATEWAY_API_KEY
  2. AI_GATEWAY_API_KEY_FILE (path to a file that contains the key)
  3. macOS Keychain (service ${KEYCHAIN_SERVICE}, account = provider name)
`;

export const credentialContext = (io: Io): CredentialContext => ({
  env: io.env,
  readFile: (path) => io.readFile(path),
  fileMode: (path) => io.fileMode(path),
  keychain: io.keychain,
  warn: (message) => io.writeStderr(`jev: warning: ${message}\n`),
});

function requireKeychain(io: Io, spec: KeySpec): void {
  if (!io.keychain.available) {
    throw usageError(`the Keychain is only available on macOS; use ${spec.envName} or ${fileEnvName(spec.envName)} instead`);
  }
}

export async function runAuth(argv: string[], io: Io): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { provider: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    throw usageError(errorMessage(error));
  }
  const { values, positionals } = parsed;
  const [action, ...rest] = positionals;
  if (values.help === true || action === undefined) {
    io.writeStdout(AUTH_HELP);
    return;
  }
  if (rest.length > 0) throw usageError(`unexpected arguments: ${rest.join(' ')}`);

  const provider = parseProviderName(values.provider ?? DEFAULT_PROVIDER);
  const spec = PROVIDER_KEYS[provider];

  switch (action) {
    case 'set': {
      requireKeychain(io, spec);
      // security が端末でキーを聞くので、端末が無いと入力できない
      if (!io.stdinIsTTY) throw usageError("'jev auth set' needs a terminal to prompt for the key");
      await io.keychain.add(KEYCHAIN_SERVICE, spec.account);
      io.writeStdout(`saved to macOS Keychain (service ${KEYCHAIN_SERVICE}, account ${spec.account})\n`);
      const overriding = [spec.envName, fileEnvName(spec.envName)].filter((name) => {
        const value = io.env[name];
        return value !== undefined && value !== '';
      });
      for (const name of overriding) {
        io.writeStderr(`jev: warning: ${name} is set and takes precedence over the Keychain\n`);
      }
      return;
    }
    case 'status': {
      const resolved = await resolveApiKey(spec, credentialContext(io));
      if (resolved === undefined) {
        throw new CliError(`${provider}: ${missingKeyMessage(spec, io.keychain.available)}`, EXIT.auth);
      }
      io.writeStdout(`${provider}: ${describeSource(resolved.source)}\n`);
      return;
    }
    case 'delete': {
      requireKeychain(io, spec);
      const removed = await io.keychain.remove(KEYCHAIN_SERVICE, spec.account);
      io.writeStdout(removed
        ? `removed from macOS Keychain (service ${KEYCHAIN_SERVICE}, account ${spec.account})\n`
        : `nothing to remove (service ${KEYCHAIN_SERVICE}, account ${spec.account})\n`);
      return;
    }
    default:
      throw usageError(`unknown auth command: ${action} (use set / status / delete)`);
  }
}
