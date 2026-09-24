// macOS の security コマンドで Keychain の generic password を扱う
import { execFile, spawn } from 'node:child_process';
import { CliError, EXIT } from '../errors.js';
import type { Keychain } from '../credentials/resolve.js';

// 項目が無いときの security の終了コード (実測)
const NOT_FOUND = 44;

type ExecResult = { code: number; stdout: string; stderr: string };

const exec = (args: string[]): Promise<ExecResult> =>
  new Promise((resolve, reject) => {
    execFile('security', args, (error, stdout, stderr) => {
      if (error === null) return resolve({ code: 0, stdout, stderr });
      if (typeof error.code === 'number') return resolve({ code: error.code, stdout, stderr });
      reject(error);
    });
  });

const failure = (action: string, result: ExecResult): CliError =>
  new CliError(`keychain ${action} failed (security exit ${result.code}): ${result.stderr.trim()}`, EXIT.auth);

export const macosKeychain: Keychain = {
  available: process.platform === 'darwin',

  async find(service, account) {
    const result = await exec(['find-generic-password', '-s', service, '-a', account, '-w']);
    if (result.code === NOT_FOUND) return undefined;
    if (result.code !== 0) throw failure('lookup', result);
    return result.stdout.replace(/\n$/, '');
  },

  // -w を最後に置くと security がキーを端末で聞く。引数で渡すとプロセス一覧からキーが見える
  add(service, account) {
    return new Promise((resolve, reject) => {
      const child = spawn('security', ['add-generic-password', '-U', '-s', service, '-a', account, '-w'], {
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new CliError(`keychain save failed (security exit ${String(code)})`, EXIT.auth));
      });
    });
  },

  async remove(service, account) {
    const result = await exec(['delete-generic-password', '-s', service, '-a', account]);
    if (result.code === NOT_FOUND) return false;
    if (result.code !== 0) throw failure('delete', result);
    return true;
  },
};
