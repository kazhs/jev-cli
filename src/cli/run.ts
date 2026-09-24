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

TypeSafe AIのJevにstateと質問を渡し、回答を整形して出す。

state:
  -s, --state <value>       評価させる入力。値は テキスト / @path / - (stdin)。@で始まるテキストは@@で書く
                            key=<value> を複数並べると {key: ...} のJSONにまとめる
                            .jsonのファイルはJSONとして、それ以外はテキストとして読む

質問:
  -f, --file <path>         質問ファイル (YAML)
      --bool <name=質問文[|true:説明,false:説明]>
      --choice <name=質問文|a:説明,b:説明>
      --score <name=質問文|低,中,高>

出力:
      --format <text|json|md>  既定は、標準出力が端末ならtext、それ以外ならjson
  -o, --output <path>       標準出力に加えてファイルにも書く。形式は拡張子 (.json / .md) で決め、それ以外は--formatに従う
      --raw                 APIの応答をそのまま出す
      --dry-run             組み立てたリクエストを出すだけで、APIは呼ばない

その他:
      --model <id>          既定は ${DEFAULT_MODEL}
      --provider <name>     既定は ${DEFAULT_PROVIDER}
      --timeout <ms>        既定は30000
  -h, --help
  -v, --version

環境変数:
  AI_GATEWAY_API_KEY        providerがvercelのときのAPIキー

終了コード: 0 正常 / 1 APIエラー / 2 使い方の誤り / 3 認証
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
  if (!isOutputFormat(value)) throw usageError(`--format は ${OUTPUT_FORMATS.join(' / ')} のどれか (${value})`);
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
  if (!Number.isInteger(ms) || ms <= 0) throw usageError(`--timeout は正の整数 (ms) にする (${value})`);
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
      throw usageError(`質問ファイルを読めない (${path}): ${error instanceof Error ? error.message : String(error)}`);
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
      throw usageError(`ファイルに書けない (${path}): ${error instanceof Error ? error.message : String(error)}`);
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
      if (error.exitCode === EXIT.usage) deps.io.writeStderr('jev --help で使い方を出す\n');
      return error.exitCode;
    }
    throw error;
  }
}
