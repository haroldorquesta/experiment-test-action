/**
 * Represents the status of an experiment sheet run
 */
export enum SheetRunStatus {
  /** Initial state before the run is queued */
  DRAFT = 'draft',
  /** Run is queued for execution */
  QUEUED = 'queued',
  /** Run is currently being executed */
  RUNNING = 'running',
  /** Run has completed successfully */
  COMPLETED = 'completed',
  /** Run was cancelled by user */
  CANCELLED = 'cancelled',
  /** Run failed during execution */
  FAILED = 'failed'
}
