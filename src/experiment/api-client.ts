import * as core from '@actions/core'
import type {
  DeploymentExperimentRunResponse,
  DeploymentExperimentRunPayload,
  ExperimentManifest,
  PaginatedExperimentManifestRows,
  Experiment
} from './types.js'
import { OrqExperimentError } from './errors.js'

export class OrqApiClient {
  private apiKey: string
  private baseUrl: string

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
  }

  private get defaultHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`
    }
  }

  private async makeRequest<T>(
    endpoint: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE'
      body?: unknown
      headers?: Record<string, string>
    }
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: options.method,
      headers: {
        ...this.defaultHeaders,
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    })

    if (!response.ok) {
      throw new OrqExperimentError(
        `API request failed: ${response.statusText}`,
        {
          phase: 'api_call',
          details: {
            status: response.status,
            statusText: response.statusText,
            endpoint
          }
        }
      )
    }

    return (await response.json()) as T
  }

  async runExperiment(
    payload: DeploymentExperimentRunPayload
  ): Promise<DeploymentExperimentRunResponse> {
    core.info(`Run experiment ${JSON.stringify(payload)}`)
    return this.makeRequest<DeploymentExperimentRunResponse>(
      `/v2/deployments/${payload.deployment_key}/experiment`,
      {
        method: 'POST',
        body: {
          type: 'deployment_experiment',
          experiment_key: payload.experiment_key,
          dataset_id: payload.dataset_id,
          ...(payload.context ? { context: payload.context } : {}),
          ...(payload.evaluators ? { evaluators: payload.evaluators } : {})
        }
      }
    )
  }

  async getExperiment(experimentId: string): Promise<Experiment> {
    const experiment = await this.makeRequest<Experiment>(
      `/v2/spreadsheets/${experimentId}`,
      { method: 'GET' }
    )
    core.info(`Get experiment result ${JSON.stringify(experiment)}`)
    return experiment
  }

  async getExperimentManifest(
    experimentId: string,
    experimentRunId: string
  ): Promise<ExperimentManifest> {
    return this.makeRequest<ExperimentManifest>(
      `/v2/spreadsheets/${experimentId}/manifests/${experimentRunId}`,
      { method: 'GET' }
    )
  }

  async getExperimentManifestRows(
    experimentId: string,
    experimentRunId: string
  ): Promise<PaginatedExperimentManifestRows> {
    return this.makeRequest<PaginatedExperimentManifestRows>(
      `/v2/spreadsheets/${experimentId}/rows?manifest_id=${experimentRunId}`,
      { method: 'GET' }
    )
  }

  async getExperimentRunAverageMetrics(
    experimentId: string,
    experimentRunId: string
  ): Promise<[ExperimentManifest | null, ExperimentManifest | null]> {
    const experimentManifestPaged = await this.makeRequest<{
      items: ExperimentManifest[]
    }>(`/v2/spreadsheets/${experimentId}/manifests`, {
      method: 'GET'
    })

    const experimentManifests = experimentManifestPaged.items
    core.info(`Paginated manifests ${JSON.stringify(experimentManifests)}`)

    const currentRunIndex = experimentManifests.findIndex(
      (manifest) => manifest._id === experimentRunId
    )
    const currentRun =
      currentRunIndex !== -1 ? experimentManifests[currentRunIndex] : null
    const previousRun =
      currentRunIndex !== -1 && currentRunIndex + 1 < experimentManifests.length
        ? experimentManifests[currentRunIndex + 1]
        : null

    return [currentRun || null, previousRun || null]
  }
}
