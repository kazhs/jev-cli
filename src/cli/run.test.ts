import { describe, expect, it } from 'vitest';
import type { Keychain } from '../credentials/resolve.js';
import type { Io } from '../io/node-io.js';
import { SAMPLE_RESPONSE } from '../providers/fixtures.js';
import { run } from './run.js';

type FakeIo = Io & { stdout: string; stderr: string; written: Record<string, string> };

type FakeKeychain = Keychain & { items: Record<string, string>; added: string[] };

const fakeKeychain = (items: Record<string, string> = {}, available = true): FakeKeychain => {
  const keychain: FakeKeychain = {
    available,
    items,
    added: [],
    find: async (service, account) => keychain.items[`${service}/${account}`],
    add: async (service, account) => {
      keychain.added.push(`${service}/${account}`);
      keychain.items[`${service}/${account}`] = 'prompted-key';
    },
    remove: async (service, account) => {
      const id = `${service}/${account}`;
      if (!(id in keychain.items)) return false;
      delete keychain.items[id];
      return true;
    },
  };
  return keychain;
};

type FakeIoOptions = {
  files?: Record<string, string>;
  modes?: Record<string, number>;
  stdin?: string;
  tty?: boolean;
  stdinTty?: boolean;
  env?: Record<string, string>;
  keychain?: Keychain;
};

const fakeIo = (options: FakeIoOptions = {}): FakeIo => {
  const io: FakeIo = {
    stdout: '',
    stderr: '',
    written: {},
    readFile: async (path) => {
      const content = options.files?.[path];
      if (content === undefined) throw new Error('ENOENT');
      return content;
    },
    readStdin: async () => options.stdin ?? '',
    writeStdout: (text) => {
      io.stdout += text;
    },
    writeStderr: (text) => {
      io.stderr += text;
    },
    writeFile: async (path, text) => {
      io.written[path] = text;
    },
    fileMode: async (path) => options.modes?.[path],
    stdoutIsTTY: options.tty ?? false,
    stdinIsTTY: options.stdinTty ?? false,
    env: options.env ?? { AI_GATEWAY_API_KEY: 'test-key' },
    keychain: options.keychain ?? fakeKeychain({}, false),
  };
  return io;
};

const okFetch = (bodies: unknown[] = [], auth: string[] = []) =>
  (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    auth.push(new Headers(init?.headers).get('authorization') ?? '');
    return new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 });
  }) as typeof fetch;

const QUESTIONS = ['--bool', 'refund=返金を求めているか'];

describe('run', () => {
  it('pipeならjsonで出す', async () => {
    const io = fakeIo();
    const code = await run(['-s', '二重に請求された', ...QUESTIONS], { io, version: '0.0.0', fetch: okFetch() });
    expect(code).toBe(0);
    expect(JSON.parse(io.stdout)).toMatchObject({ answers: { refund: { type: 'boolean', probability: 0.98 } } });
  });

  it('端末ならtextで出す', async () => {
    const io = fakeIo({ tty: true });
    await run(['-s', 'x', ...QUESTIONS], { io, version: '0.0.0', fetch: okFetch() });
    expect(io.stdout).toContain('refund: 98.0%');
    expect(io.stdout).toContain('generationId: gen_test');
  });

  it('YAMLの質問とinlineを合わせ、宣言どおりにstateを合成して送る', async () => {
    const bodies: unknown[] = [];
    const io = fakeIo({
      files: {
        'q.yaml': 'state:\n  thesis: text\n  market: json\nquestions:\n  route:\n    type: choice\n    instructions: 振り分け先は\n    criteria: { billing: 請求, shipping: 配送 }\n',
        't.txt': '請求の問題',
        'm.json': '{"orders":1}',
      },
    });
    const code = await run(
      ['-f', 'q.yaml', '-s', 'thesis=@t.txt', '-s', 'market=@m.json', ...QUESTIONS],
      { io, version: '0.0.0', fetch: okFetch(bodies) },
    );
    expect(code).toBe(0);
    expect(bodies[0]).toEqual({
      model: 'typesafe-ai/jev',
      state: { thesis: '請求の問題', market: { orders: 1 } },
      questions: {
        route: { type: 'choice', instructions: '振り分け先は', criteria: { billing: '請求', shipping: '配送' } },
        refund: { type: 'boolean', instructions: '返金を求めているか' },
      },
    });
  });

  it('-o は標準出力と別に、拡張子の形式でファイルに書く', async () => {
    const io = fakeIo({ tty: true });
    await run(['-s', 'x', ...QUESTIONS, '-o', 'out/result.md'], { io, version: '0.0.0', fetch: okFetch() });
    expect(io.stdout).toContain('refund: 98.0%');
    expect(io.written['out/result.md']).toContain('| refund | boolean | 98.0% |');
  });

  it('拡張子で決まらないファイルは --format に従う', async () => {
    const io = fakeIo();
    await run(['-s', 'x', ...QUESTIONS, '--format', 'json', '-o', 'result.log'], { io, version: '0.0.0', fetch: okFetch() });
    expect(JSON.parse(io.written['result.log'] ?? '')).toMatchObject({ answers: { refund: { probability: 0.98 } } });
  });

  it('--raw はAPIの応答をそのまま出す', async () => {
    const io = fakeIo();
    await run(['-s', 'x', ...QUESTIONS, '--raw'], { io, version: '0.0.0', fetch: okFetch() });
    expect(JSON.parse(io.stdout)).toEqual(SAMPLE_RESPONSE);
  });

  it('--dry-run はキー無しで動き、APIを呼ばない', async () => {
    const io = fakeIo({ env: {} });
    const bodies: unknown[] = [];
    const code = await run(['-s', 'x', ...QUESTIONS, '--dry-run'], { io, version: '0.0.0', fetch: okFetch(bodies) });
    expect(code).toBe(0);
    expect(bodies).toHaveLength(0);
    expect(JSON.parse(io.stdout)).toMatchObject({ model: 'typesafe-ai/jev', state: 'x' });
  });

  it('キーが無ければ exit 3', async () => {
    const io = fakeIo({ env: {} });
    expect(await run(['-s', 'x', ...QUESTIONS], { io, version: '0.0.0', fetch: okFetch() })).toBe(3);
    expect(io.stderr).toContain('AI_GATEWAY_API_KEY');
  });

  it('使い方の誤りは exit 2', async () => {
    const io = fakeIo();
    expect(await run(['--unknown'], { io, version: '0.0.0' })).toBe(2);
    expect(await run(['-s', 'x'], { io, version: '0.0.0' })).toBe(2);
    expect(await run(['-s', 'x', ...QUESTIONS, '--format', 'xml'], { io, version: '0.0.0' })).toBe(2);
  });

  it('--help と --version', async () => {
    const io = fakeIo();
    expect(await run(['--version'], { io, version: '1.2.3' })).toBe(0);
    expect(io.stdout).toBe('1.2.3\n');
  });

  it('キーは 環境変数 > _FILE > Keychain の順で探す', async () => {
    const keychain = fakeKeychain({ 'jev-cli/vercel': 'keychain-key' });
    const files = { '/k': 'file-key\n' };
    const cases: [Record<string, string>, string][] = [
      [{ AI_GATEWAY_API_KEY: 'env-key', AI_GATEWAY_API_KEY_FILE: '/k' }, 'Bearer env-key'],
      [{ AI_GATEWAY_API_KEY_FILE: '/k' }, 'Bearer file-key'],
      [{}, 'Bearer keychain-key'],
    ];
    for (const [env, expected] of cases) {
      const auth: string[] = [];
      const io = fakeIo({ env, files, keychain, modes: { '/k': 0o100600 } });
      expect(await run(['-s', 'x', ...QUESTIONS], { io, version: '0.0.0', fetch: okFetch([], auth) })).toBe(0);
      expect(auth).toEqual([expected]);
      expect(io.stderr).toBe('');
    }
  });

  it('他人が読めるキーファイルは警告するが止めない', async () => {
    const io = fakeIo({ env: { AI_GATEWAY_API_KEY_FILE: '/k' }, files: { '/k': 'k' }, modes: { '/k': 0o100644 } });
    expect(await run(['-s', 'x', ...QUESTIONS], { io, version: '0.0.0', fetch: okFetch() })).toBe(0);
    expect(io.stderr).toContain('accessible by other users');
    expect(io.stderr).toContain("chmod 600 '/k'");
    expect(io.stderr).not.toContain('k\n');
  });

  it('キーファイルのエラーにパスを出さない (キーそのものが入っていることがある)', async () => {
    const io = fakeIo({ env: { AI_GATEWAY_API_KEY_FILE: 'sk-secret-value' } });
    expect(await run(['-s', 'x', ...QUESTIONS], { io, version: '0.0.0', fetch: okFetch() })).toBe(3);
    expect(io.stderr).toContain('AI_GATEWAY_API_KEY_FILE');
    expect(io.stderr).not.toContain('sk-secret-value');
  });

  it('キーファイルが読めない・空なら exit 3', async () => {
    const missing = fakeIo({ env: { AI_GATEWAY_API_KEY_FILE: '/none' } });
    expect(await run(['-s', 'x', ...QUESTIONS], { io: missing, version: '0.0.0', fetch: okFetch() })).toBe(3);
    const empty = fakeIo({ env: { AI_GATEWAY_API_KEY_FILE: '/k' }, files: { '/k': '\n' } });
    expect(await run(['-s', 'x', ...QUESTIONS], { io: empty, version: '0.0.0', fetch: okFetch() })).toBe(3);
  });
});

describe('キーの検証', () => {
  it.each([
    ['環境変数', { AI_GATEWAY_API_KEY: 'sk-a\nsk-b' }, {}],
    ['キーファイル', { AI_GATEWAY_API_KEY_FILE: '/k' }, { '/k': '# vercel key\nsk-secret-value\n' }],
  ])('%sのキーに改行があれば、値を出さずに exit 3', async (_label, env, files) => {
    const bodies: unknown[] = [];
    const io = fakeIo({ env, files, modes: { '/k': 0o100600 } });
    expect(await run(['-s', 'x', ...QUESTIONS], { io, version: '0.0.0', fetch: okFetch(bodies) })).toBe(3);
    expect(bodies).toHaveLength(0);
    expect(io.stderr).toContain('whitespace or non-printable');
    expect(io.stderr).not.toMatch(/sk-/);
  });

  it('権限の警告に出すパスはクォートする', async () => {
    const io = fakeIo({ env: { AI_GATEWAY_API_KEY_FILE: "/my keys/it's" }, files: { "/my keys/it's": 'k' }, modes: { "/my keys/it's": 0o100644 } });
    expect(await run(['-s', 'x', ...QUESTIONS], { io, version: '0.0.0', fetch: okFetch() })).toBe(0);
    expect(io.stderr).toContain("chmod 600 '/my keys/it'\\''s'");
  });

  it('--timeout の上限を超えたら exit 2', async () => {
    const io = fakeIo();
    expect(await run(['-s', 'x', ...QUESTIONS, '--timeout', '2147483648'], { io, version: '0.0.0', fetch: okFetch() })).toBe(2);
    expect(await run(['-s', 'x', ...QUESTIONS, '--timeout', '2147483647'], { io, version: '0.0.0', fetch: okFetch() })).toBe(0);
  });
});

describe('jev auth', () => {
  it('status はキーの出どころだけを出し、値は出さない', async () => {
    const io = fakeIo({ env: {}, keychain: fakeKeychain({ 'jev-cli/vercel': 'secret-value' }) });
    expect(await run(['auth', 'status'], { io, version: '0.0.0' })).toBe(0);
    expect(io.stdout).toBe('vercel: macOS Keychain (service jev-cli, account vercel)\n');
    expect(io.stdout + io.stderr).not.toContain('secret-value');
  });

  it('status でキーが無ければ exit 3', async () => {
    const io = fakeIo({ env: {}, keychain: fakeKeychain() });
    expect(await run(['auth', 'status'], { io, version: '0.0.0' })).toBe(3);
    expect(io.stderr).toContain("jev auth set");
  });

  it('set は端末があるときだけ Keychain に保存する', async () => {
    const keychain = fakeKeychain();
    const noTty = fakeIo({ keychain });
    expect(await run(['auth', 'set'], { io: noTty, version: '0.0.0' })).toBe(2);
    expect(keychain.added).toEqual([]);

    const io = fakeIo({ env: {}, keychain, stdinTty: true });
    expect(await run(['auth', 'set'], { io, version: '0.0.0' })).toBe(0);
    expect(keychain.added).toEqual(['jev-cli/vercel']);
  });

  it('set で環境変数やキーファイルも設定されていれば、そちらが優先されると警告する', async () => {
    const io = fakeIo({ env: { AI_GATEWAY_API_KEY: 'x' }, keychain: fakeKeychain(), stdinTty: true });
    expect(await run(['auth', 'set'], { io, version: '0.0.0' })).toBe(0);
    expect(io.stderr).toContain('AI_GATEWAY_API_KEY is set and takes precedence');

    const fileIo = fakeIo({ env: { AI_GATEWAY_API_KEY_FILE: '/k' }, keychain: fakeKeychain(), stdinTty: true });
    expect(await run(['auth', 'set'], { io: fileIo, version: '0.0.0' })).toBe(0);
    expect(fileIo.stderr).toContain('AI_GATEWAY_API_KEY_FILE is set and takes precedence');
  });

  it('delete は Keychain から消す', async () => {
    const keychain = fakeKeychain({ 'jev-cli/vercel': 'k' });
    const io = fakeIo({ keychain });
    expect(await run(['auth', 'delete'], { io, version: '0.0.0' })).toBe(0);
    expect(keychain.items).toEqual({});
    expect(await run(['auth', 'delete'], { io, version: '0.0.0' })).toBe(0);
    expect(io.stdout).toContain('nothing to remove');
  });

  it('Keychain の無い環境で set / delete は exit 2', async () => {
    const io = fakeIo({ keychain: fakeKeychain({}, false), stdinTty: true });
    expect(await run(['auth', 'set'], { io, version: '0.0.0' })).toBe(2);
    expect(await run(['auth', 'delete'], { io, version: '0.0.0' })).toBe(2);
  });

  it('未知のサブコマンドは exit 2', async () => {
    const io = fakeIo();
    expect(await run(['auth', 'login'], { io, version: '0.0.0' })).toBe(2);
  });
});
