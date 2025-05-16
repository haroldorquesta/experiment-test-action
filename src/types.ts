import type * as github from '@actions/github'

export type GithubOctokit = ReturnType<typeof github.getOctokit>

export type GithubContext = typeof github.context

export type GithubPullRequest = {
  owner: string
  repo: string
  issue_number: number
}

export type FileLines = {
  start: number
  end: number
}

export type ModifiedFile = {
  name: string
  deletion?: FileLines[]
  addition?: FileLines[]
}

export type GithubContentFile = {
  type: 'file'
  encoding: string
  size: number
  name: string
  path: string
  content: string
  sha: string
  url: string
  git_url: string | null
  html_url: string | null
  download_url: string | null
  target: string | undefined
  submodule_git_url: string | undefined
}

export type DeploymentExperimentRunPayload = {
  type: string
  deployment_key: string
  dataset_id: string
  experiment_key: string
  context: Record<string, unknown> | undefined
  evaluators: string[] | undefined
}

export type DeploymentExperimentRunResponse = {
  url: string
  experiment_id: string
  experiment_run_id: string
}

export type ExperimentResult = {
  deployment_id: string
  deployment_variant_id: string
  deployment_variant_version: string
  status: string
}
