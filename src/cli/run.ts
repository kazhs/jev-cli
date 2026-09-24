import { parseArgs } from 'node:util';
import { CliError, EXIT, type ExitCode, usageError } from '../errors.js';
import type { Io } from '../io/node-io.js';
import { OUTPUT_FORMATS, type OutputFormat, formatRaw, formatResult } from '../output/format.js';
import { createProvider } from '../providers/index.js';
import type { EvaluateRequest, Question } from '../providers/types.js';
import { mergeQuestions, parseInlineQuestion, parseQuestionFile, type QuestionFile } from '../request/questions.js';
import { buildState, parseStateArg } from '../request/state.js';

export const DEFAULT_MODEL = 'typesafe-ai/jev';
export const DEFAULT_PROVIDER = 'vercel';

export const HELP = `usage: jev [options]

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
      --raw                 Print the API response as-is
      --dry-run             Print the assembled request without calling the API

other:
      --model <id>          Default: ${DEFAULT_MODEL}
      --provider <name>     Default: ${DEFAULT_PROVIDER}
      --timeout <ms>        Default: 30000
  -h, --help
  -v, --version

environment variables:
  AI_GATEWAY_API_KEY        API key used when provider is vercel

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
  model: { type: 'string' },
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

function parseTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms <= 0) throw usageError(`--timeout must be a positive integer (ms) (${value})`);
  return ms;
}

export type RunDeps = {
  io: Io;
  version: string;
  fetch?: typeof fetch;
};

async function execute(argv: string[], deps: RunDeps): Promise<void> {
  const { io } = deps;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false });
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : String(error));
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

  let file: QuestionFile = { questions: {} };
  if (values.file !== undefined) {
    const path = values.file;
    let text: string;
    try {
      text = await io.readFile(path);
    } catch (error) {
      throw usageError(`cannot read question file (${path}): ${error instanceof Error ? error.message : String(error)}`);
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
  const request: EvaluateRequest = { model: values.model ?? file.model ?? DEFAULT_MODEL, state, questions };

  if (values['dry-run'] === true) {
    io.writeStdout(`${JSON.stringify(request, null, 2)}\n`);
    return;
  }

  const provider = createProvider(values.provider ?? DEFAULT_PROVIDER, {
    env: io.env,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
  const result = await provider.evaluate(request);

  const render = (target: OutputFormat): string =>
    values.raw === true ? formatRaw(result) : formatResult(result, target, questions);
  io.writeStdout(render(format ?? (io.stdoutIsTTY ? 'text' : 'json')));
  if (values.output !== undefined) {
    const path = values.output;
    try {
      await io.writeFile(path, render(formatForFile(path, format)));
    } catch (error) {
      throw usageError(`cannot write file (${path}): ${error instanceof Error ? error.message : String(error)}`);
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
      if (error.exitCode === EXIT.usage) deps.io.writeStderr("Run 'jev --help' for usage.\n");
      return error.exitCode;
    }
    throw error;
  }
}
