import * as core from '@actions/core'
import * as fs from 'node:fs/promises'
import yaml from 'yaml'
import { formatNumber, sleep } from './utils.js'
import type {
  DeploymentExperimentRunResponse,
  DeploymentExperimentRunPayload,
  ExperimentManifest,
  Experiment,
  ExperimentEvalResults,
  ExperimentManifestRow
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

    core.info(JSON.stringify(experiment))

    core.info('get current run')

    const [currentRun, previousRun] =
      await this.apiClient.getCurrentAndPreviousRunManifest(
        experimentRun.experiment_id,
        experimentRun.experiment_run_id
      )

    core.info(JSON.stringify(currentRun))

    core.info('get experiment manifest rows')

    const currentManifestRows = await this.apiClient.getExperimentManifestRows(
      experimentRun.experiment_id,
      experimentRun.experiment_run_id
    )

    core.info(JSON.stringify(currentManifestRows))

    core.info('get previous run')

    let previousManifestRows: ExperimentManifestRow[] | null = null

    if (previousRun) {
      previousManifestRows = await this.apiClient.getExperimentManifestRows(
        experimentRun.experiment_id,
        previousRun._id
      )
    }

    core.info(JSON.stringify(previousRun))
    core.info('previous maniefst rows')
    core.info(JSON.stringify(previousManifestRows))

    core.info('running eval table')

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
    currentManifestRows: ExperimentManifestRow[],
    previousManifestRows: ExperimentManifestRow[]
  ): string[][] {
    const evalTable: string[][] = []
    core.info('current evals')
    const currentRunNormalizedMetrics = this.metricsProcessor.normalizeMetrics(
      currentRun.metrics
    )
    const currentRunNormalizedMetricKeys = Object.keys(
      currentRunNormalizedMetrics
    )

    const previousRunNormalizedMetrics = this.metricsProcessor.normalizeMetrics(
      previousRun.metrics
    )
    const previousRunNormalizedMetricKeys = Object.keys(
      previousRunNormalizedMetrics
    )

    const currentEvals = this.extractEvalValues(
      experiment,
      currentRun,
      currentManifestRows,
      currentRunNormalizedMetricKeys
    )
    core.info(JSON.stringify(currentEvals))
    core.info('previous evals')
    const previousEvals = this.extractEvalValues(
      experiment,
      previousRun,
      previousManifestRows,
      previousRunNormalizedMetricKeys
    )
    core.info(JSON.stringify(previousEvals))

    for (const evaluator of experiment.unique_evaluators) {
      const evalId = evaluator.evaluator_id
      const evalType = evaluator.evaluator_type

      // Get all metric keys for this evaluator based on type
      const metricKeys = this.getMetricKeysForEvaluator(evalId, evalType)

      for (const metricKey of metricKeys) {
        let improvements = 0
        let regressions = 0
        let validComparisons = 0

        // Compare row by row for the same metric key
        const minLength = Math.min(currentEvals.length, previousEvals.length)

        for (let i = 0; i < minLength; i++) {
          const currentScore = currentEvals[i][metricKey]
          const previousScore = previousEvals[i][metricKey]

          if (currentScore !== undefined && previousScore !== undefined) {
            validComparisons++

            const diff = currentScore - previousScore
            if (['orq_cost', 'orq_latency'].includes(evalId)) {
              if (diff < 0) {
                improvements++
              } else if (diff > 0) {
                regressions++
              }
            } else {
              if (diff > 0) {
                improvements++
              } else if (diff < 0) {
                regressions++
              }
            }
          }
        }

        if (validComparisons === 0) {
          continue // Skip this metric if no valid comparisons
        }

        const currentAverage = currentRunNormalizedMetrics[evalId]
        const previousAverage = previousRunNormalizedMetrics[evalId]
        const averageDiff = currentAverage - previousAverage

        const improvementDisplay =
          improvements > 0
            ? `${CONSTANTS.UNICODE.SUCCESS} ${improvements}`
            : `${CONSTANTS.UNICODE.NEUTRAL}`

        const regressionDisplay =
          regressions > 0
            ? `${CONSTANTS.UNICODE.ERROR} ${regressions}`
            : `${CONSTANTS.UNICODE.NEUTRAL}`

        // Format average with difference in parentheses
        const diffSign = averageDiff > 0 ? '+' : ''
        const averageDisplay = `${formatNumber(currentAverage)} ${averageDiff !== 0 ? `(${diffSign}${formatNumber(averageDiff)}` : ''}`

        // Generate display name for the metric
        const displayName = this.getMetricDisplayName(
          evalId,
          metricKey,
          evaluator.evaluator_name
        )

        evalTable.push([
          displayName,
          averageDisplay,
          improvementDisplay,
          regressionDisplay
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
    manifestRows: ExperimentManifestRow[],
    normalizedMetricKeys: string[]
  ): ExperimentEvalResults[] {
    const evalValues: ExperimentEvalResults[] = []
    core.info('extractevalvalues context')

    const evalColumnIdMapper = this.evaluatorColumnIdMapper(
      normalizedMetricKeys,
      run
    )

    core.info(`evalColumnIdMapper: ${JSON.stringify(evalColumnIdMapper)}`)

    for (const row of manifestRows) {
      let mapper: ExperimentEvalResults = {}
      core.info(`row: ${JSON.stringify(row)}`)

      for (const evaluator of experiment.unique_evaluators) {
        const evalId = evaluator.evaluator_id
        core.info(`evaluator: ${JSON.stringify(evaluator)}`)
        const evalColumnId = evalColumnIdMapper[evalId]
        core.info(`evalColumnId: ${JSON.stringify(evalColumnId)}`)

        if (!evalColumnId) continue

        for (const cell of row.cells) {
          core.info(`cell: ${JSON.stringify(cell)}`)
          if (cell.column_id === evalColumnId) {
            core.info(`matched:`)
            const extractedValue = this.metricsProcessor.extractEvalValue(
              cell,
              evalId
            )
            core.info(`extractedValue: ${JSON.stringify(extractedValue)}`)
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
    evalKeys: string[],
    run: ExperimentManifest
  ): Record<string, string> {
    const mapper: Record<string, string> = {}

    core.info('evaluatorColumnIdMapper')

    core.info('run columns')
    core.info(JSON.stringify(run.columns))

    for (const evalKey of evalKeys) {
      core.info(`evalKey ${evalKey}`)
      const evalKeyList = evalKey.split('_')

      let normalizeEvalKey = ''

      if (evalKeyList.length === 1) {
        normalizeEvalKey = evalKeyList[0]
      } else {
        normalizeEvalKey = evalKeyList.slice(1).join('_')
      }

      for (const column of run.columns) {
        if (
          'config' in column &&
          'evaluator_id' in column.config &&
          normalizeEvalKey === column.config['evaluator_id']
        ) {
          mapper[evalKey] = column.id
        } else if (column.key === normalizeEvalKey) {
          mapper[evalKey] = column.id
        }
      }
    }

    return mapper
  }
}

export default OrqExperimentAction
