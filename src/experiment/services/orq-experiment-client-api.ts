import * as core from '@actions/core'
import type {
  DeploymentExperimentRunResponse,
  DeploymentExperimentRunPayload,
  ExperimentManifest,
  PaginatedExperimentManifestRows,
  Experiment,
  ExperimentManifestRow,
  Account
} from '../types.js'
import { OrqExperimentError } from '../errors.js'
import { CONSTANTS } from '../constants.js'
import { SheetRunStatus } from '../enums.js'

export class OrqExperimentClientApi {
  private apiKey: string
  private baseUrl: string

  constructor(apiKey: string, baseUrl = CONSTANTS.API_BASE_URL) {
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
        `API request failed: ${response.statusText} (${response.status})`
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
  ): Promise<ExperimentManifestRow[]> {
    const result = await this.makeRequest<PaginatedExperimentManifestRows>(
      `/v2/spreadsheets/${experimentId}/rows?manifest_id=${experimentRunId}`,
      { method: 'GET' }
    )

    return result.items
  }

  async getAllExperimentManifests(
    experimentId: string
  ): Promise<ExperimentManifest[]> {
    return this.makeRequest<ExperimentManifest[]>(
      `/v2/spreadsheets/${experimentId}/manifests`,
      {
        method: 'GET'
      }
    )
  }

  async createExperimentRun(
    payload: DeploymentExperimentRunPayload
  ): Promise<DeploymentExperimentRunResponse> {
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

  async getAccount() {
    return this.makeRequest<Account>(`/v2/api/me`, {
      method: 'GET'
    })
  }

  async getCurrentAndPreviousRunManifest(
    experimentId: string,
    experimentRunId: string
  ): Promise<[ExperimentManifest, ExperimentManifest | null]> {
    const allRuns = await this.getAllExperimentManifests(experimentId)

    const currentRunIndex = allRuns.findIndex(
      (manifest) => manifest._id === experimentRunId
    )

    if (currentRunIndex === -1) {
      throw new OrqExperimentError(`Current experiment not found!`)
    }

    const currentRun = allRuns[currentRunIndex]

    let previousRun: ExperimentManifest | null = null

    if (currentRunIndex !== -1 && currentRunIndex + 1 < allRuns.length) {
      const potentialPreviousRun = allRuns[currentRunIndex + 1]

      if (potentialPreviousRun.status !== SheetRunStatus.COMPLETED) {
        throw new OrqExperimentError(
          `Previous experiment run has status '${potentialPreviousRun.status}', expected 'COMPLETED'`
        )
      }

      previousRun = potentialPreviousRun
    }

    return [currentRun, previousRun]
  }
}
