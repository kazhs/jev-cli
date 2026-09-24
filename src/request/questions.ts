// 質問の検証と、inlineフラグ・YAMLからの組み立て
// 型ごとの制約は https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk に従う
import { parse as parseYaml } from 'yaml';
import { usageError } from '../errors.js';
import type { Question, QuestionType } from '../providers/types.js';
import type { StateValueType } from './state.js';
import { errorMessage, isRecord } from '../shared.js';

const QUESTION_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const CHOICE_MAX = 255;
const SCORE_MIN = 2;
const SCORE_MAX = 10;

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function checkName(name: string, where: string): void {
  if (!QUESTION_NAME.test(name)) {
    throw usageError(`${where}: question name "${name}" must start with a letter or _ and contain only letters, digits, _ or -`);
  }
}

export function validateQuestion(name: string, value: unknown, where: string): Question {
  checkName(name, where);
  const at = `${where}: ${name}`;
  if (!isRecord(value)) throw usageError(`${at} is not an object`);
  if (!isNonEmptyString(value.instructions)) throw usageError(`${at}.instructions is empty`);
  const { instructions, criteria } = value;

  switch (value.type) {
    case 'boolean': {
      if (criteria === undefined) return { type: 'boolean', instructions };
      if (!isRecord(criteria)) throw usageError(`${at}.criteria must be an object with true / false descriptions`);
      const unknownKeys = Object.keys(criteria).filter((key) => key !== 'true' && key !== 'false');
      if (unknownKeys.length > 0) throw usageError(`${at}.criteria only accepts true / false keys: ${unknownKeys.join(', ')}`);
      const result: { true?: string; false?: string } = {};
      for (const key of ['true', 'false'] as const) {
        const description = criteria[key];
        if (description === undefined) continue;
        if (!isNonEmptyString(description)) throw usageError(`${at}.criteria.${key} is empty`);
        result[key] = description;
      }
      return { type: 'boolean', instructions, criteria: result };
    }
    case 'choice': {
      if (!isRecord(criteria)) throw usageError(`${at}.criteria must be an object mapping option name to description`);
      const entries = Object.entries(criteria);
      if (entries.length < 2 || entries.length > CHOICE_MAX) {
        throw usageError(`${at}.criteria must have between 2 and ${CHOICE_MAX} options (got ${entries.length})`);
      }
      const options: [string, string][] = [];
      for (const [option, description] of entries) {
        if (!isNonEmptyString(description)) throw usageError(`${at}.criteria.${option} description is empty`);
        options.push([option, description]);
      }
      return { type: 'choice', instructions, criteria: Object.fromEntries(options) };
    }
    case 'score': {
      if (!Array.isArray(criteria)) throw usageError(`${at}.criteria must be an array of level descriptions (lowest first)`);
      if (criteria.length < SCORE_MIN || criteria.length > SCORE_MAX) {
        throw usageError(`${at}.criteria must have between ${SCORE_MIN} and ${SCORE_MAX} levels (got ${criteria.length})`);
      }
      const levels: string[] = [];
      for (const [index, level] of criteria.entries()) {
        if (!isNonEmptyString(level)) throw usageError(`${at}.criteria[${index}] is empty`);
        levels.push(level);
      }
      return { type: 'score', instructions, criteria: levels };
    }
    default:
      throw usageError(`${at}.type must be boolean / choice / score (${String(value.type)})`);
  }
}

// --bool / --choice / --score の値: name="instructions|criteria"
// criteria は , 区切り。choice と boolean は key:説明 (choice は説明を省くと選択肢名を説明に使う)。
// instructions と criteria は最後の | で分ける。, や | を説明に含めるなら質問ファイルを使う
export function parseInlineQuestion(type: QuestionType, arg: string): [string, Question] {
  const flag = type === 'boolean' ? '--bool' : `--${type}`;
  const eq = arg.indexOf('=');
  if (eq <= 0) throw usageError(`${flag}: write it as name="instructions" (${arg})`);
  const name = arg.slice(0, eq);
  const body = arg.slice(eq + 1);
  const bar = body.lastIndexOf('|');
  const instructions = bar < 0 ? body : body.slice(0, bar);
  const items = bar < 0
    ? []
    : body.slice(bar + 1).split(',').map((item) => item.trim()).filter((item) => item !== '');

  const pairs = (): [string, string][] => items.map((item) => {
    const colon = item.indexOf(':');
    return colon < 0 ? [item, item] : [item.slice(0, colon).trim(), item.slice(colon + 1).trim()];
  });

  let raw: Record<string, unknown>;
  switch (type) {
    case 'boolean':
      raw = { type, instructions, ...(items.length === 0 ? {} : { criteria: Object.fromEntries(pairs()) }) };
      break;
    case 'choice':
      if (bar < 0) throw usageError(`${flag} ${name}: no options given. write it as "instructions|a:description,b:description"`);
      raw = { type, instructions, criteria: Object.fromEntries(pairs()) };
      break;
    case 'score':
      if (bar < 0) throw usageError(`${flag} ${name}: no levels given. write it as "instructions|low,mid,high"`);
      raw = { type, instructions, criteria: items };
      break;
  }
  return [name, validateQuestion(name, raw, flag)];
}

export type QuestionFile = {
  model?: string;
  state?: Record<string, StateValueType>;
  questions: Record<string, Question>;
};

const FILE_KEYS = ['model', 'state', 'questions'];

export function parseQuestionFile(text: string, path: string): QuestionFile {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (error) {
    const message = errorMessage(error);
    throw usageError(`${path}: cannot parse as YAML: ${message}`);
  }
  if (!isRecord(doc)) throw usageError(`${path}: top level is not an object`);
  const unknownKeys = Object.keys(doc).filter((key) => !FILE_KEYS.includes(key));
  if (unknownKeys.length > 0) throw usageError(`${path}: unknown key(s): ${unknownKeys.join(', ')} (allowed: ${FILE_KEYS.join(' / ')})`);

  const result: QuestionFile = { questions: {} };
  if (doc.model !== undefined) {
    if (!isNonEmptyString(doc.model)) throw usageError(`${path}: model is empty`);
    result.model = doc.model;
  }
  if (doc.state !== undefined) {
    if (!isRecord(doc.state)) throw usageError(`${path}: state must be an object mapping key to text | json`);
    const state: [string, StateValueType][] = [];
    for (const [key, type] of Object.entries(doc.state)) {
      if (type !== 'text' && type !== 'json') throw usageError(`${path}: state.${key} must be text or json (${String(type)})`);
      state.push([key, type]);
    }
    result.state = Object.fromEntries(state);
  }
  if (!isRecord(doc.questions)) throw usageError(`${path}: questions is missing`);
  result.questions = Object.fromEntries(
    Object.entries(doc.questions).map(([name, value]) => [name, validateQuestion(name, value, path)]),
  );
  return result;
}

// 質問ファイルとinlineを合わせる。名前が衝突したらエラー。
// 質問名は constructor や __proto__ でもよいので、in や代入 (prototype に触れる) を使わず Map で組む
export function mergeQuestions(
  fileQuestions: Record<string, Question>,
  inline: [string, Question][],
): Record<string, Question> {
  const merged = new Map(Object.entries(fileQuestions));
  for (const [name, question] of inline) {
    if (merged.has(name)) throw usageError(`duplicate question name: ${name}`);
    merged.set(name, question);
  }
  if (merged.size === 0) throw usageError('no questions given (use --bool / --choice / --score or -f)');
  return Object.fromEntries(merged);
}
