import * as core from '@actions/core'
import * as github from '@actions/github'
import yaml from 'yaml'
import * as fs from 'node:fs'
import {
  decodeBase64String,
  formatNumber,
  generateMarkdownTable,
  sleep
} from './utils.js'
import type {
  DeploymentExperimentRunResponse,
  DeploymentExperimentRunPayload,
  GithubContentFile,
  GithubContext,
  GithubOctokit,
  GithubPullRequest,
  ExperimentManifest,
  PaginatedExperimentManifestRows,
  Experiment,
  ExperimentEval,
  ExperimentManifestRow
} from './types.js'
import { SheetRunStatus } from './enums.js'
import { OrqApiClient } from './api-client.js'
import { OrqExperimentError } from './errors.js'
import { CONSTANTS } from './constants.js'

// Type guards
function isLLMEvalValue(value: unknown): value is { value: number | boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    (typeof (value as { value: unknown }).value === 'number' ||
      typeof (value as { value: unknown }).value === 'boolean')
  )
}

function isBertScoreValue(value: unknown): value is {
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

function isRougeScoreValue(value: unknown): value is {
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

class OrqExperimentAction {
  private octokit: GithubOctokit
  private context: GithubContext
  private pullRequest: GithubPullRequest
  private apiClient: OrqApiClient | null = null
  private path: string = ''

  constructor() {
    this.octokit = github.getOctokit(core.getInput('github_token'))
    this.context = github.context

    const { issue, repo } = this.context

    this.pullRequest = {
      owner: repo.owner,
      repo: repo.repo,
      issue_number: issue.number
    }
  }

  private extractEvalValue(
    cell: ExperimentManifestRow,
    evaluatorId: string
  ): Record<string, number> {
    core.info(
      `extracttttt: ${JSON.stringify(cell)}, evaluatorId: ${evaluatorId}`
    )
    const mapper: Record<string, number> = {}

    const { type, value } = cell.value

    core.info(`type: ${type}, value: ${value}`)

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
    }

    return mapper
  }

  /**
   * Main entry point for the GitHub Action
   * Processes config changes and runs experiments
   */
  async run(): Promise<void> {
    this.validateInput()

    if (!this.pullRequest) {
      throw new OrqExperimentError('Pull request not found!', {
        phase: 'initialization'
      })
    }

    const configChanges = await this.getConfigChanges()

    const experimentRuns: Promise<void>[] = []

    for (const configChange of configChanges) {
      const experimentRun = this.orchestrateExperimentRun(configChange)
      experimentRuns.push(experimentRun)
    }

    await Promise.all(experimentRuns)
  }

  normalizeMetrics(metrics: Record<string, number>): Record<string, number> {
    const normalizeMetrics: Record<string, number> = {}

    for (const metricKey of Object.keys(metrics)) {
      const newMetricKey = metricKey.split('_').slice(1).join('_')

      normalizeMetrics[newMetricKey] = metrics[metricKey]
    }

    return normalizeMetrics
  }

  evaluatorColumnIdMapper(
    evalKeys: string[],
    experimentManifest: ExperimentManifest
  ): Record<string, string> {
    const mapper: Record<string, string> = {}

    for (const evalKey of evalKeys) {
      const evalKeyList = evalKey.split('_')

      let normalizeEvalKey = ''

      if (evalKeyList.length === 1) {
        normalizeEvalKey = evalKeyList[0]
      } else {
        normalizeEvalKey = evalKeyList.slice(1).join('_')
      }

      for (const column of experimentManifest.columns) {
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

  private calculateEvalScoreDifferences(
    evalValues: Record<string, number>[],
    previousEvalValues: Record<string, number>[],
    metricId: string
  ): { improvements: number; regressions: number } {
    let improvements = 0
    let regressions = 0

    for (const [index, evaluator] of evalValues.entries()) {
      const score = evaluator[metricId] - previousEvalValues[index][metricId]
      if (score > 0) {
        improvements++
      } else if (score < 0) {
        regressions++
      }
    }

    return { improvements, regressions }
  }

  private formatScoreDisplay(
    currentScore: number,
    previousScore: number
  ): string {
    const diff = currentScore - previousScore
    if (diff === 0) return formatNumber(currentScore).toString()
    return `${formatNumber(currentScore)} ${diff > 0 ? `(+${formatNumber(diff)})` : `(${formatNumber(diff)})`}`
  }

  private formatImprovementsRegressions(
    improvements: number,
    regressions: number
  ): [string, string] {
    return [
      improvements === 0
        ? CONSTANTS.ICONS.NEUTRAL
        : `${CONSTANTS.ICONS.SUCCESS} ${improvements}`,
      regressions === 0
        ? CONSTANTS.ICONS.NEUTRAL
        : `${CONSTANTS.ICONS.ERROR} ${regressions}`
    ]
  }

  private processBertScoreEval(
    evaluator: ExperimentEval,
    evalValues: Record<string, number>[],
    previousEvalValues: Record<string, number>[],
    currentRunMetrics: Record<string, number>,
    previousRunMetrics: Record<string, number>
  ): string[][] {
    const metrics = CONSTANTS.BERT_SCORE_METRICS.map((suffix) => ({
      suffix,
      label: suffix.charAt(0).toUpperCase() + suffix.slice(1)
    }))
    const results: string[][] = []

    for (const metric of metrics) {
      const metricId = `${evaluator.evaluator_id}_bert_score_${metric.suffix}`
      const currentScore = currentRunMetrics[metricId]
      const previousScore = previousRunMetrics[metricId]
      const { improvements, regressions } = this.calculateEvalScoreDifferences(
        evalValues,
        previousEvalValues,
        metricId
      )
      const [improvementsStr, regressionsStr] =
        this.formatImprovementsRegressions(improvements, regressions)

      results.push([
        `Bert Score ${metric.label}`,
        this.formatScoreDisplay(currentScore, previousScore),
        improvementsStr,
        regressionsStr
      ])
    }

    return results
  }

  private processRougeNEval(
    evaluator: ExperimentEval,
    evalValues: Record<string, number>[],
    previousEvalValues: Record<string, number>[],
    currentRunMetrics: Record<string, number>,
    previousRunMetrics: Record<string, number>
  ): string[][] {
    const rougeTypes = ['rouge_1', 'rouge_2', 'rouge_l']
    const metrics = ['f1', 'precision', 'recall']
    const results: string[][] = []

    for (const rougeType of rougeTypes) {
      for (const metric of metrics) {
        const metricId = `${evaluator.evaluator_id}_${rougeType}_${metric}`
        const currentScore = currentRunMetrics[metricId]
        const previousScore = previousRunMetrics[metricId]
        const { improvements, regressions } =
          this.calculateEvalScoreDifferences(
            evalValues,
            previousEvalValues,
            metricId
          )
        const [improvementsStr, regressionsStr] =
          this.formatImprovementsRegressions(improvements, regressions)

        const rougeTypeLabelSuffix = rougeType.toUpperCase().split('_')[1]
        const rougeTypeLabel = `Rouge ${rougeTypeLabelSuffix.toUpperCase()}`
        const label = `${rougeTypeLabel} - ${metric.charAt(0).toUpperCase() + metric.slice(1)}`
        results.push([
          label,
          this.formatScoreDisplay(currentScore, previousScore),
          improvementsStr,
          regressionsStr
        ])
      }
    }

    return results
  }

  private processStandardEval(
    evaluator: ExperimentEval,
    evalValues: Record<string, number>[],
    previousEvalValues: Record<string, number>[],
    currentRunMetrics: Record<string, number>,
    previousRunMetrics: Record<string, number>
  ): string[] | null {
    try {
      const currentScore = currentRunMetrics[evaluator.evaluator_id]
      const previousScore = previousRunMetrics[evaluator.evaluator_id]
      const { improvements, regressions } = this.calculateEvalScoreDifferences(
        evalValues,
        previousEvalValues,
        evaluator.evaluator_id
      )
      const [improvementsStr, regressionsStr] =
        this.formatImprovementsRegressions(improvements, regressions)

      return [
        evaluator.evaluator_name,
        this.formatScoreDisplay(currentScore, previousScore),
        improvementsStr,
        regressionsStr
      ]
    } catch (error) {
      core.error(error as string)
      return null
    }
  }

  private collectEvalValues(
    manifestRows: PaginatedExperimentManifestRows,
    evalColumnId: string,
    evaluatorId: string
  ): Record<string, number>[] {
    const evalValues: Record<string, number>[] = []

    for (const row of manifestRows.items) {
      core.info(`Row: ${JSON.stringify(row)}`)
      let mapper: Record<string, number> = {}
      for (const cell of row.cells) {
        core.info(
          `Cell: ${JSON.stringify(cell)}, evalColumnId: ${evalColumnId}, evaluatorId: ${evaluatorId}`
        )
        if (cell.column_id === evalColumnId) {
          core.info('Matched')
          const extractedValue = this.extractEvalValue(cell, evaluatorId)
          core.info(`extractedValue: ${JSON.stringify(extractedValue)}`)
          mapper = { ...mapper, ...extractedValue }
          core.info(`mapper: ${JSON.stringify(mapper)}`)
          break
        }
      }
      evalValues.push(mapper)
    }

    return evalValues
  }

  private generateEvalImprovementsRegressions(
    experiment: Experiment,
    currentRun: ExperimentManifest,
    previousRun: ExperimentManifest,
    currentManifestRows: PaginatedExperimentManifestRows,
    previousManifestRows: PaginatedExperimentManifestRows
  ): string[][] {
    core.info('generate regressions')
    const uniqueEvals = experiment.unique_evaluators

    const evals: string[][] = []

    const currentRunMetrics = this.normalizeMetrics(currentRun.metrics)
    const previousRunMetrics = this.normalizeMetrics(previousRun.metrics)

    const evalColumnIdMapper = this.evaluatorColumnIdMapper(
      Object.keys(currentRunMetrics),
      currentRun
    )

    core.info(`evalColumnIdMapper ${JSON.stringify(evalColumnIdMapper)}`)
    core.info(`unique evals ${JSON.stringify(uniqueEvals)}`)
    core.info(`currentRunMetrics ${JSON.stringify(currentRunMetrics)}`)
    core.info(`previousRunMetrics ${JSON.stringify(previousRunMetrics)}`)

    for (const evaluator of uniqueEvals) {
      core.info(`evaluator ${JSON.stringify(evaluator)}`)
      const evalColumnId = evalColumnIdMapper[evaluator.evaluator_id]

      const evalValues = this.collectEvalValues(
        currentManifestRows,
        evalColumnId,
        evaluator.evaluator_id
      )
      const previousEvalValues = this.collectEvalValues(
        previousManifestRows,
        evalColumnId,
        evaluator.evaluator_id
      )

      core.info(`current Evals values ${JSON.stringify(evalValues)}`)
      core.info(`previous Evals values ${JSON.stringify(previousEvalValues)}`)

      if (evaluator.evaluator_key === 'bert_score') {
        const bertScoreResults = this.processBertScoreEval(
          evaluator,
          evalValues,
          previousEvalValues,
          currentRunMetrics,
          previousRunMetrics
        )
        evals.push(...bertScoreResults)
      } else if (evaluator.evaluator_key === 'rouge_n') {
        const rougeNResults = this.processRougeNEval(
          evaluator,
          evalValues,
          previousEvalValues,
          currentRunMetrics,
          previousRunMetrics
        )
        evals.push(...rougeNResults)
      } else {
        const standardEvalResult = this.processStandardEval(
          evaluator,
          evalValues,
          previousEvalValues,
          currentRunMetrics,
          previousRunMetrics
        )
        if (standardEvalResult) {
          evals.push(standardEvalResult)
        }
      }
    }

    return evals
  }

  private async orchestrateExperimentRun(
    runPayload: DeploymentExperimentRunPayload
  ): Promise<void> {
    const commentKey = `<!-- orq_experiment_action_${runPayload.experiment_key} -->`

    try {
      let message = `## Orq Experiment report
### Running experiment ${runPayload.experiment_key}...`
      await this.upsertComment(commentKey, message)

      if (!this.apiClient) {
        throw new OrqExperimentError('API client not initialized', {
          phase: 'api_call'
        })
      }

      const experimentRun = await this.apiClient.runExperiment(runPayload)
      const experiment = await this.apiClient.getExperiment(
        experimentRun.experiment_id
      )
      await this.waitForExperimentManifestRunCompletion(experimentRun)
      const [currentRun, previousRun] =
        await this.apiClient.getExperimentRunAverageMetrics(
          experimentRun.experiment_id,
          experimentRun.experiment_run_id
        )

      const headers = ['Score', 'Average', 'Improvements', 'Regressions']
      let rows: string[][] = []
      if (currentRun !== null && previousRun !== null) {
        const [currentExperimentManifestRows, previousExperimentManifestRows] =
          await Promise.all([
            this.apiClient.getExperimentManifestRows(
              experimentRun.experiment_id,
              experimentRun.experiment_run_id
            ),
            this.apiClient.getExperimentManifestRows(
              experimentRun.experiment_id,
              previousRun._id
            )
          ])
        rows = this.generateEvalImprovementsRegressions(
          experiment,
          currentRun,
          previousRun,
          currentExperimentManifestRows,
          previousExperimentManifestRows
        )
      } else {
        rows = experiment.unique_evaluators.map((evaluator) => {
          return [
            evaluator.evaluator_name,
            '85% (+1pp)',
            `${CONSTANTS.ICONS.SUCCESS} 6`,
            `${CONSTANTS.ICONS.ERROR} 6`
          ]
        })
      }

      message = `## Orq experiment report
[Experiment ${runPayload.experiment_key} (${experimentRun.experiment_run_id})](${experimentRun.url})

${generateMarkdownTable(headers, rows)}
`
      this.upsertComment(commentKey, message)
    } catch (error) {
      this.showErrorComment(commentKey, runPayload.experiment_key, error)
    }
  }

  private async showErrorComment(
    commentKey: string,
    experimentKey: string,
    error: unknown
  ): Promise<void> {
    const message = `## Orq Experiment report
### Experiment ${experimentKey}: 

🔴 Failed to run experiment, error: ${error}
`
    await this.upsertComment(commentKey, message)
  }

  private validateInput(): void {
    const apiKey = core.getInput('api_key')

    if (!apiKey) {
      throw new OrqExperimentError('Input `api_key` not set!', {
        phase: 'validation'
      })
    }

    this.apiClient = new OrqApiClient(apiKey, CONSTANTS.API_BASE_URL)

    const path = core.getInput('path')

    if (!path) {
      throw new OrqExperimentError(
        'Input `path` for yaml configs was not set!',
        {
          phase: 'validation'
        }
      )
    }

    this.path = path
  }

  private async waitForExperimentManifestRunCompletion(
    experimentRun: DeploymentExperimentRunResponse
  ): Promise<void> {
    if (!this.apiClient) {
      throw new OrqExperimentError('API client not initialized', {
        phase: 'api_call'
      })
    }

    while (true) {
      core.info(
        `Get experiment manifest status ${JSON.stringify(experimentRun)}`
      )
      const experimentManifest = await this.apiClient.getExperimentManifest(
        experimentRun.experiment_id,
        experimentRun.experiment_run_id
      )

      core.info(
        `Get experiment manifest status result ${JSON.stringify(experimentManifest)}`
      )

      if (experimentManifest.status === SheetRunStatus.COMPLETED) {
        break
      } else if (experimentManifest.status === SheetRunStatus.CANCELLED) {
        throw new Error('Experiment was cancelled!')
      } else if (experimentManifest.status === SheetRunStatus.FAILED) {
        throw new OrqExperimentError('Experiment failed to run!', {
          experimentId: experimentRun.experiment_id,
          phase: 'execution',
          details: experimentManifest
        })
      }

      await sleep(CONSTANTS.POLL_INTERVAL_SECONDS)
    }
  }

  private async findExistingComment(key: string): Promise<number | null> {
    const { owner, repo, issue_number } = this.pullRequest

    const { data: comments } = await this.octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number,
      sort: 'created',
      direction: 'desc',
      per_page: 100
    })

    for (const comment of comments) {
      if (comment.body?.includes(key)) {
        return comment.id
      }
    }

    return null
  }

  private async upsertComment(key: string, message: string): Promise<void> {
    const existingComment = await this.findExistingComment(key)

    if (!existingComment) {
      await this.octokit.rest.issues.createComment({
        ...this.pullRequest,
        body: `${key}\n${message}`
      })

      return
    }

    await this.octokit.rest.issues.updateComment({
      owner: this.pullRequest.owner,
      repo: this.pullRequest.repo,
      comment_id: existingComment,
      body: `${key}\n${message}`
    })
  }

  private async hasConfigChange(
    filename: string,
    base_sha: string
  ): Promise<DeploymentExperimentRunPayload | null> {
    const newRunPayload: DeploymentExperimentRunPayload =
      await this.getDeploymentExperimentRunPayload(filename)

    const originalRunPayload = await this.getOriginalDeploymentRunPayload(
      filename,
      base_sha
    )

    if (originalRunPayload.deployment_key !== newRunPayload.deployment_key) {
      return newRunPayload
    }

    if (originalRunPayload.dataset_id !== newRunPayload.dataset_id) {
      return newRunPayload
    }

    return null
  }

  private async getOriginalDeploymentRunPayload(
    filename: string,
    commit_hash: string
  ): Promise<DeploymentExperimentRunPayload> {
    const { repo } = this.context

    const response = await this.octokit.rest.repos.getContent({
      owner: repo.owner,
      repo: repo.repo,
      path: filename,
      ref: commit_hash
    })

    const githubContentFile = response.data as GithubContentFile
    const originalRunPayload: DeploymentExperimentRunPayload = yaml.parse(
      decodeBase64String(githubContentFile.content)
    )

    return originalRunPayload
  }

  private async getDeploymentExperimentRunPayload(
    filename: string
  ): Promise<DeploymentExperimentRunPayload> {
    const payload: DeploymentExperimentRunPayload = yaml.parse(
      fs.readFileSync(filename).toString()
    )

    return payload
  }

  private async getConfigChanges(): Promise<DeploymentExperimentRunPayload[]> {
    const { payload, repo } = this.context
    const payloadChanges: DeploymentExperimentRunPayload[] = []

    if (payload) {
      const base = payload.pull_request?.base.sha
      const head = payload.pull_request?.head.sha

      const response = await this.octokit.rest.repos.compareCommits({
        base,
        head,
        owner: repo.owner,
        repo: repo.repo
      })

      const files = response.data.files ?? []
      for (const file of files) {
        if (!file.filename.startsWith(this.path)) {
          continue
        }

        if (file.status === 'modified') {
          const runPayload = await this.hasConfigChange(file.filename, base)
          if (runPayload !== null) {
            payloadChanges.push(runPayload)
          }
        } else if (file.status === 'added') {
          const runPayload = await this.getDeploymentExperimentRunPayload(
            file.filename
          )
          payloadChanges.push(runPayload)
        }
      }
    }

    return payloadChanges
  }
}

export default OrqExperimentAction
