// プロバイダ共通の形。プロバイダごとの差 (エンドポイント・型名・キーの環境変数) は各実装に閉じる

export type BooleanQuestion = {
  type: 'boolean';
  instructions: string;
  criteria?: { true?: string; false?: string };
};

export type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};

export type ScoreQuestion = {
  type: 'score';
  instructions: string;
  criteria: string[];
};

export type Question = BooleanQuestion | ChoiceQuestion | ScoreQuestion;
export type QuestionType = Question['type'];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type EvaluateRequest = {
  model: string;
  state: JsonValue;
  questions: Record<string, Question>;
};

export type BooleanAnswer = { type: 'boolean'; probability: number };
export type ChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number;
};
export type ScoreAnswer = {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence?: number;
};

export type Answer = BooleanAnswer | ChoiceAnswer | ScoreAnswer;

// 応答に無かった値は undefined のまま持つ (推測で埋めない)
export type EvaluateMeta = {
  provider: string;
  startedAt?: string;
  model?: string;
  elapsedMs: number;
  providerMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  marketCost?: string;
  generationId?: string;
};

export type EvaluateResult = {
  answers: Record<string, Answer | undefined>;
  meta: EvaluateMeta;
  raw: unknown;
};

export type Provider = {
  name: string;
  evaluate(request: EvaluateRequest): Promise<EvaluateResult>;
};
