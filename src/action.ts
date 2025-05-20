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
  PaginatedExperimentManifestRows
} from './types.js'

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
    try {
      const commentKey = `<!-- orq_experiment_action_${runPayload.experiment_key} -->`

      let message = `
  Experiment ${runPayload.experiment_key} is now running...   
  `
      await this.upsertComment(commentKey, message)

      const experiment = await this.runExperiment(runPayload)
      const experimentResult = await this.getExperimentResult(experiment)

      await sleep(5000)

      const headers = experimentResult.experimentManifest.columns.map(
        (column) => column.display_name
      )

      const headerKeys = experimentResult.experimentManifest.columns.map(
        (column) => column.column_type
      )

      const rows = [] as string[][]

      for (const row of experimentResult.experimentManifestRows.items) {
        const manifestRow = []

        for (const headerKey of headerKeys) {
          for (const cell of row.cells) {
            if (cell.type === headerKey) {
              // if (cell.type === 'metric') {
              //   manifestRow.push(
              //     (cell.value as unknown as {value: string}).value
              //   )
              // }
              // if (typeof cell.value === 'object' && 'value' in cell.value) {
              //   manifestRow.push(cell.value.value)
              // }
              // if (typeof cell.value === 'object' && 'value' in cell.value) {
              //   manifestRow.push(cell.value.value)
              // }
              // if (typeof cell.value === 'object' && 'value' in cell.value) {
              //   manifestRow.push(cell.value.value)
              // }
              manifestRow.push(JSON.stringify(cell.value))
              break
            }
          }
        }

        rows.push(manifestRow)
      }

      message = `
Experiment ${runPayload.experiment_key} has finished running!

${generateMarkdownTable(headers, rows)}
`
      this.upsertComment(commentKey, message)
    } catch (error) {
      console.error(error)
      // TODO: error running experiment - handle error
    }
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

  private async getExperimentResult(payload: DeploymentExperimentRunResponse) {
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

      if (experimentManifest.status === 'completed') {
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
      }
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
