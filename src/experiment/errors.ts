export class OrqExperimentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrqExperimentError'
  }
}
