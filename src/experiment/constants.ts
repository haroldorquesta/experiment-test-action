export const CONSTANTS = {
  PERFECT_SCORE: 100,
  FAILED_SCORE: 0,
  BERT_SCORE_METRICS: ['f1', 'precision', 'recall'] as const,
  POLL_INTERVAL_SECONDS: 3,
  API_BASE_URL: 'https://my.staging.orq.ai',
  UNICODE: {
    NEUTRAL: '🟡',
    SUCCESS: '🟢',
    ERROR: '🔴'
  }
} as const
