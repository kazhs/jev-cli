// 終了コードの意味は docs/specs/requirements.md の表に従う
export const EXIT = {
  ok: 0,
  api: 1,
  usage: 2,
  auth: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CliError extends Error {
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: ExitCode) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export const usageError = (message: string): CliError => new CliError(message, EXIT.usage);
