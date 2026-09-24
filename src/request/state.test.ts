import { describe, expect, it } from 'vitest';
import { CliError } from '../errors.js';
import { type InputReader, buildState, parseStateArg } from './state.js';

const reader = (files: Record<string, string>, stdin = ''): InputReader => ({
  readFile: async (path) => {
    const content = files[path];
    if (content === undefined) throw new Error('ENOENT');
    return content;
  },
  readStdin: async () => stdin,
});

describe('parseStateArg', () => {
  it('テキスト・@file・stdinを見分ける', () => {
    expect(parseStateArg('hello world')).toEqual({ source: { kind: 'literal', text: 'hello world' } });
    expect(parseStateArg('@a.txt')).toEqual({ source: { kind: 'file', path: 'a.txt' } });
    expect(parseStateArg('-')).toEqual({ source: { kind: 'stdin' } });
    expect(parseStateArg('@@mention')).toEqual({ source: { kind: 'literal', text: '@mention' } });
  });

  it('識別子=値 のときだけキー付きにする', () => {
    expect(parseStateArg('thesis=@t.txt')).toEqual({ key: 'thesis', source: { kind: 'file', path: 't.txt' } });
    expect(parseStateArg('1x=foo')).toEqual({ source: { kind: 'literal', text: '1x=foo' } });
    expect(parseStateArg('a b=c')).toEqual({ source: { kind: 'literal', text: 'a b=c' } });
  });
});

describe('buildState', () => {
  it('キー無しの1つはそのまま渡す。.jsonはJSONとして読む', async () => {
    expect(await buildState([parseStateArg('text')], reader({}))).toBe('text');
    expect(await buildState([parseStateArg('@s.json')], reader({ 's.json': '{"a":1}' }))).toEqual({ a: 1 });
    expect(await buildState([parseStateArg('@s.txt')], reader({ 's.txt': '{"a":1}' }))).toBe('{"a":1}');
  });

  it('キー付きを合成する', async () => {
    const state = await buildState(
      ['thesis=@t.txt', 'market=@m.json', 'note=-'].map(parseStateArg),
      reader({ 't.txt': 'long', 'm.json': '[1,2]' }, 'from stdin'),
    );
    expect(state).toEqual({ thesis: 'long', market: [1, 2], note: 'from stdin' });
  });

  it('ファイル・stdinの末尾の改行を1つだけ落とす', async () => {
    const state = await buildState(['a=@a.txt', 'b=-'].map(parseStateArg), reader({ 'a.txt': 'x\n\n' }, 'y\r\n'));
    expect(state).toEqual({ a: 'x\n', b: 'y' });
  });

  it('宣言した型が拡張子より優先する', async () => {
    const state = await buildState(
      ['a=@a.json', 'b=[1]'].map(parseStateArg),
      reader({ 'a.json': '{"x":1}' }),
      { a: 'text', b: 'json' },
    );
    expect(state).toEqual({ a: '{"x":1}', b: [1] });
  });

  it.each([
    ['--state が無い', [], undefined],
    ['キー有り無しの混在', ['a=1', 'text'], undefined],
    ['キー無しの複数', ['x', 'y'], undefined],
    ['キーの重複', ['a=1', 'a=2'], undefined],
    ['stdinが2つ', ['a=-', 'b=-'], undefined],
    ['宣言キーの不足', ['a=1'], { a: 'text', b: 'text' }],
    ['宣言外のキー', ['a=1', 'c=2'], { a: 'text' }],
    ['宣言があるのにキー無し', ['text'], { a: 'text' }],
    ['JSONとして読めない', ['a=@bad.json'], undefined],
    ['ファイルが無い', ['a=@none.txt'], undefined],
  ] as const)('%s は使い方の誤り (exit 2)', async (_label, args, declared) => {
    const promise = buildState(args.map(parseStateArg), reader({ 'bad.json': '{' }), declared);
    await expect(promise).rejects.toBeInstanceOf(CliError);
    await expect(promise).rejects.toMatchObject({ exitCode: 2 });
  });
});
