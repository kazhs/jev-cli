// --state の解釈とstateの合成
import { usageError } from '../errors.js';
import type { JsonValue } from '../providers/types.js';
import { errorMessage } from '../shared.js';

export type StateValueType = 'text' | 'json';

export type StateSource =
  | { kind: 'literal'; text: string }
  | { kind: 'file'; path: string }
  | { kind: 'stdin' };

export type StateArg = { key?: string; source: StateSource };
type KeyedStateArg = StateArg & { key: string };

export type InputReader = {
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
};

const KEYED = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

// 値は そのまま=テキスト / @path=ファイル / -=stdin。@ で始まるテキストは @@ で書く
function parseSource(value: string): StateSource {
  if (value === '-') return { kind: 'stdin' };
  if (value.startsWith('@@')) return { kind: 'literal', text: value.slice(1) };
  if (value.startsWith('@')) {
    const path = value.slice(1);
    if (path === '') throw usageError('--state: no file path after @');
    return { kind: 'file', path };
  }
  return { kind: 'literal', text: value };
}

// key=... の形は key が識別子のときだけ。識別子= で始まるテキストを渡すなら @file か stdin を使う
export function parseStateArg(arg: string): StateArg {
  const match = KEYED.exec(arg);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return { key: match[1], source: parseSource(match[2]) };
  }
  return { source: parseSource(arg) };
}

const inferType = (source: StateSource): StateValueType =>
  source.kind === 'file' && source.path.toLowerCase().endsWith('.json') ? 'json' : 'text';

const describe = (arg: StateArg): string => (arg.key === undefined ? '--state' : `--state ${arg.key}`);

async function loadValue(arg: StateArg, type: StateValueType, reader: InputReader): Promise<JsonValue> {
  const { source } = arg;
  let text: string;
  if (source.kind === 'literal') {
    text = source.text;
  } else if (source.kind === 'stdin') {
    text = await reader.readStdin();
  } else {
    try {
      text = await reader.readFile(source.path);
    } catch (error) {
      const message = errorMessage(error);
      throw usageError(`${describe(arg)}: cannot read file (${source.path}): ${message}`);
    }
  }
  // ファイル・stdinの末尾の改行はエディタやechoが足したもので、評価させたい内容ではない
  if (source.kind !== 'literal') text = text.replace(/\r?\n$/, '');
  if (type === 'text') return text;
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    const message = errorMessage(error);
    throw usageError(`${describe(arg)}: cannot parse as JSON: ${message}`);
  }
}

// declared を渡すと、キーの過不足をエラーにし、値の型は宣言に従う (拡張子より優先)
export async function buildState(
  args: StateArg[],
  reader: InputReader,
  declared?: Record<string, StateValueType>,
): Promise<JsonValue> {
  if (args.length === 0) throw usageError('--state is required');
  if (args.filter((arg) => arg.source.kind === 'stdin').length > 1) {
    throw usageError('only one --state can read from stdin (-)');
  }

  const keyed = args.filter((arg): arg is KeyedStateArg => arg.key !== undefined);
  if (keyed.length < args.length) {
    const [only, ...rest] = args;
    if (only === undefined || rest.length > 0) throw usageError('when passing multiple --state, all must be key=value');
    if (declared !== undefined) {
      throw usageError(`the question file declares state keys (${Object.keys(declared).join(', ')}); pass --state key=value`);
    }
    return loadValue(only, inferType(only.source), reader);
  }

  const keys = keyed.map((arg) => arg.key);
  const duplicated = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicated.length > 0) throw usageError(`duplicate --state keys: ${[...new Set(duplicated)].join(', ')}`);

  if (declared !== undefined) {
    const missing = Object.keys(declared).filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !Object.hasOwn(declared, key));
    if (missing.length > 0) throw usageError(`missing state key(s) declared by the question file: ${missing.join(', ')}`);
    if (extra.length > 0) throw usageError(`state key(s) not declared by the question file: ${extra.join(', ')}`);
  }

  const entries: [string, JsonValue][] = [];
  for (const arg of keyed) {
    const type = declared !== undefined && Object.hasOwn(declared, arg.key) ? declared[arg.key] : undefined;
    entries.push([arg.key, await loadValue(arg, type ?? inferType(arg.source), reader)]);
  }
  return Object.fromEntries(entries);
}
