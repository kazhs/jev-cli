import type { Answer, EvaluateRequest, EvaluateResult, Question } from '../providers/types.js';

export type OutputFormat = 'text' | 'json' | 'md';
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['text', 'json', 'md'];

const MISSING = 'n/a';

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

// scoreの確率は段階の番号で返るので、質問のcriteriaから段階の説明を引いて並べる
function distribution(probabilities: Record<string, number>, question: Question | undefined, separator: string): string {
  return Object.entries(probabilities).map(([key, value]) => {
    const label = question?.type === 'score' ? question.criteria[Number(key)] : undefined;
    return `${label === undefined ? key : `${key}:${label}`} ${percent(value)}`;
  }).join(separator);
}

// booleanにはconfidenceが返らないので、choice / scoreだけに付ける
function summarize(answer: Answer | undefined, question: Question | undefined, separator: string): { value: string; detail: string } {
  if (answer === undefined) return { value: MISSING, detail: '' };
  switch (answer.type) {
    case 'boolean':
      return { value: percent(answer.probability), detail: '' };
    case 'choice':
    case 'score': {
      const value = answer.type === 'choice' ? answer.choice : answer.score.toFixed(2);
      const confidence = answer.confidence === undefined ? '' : `${separator}confidence ${answer.confidence}`;
      return { value, detail: `${distribution(answer.probabilities, question, separator)}${confidence}` };
    }
  }
}

function criteriaText(question: Question): string | undefined {
  switch (question.type) {
    case 'boolean':
      if (question.criteria === undefined) return undefined;
      return Object.entries(question.criteria).map(([key, description]) => `${key}: ${description}`).join(' / ');
    case 'choice':
      return Object.entries(question.criteria).map(([key, description]) => `${key}: ${description}`).join(' / ');
    case 'score':
      return question.criteria.map((level, index) => `${index}: ${level}`).join(' / ');
  }
}

const stateText = (state: EvaluateRequest['state']): string =>
  typeof state === 'string' ? state : JSON.stringify(state, null, 2);

const metaLines = (result: EvaluateResult): [string, string][] => {
  const { meta } = result;
  const orMissing = (value: string | number | undefined, unit = ''): string =>
    value === undefined ? MISSING : `${value}${unit}`;
  return [
    ['startedAt', orMissing(meta.startedAt)],
    ['provider', `${meta.provider} / ${orMissing(meta.model)}`],
    ['elapsed', `${meta.elapsedMs.toFixed(0)}ms (local) / provider ${orMissing(meta.providerMs, 'ms')}`],
    ['tokens', `input ${orMissing(meta.inputTokens)} / output ${orMissing(meta.outputTokens)}`],
    ['marketCost', orMissing(meta.marketCost)],
    ['generationId', orMissing(meta.generationId)],
  ];
};

const indent = (text: string): string => text.split('\n').map((line) => `  ${line}`).join('\n');

function formatText(result: EvaluateResult, request: EvaluateRequest): string {
  const answers = Object.entries(result.answers).flatMap(([name, answer]) => {
    const question = request.questions[name];
    const { value, detail } = summarize(answer, question, ' / ');
    const criteria = question === undefined ? undefined : criteriaText(question);
    return [
      detail === '' ? `${name}: ${value}` : `${name}: ${value}  (${detail})`,
      ...(question === undefined ? [] : [`  question: ${question.instructions}`]),
      ...(criteria === undefined ? [] : [`  criteria: ${criteria}`]),
    ];
  });
  const meta = metaLines(result).map(([key, value]) => `${key}: ${value}`);
  return [...answers, '', 'state:', indent(stateText(request.state)), '', ...meta, ''].join('\n');
}

const escapeCell = (text: string): string => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

// コードフェンスの長さを中身より長くして、stateに ``` が含まれていても閉じないようにする
function fence(text: string, info: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const marks = '`'.repeat(longest + 1);
  return `${marks}${info}\n${text}\n${marks}`;
}

function formatMarkdown(result: EvaluateResult, request: EvaluateRequest): string {
  const rows = Object.entries(result.answers).map(([name, answer]) => {
    const question = request.questions[name];
    const { value, detail } = summarize(answer, question, ' / ');
    const type = answer?.type ?? question?.type ?? MISSING;
    const instructions = question?.instructions ?? MISSING;
    return `| ${escapeCell(name)} | ${type} | ${escapeCell(instructions)} | ${escapeCell(value)} | ${escapeCell(detail)} |`;
  });
  const meta = metaLines(result).map(([key, value]) => `- ${key}: ${value}`);
  const stateIsText = typeof request.state === 'string';
  return [
    '| question | type | instructions | answer | detail |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...meta,
    '',
    '## State',
    '',
    fence(stateText(request.state), stateIsText ? 'text' : 'json'),
    '',
    '## Questions',
    '',
    fence(JSON.stringify(request.questions, null, 2), 'json'),
    '',
  ].join('\n');
}

// 取得できなかった回答は null で出す (キーを落とすと、欠けたことに気付けない)
export function formatJson(result: EvaluateResult, request: EvaluateRequest): string {
  const answers = Object.fromEntries(Object.entries(result.answers).map(([name, answer]) => [name, answer ?? null]));
  return `${JSON.stringify({ request, answers, meta: result.meta }, null, 2)}\n`;
}

export function formatResult(result: EvaluateResult, format: OutputFormat, request: EvaluateRequest): string {
  switch (format) {
    case 'text':
      return formatText(result, request);
    case 'md':
      return formatMarkdown(result, request);
    case 'json':
      return formatJson(result, request);
  }
}

export const formatRaw = (result: EvaluateResult): string => `${JSON.stringify(result.raw, null, 2)}\n`;
