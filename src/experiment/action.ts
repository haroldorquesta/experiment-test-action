import * as core from '@actions/core'
import * as github from '@actions/github'
import yaml from 'yaml'
import * as fs from 'node:fs'
import { decodeBase64String, generateMarkdownTable, sleep } from './utils.js'
import type {
  DeploymentExperimentRunResponse,
  DeploymentExperimentRunPayload,
  GithubContentFile,
  GithubContext,
  GithubOctokit,
  GithubPullRequest,
  ExperimentManifest,
  PaginatedExperimentManifestRows,
  Experiment
} from './types.js'
import { SheetRunStatus } from './enums.js'

class OrqExperimentAction {
  private octokit: GithubOctokit
  private context: GithubContext
  private pullRequest: GithubPullRequest
  private apiKey = ''
  private path = ''
  private orqApiBaseUrl = 'https://my.staging.orq.ai'

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

  async run(): Promise<void> {
    if (!this.pullRequest) {
      throw new Error('Pull request not found!')
    }

    const configChanges = await this.getConfigChanges()

    const experimentRuns = [] as Promise<void>[]

    for (const configChange of configChanges) {
      const experimentRun = this.orchestrateExperimentRun(configChange)
      experimentRuns.push(experimentRun)
    }

    await Promise.all(experimentRuns)
  }

  normalizeMetrics(metrics: Record<string, number>) {
    const normalizeMetrics = {} as Record<string, number>

    for (const metricKey of Object.keys(metrics)) {
      const newMetricKey = metricKey.split('_').slice(1).join('_')

      if (['orq_cost', 'orq_latency'].includes(newMetricKey)) continue

      normalizeMetrics[newMetricKey] = metrics[metricKey]
    }

    return normalizeMetrics
  }

  evaluatorColumnIdMapper(
    evalKeys: string[],
    experimentManifest: ExperimentManifest
  ) {
    const mapper = {} as Record<string, string>

    for (const evalKey of evalKeys) {
      const normalizeEvalKey = evalKey.includes('_')
        ? evalKey.split('_')[0]
        : evalKey
      for (const column of experimentManifest.columns) {
        if (
          'config' in column &&
          'evaluator_id' in column.config &&
          normalizeEvalKey === column.config['evaluator_id']
        ) {
          mapper[evalKey] = column.id
        }
      }
    }

    return mapper
  }

  generateEvalImprovementsRegressions(
    experiment: Experiment,
    currentRun: ExperimentManifest,
    previousRun: ExperimentManifest,
    currentManifestRows: PaginatedExperimentManifestRows,
    previousManifestRows: PaginatedExperimentManifestRows
  ) {
    core.info('generate regressions')
    const uniqueEvals = experiment.unique_evaluators

    const evals = []

    const currentRunMetrics = this.normalizeMetrics(currentRun.metrics)
    const previousRunMetrics = this.normalizeMetrics(previousRun.metrics)

    const evalColumnIdMapper = this.evaluatorColumnIdMapper(
      Object.keys(currentRunMetrics),
      currentRun
    )

    core.info(`unique evals ${JSON.stringify(uniqueEvals)}`)
    core.info(`currentRunMetrics ${JSON.stringify(currentRunMetrics)}`)
    core.info(`previousRunMetrics ${JSON.stringify(previousRunMetrics)}`)

    for (const evaluator of uniqueEvals) {
      if (['orq_cost', 'orq_latency'].includes(evaluator.evaluator_key))
        continue

      core.info(`evaluator ${JSON.stringify(evaluator)}`)
      const evalColumnId = evalColumnIdMapper[evaluator.evaluator_id]

      const evalValues = [] as Record<string, number>[]
      const previousEvalValues = [] as Record<string, number>[]

      for (const row of currentManifestRows.items) {
        for (const cell of row.cells) {
          const mapper = {} as Record<string, number>
          if (cell.column_id === evalColumnId) {
            if (cell.value.type === 'number') {
              mapper[evaluator.evaluator_id] = cell.value.value as number
            } else if (cell.value.type === 'boolean') {
              mapper[evaluator.evaluator_id] = (cell.value.value as boolean)
                ? 100
                : 0
            } else if (cell.value.type === 'llm_evaluator') {
              const llmEvalValue = cell.value.value as {
                value: number | boolean
              }
              if (typeof llmEvalValue?.value === 'boolean') {
                mapper[evaluator.evaluator_id] = (cell.value.value as boolean)
                  ? 100
                  : 0
              } else if (typeof llmEvalValue?.value === 'number') {
                mapper[evaluator.evaluator_id] = cell.value.value as number
              }
            } else if (cell.value.type === 'bert_score') {
              const bertScoreValue = cell.value.value as {
                f1: number
                precision: number
                recall: number
              }
              mapper[`${evaluator.evaluator_id}_bert_score_f1`] =
                bertScoreValue.f1
              mapper[`${evaluator.evaluator_id}_bert_score_precision`] =
                bertScoreValue.precision
              mapper[`${evaluator.evaluator_id}_bert_score_recall`] =
                bertScoreValue.recall
            } else if (cell.value.type === 'rouge_n') {
              const rougeScoreValue = cell.value.value as {
                rouge_1: {
                  f1: number
                  precision: number
                  recall: number
                }
                rouge_2: {
                  f1: number
                  precision: number
                  recall: number
                }
                rouge_l: {
                  f1: number
                  precision: number
                  recall: number
                }
              }
              mapper[`${evaluator.evaluator_id}_rouge_1_f1`] =
                rougeScoreValue.rouge_1.f1
              mapper[`${evaluator.evaluator_id}_rouge_1_precision`] =
                rougeScoreValue.rouge_1.precision
              mapper[`${evaluator.evaluator_id}_rouge_1_recall`] =
                rougeScoreValue.rouge_1.recall
              mapper[`${evaluator.evaluator_id}_rouge_2_f1`] =
                rougeScoreValue.rouge_2.f1
              mapper[`${evaluator.evaluator_id}_rouge_2_precision`] =
                rougeScoreValue.rouge_2.precision
              mapper[`${evaluator.evaluator_id}_rouge_2_recall`] =
                rougeScoreValue.rouge_2.recall
              mapper[`${evaluator.evaluator_id}_rouge_l_f1`] =
                rougeScoreValue.rouge_l.f1
              mapper[`${evaluator.evaluator_id}_rouge_l_precision`] =
                rougeScoreValue.rouge_l.precision
              mapper[`${evaluator.evaluator_id}_rouge_l_recall`] =
                rougeScoreValue.rouge_l.recall
            }
          }

          evalValues.push(mapper)
        }
      }

      core.info(`Evals values ${JSON.stringify(evalValues)}`)

      for (const row of previousManifestRows.items) {
        for (const cell of row.cells) {
          const mapper = {} as Record<string, number>
          if (cell.column_id === evalColumnId) {
            if (cell.value.type === 'number') {
              mapper[evaluator.evaluator_id] = cell.value.value as number
            } else if (cell.value.type === 'boolean') {
              mapper[evaluator.evaluator_id] = (cell.value.value as boolean)
                ? 100
                : 0
            } else if (cell.value.type === 'llm_evaluator') {
              const llmEvalValue = cell.value.value as {
                value: number | boolean
              }
              if (typeof llmEvalValue?.value === 'boolean') {
                mapper[evaluator.evaluator_id] = (cell.value.value as boolean)
                  ? 100
                  : 0
              } else if (typeof llmEvalValue?.value === 'number') {
                mapper[evaluator.evaluator_id] = cell.value.value as number
              }
            } else if (cell.value.type === 'bert_score') {
              const bertScoreValue = cell.value.value as {
                f1: number
                precision: number
                recall: number
              }
              mapper[`${evaluator.evaluator_id}_bert_score_f1`] =
                bertScoreValue.f1
              mapper[`${evaluator.evaluator_id}_bert_score_precision`] =
                bertScoreValue.precision
              mapper[`${evaluator.evaluator_id}_bert_score_recall`] =
                bertScoreValue.recall
            } else if (cell.value.type === 'rouge_n') {
              const rougeScoreValue = cell.value.value as {
                rouge_1: {
                  f1: number
                  precision: number
                  recall: number
                }
                rouge_2: {
                  f1: number
                  precision: number
                  recall: number
                }
                rouge_l: {
                  f1: number
                  precision: number
                  recall: number
                }
              }
              mapper[`${evaluator.evaluator_id}_rouge_1_f1`] =
                rougeScoreValue.rouge_1.f1
              mapper[`${evaluator.evaluator_id}_rouge_1_precision`] =
                rougeScoreValue.rouge_1.precision
              mapper[`${evaluator.evaluator_id}_rouge_1_recall`] =
                rougeScoreValue.rouge_1.recall
              mapper[`${evaluator.evaluator_id}_rouge_2_f1`] =
                rougeScoreValue.rouge_2.f1
              mapper[`${evaluator.evaluator_id}_rouge_2_precision`] =
                rougeScoreValue.rouge_2.precision
              mapper[`${evaluator.evaluator_id}_rouge_2_recall`] =
                rougeScoreValue.rouge_2.recall
              mapper[`${evaluator.evaluator_id}_rouge_l_f1`] =
                rougeScoreValue.rouge_l.f1
              mapper[`${evaluator.evaluator_id}_rouge_l_precision`] =
                rougeScoreValue.rouge_l.precision
              mapper[`${evaluator.evaluator_id}_rouge_l_recall`] =
                rougeScoreValue.rouge_l.recall
            }
          }

          previousEvalValues.push(mapper)
        }
      }

      core.info(`Evals values ${JSON.stringify(previousEvalValues)}`)

      if (evaluator.evaluator_key === 'bert_score') {
        let evaluator_id = `${evaluator.evaluator_id}_f1`
        let improvements = 0
        let regressions = 0

        let currentAvgScore = currentRunMetrics[evaluator_id]
        let previousAvgScore = previousRunMetrics[evaluator_id]
        let diffAverageScore = currentAvgScore - previousAvgScore

        for (const [index, evalluator] of evalValues.entries()) {
          const score =
            evalluator[evaluator_id] - previousEvalValues[index][evaluator_id]
          if (score > 0) {
            improvements++
          } else if (score < 0) {
            regressions++
          }
        }

        evals.push([
          `${evaluator.evaluator_name} - F1`,
          `${currentAvgScore} (${diffAverageScore > 0 ? '+' : '-'}${diffAverageScore}pp)`,
          improvements.toString(),
          regressions.toString()
        ])

        evaluator_id = `${evaluator.evaluator_id}_precision`
        improvements = 0
        regressions = 0

        currentAvgScore = currentRunMetrics[evaluator_id]
        previousAvgScore = previousRunMetrics[evaluator_id]
        diffAverageScore = currentAvgScore - previousAvgScore

        for (const [index, evalluator] of evalValues.entries()) {
          const score =
            evalluator[evaluator_id] - previousEvalValues[index][evaluator_id]
          if (score > 0) {
            improvements++
          } else if (score < 0) {
            regressions++
          }
        }

        evals.push([
          `${evaluator.evaluator_name} - Precision`,
          `${currentAvgScore} (${diffAverageScore > 0 ? '+' : '-'}${diffAverageScore}pp)`,
          improvements.toString(),
          regressions.toString()
        ])

        evaluator_id = `${evaluator.evaluator_id}_recall`
        improvements = 0
        regressions = 0

        currentAvgScore = currentRunMetrics[evaluator_id]
        previousAvgScore = previousRunMetrics[evaluator_id]
        diffAverageScore = currentAvgScore - previousAvgScore

        for (const [index, evalluator] of evalValues.entries()) {
          const score =
            evalluator[evaluator_id] - previousEvalValues[index][evaluator_id]
          if (score > 0) {
            improvements++
          } else if (score < 0) {
            regressions++
          }
        }

        evals.push([
          `${evaluator.evaluator_name} - Recall`,
          `${currentAvgScore} (${diffAverageScore > 0 ? '+' : '-'}${diffAverageScore}pp)`,
          improvements.toString(),
          regressions.toString()
        ])
      } else {
        core.info('else')
        try {
          let improvements = 0
          let regressions = 0

          const currentAvgScore = currentRunMetrics[evaluator.evaluator_id]
          const previousAvgScore = previousRunMetrics[evaluator.evaluator_id]
          const diffAverageScore = currentAvgScore - previousAvgScore

          for (const [index, evalluator] of evalValues.entries()) {
            const score =
              evalluator[evaluator.evaluator_id] -
              previousEvalValues[index][evaluator.evaluator_id]
            if (score > 0) {
              improvements++
            } else if (score < 0) {
              regressions++
            }
          }

          evals.push([
            evaluator.evaluator_name,
            `${currentAvgScore} (${diffAverageScore > 0 ? '+' : '-'}${diffAverageScore}pp)`,
            improvements.toString(),
            regressions.toString()
          ])
        } catch (error) {
          core.error(error as string)
        }
      }
    }

    return evals
  }

  async getExperimentManifestRows(
    experimentId: string,
    experimentRunId: string
  ) {
    const experimentManifestRowsResponse = await fetch(
      `${this.orqApiBaseUrl}/v2/spreadsheets/${experimentId}/rows?manifest_id=${experimentRunId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        }
      }
    )
    return (await experimentManifestRowsResponse.json()) as PaginatedExperimentManifestRows
  }

  async orchestrateExperimentRun(runPayload: DeploymentExperimentRunPayload) {
    const commentKey = `<!-- orq_experiment_action_${runPayload.experiment_key} -->`

    try {
      let message = `## Orq Experiment report
### Running experiment ${runPayload.experiment_key}...`
      await this.upsertComment(commentKey, message)

      const experimentRun = await this.runExperiment(runPayload)
      const experiment = await this.getExperiment(experimentRun.experiment_id)
      await this.waitForExperimentManifestRunCompletion(experimentRun)
      const [currentRun, previousRun] =
        await this.getExperimentRunAverageMetrics(
          experimentRun.experiment_id,
          experimentRun.experiment_run_id
        )

      const headers = ['Score', 'Average', 'Improvements', 'Regressions']
      let rows = []
      if (currentRun !== null && previousRun !== null) {
        const currentExperimentManifestRows =
          await this.getExperimentManifestRows(
            experimentRun.experiment_id,
            experimentRun.experiment_run_id
          )
        const previousExperimentManifestRows =
          await this.getExperimentManifestRows(
            experimentRun.experiment_id,
            previousRun._id
          )
        rows = this.generateEvalImprovementsRegressions(
          experiment,
          currentRun,
          previousRun,
          currentExperimentManifestRows,
          previousExperimentManifestRows
        )
      } else {
        rows = experiment.unique_evaluators.map((evaluator) => {
          return [evaluator.evaluator_name, '85% (+1pp)', '🟢 6', '🔴 6']
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

  async showErrorComment(
    commentKey: string,
    experimentKey: string,
    error: unknown
  ) {
    const message = `## Orq Experiment report
### Experiment ${experimentKey}: 

🔴 Error: ${error}
`
    await this.upsertComment(commentKey, message)
  }

  async validateInput(): Promise<void> {
    const apiKey = core.getInput('api_key')

    if (!apiKey) {
      throw new Error('Input `api_key` not set!')
    }

    this.apiKey = apiKey

    const path = core.getInput('path')

    if (!path) {
      throw new Error('Input `path` for yaml configs was not set!')
    }

    this.path = path
  }

  private async getExperiment(experimentId: string) {
    const experimentResponse = await fetch(
      `${this.orqApiBaseUrl}/v2/spreadsheets/${experimentId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        }
      }
    )

    const experiment = (await experimentResponse.json()) as Experiment

    core.info(`Get experiment result ${JSON.stringify(experiment)}`)

    return experiment
  }

  private async runExperiment(payload: DeploymentExperimentRunPayload) {
    core.info(`Run experiment ${JSON.stringify(payload)}`)
    const response = await fetch(
      `${this.orqApiBaseUrl}/v2/deployments/${payload.deployment_key}/experiment`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          type: 'deployment_experiment',
          experiment_key: payload.experiment_key,
          dataset_id: payload.dataset_id,
          ...(payload.context && {
            context: payload.context
          }),
          ...(payload.evaluators && {
            evaluators: payload.evaluators
          })
        })
      }
    )

    const data = (await response.json()) as DeploymentExperimentRunResponse

    return data
  }

  private async waitForExperimentManifestRunCompletion(
    payload: DeploymentExperimentRunResponse
  ) {
    while (true) {
      core.info(`Get experiment manifest status ${JSON.stringify(payload)}`)
      const experimentManifestResponse = await fetch(
        `${this.orqApiBaseUrl}/v2/spreadsheets/${payload.experiment_id}/manifests/${payload.experiment_run_id}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          }
        }
      )

      const experimentManifest =
        (await experimentManifestResponse.json()) as ExperimentManifest

      core.info(
        `Get experiment manifest status result ${JSON.stringify(experimentManifest)}`
      )

      if (experimentManifest.status === SheetRunStatus.COMPLETED) {
        break
      } else if (experimentManifest.status === SheetRunStatus.CANCELLED) {
        throw new Error('Experiment was cancelled!')
      } else if (experimentManifest.status === SheetRunStatus.FAILED) {
        throw new Error('Experiment failed to run!')
      }

      await sleep(3)
    }
  }

  private async getExperimentRunAverageMetrics(
    experimentId: string,
    experimentRunId: string
  ) {
    const experimentManifestResponse = await fetch(
      `${this.orqApiBaseUrl}/v2/spreadsheets/${experimentId}/manifests`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        }
      }
    )

    const experimentManifests =
      (await experimentManifestResponse.json()) as ExperimentManifest[]

    let currentExperimentRunIndex = -1
    let currentRunExperiment = {} as ExperimentManifest

    for (const [index, experimentManifest] of experimentManifests.entries()) {
      if (experimentManifest._id === experimentRunId) {
        currentExperimentRunIndex = index
        currentRunExperiment = experimentManifest
        break
      }
    }

    if (currentExperimentRunIndex === -1) return [null, null]

    if (currentExperimentRunIndex + 1 >= experimentManifests.length) {
      return [currentRunExperiment, null]
    }

    const previousRunExperiment =
      experimentManifests[currentExperimentRunIndex + 1]

    return [currentRunExperiment, previousRunExperiment]
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

  async hasConfigChange(filename: string, base_sha: string) {
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

  async getOriginalDeploymentRunPayload(filename: string, commit_hash: string) {
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

  async getDeploymentExperimentRunPayload(filename: string) {
    const payload: DeploymentExperimentRunPayload = yaml.parse(
      fs.readFileSync(filename).toString()
    )

    return payload
  }

  async getConfigChanges() {
    const { payload, repo } = this.context
    const payloadChanges = [] as DeploymentExperimentRunPayload[]

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
