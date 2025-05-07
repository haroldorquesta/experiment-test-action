import * as core from '@actions/core'
import * as github from '@actions/github'

type Octokit = ReturnType<typeof github.getOctokit>

type PullRequest = {
  owner: string
  repo: string
  issue_number: number
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

    core.info(JSON.stringify(prs))

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

const inferPullRequestsFromContext = async (
  octokit: Octokit
): Promise<PullRequest[]> => {
  const { context } = github
  if (Number.isSafeInteger(context.issue.number)) {
    core.debug(`Use #${context.issue.number} from the current context`)
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
    core.debug(`  #${pull.number}: ${pull.title}`)
  }
  return pulls.data.map((p) => ({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: p.number
  }))
}
