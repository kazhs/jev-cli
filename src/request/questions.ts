// 質問の検証と、inlineフラグ・YAMLからの組み立て
// 型ごとの制約は https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk に従う
import { parse as parseYaml } from 'yaml';
import { usageError } from '../errors.js';
import type { Question, QuestionType } from '../providers/types.js';
import type { StateValueType } from './state.js';

const QUESTION_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const CHOICE_MAX = 255;
const SCORE_MIN = 2;
const SCORE_MAX = 10;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function checkName(name: string, where: string): void {
  if (!QUESTION_NAME.test(name)) {
    throw usageError(`${where}: 質問名 "${name}" は英字か_で始め、英数字・_・-だけで書く`);
  }
}

export function validateQuestion(name: string, value: unknown, where: string): Question {
  checkName(name, where);
  const at = `${where}: ${name}`;
  if (!isRecord(value)) throw usageError(`${at} がオブジェクトでない`);
  if (!isNonEmptyString(value.instructions)) throw usageError(`${at}.instructions が空`);
  const { instructions, criteria } = value;

  switch (value.type) {
    case 'boolean': {
      if (criteria === undefined) return { type: 'boolean', instructions };
      if (!isRecord(criteria)) throw usageError(`${at}.criteria は true / false の説明を持つオブジェクトにする`);
      const unknownKeys = Object.keys(criteria).filter((key) => key !== 'true' && key !== 'false');
      if (unknownKeys.length > 0) throw usageError(`${at}.criteria に使えるキーは true / false だけ: ${unknownKeys.join(', ')}`);
      const result: { true?: string; false?: string } = {};
      for (const key of ['true', 'false'] as const) {
        const description = criteria[key];
        if (description === undefined) continue;
        if (!isNonEmptyString(description)) throw usageError(`${at}.criteria.${key} が空`);
        result[key] = description;
      }
      return { type: 'boolean', instructions, criteria: result };
    }
    case 'choice': {
      if (!isRecord(criteria)) throw usageError(`${at}.criteria は 選択肢名 → 説明 のオブジェクトにする`);
      const entries = Object.entries(criteria);
      if (entries.length < 2 || entries.length > CHOICE_MAX) {
        throw usageError(`${at}.criteria の選択肢は2〜${CHOICE_MAX}個にする (${entries.length}個)`);
      }
      const result: Record<string, string> = {};
      for (const [option, description] of entries) {
        if (!isNonEmptyString(description)) throw usageError(`${at}.criteria.${option} の説明が空`);
        result[option] = description;
      }
      return { type: 'choice', instructions, criteria: result };
    }
    case 'score': {
      if (!Array.isArray(criteria)) throw usageError(`${at}.criteria は段階の説明の配列にする (低い段階から)`);
      if (criteria.length < SCORE_MIN || criteria.length > SCORE_MAX) {
        throw usageError(`${at}.criteria の段階は${SCORE_MIN}〜${SCORE_MAX}個にする (${criteria.length}個)`);
      }
      const levels: string[] = [];
      for (const [index, level] of criteria.entries()) {
        if (!isNonEmptyString(level)) throw usageError(`${at}.criteria[${index}] が空`);
        levels.push(level);
      }
      return { type: 'score', instructions, criteria: levels };
    }
    default:
      throw usageError(`${at}.type は boolean / choice / score のどれか (${String(value.type)})`);
  }
}

// --bool / --choice / --score の値: name="instructions|criteria"
// criteria は , 区切り。choice と boolean は key:説明 (choice は説明を省くと選択肢名を説明に使う)。
// instructions と criteria は最後の | で分ける。, や | を説明に含めるなら質問ファイルを使う
export function parseInlineQuestion(type: QuestionType, arg: string): [string, Question] {
  const flag = type === 'boolean' ? '--bool' : `--${type}`;
  const eq = arg.indexOf('=');
  if (eq <= 0) throw usageError(`${flag}: name="質問文" の形で書く (${arg})`);
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
      if (bar < 0) throw usageError(`${flag} ${name}: 選択肢が無い。"質問文|a:説明,b:説明" の形で書く`);
      raw = { type, instructions, criteria: Object.fromEntries(pairs()) };
      break;
    case 'score':
      if (bar < 0) throw usageError(`${flag} ${name}: 段階が無い。"質問文|低,中,高" の形で書く`);
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
    const message = error instanceof Error ? error.message : String(error);
    throw usageError(`${path}: YAMLとして読めない: ${message}`);
  }
  if (!isRecord(doc)) throw usageError(`${path}: トップレベルがオブジェクトでない`);
  const unknownKeys = Object.keys(doc).filter((key) => !FILE_KEYS.includes(key));
  if (unknownKeys.length > 0) throw usageError(`${path}: 使えないキー: ${unknownKeys.join(', ')} (使えるのは ${FILE_KEYS.join(' / ')})`);

  const result: QuestionFile = { questions: {} };
  if (doc.model !== undefined) {
    if (!isNonEmptyString(doc.model)) throw usageError(`${path}: model が空`);
    result.model = doc.model;
  }
  if (doc.state !== undefined) {
    if (!isRecord(doc.state)) throw usageError(`${path}: state は キー → text | json のオブジェクトにする`);
    const state: Record<string, StateValueType> = {};
    for (const [key, type] of Object.entries(doc.state)) {
      if (type !== 'text' && type !== 'json') throw usageError(`${path}: state.${key} は text か json (${String(type)})`);
      state[key] = type;
    }
    result.state = state;
  }
  if (!isRecord(doc.questions)) throw usageError(`${path}: questions が無い`);
  for (const [name, value] of Object.entries(doc.questions)) {
    result.questions[name] = validateQuestion(name, value, path);
  }
  return result;
}

// 質問ファイルとinlineを合わせる。名前が衝突したらエラー
export function mergeQuestions(
  fileQuestions: Record<string, Question>,
  inline: [string, Question][],
): Record<string, Question> {
  const merged: Record<string, Question> = { ...fileQuestions };
  for (const [name, question] of inline) {
    if (name in merged) throw usageError(`質問名が重複している: ${name}`);
    merged[name] = question;
  }
  if (Object.keys(merged).length === 0) throw usageError('質問が無い (--bool / --choice / --score か -f で渡す)');
  return merged;
}
