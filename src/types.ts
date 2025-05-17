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

type ExperimentManifetColumn = {
  display_name: string
  key: string
  column_type: string
  id: string
  position: number
  active: boolean
  config: Record<string, unknown>
}

export type ExperimentManifest = {
  sheet_id: string
  key: string
  columns: ExperimentManifetColumn[]
  status: string
  created_by_id: string
  updated_by_id: string
  created: string
  updated: string
  dataset_id: string
  dataset_version_id: string
  deployment_id: string
  deployment_variant_id: string
  deployment_variant_version: string
  stats: {
    total_cost: number
  }
  started_at: string
  completed_at: string
}

type ExperimentManifestRow = {
  type: string
  _id: string
  row_id: string
  column_id: string
  value?: string
  status?: string
  created_by_id?: string
  updated_by_id?: string
  created?: string
  updated?: string
}

export type ExperimentManifestRows = {
  status: string
  sheet_id: string
  manifest_id: string
  cells: ExperimentManifestRow[]
  created_by_id: string
  updated_by_id: string
  created: string
  updated: string
  statusCode: number
  retry_count: number
  run_at: string
}
