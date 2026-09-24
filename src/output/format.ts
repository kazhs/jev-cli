import type { Answer, EvaluateResult, Question } from '../providers/types.js';

export type OutputFormat = 'text' | 'json' | 'md';
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['text', 'json', 'md'];

const MISSING = '未取得';

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const distribution = (probabilities: Record<string, number>, separator: string): string =>
  Object.entries(probabilities).map(([key, value]) => `${key} ${percent(value)}`).join(separator);

// booleanにはconfidenceが返らないので、choice / scoreだけに付ける
function summarize(answer: Answer | undefined, separator: string): { value: string; detail: string } {
  if (answer === undefined) return { value: MISSING, detail: '' };
  switch (answer.type) {
    case 'boolean':
      return { value: percent(answer.probability), detail: '' };
    case 'choice':
    case 'score': {
      const value = answer.type === 'choice' ? answer.choice : answer.score.toFixed(2);
      const confidence = answer.confidence === undefined ? '' : `${separator}confidence ${answer.confidence}`;
      return { value, detail: `${distribution(answer.probabilities, separator)}${confidence}` };
    }
  }
}

const metaLines = (result: EvaluateResult): [string, string][] => {
  const { meta } = result;
  const orMissing = (value: string | number | undefined, unit = ''): string =>
    value === undefined ? MISSING : `${value}${unit}`;
  return [
    ['provider', `${meta.provider} / ${orMissing(meta.model)}`],
    ['elapsed', `${meta.elapsedMs.toFixed(0)}ms (手元計測) / provider ${orMissing(meta.providerMs, 'ms')}`],
    ['tokens', `input ${orMissing(meta.inputTokens)} / output ${orMissing(meta.outputTokens)}`],
    ['marketCost', orMissing(meta.marketCost)],
    ['generationId', orMissing(meta.generationId)],
  ];
};

function formatText(result: EvaluateResult): string {
  const answers = Object.entries(result.answers).map(([name, answer]) => {
    const { value, detail } = summarize(answer, ' / ');
    return detail === '' ? `${name}: ${value}` : `${name}: ${value}  (${detail})`;
  });
  const meta = metaLines(result).map(([key, value]) => `${key}: ${value}`);
  return [...answers, '', ...meta, ''].join('\n');
}

const escapeCell = (text: string): string => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

function formatMarkdown(result: EvaluateResult, questions: Record<string, Question>): string {
  const rows = Object.entries(result.answers).map(([name, answer]) => {
    const { value, detail } = summarize(answer, ' / ');
    const type = answer?.type ?? questions[name]?.type ?? MISSING;
    return `| ${escapeCell(name)} | ${type} | ${escapeCell(value)} | ${escapeCell(detail)} |`;
  });
  const meta = metaLines(result).map(([key, value]) => `- ${key}: ${value}`);
  return [
    '| question | type | answer | detail |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    ...meta,
    '',
  ].join('\n');
}

// 取得できなかった回答は null で出す (キーを落とすと、欠けたことに気付けない)
function formatJson(result: EvaluateResult): string {
  const answers = Object.fromEntries(Object.entries(result.answers).map(([name, answer]) => [name, answer ?? null]));
  return `${JSON.stringify({ answers, meta: result.meta }, null, 2)}\n`;
}

export function formatResult(result: EvaluateResult, format: OutputFormat, questions: Record<string, Question>): string {
  switch (format) {
    case 'text':
      return formatText(result);
    case 'md':
      return formatMarkdown(result, questions);
    case 'json':
      return formatJson(result);
  }
}

export const formatRaw = (result: EvaluateResult): string => `${JSON.stringify(result.raw, null, 2)}\n`;
