export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
