export class OrqExperimentError extends Error {
  constructor(
    message: string,
    public readonly context: {
      experimentKey?: string
      experimentId?: string
      phase?: string
      details?: unknown
    }
  ) {
    super(message)
    this.name = 'OrqExperimentError'
  }
}
