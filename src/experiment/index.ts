import * as core from '@actions/core'
import OrqExperimentAction from './action.js'

async function run(): Promise<void> {
  try {
    const action = new OrqExperimentAction()
    await action.validateInput()
    await action.run()
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
