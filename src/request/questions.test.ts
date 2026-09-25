import { describe, expect, it } from 'vitest';
import { mergeQuestions, parseInlineQuestion, parseQuestionFile, validateQuestion } from './questions.js';

const expectUsageError = (fn: () => unknown) => {
  expect(fn).toThrow(expect.objectContaining({ exitCode: 2 }));
};

describe('parseInlineQuestion', () => {
  it('boolean は criteria を省ける', () => {
    expect(parseInlineQuestion('boolean', 'bullish=上昇を示すか')).toEqual([
      'bullish',
      { type: 'boolean', instructions: '上昇を示すか' },
    ]);
    expect(parseInlineQuestion('boolean', 'ok=通ったか|true:exit 0,false:それ以外')).toEqual([
      'ok',
      { type: 'boolean', instructions: '通ったか', criteria: { true: 'exit 0', false: 'それ以外' } },
    ]);
  });

  it('choice は説明を省くと選択肢名を説明に使う', () => {
    expect(parseInlineQuestion('choice', 'dir=方向は?|long:上昇, short:下落,neutral')).toEqual([
      'dir',
      { type: 'choice', instructions: '方向は?', criteria: { long: '上昇', short: '下落', neutral: 'neutral' } },
    ]);
  });

  it('score は段階を低い順に並べる', () => {
    expect(parseInlineQuestion('score', 'q=品質は|低,中,高')).toEqual([
      'q',
      { type: 'score', instructions: '品質は', criteria: ['低', '中', '高'] },
    ]);
  });

  it('instructions に | を含めても最後の | で分ける', () => {
    expect(parseInlineQuestion('choice', 'x=A|Bのどちらか|a,b')[1]).toMatchObject({ instructions: 'A|Bのどちらか' });
  });

  it.each([
    ['boolean', '質問文だけ'],
    ['boolean', '=名前が空'],
    ['choice', 'dir=選択肢が無い'],
    ['choice', 'dir=1つだけ|a'],
    ['score', 's=段階が無い'],
    ['score', 's=1段|a'],
    ['boolean', 'b=x|maybe:どちらでも'],
    ['boolean', '1bad=名前が数字始まり'],
  ] as const)('%s %s は使い方の誤り', (type, arg) => {
    expectUsageError(() => parseInlineQuestion(type, arg));
  });
});

describe('validateQuestion', () => {
  it('score の段階は10個まで', () => {
    const criteria = Array.from({ length: 11 }, (_, i) => `level ${i}`);
    expectUsageError(() => validateQuestion('s', { type: 'score', instructions: 'x', criteria }, 'test'));
  });

  it('未知の type は使い方の誤り', () => {
    expectUsageError(() => validateQuestion('s', { type: 'number', instructions: 'x' }, 'test'));
  });
});

describe('parseQuestionFile', () => {
  it('state / questions を読む', () => {
    const file = parseQuestionFile(
      [
        'state:',
        '  thesis: text',
        '  market: json',
        'questions:',
        '  direction:',
        '    type: choice',
        '    instructions: thesisが主張する方向は',
        '    criteria: { long: 上昇, short: 下落, neutral: 未定 }',
      ].join('\n'),
      'q.yaml',
    );
    expect(file).toEqual({
      state: { thesis: 'text', market: 'json' },
      questions: {
        direction: {
          type: 'choice',
          instructions: 'thesisが主張する方向は',
          criteria: { long: '上昇', short: '下落', neutral: '未定' },
        },
      },
    });
  });

  it.each([
    ['YAMLとして読めない', 'questions: [unclosed'],
    ['トップレベルが配列', '- a'],
    ['未知のキー', 'questions: {}\nextra: 1'],
    ['questions が無い', 'state: { a: text }'],
    ['model は書けない', 'model: typesafe-ai/jev\nquestions: {}'],
    ['state の型が不正', 'state: { a: number }\nquestions: {}'],
  ])('%s は使い方の誤り', (_label, text) => {
    expectUsageError(() => parseQuestionFile(text, 'q.yaml'));
  });
});

describe('mergeQuestions', () => {
  const q = { type: 'boolean', instructions: 'x' } as const;

  it('質問ファイルとinlineを合わせる', () => {
    expect(Object.keys(mergeQuestions({ a: q }, [['b', q]]))).toEqual(['a', 'b']);
  });

  it('constructor や __proto__ も質問名に使える', () => {
    const inline = [parseInlineQuestion('boolean', 'constructor=x'), parseInlineQuestion('boolean', '__proto__=y')];
    const merged = mergeQuestions({}, inline);
    expect(Object.keys(merged)).toEqual(['constructor', '__proto__']);
    expect(JSON.stringify(merged)).toBe(
      '{"constructor":{"type":"boolean","instructions":"x"},"__proto__":{"type":"boolean","instructions":"y"}}',
    );
    const file = parseQuestionFile('questions:\n  q:\n    type: choice\n    instructions: x\n    criteria: { __proto__: a, toString: b }\n', 'q.yaml');
    expect(Object.keys(file.questions.q?.type === 'choice' ? file.questions.q.criteria : {})).toEqual(['__proto__', 'toString']);
  });

  it('名前の衝突と質問0件は使い方の誤り', () => {
    expectUsageError(() => mergeQuestions({ a: q }, [['a', q]]));
    expectUsageError(() => mergeQuestions({}, []));
  });
});
