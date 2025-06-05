import type { Experiment } from '../types.js'
import { formatNumber, generateMarkdownTable } from '../utils.js'
import { CONSTANTS } from '../constants.js'

export class CommentFormatter {
  generateCommentKey(filename: string): string {
    return `<!-- orq-action-identifier:${filename} -->`
  }

  formatExperimentRunningComment(
    experimentKey: string,
    deploymentKey: string,
    filename: string
  ): string {
    const key = this.generateCommentKey(filename)

    return `${key}
## 🧪 Orq.ai Experiment Running

**Deployment:** ${deploymentKey}  
**Experiment:** ${experimentKey}

🔄 Your experiment is currently running. Results will be posted here once complete.

---
`
  }

  formatExperimentResultsComment(
    experiment: Experiment,
    deploymentName: string,
    evalTable: string[][],
    filename: string,
    experimentRunId: string
  ): string {
    const key = this.generateCommentKey(filename)

    const content = `${key}
## 🧪 Orq.ai Experiment Results

**Deployment:** ${deploymentName}
**Experiment:** ${experiment.name}

${this.formatEvaluationTable(evalTable)}

---
[View detailed results in Orq.ai](${CONSTANTS.API_BASE_URL}/experiments/${experiment.id}/run/${experimentRunId})`

    return content
  }

  formatExperimentErrorComment(
    error: Error,
    filename: string,
    deploymentName?: string,
    experimentName?: string
  ): string {
    const key = this.generateCommentKey(filename)

    return `${key}
## ❌ Orq.ai Experiment Failed

${deploymentName ? `**Deployment:** ${deploymentName}` : ''}  
${experimentName ? `**Experiment:** ${experimentName}` : ''}  

**Error:** ${error.message}

Please check your configuration and try again.`
  }

  private formatEvaluationTable(evalTable: string[][]): string {
    if (evalTable.length === 0) {
      return '*No evaluation metrics to compare*'
    }

    const headers = ['Score', 'Average', 'Improvements', 'Regressions']
    return generateMarkdownTable(headers, evalTable)
  }

  formatMetricsDiff(
    currentMetrics: Record<string, number>,
    previousMetrics: Record<string, number>
  ): string[][] {
    const metricsTable: string[][] = []

    if ('orq_cost' in currentMetrics && 'orq_cost' in previousMetrics) {
      const currentCost = currentMetrics.orq_cost
      const previousCost = previousMetrics.orq_cost
      const costDiff = currentCost - previousCost
      const costIcon =
        costDiff < 0
          ? CONSTANTS.UNICODE.SUCCESS
          : costDiff > 0
            ? CONSTANTS.UNICODE.ERROR
            : CONSTANTS.UNICODE.NEUTRAL

      metricsTable.push([
        'Cost',
        `$${formatNumber(previousCost)}`,
        `$${formatNumber(currentCost)}`,
        `${costIcon} $${formatNumber(Math.abs(costDiff))}`
      ])
    }

    if ('orq_latency' in currentMetrics && 'orq_latency' in previousMetrics) {
      const currentLatency = currentMetrics.orq_latency
      const previousLatency = previousMetrics.orq_latency
      const latencyDiff = currentLatency - previousLatency
      const latencyIcon =
        latencyDiff < 0
          ? CONSTANTS.UNICODE.SUCCESS
          : latencyDiff > 0
            ? CONSTANTS.UNICODE.ERROR
            : CONSTANTS.UNICODE.NEUTRAL

      metricsTable.push([
        'Latency',
        `${formatNumber(previousLatency)}ms`,
        `${formatNumber(currentLatency)}ms`,
        `${latencyIcon} ${formatNumber(Math.abs(latencyDiff))}ms`
      ])
    }

    return metricsTable
  }
}
