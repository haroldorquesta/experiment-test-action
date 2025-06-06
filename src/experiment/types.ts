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
  context?: Record<string, unknown> | undefined
  evaluators?: string[] | undefined
}

export type DeploymentExperimentRunResponse = {
  url: string
  experiment_id: string
  experiment_run_id: string
}

export type ExperimentManifestColumn = {
  display_name: string
  key: string
  column_type: string
  id: string
  position: number
  active: boolean
  config: Record<string, unknown>
  evaluator_id: string
}

export type ExperimentManifest = {
  _id: string
  sheet_id: string
  key: string
  columns: ExperimentManifestColumn[]
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
  metrics: Record<string, number>
}

export type ExperimentManifestRowCell = {
  type: string
  _id: string
  row_id: string
  column_id: string
  value: {
    type: string
    value: unknown
  }
  status?: string
  created_by_id?: string
  updated_by_id?: string
  created?: string
  updated?: string
}

export type EvalTable = {
  headers: string[]
  rows: string[][]
}

export type ExperimentManifestRow = {
  status: string
  sheet_id: string
  manifest_id: string
  cells: ExperimentManifestRowCell[]
  created_by_id: string
  updated_by_id: string
  created: string
  updated: string
  statusCode: number
  retry_count: number
  run_at: string
}

export type PaginatedExperimentManifestRows = {
  count: number
  page: number
  limit: number
  totalPages: number
  items: ExperimentManifestRow[]
}

export type ExperimentEval = {
  evaluator_id: string
  evaluator_type: string
  evaluator_key: string
  evaluator_name: string
}

export type ExperimentEvalResults = Record<string, number>

export type Experiment = {
  _id: string
  id: string
  type: string
  dataset_id: string
  dataset_name: string
  dataset_version_id: string
  workspace_id: string
  project_id: string
  display_name: string
  name: string
  state: {
    selected_manifest_id: string
    row_height_level: number
  }
  deployment_id: string
  deployment_variant_id: string
  deployment_variant_version: string
  created: string
  updated: string
  updated_by_id: string
  unique_evaluators: ExperimentEval[]
}
