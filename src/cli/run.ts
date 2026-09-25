import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { missingKeyMessage, resolveApiKey } from '../credentials/resolve.js';
import { CliError, EXIT, type ExitCode, usageError } from '../errors.js';
import type { Io } from '../io/node-io.js';
import { OUTPUT_FORMATS, type OutputFormat, formatJson, formatRaw, formatResult } from '../output/format.js';
import { DEFAULT_PROVIDER, PROVIDER_KEYS, createProvider, parseProviderName } from '../providers/index.js';
import type { EvaluateRequest, Question } from '../providers/types.js';
import { mergeQuestions, parseInlineQuestion, parseQuestionFile, type QuestionFile } from '../request/questions.js';
import { buildState, parseStateArg } from '../request/state.js';
import { credentialContext, runAuth } from './auth.js';
import { errorMessage } from '../shared.js';

// jev専用のCLIなので、モデルは切り替えさせない
export const JEV_MODEL = 'typesafe-ai/jev';

export const HELP = `usage: jev [options]
       jev auth <set|status|delete>

Send state and questions to TypeSafe AI's Jev, and print the formatted answer.

state:
  -s, --state <value>       Input to evaluate. Value is text / @path / - (stdin). Text starting with @ is written as @@
                            Multiple key=<value> pairs are combined into a JSON object {key: ...}
                            .json files are read as JSON, everything else as text

questions:
  -f, --file <path>         Question file (YAML)
      --bool <name=instructions[|true:description,false:description]>
      --choice <name=instructions|a:description,b:description>
      --score <name=instructions|low,mid,high>

output:
      --format <text|json|md>  Default: text if stdout is a TTY, json otherwise
  -o, --output <path>       Also write to a file in addition to stdout. Format is chosen by extension (.json / .md), otherwise follows --format
                            Every output includes the full request (state and questions)
      --raw                 Print the API response as-is
      --dry-run             Print the assembled request without calling the API

other:
      --provider <name>     Default: ${DEFAULT_PROVIDER}
      --timeout <ms>        Default: 30000
  -h, --help
  -v, --version

Run records:
  JEV_CLI_OUTPUT_DIR        If set, every evaluation is also saved there as <UTC time>-<generationId>.json
                            (same content as --format json). Not written with --dry-run or when the call fails

API key (provider vercel), looked up in this order:
  AI_GATEWAY_API_KEY        The key itself
  AI_GATEWAY_API_KEY_FILE   Path to a file that contains the key
  macOS Keychain            Saved with 'jev auth set' (see 'jev auth --help')

exit codes: 0 ok / 1 API error / 2 usage error / 3 auth
`;

const OPTIONS = {
  state: { type: 'string', short: 's', multiple: true },
  file: { type: 'string', short: 'f' },
  bool: { type: 'string', multiple: true },
  choice: { type: 'string', multiple: true },
  score: { type: 'string', multiple: true },
  format: { type: 'string' },
  output: { type: 'string', short: 'o' },
  raw: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  provider: { type: 'string' },
  timeout: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

const isOutputFormat = (value: string): value is OutputFormat =>
  (OUTPUT_FORMATS as readonly string[]).includes(value);

function parseFormat(value: string | undefined): OutputFormat | undefined {
  if (value === undefined) return undefined;
  if (!isOutputFormat(value)) throw usageError(`--format must be one of ${OUTPUT_FORMATS.join(' / ')} (${value})`);
  return value;
}

function formatForFile(path: string, explicit: OutputFormat | undefined): OutputFormat {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'md';
  return explicit ?? 'text';
}

// Node のタイマーは 2^31-1ms を超えると 1ms に丸められ、即タイムアウトする
const MAX_TIMEOUT_MS = 2_147_483_647;

function parseTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms <= 0 || ms > MAX_TIMEOUT_MS) {
    throw usageError(`--timeout must be an integer between 1 and ${MAX_TIMEOUT_MS} (ms) (${value})`);
  }
  return ms;
}

export const OUTPUT_DIR_ENV = 'JEV_CLI_OUTPUT_DIR';

export type RunDeps = {
  io: Io;
  version: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

// 名前順に並べると時系列になるよう、UTCの日時を先頭に置く。generationIdで同じ秒の実行も区別する
function recordFileName(startedAt: Date, generationId: string | undefined): string {
  const stamp = startedAt.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll('-', '').replaceAll(':', '');
  const id = generationId ?? `no-generation-id-${Math.random().toString(36).slice(2, 10)}`;
  return `${stamp}-${id.replaceAll(/[^A-Za-z0-9_-]/g, '_')}.json`;
}

async function execute(argv: string[], deps: RunDeps): Promise<void> {
  const { io } = deps;
  if (argv[0] === 'auth') {
    await runAuth(argv.slice(1), io);
    return;
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false });
  } catch (error) {
    throw usageError(errorMessage(error));
  }
  const { values } = parsed;

  if (values.help === true) {
    io.writeStdout(HELP);
    return;
  }
  if (values.version === true) {
    io.writeStdout(`${deps.version}\n`);
    return;
  }

  const format = parseFormat(values.format);
  const timeoutMs = parseTimeout(values.timeout);
  const providerName = parseProviderName(values.provider ?? DEFAULT_PROVIDER);

  let file: QuestionFile = { questions: {} };
  if (values.file !== undefined) {
    const path = values.file;
    let text: string;
    try {
      text = await io.readFile(path);
    } catch (error) {
      throw usageError(`cannot read question file (${path}): ${errorMessage(error)}`);
    }
    file = parseQuestionFile(text, path);
  }

  const inline: [string, Question][] = [
    ...(values.bool ?? []).map((arg) => parseInlineQuestion('boolean', arg)),
    ...(values.choice ?? []).map((arg) => parseInlineQuestion('choice', arg)),
    ...(values.score ?? []).map((arg) => parseInlineQuestion('score', arg)),
  ];
  const questions = mergeQuestions(file.questions, inline);
  const state = await buildState((values.state ?? []).map(parseStateArg), io, file.state);
  const request: EvaluateRequest = { model: JEV_MODEL, state, questions };

  if (values['dry-run'] === true) {
    io.writeStdout(`${JSON.stringify(request, null, 2)}\n`);
    return;
  }

  const keySpec = PROVIDER_KEYS[providerName];
  const resolved = await resolveApiKey(keySpec, credentialContext(io));
  if (resolved === undefined) throw new CliError(missingKeyMessage(keySpec, io.keychain.available), EXIT.auth);
  const provider = createProvider(providerName, {
    apiKey: resolved.key,
    timeoutMs,
    fetch: deps.fetch,
  });
  const startedAt = (deps.now ?? (() => new Date()))();
  const result = await provider.evaluate(request);
  result.meta.startedAt = startedAt.toISOString();

  const render = (target: OutputFormat): string =>
    values.raw === true ? formatRaw(result) : formatResult(result, target, request);
  io.writeStdout(render(format ?? (io.stdoutIsTTY ? 'text' : 'json')));
  if (values.output !== undefined) {
    const path = values.output;
    try {
      await io.writeFile(path, render(formatForFile(path, format)));
    } catch (error) {
      throw usageError(`cannot write file (${path}): ${errorMessage(error)}`);
    }
  }
  const outputDir = io.env[OUTPUT_DIR_ENV];
  if (outputDir !== undefined && outputDir !== '') {
    const path = join(outputDir, recordFileName(startedAt, result.meta.generationId));
    try {
      await io.writeFile(path, formatJson(result, request));
    } catch (error) {
      throw usageError(`cannot write the run record to ${OUTPUT_DIR_ENV} (${path}): ${errorMessage(error)}`);
    }
  }
}

export async function run(argv: string[], deps: RunDeps): Promise<ExitCode> {
  try {
    await execute(argv, deps);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof CliError) {
      deps.io.writeStderr(`jev: ${error.message}\n`);
      if (error.exitCode === EXIT.usage) {
        deps.io.writeStderr(`Run '${argv[0] === 'auth' ? 'jev auth --help' : 'jev --help'}' for usage.\n`);
      }
      return error.exitCode;
    }
    throw error;
  }
}
