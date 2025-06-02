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

  async orchestrateExperimentRun(runPayload: DeploymentExperimentRunPayload) {
    const commentKey = `<!-- orq_experiment_action_${runPayload.experiment_key} -->`

    try {
      let message = `## Orq Experiment report
### Running experiment ${runPayload.experiment_key}...`
      await this.upsertComment(commentKey, message)

      const experimentRun = await this.runExperiment(runPayload)
      const experiment = await this.getExperiment(experimentRun.experiment_id)
      //const experimentResult =
      await this.getExperimentManifestResult(experimentRun)

      const headers = ['Score', 'Average', 'Improvements', 'Regressions']
      const rows = experiment.unique_evaluators.map((evaluator) => {
        return [evaluator.evaluator_name, '85% (+1pp)', '🟢 6', '🔴 6']
      })
      /*[
        ['Levenshtein', '85% (+1pp)', '🟢 6', '🔴 6'],
        ['Duration', '1s (+0s)', '🟡', '🔴 20']
      ]*/

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

    core.info(`Run experiment return ${JSON.stringify(data)}`)

    return data
  }

  private async getExperimentManifestResult(
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
        const experimentManifestRowsResponse = await fetch(
          `${this.orqApiBaseUrl}/v2/spreadsheets/${payload.experiment_id}/rows?manifest_id=${payload.experiment_run_id}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`
            }
          }
        )
        return {
          experimentManifest,
          experimentManifestRows:
            (await experimentManifestRowsResponse.json()) as PaginatedExperimentManifestRows
        }
      } else if (experimentManifest.status === SheetRunStatus.CANCELLED) {
        throw new Error('Experiment was cancelled!')
      } else if (experimentManifest.status === SheetRunStatus.FAILED) {
        throw new Error('Experiment failed to run!')
      }

      await sleep(3)
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
