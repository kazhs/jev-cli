// 公式docsの応答例に、実際の応答で観測した routing.modelAttempts を足した形
// https://vercel.com/docs/ai-gateway/modalities/evaluation
export const SAMPLE_RESPONSE = {
  model: 'typesafe-ai/jev',
  answers: {
    refund: { type: 'boolean', probability: 0.98 },
    route: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, shipping: 0.1 }, confidence: 0.8 },
    quality: { type: 'score', score: 2.97, probabilities: { '0': 0, '1': 0, '2': 0.02, '3': 0.98 } },
  },
  usage: { inputTokens: 275, outputTokens: 20 },
  providerMetadata: {
    gateway: {
      routing: { modelAttempts: [{ providerAttempts: [{ startTime: 1000, endTime: 1192 }] }] },
      cost: '0',
      marketCost: '0.00001155',
      generationId: 'gen_test',
    },
  },
};
