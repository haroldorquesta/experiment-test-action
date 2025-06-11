import * as core from '@actions/core'

async function run(): Promise<void> {
  try {
    core.debug('custom action example')
    console.info('test')
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
