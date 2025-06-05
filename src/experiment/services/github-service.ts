import * as github from '@actions/github'
import type {
  GithubOctokit,
  GithubPullRequest,
  GithubContentFile,
  DeploymentExperimentRunPayload
} from '../types.js'
import { decodeBase64String } from '../utils.js'
import yaml from 'yaml'

export class GithubService {
  private octokit: GithubOctokit
  private pullRequest: GithubPullRequest

  constructor(token: string) {
    this.octokit = github.getOctokit(token)
    const { issue, repo } = github.context

    this.pullRequest = {
      owner: repo.owner,
      repo: repo.repo,
      issue_number: issue.number
    }
  }

  async findExistingComment(key: string): Promise<number | null> {
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

  async upsertComment(key: string, message: string): Promise<void> {
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

  async getFileContent(
    filename: string,
    ref?: string
  ): Promise<GithubContentFile> {
    const { owner, repo } = this.pullRequest

    const params: {
      owner: string
      repo: string
      path: string
      ref?: string
    } = {
      owner,
      repo,
      path: filename
    }

    if (ref) {
      params.ref = ref
    }

    const response = await this.octokit.rest.repos.getContent(params)
    return response.data as GithubContentFile
  }

  async getPullRequestBase(): Promise<string> {
    const { owner, repo, issue_number } = this.pullRequest

    const { data: pr } = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: issue_number
    })

    return pr.base.sha
  }

  async getFilesChanged(path: string): Promise<string[]> {
    const { owner, repo, issue_number } = this.pullRequest

    const { data: files } = await this.octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: issue_number,
      per_page: 100
    })

    return files
      .filter((file) => this.isOrqExperimentConfigFile(file.filename, path))
      .map((file) => file.filename)
  }

  private isOrqExperimentConfigFile(
    filename: string,
    basePath: string
  ): boolean {
    const isInPath = filename.startsWith(basePath)
    const isYamlFile = filename.endsWith('.yaml') || filename.endsWith('.yml')
    return isInPath && isYamlFile
  }

  async parseYamlFile(
    content: string
  ): Promise<DeploymentExperimentRunPayload> {
    const decodedContent = decodeBase64String(content)
    return yaml.parse(decodedContent)
  }

  getPullRequest(): GithubPullRequest {
    return this.pullRequest
  }
}
