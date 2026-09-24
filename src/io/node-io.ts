import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { InputReader } from '../request/state.js';

export type Io = InputReader & {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  writeFile(path: string, text: string): Promise<void>;
  stdoutIsTTY: boolean;
  env: Record<string, string | undefined>;
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
  stdoutIsTTY: process.stdout.isTTY === true,
  env: process.env,
};
