export function isLLMEvalValue(
  value: unknown
): value is { value: number | boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    (typeof (value as { value: unknown }).value === 'number' ||
      typeof (value as { value: unknown }).value === 'boolean')
  )
}

export function isBertScoreValue(value: unknown): value is {
  f1: number
  precision: number
  recall: number
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'f1' in value &&
    'precision' in value &&
    'recall' in value &&
    typeof (value as { f1: unknown; precision: unknown; recall: unknown })
      .f1 === 'number' &&
    typeof (value as { f1: unknown; precision: unknown; recall: unknown })
      .precision === 'number' &&
    typeof (value as { f1: unknown; precision: unknown; recall: unknown })
      .recall === 'number'
  )
}

export function isRougeScoreValue(value: unknown): value is {
  rouge_1: { f1: number; precision: number; recall: number }
  rouge_2: { f1: number; precision: number; recall: number }
  rouge_l: { f1: number; precision: number; recall: number }
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rouge_1' in value &&
    'rouge_2' in value &&
    'rouge_l' in value
  )
}
