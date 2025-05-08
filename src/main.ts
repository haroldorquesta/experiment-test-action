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

    const prs = await inferPullRequestsFromContext(octokit)

    if (prs.length > 0) {
      let message = `
Orq ai experiment run - in progress      
`
      await createComment(octokit, prs[0], message)

      await sleep(5000)

      message = `
Orq ai experiment run - succeeded    
`

      await createComment(octokit, prs[0], message)
    }

    core.info(JSON.stringify(prs))

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

const createComment = async (
  octokit: Octokit,
  pullRequest: PullRequest,
  body: string
) => {
  await octokit.rest.issues.createComment({
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    issue_number: pullRequest.issue_number,
    body: `${body}\n`
  })
}

const inferPullRequestsFromContext = async (
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
