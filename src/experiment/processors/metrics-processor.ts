import * as core from '@actions/core'
import type {
  ExperimentManifest,
  ExperimentManifestRowCell,
  ExperimentEvalResults
} from '../types.js'
import { CONSTANTS } from '../constants.js'
import {
  isLLMEvalValue,
  isBertScoreValue,
  isRougeScoreValue
} from '../type-guards.js'
import { formatNumber } from '../utils.js'

export class MetricsProcessor {
  normalizeMetrics(
    metrics: ExperimentManifest['metrics']
  ): Record<string, number> {
    const normalizeMetrics: Record<string, number> = {}

    core.info(`normalizedMetrics start: ${JSON.stringify(metrics)}`)

    for (const metricKey of Object.keys(metrics)) {
      const newMetricKey = metricKey.split('_').slice(1).join('_')

      normalizeMetrics[newMetricKey] = metrics[metricKey]
    }

    core.info(`normalizedMetrics: ${JSON.stringify(normalizeMetrics)}`)

    return normalizeMetrics
  }

  extractEvalValue(
    cell: ExperimentManifestRowCell,
    evaluatorId: string
  ): Record<string, number> {
    const mapper: Record<string, number> = {}
    const { type, value } = cell.value
    core.info(
      `extract actual value: type${type}, value${JSON.stringify(value)}`
    )

    switch (type) {
      case 'number':
      case 'cost':
      case 'latency':
        if (typeof value === 'number') {
          mapper[evaluatorId] = value
        }
        break
      case 'boolean':
        if (typeof value === 'boolean') {
          mapper[evaluatorId] = value
            ? CONSTANTS.PERFECT_SCORE
            : CONSTANTS.FAILED_SCORE
        }
        break
      case 'llm_evaluator':
        if (isLLMEvalValue(value)) {
          if (typeof value.value === 'boolean') {
            mapper[evaluatorId] = value.value
              ? CONSTANTS.PERFECT_SCORE
              : CONSTANTS.FAILED_SCORE
          } else if (typeof value.value === 'number') {
            mapper[evaluatorId] = value.value
          }
        }
        break
      case 'bert_score':
        if (isBertScoreValue(value)) {
          mapper[`${evaluatorId}_bert_score_f1`] = value.f1
          mapper[`${evaluatorId}_bert_score_precision`] = value.precision
          mapper[`${evaluatorId}_bert_score_recall`] = value.recall
        }
        break
      case 'rouge_n':
        if (isRougeScoreValue(value)) {
          mapper[`${evaluatorId}_rouge_1_f1`] = value.rouge_1.f1
          mapper[`${evaluatorId}_rouge_1_precision`] = value.rouge_1.precision
          mapper[`${evaluatorId}_rouge_1_recall`] = value.rouge_1.recall
          mapper[`${evaluatorId}_rouge_2_f1`] = value.rouge_2.f1
          mapper[`${evaluatorId}_rouge_2_precision`] = value.rouge_2.precision
          mapper[`${evaluatorId}_rouge_2_recall`] = value.rouge_2.recall
          mapper[`${evaluatorId}_rouge_l_f1`] = value.rouge_l.f1
          mapper[`${evaluatorId}_rouge_l_precision`] = value.rouge_l.precision
          mapper[`${evaluatorId}_rouge_l_recall`] = value.rouge_l.recall
        }
        break
      default:
        break
    }

    return mapper
  }

  processBertScoreEval(
    evalId: string,
    currentValues: ExperimentEvalResults[],
    previousValues: ExperimentEvalResults[]
  ): string[] {
    const evals: string[] = []

    for (const metric of CONSTANTS.BERT_SCORE_METRICS) {
      const metricId = `${evalId}_bert_score_${metric}`
      const current = currentValues.find((v) => v[metricId] !== undefined)
      const previous = previousValues.find((v) => v[metricId] !== undefined)

      if (current && previous) {
        const currentValue = current[metricId] as number
        const previousValue = previous[metricId] as number
        const diff = currentValue - previousValue
        const icon =
          diff > 0
            ? CONSTANTS.UNICODE.SUCCESS
            : diff < 0
              ? CONSTANTS.UNICODE.ERROR
              : CONSTANTS.UNICODE.NEUTRAL

        evals.push(
          `${evalId} (${metric})`,
          formatNumber(previousValue),
          formatNumber(currentValue),
          `${icon} ${formatNumber(diff)}`
        )
      }
    }

    return evals
  }

  processRougeNEval(
    evalId: string,
    currentValues: ExperimentEvalResults[],
    previousValues: ExperimentEvalResults[]
  ): string[] {
    const evals: string[] = []
    const rougeTypes = ['rouge_1', 'rouge_2', 'rouge_l']
    const rougeMetrics = ['f1', 'precision', 'recall']

    for (const rougeType of rougeTypes) {
      for (const metric of rougeMetrics) {
        const metricId = `${evalId}_${rougeType}_${metric}`
        const current = currentValues.find((v) => v[metricId] !== undefined)
        const previous = previousValues.find((v) => v[metricId] !== undefined)

        if (current && previous) {
          const currentValue = current[metricId] as number
          const previousValue = previous[metricId] as number
          const diff = currentValue - previousValue
          const icon =
            diff > 0
              ? CONSTANTS.UNICODE.SUCCESS
              : diff < 0
                ? CONSTANTS.UNICODE.ERROR
                : CONSTANTS.UNICODE.NEUTRAL

          evals.push(
            `${evalId} (${rougeType.replace('_', '-')} ${metric})`,
            formatNumber(previousValue),
            formatNumber(currentValue),
            `${icon} ${formatNumber(diff)}`
          )
        }
      }
    }

    return evals
  }

  processStandardEval(
    evalId: string,
    currentValues: ExperimentEvalResults[],
    previousValues: ExperimentEvalResults[]
  ): string[] {
    const current = currentValues.find((v) => v[evalId] !== undefined)
    const previous = previousValues.find((v) => v[evalId] !== undefined)

    if (!current || !previous) {
      return []
    }

    const currentValue = current[evalId] as number
    const previousValue = previous[evalId] as number
    const diff = currentValue - previousValue
    const icon =
      diff > 0
        ? CONSTANTS.UNICODE.SUCCESS
        : diff < 0
          ? CONSTANTS.UNICODE.ERROR
          : CONSTANTS.UNICODE.NEUTRAL

    return [
      evalId,
      formatNumber(previousValue),
      formatNumber(currentValue),
      `${icon} ${formatNumber(diff)}`
    ]
  }
}
