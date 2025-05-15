import * as core from '@actions/core'
import * as github from '@actions/github'
import yaml from 'yaml'
import * as fs from 'node:fs'
import { decodeBase64String, generateMarkdownTable, sleep } from './utils.js'
import type {
  ExperimentPayload,
  GithubContentFile,
  GithubContext,
  GithubOctokit,
  GithubPullRequest
} from './types.js'

class OrqExperimentAction {
  private octokit: GithubOctokit
  private context: GithubContext
  private pullRequest: GithubPullRequest
  private apiKey = ''
  private path = ''

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

  async run(): Promise<void> {
    if (!this.pullRequest) {
      throw new Error('Pull request not found!')
    }

    const configChanges = await this.getConfigChanges()

    const commentKey = '<!-- orq_experiment_action_12345 -->'

    let message = `
Orq ai experiment run - in progress      
`
    await this.upsertComment(commentKey, message)

    await sleep(5000)

    const headers = ['Col1', 'Col2', 'Col3', 'Col4', 'Col5']
    const rows = [
      ['test1', 'test2', 'test3', 'test4', 'test5'],
      ['test1', 'test2', 'test3', 'test4', 'test5']
    ]

    message = `
Orq ai experiment run - succeeded

has changes -> ${configChanges.join(',')}

${generateMarkdownTable(headers, rows)}
`
    this.upsertComment(commentKey, message)
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

  async runExperiment(payload: ExperimentPayload) {
    core.info(`payload: ${payload}`)
    core.info(`apiKey: ${this.apiKey}`)
  }

  async hasConfigChange(filename: string, base_sha: string) {
    const newContent: ExperimentPayload = yaml.parse(
      fs.readFileSync(filename).toString()
    )
    const { repo } = this.context

    const response = await this.octokit.rest.repos.getContent({
      owner: repo.owner,
      repo: repo.repo,
      path: filename,
      ref: base_sha
    })

    const githubContentFile = response.data as GithubContentFile
    const originalContent: ExperimentPayload = yaml.parse(
      decodeBase64String(githubContentFile.content)
    )

    if (originalContent.deployment_id !== newContent.deployment_id) {
      return true
    }

    if (originalContent.dataset_id !== newContent.dataset_id) {
      return true
    }

    return null
  }

  async getConfigChanges() {
    const { payload, repo } = this.context
    const fileChanges = []

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
        if (file.filename.startsWith(this.path) && file.status === 'modified') {
          if (await this.hasConfigChange(file.filename, base)) {
            fileChanges.push(file.filename)
          }
        }
      }
    }

    return fileChanges
  }
}

export default OrqExperimentAction
