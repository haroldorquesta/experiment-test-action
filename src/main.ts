import * as core from '@actions/core'
import * as github from '@actions/github'

type Octokit = ReturnType<typeof github.getOctokit>

type PullRequest = {
  owner: string
  repo: string
  issue_number: number
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function generateMarkdownTable(headers: string[], rows: string[][]) {
  let table = `| ${headers.join(' | ')} |\n`
  table += `|${headers.map(() => '---').join('|')}|\n`

  for (const row of rows) {
    table += `| ${row.join(' | ')} |\n`
  }

  return table
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Log the current timestamp, wait, then log the new timestamp
    core.debug(new Date().toTimeString())

    const apiKey = core.getInput('api_key')

    if (!apiKey) {
      throw new Error('Input `api_key` not set!')
    }

    const path = core.getInput('path')

    if (!path) {
      throw new Error('Input `path` for yaml configs was not set!')
    }

    const githubToken = core.getInput('github_token')
    const octokit = github.getOctokit(githubToken)

    const prs = await getPullRequestsFromContext(octokit)

    if (prs.length > 0) {
      let message = `
Orq ai experiment run - in progress      
`
      await upsertComment(octokit, prs[0], message)

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

      await upsertComment(octokit, prs[0], message)
    }

    await getChangesInAPr()

    core.info(JSON.stringify(prs))

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

async function getChangesInAPr() {
  const { context } = github
  if (context.payload) {
    core.info(`pull_request: ${JSON.stringify(context.payload.pull_request)}`)
    const base = context.payload.pull_request?.base.sha
    core.info(`base: ${base}`)
    const head = context.payload.pull_request?.head.sha
    core.info(`head: ${head}`)

    const githubToken = core.getInput('github_token')
    const octokit = github.getOctokit(githubToken)

    const response = await octokit.rest.repos.compareCommits({
      base,
      head,
      owner: context.repo.owner,
      repo: context.repo.repo
    })

    const files = response.data.files
    const fileNames = files?.map((file) => file.filename)
    console.info(`fileNames: ${fileNames}`)
  }
}

const upsertComment = async (
  octokit: Octokit,
  pullRequest: PullRequest,
  body: string
) => {
  const commentKey = '<!-- orq_ai_experiment_bot -->'

  const { data: comments } = await octokit.rest.issues.listComments({
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    issue_number: pullRequest.issue_number,
    sort: 'created',
    direction: 'desc',
    per_page: 100
  })

  core.debug(
    `Found ${comments.length} comment(s) of #${pullRequest.issue_number}`
  )

  for (const comment of comments) {
    if (comment.body?.includes(commentKey)) {
      const { data: updated } = await octokit.rest.issues.updateComment({
        owner: pullRequest.owner,
        repo: pullRequest.repo,
        comment_id: comment.id,
        body: `${body}\n${commentKey}`
      })

      core.info(`Updated the comment ${updated.html_url}`)

      return
    }
  }

  await octokit.rest.issues.createComment({
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    issue_number: pullRequest.issue_number,
    body: `${commentKey}\n${body}`
  })
}

const getPullRequestsFromContext = async (
  octokit: Octokit
): Promise<PullRequest[]> => {
  const { context } = github
  if (Number.isSafeInteger(context.issue.number)) {
    core.info(`Use #${context.issue.number} from the current context`)
    return [
      {
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number
      }
    ]
  }

  core.debug(`List pull requests associated with sha ${context.sha}`)
  const pulls = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
    owner: context.repo.owner,
    repo: context.repo.repo,
    commit_sha: context.sha
  })

  for (const pull of pulls.data) {
    core.info(`  #${pull.number}: ${pull.title}`)
  }

  return pulls.data.map((p) => ({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: p.number
  }))
}
