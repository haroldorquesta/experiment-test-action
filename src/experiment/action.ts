import * as core from '@actions/core'
import * as fs from 'node:fs/promises'
import yaml from 'yaml'
import { sleep } from './utils.js'
import type {
  DeploymentExperimentRunResponse,
  DeploymentExperimentRunPayload,
  ExperimentManifest,
  PaginatedExperimentManifestRows,
  Experiment,
  ExperimentEvalResults
} from './types.js'
import { SheetRunStatus } from './enums.js'
import { OrqExperimentClientApi } from './services/orq-experiment-client-api.js'
import { OrqExperimentError } from './errors.js'
import { CONSTANTS } from './constants.js'
import { GithubService } from './services/github-service.js'
import { MetricsProcessor } from './processors/metrics-processor.js'
import { CommentFormatter } from './formatters/comment-formatter.js'

class OrqExperimentAction {
  private githubService: GithubService
  private apiClient: OrqExperimentClientApi | null = null
  private metricsProcessor: MetricsProcessor
  private commentFormatter: CommentFormatter
  private path = ''

  constructor() {
    const githubToken = core.getInput('github_token')
    this.githubService = new GithubService(githubToken)
    this.metricsProcessor = new MetricsProcessor()
    this.commentFormatter = new CommentFormatter()

    const apiKey = core.getInput('api_key')
    this.apiClient = new OrqExperimentClientApi(apiKey)
    this.path = core.getInput('path')
  }

  async run(): Promise<void> {
    try {
      if (!this.githubService.getPullRequest()) {
        throw new OrqExperimentError('Pull request not found!')
      }

      const baseSha = await this.githubService.getPullRequestBase()
      const filesChanged = await this.githubService.getFilesChanged(this.path)

      core.info(`Files changed: ${JSON.stringify(filesChanged)}`)
      core.info(`Found ${filesChanged.length} files changed`)

      // Process all files in parallel
      await Promise.all(
        filesChanged.map((filename) => this.processFile(filename, baseSha))
      )
    } catch (error) {
      core.error(`Failed to run Orq experiment: ${error}`)
      throw error
    }
  }

  private async processFile(filename: string, baseSha: string): Promise<void> {
    try {
      const hasChange = await this.configChange(filename, baseSha)

      if (!hasChange) {
        core.info(`No relevant changes detected in ${filename}`)
        return
      }

      await this.runExperiment(filename, hasChange)
    } catch (error) {
      if (error instanceof Error) {
        const comment = this.commentFormatter.formatExperimentErrorComment(
          error,
          filename
        )
        const key = this.commentFormatter.generateCommentKey(filename)
        await this.githubService.upsertComment(key, comment)
      }
      throw error
    }
  }

  private async configChange(
    filename: string,
    baseSha: string
  ): Promise<DeploymentExperimentRunPayload | null> {
    const newPayload = await this.readLocalYamlFile(filename)

    try {
      const originalFile = await this.githubService.getFileContent(
        filename,
        baseSha
      )
      const originalPayload = await this.githubService.parseYamlFile(
        originalFile.content
      )

      if (
        originalPayload.deployment_key !== newPayload.deployment_key ||
        originalPayload.dataset_id !== newPayload.dataset_id
      ) {
        return newPayload
      }

      return null
    } catch {
      // File doesn't exist in base branch
      return newPayload
    }
  }

  private async readLocalYamlFile(
    filename: string
  ): Promise<DeploymentExperimentRunPayload> {
    const fileContent = await fs.readFile(filename, 'utf8')
    return yaml.parse(fileContent)
  }

  private async runExperiment(
    filename: string,
    payload: DeploymentExperimentRunPayload
  ): Promise<void> {
    if (!this.apiClient) {
      throw new OrqExperimentError('API client not initialized')
    }

    const { deployment_key, experiment_key } = payload

    // Initial running comment
    let runningComment = this.commentFormatter.formatExperimentRunningComment(
      experiment_key,
      deployment_key,
      filename
    )
    const key = this.commentFormatter.generateCommentKey(filename)
    await this.githubService.upsertComment(key, runningComment)

    // Run the experiment
    const experimentRun = await this.apiClient.createExperimentRun(payload)

    // Post initial running comment with experiment link
    runningComment = this.commentFormatter.formatExperimentRunningComment(
      experiment_key,
      deployment_key,
      filename,
      experimentRun.experiment_id,
      experimentRun.experiment_run_id
    )
    await this.githubService.upsertComment(key, runningComment)

    core.info('wait for completion')

    await this.waitForCompletion(experimentRun)

    core.info('get experiment')

    // Get experiment details
    const experiment = await this.apiClient.getExperiment(
      experimentRun.experiment_id
    )

    core.info('get current run maifest')

    // Get results
    const currentRun = await this.apiClient.getExperimentManifest(
      experimentRun.experiment_id,
      experimentRun.experiment_run_id
    )

    core.info('get experiment manifest rows')

    const currentManifestRows = await this.apiClient.getExperimentManifestRows(
      experimentRun.experiment_id,
      experimentRun.experiment_run_id
    )

    core.info('get previous run')

    // Try to get previous run for comparison
    let previousRun: ExperimentManifest | null = null
    let previousManifestRows: PaginatedExperimentManifestRows | null = null

    try {
      const allRuns = await this.apiClient.getAllExperimentManifests(
        experimentRun.experiment_id
      )

      // Find the current run index first
      // Results are already sorted in descending date order
      const currentRunIndex = allRuns.findIndex(
        (run) => run._id === experimentRun.experiment_run_id
      )

      // Previous run is at index + 1, check bounds first
      if (currentRunIndex !== -1 && currentRunIndex + 1 < allRuns.length) {
        const potentialPreviousRun = allRuns[currentRunIndex + 1]

        if (potentialPreviousRun.status !== SheetRunStatus.COMPLETED) {
          throw new OrqExperimentError(
            `Previous experiment run has status '${potentialPreviousRun.status}', expected 'COMPLETED'`
          )
        }

        previousRun = potentialPreviousRun
        previousManifestRows = await this.apiClient.getExperimentManifestRows(
          experimentRun.experiment_id,
          previousRun._id
        )
      }
    } catch (error) {
      throw new OrqExperimentError(
        `Failed to get previous run for comparison: ${error}`
      )
    }

    // Generate comparison tables
    const evalTable =
      previousRun && previousManifestRows
        ? this.generateEvalComparisonTable(
            experiment,
            currentRun,
            previousRun,
            currentManifestRows,
            previousManifestRows
          )
        : []

    // Post results comment
    const resultsComment = this.commentFormatter.formatExperimentResultsComment(
      experimentRun.experiment_id,
      experimentRun.experiment_run_id,
      experiment_key,
      deployment_key,
      evalTable,
      filename
    )

    await this.githubService.upsertComment(key, resultsComment)
  }

  private async waitForCompletion(
    experimentRun: DeploymentExperimentRunResponse
  ): Promise<void> {
    if (!this.apiClient) {
      throw new OrqExperimentError('API client not initialized')
    }

    while (true) {
      const manifest = await this.apiClient.getExperimentManifest(
        experimentRun.experiment_id,
        experimentRun.experiment_run_id
      )

      if (manifest.status === SheetRunStatus.COMPLETED) {
        break
      } else if (manifest.status === SheetRunStatus.CANCELLED) {
        throw new Error('Experiment was cancelled!')
      } else if (manifest.status === SheetRunStatus.FAILED) {
        throw new OrqExperimentError('Experiment failed to run!')
      }

      await sleep(CONSTANTS.POLL_INTERVAL_SECONDS)
    }
  }

  private generateEvalComparisonTable(
    experiment: Experiment,
    currentRun: ExperimentManifest,
    previousRun: ExperimentManifest,
    currentManifestRows: PaginatedExperimentManifestRows,
    previousManifestRows: PaginatedExperimentManifestRows
  ): string[][] {
    const evalTable: string[][] = []
    const currentEvals = this.extractEvalValues(
      experiment,
      currentRun,
      currentManifestRows
    )
    const previousEvals = this.extractEvalValues(
      experiment,
      previousRun,
      previousManifestRows
    )

    for (const evaluator of experiment.unique_evaluators) {
      const evalId = evaluator.evaluator_id
      const evalType = evaluator.evaluator_type

      // Get all metric keys for this evaluator based on type
      const metricKeys = this.getMetricKeysForEvaluator(evalId, evalType)

      for (const metricKey of metricKeys) {
        let totalCurrentScore = 0
        let totalPreviousScore = 0
        let improvements = 0
        let regressions = 0
        let validComparisons = 0

        // Compare row by row for the same metric key
        const minLength = Math.min(currentEvals.length, previousEvals.length)

        for (let i = 0; i < minLength; i++) {
          const currentScore = currentEvals[i][metricKey]
          const previousScore = previousEvals[i][metricKey]

          if (currentScore !== undefined && previousScore !== undefined) {
            totalCurrentScore += currentScore
            totalPreviousScore += previousScore
            validComparisons++

            const diff = currentScore - previousScore
            if (diff > 0) {
              improvements++
            } else if (diff < 0) {
              regressions++
            }
          }
        }

        if (validComparisons === 0) {
          continue // Skip this metric if no valid comparisons
        }

        const currentAverage = totalCurrentScore / validComparisons
        const previousAverage = totalPreviousScore / validComparisons
        const averageDiff = currentAverage - previousAverage

        const improvementDisplay =
          improvements > 0
            ? `${CONSTANTS.UNICODE.SUCCESS} ${improvements}`
            : `${CONSTANTS.UNICODE.NEUTRAL} 0`

        const regressionDisplay =
          regressions > 0
            ? `${CONSTANTS.UNICODE.ERROR} ${regressions}`
            : `${CONSTANTS.UNICODE.NEUTRAL} 0`

        // Format average with difference in parentheses
        const diffSign = averageDiff > 0 ? '+' : ''
        const averageDisplay = `${currentAverage.toFixed(2)} (${diffSign}${averageDiff.toFixed(2)})`

        // Generate display name for the metric
        const displayName = this.getMetricDisplayName(
          evalId,
          metricKey,
          evaluator.evaluator_name
        )

        evalTable.push([
          displayName, // Score (eval name with metric)
          averageDisplay, // Current average with difference in parentheses
          improvementDisplay, // Improvements with unicode
          regressionDisplay // Regressions with unicode
        ])
      }
    }

    return evalTable
  }

  private getMetricKeysForEvaluator(
    evalId: string,
    evalType: string
  ): string[] {
    switch (evalType) {
      case 'bert_score':
        return [
          `${evalId}_bert_score_f1`,
          `${evalId}_bert_score_precision`,
          `${evalId}_bert_score_recall`
        ]
      case 'rouge_n':
        return [
          `${evalId}_rouge_1_f1`,
          `${evalId}_rouge_1_precision`,
          `${evalId}_rouge_1_recall`,
          `${evalId}_rouge_2_f1`,
          `${evalId}_rouge_2_precision`,
          `${evalId}_rouge_2_recall`,
          `${evalId}_rouge_l_f1`,
          `${evalId}_rouge_l_precision`,
          `${evalId}_rouge_l_recall`
        ]
      default:
        return [evalId] // Standard evaluators use the evalId directly
    }
  }

  private getMetricDisplayName(
    evalId: string,
    metricKey: string,
    evaluatorName?: string
  ): string {
    const baseName = evaluatorName || evalId

    if (metricKey === evalId) {
      return baseName // Standard evaluator
    }

    // Extract the metric suffix for bert_score and rouge_n
    if (metricKey.includes('_bert_score_')) {
      const metric = metricKey.split('_bert_score_')[1]
      return `${baseName} (bert ${metric})`
    }

    if (metricKey.includes('_rouge_')) {
      const parts = metricKey.split('_')
      const rougeType = parts[parts.length - 2] // rouge_1, rouge_2, rouge_l
      const metric = parts[parts.length - 1] // f1, precision, recall
      return `${baseName} (${rougeType.replace('_', '-')} ${metric})`
    }

    return baseName
  }

  private extractEvalValues(
    experiment: Experiment,
    run: ExperimentManifest,
    manifestRows: PaginatedExperimentManifestRows
  ): ExperimentEvalResults[] {
    const evalValues: ExperimentEvalResults[] = []
    const evalColumnIdMapper = this.evaluatorColumnIdMapper(
      Object.keys(this.metricsProcessor.normalizeMetrics(run.metrics)),
      run
    )

    for (const row of manifestRows.items) {
      let mapper: ExperimentEvalResults = {}

      for (const evaluator of experiment.unique_evaluators) {
        const evalId = evaluator.evaluator_id
        const evalColumnId = evalColumnIdMapper[evalId]

        if (!evalColumnId) continue

        for (const cell of row.cells) {
          if (cell.column_id === evalColumnId) {
            const extractedValue = this.metricsProcessor.extractEvalValue(
              cell,
              evalId
            )
            mapper = { ...mapper, ...extractedValue }
            break
          }
        }
      }

      evalValues.push(mapper)
    }

    return evalValues
  }

  private evaluatorColumnIdMapper(
    columnIds: string[],
    run: ExperimentManifest
  ): Record<string, string> {
    const mapper: Record<string, string> = {}

    for (const column of run.columns) {
      if (columnIds.includes(column.id)) {
        mapper[column.evaluator_id] = column.id
      }
    }

    return mapper
  }
}

export default OrqExperimentAction
