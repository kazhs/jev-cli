import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Keychain } from '../credentials/resolve.js';
import type { InputReader } from '../request/state.js';
import { macosKeychain } from './macos-keychain.js';

export type Io = InputReader & {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  writeFile(path: string, text: string): Promise<void>;
  fileMode(path: string): Promise<number | undefined>;
  stdoutIsTTY: boolean;
  stdinIsTTY: boolean;
  env: Record<string, string | undefined>;
  keychain: Keychain;
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

export const nodeIo: Io = {
  readFile: (path) => readFile(path, 'utf8'),
  readStdin,
  writeStdout: (text) => {
    process.stdout.write(text);
  },
  writeStderr: (text) => {
    process.stderr.write(text);
  },
  writeFile: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
  },
  fileMode: async (path) => {
    try {
      return (await stat(path)).mode;
    } catch {
      return undefined;
    }
  },
  stdoutIsTTY: process.stdout.isTTY === true,
  stdinIsTTY: process.stdin.isTTY === true,
  env: process.env,
  keychain: macosKeychain,
};
