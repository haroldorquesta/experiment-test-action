import * as core from '@actions/core'
import * as github from '@actions/github'
// import yaml from 'yaml'
// import * as fs from 'node:fs'
import { generateMarkdownTable, sleep } from './utils.js'
import type {
  GithubContext,
  GithubOctokit,
  GithubPullRequest
} from './types.js'

class OrqExperimentAction {
  private octokit: GithubOctokit
  private context: GithubContext
  private pullRequest: GithubPullRequest

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

    const path = core.getInput('path')

    if (!path) {
      throw new Error('Input `path` for yaml configs was not set!')
    }
  }

  async run(): Promise<void> {
    if (!this.pullRequest) {
      throw new Error('Pull request not found!')
    }

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

  // function parseFile(file: {
  //   filename: string
  //   patch?: string | undefined
  // }): ModifiedFile {
  //   const modifiedFile: ModifiedFile = {
  //     name: file.filename
  //   }
  //   if (file.patch) {
  //     // The changes are included in the file
  //     const patches = file.patch.split('@@').filter((_, index) => index % 2) // Only take the line information and discard the modified code
  //     for (const patch of patches) {
  //       // patch is usually like " -6,7 +6,8"
  //       try {
  //         const hasAddition = patch.includes('+')
  //         // const hasDeletion = patch.includes('-');
  //         if (hasAddition) {
  //           const matches = patch.match(/\+.*/)
  //           if (matches && matches.length > 0) {
  //             const lines = matches[0]
  //               .trim()
  //               .slice(1)
  //               .split(',')
  //               .map((num) => Number.parseInt(num))
  //             modifiedFile.addition ??= []
  //             modifiedFile.addition?.push({
  //               start: lines[0] as number,
  //               end: (lines[0] as number) + (lines[1] as number)
  //             })
  //           }
  //         }
  //         // if (hasDeletion) {
  //         //   const lines = patch.split('+')[0].trim().slice(1).split(',').map((num) => parseInt(num)) as [number, number];
  //         //   modifiedFile.deletion ??= [];
  //         //   modifiedFile.deletion?.push({
  //         //     start: lines[0],
  //         //     end: lines[0] + lines[1],
  //         //   });
  //         // }
  //       } catch (error) {
  //         console.log(`Error getting the patch of the file:\n${error}`)
  //       }
  //     }
  //   } else {
  //     // Take the all file
  //     modifiedFile.addition = [
  //       {
  //         start: 0,
  //         end: Number.POSITIVE_INFINITY
  //       }
  //     ]
  //     modifiedFile.deletion = [
  //       {
  //         start: 0,
  //         end: Number.POSITIVE_INFINITY
  //       }
  //     ]
  //   }
  //   return modifiedFile
  // }

  // async function getChangesInAPr(path: string) {
  //   const { context } = github
  //   if (context.payload) {
  //     core.info(`Context: ${JSON.stringify(context)}`)
  //     core.info(`sha: ${context.sha}`)
  //     core.info(`pull_request: ${JSON.stringify(context.payload.pull_request)}`)
  //     const base = context.payload.pull_request?.base.sha
  //     core.info(`base: ${base}`)
  //     const head = context.payload.pull_request?.head.sha
  //     core.info(`head: ${head}`)

  //     const githubToken = core.getInput('github_token')
  //     const octokit = github.getOctokit(githubToken)

  //     const response = await octokit.rest.repos.compareCommits({
  //       base,
  //       head,
  //       owner: context.repo.owner,
  //       repo: context.repo.repo
  //     })

  //     // const files = response.data.files
  //     // const fileNames = files?.map((file) => file.filename)
  //     const files = response.data.files ?? []
  //     for (const file of files) {
  //       if (file.filename.startsWith(path) && file.status === 'modified') {
  //         const modifiedFilesWithModifiedLines = parseFile(file)
  //         core.info(`filename: ${file.filename}`)
  //         core.info(`status: ${file.status}`)
  //         core.info(
  //           `modifiedFilesWithModifiedLines: ${JSON.stringify(modifiedFilesWithModifiedLines)}`
  //         )

  //         const newContent = fs.readFileSync(file.filename)
  //         core.info(
  //           `new content: ${JSON.stringify(yaml.parse(newContent.toString()))}`
  //         )

  //         const content = await octokit.rest.repos.getContent({
  //           owner: context.repo.owner,
  //           repo: context.repo.repo,
  //           path: file.filename,
  //           ref: base
  //         })

  //         interface ContentFile {
  //           type: 'file'
  //           encoding: string
  //           size: number
  //           name: string
  //           path: string
  //           content: string
  //           sha: string
  //           url: string
  //           git_url: string | null
  //           html_url: string | null
  //           download_url: string | null
  //           target: string | undefined
  //           submodule_git_url: string | undefined
  //         }
  //         const data = content.data as ContentFile
  //         const decodedString = Buffer.from(data.content, 'base64').toString(
  //           'utf8'
  //         )
  //         core.info(
  //           `original content: ${JSON.stringify(yaml.parse(decodedString))}`
  //         )
  //       }
  //     }
  //   }
  // }
}

export default OrqExperimentAction
