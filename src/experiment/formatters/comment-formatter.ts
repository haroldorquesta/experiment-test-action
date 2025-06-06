import { generateMarkdownTable } from '../utils.js'
import { CONSTANTS } from '../constants.js'
import { EvalTable } from '../types.js'

export class CommentFormatter {
  generateCommentKey(filename: string): string {
    return `<!-- orq-action-identifier:${filename} -->`
  }

  formatExperimentRunningComment(
    experimentKey: string,
    deploymentKey: string,
    filename: string,
    experimentUrl?: string
  ): string {
    const key = this.generateCommentKey(filename)

    return `${key}
## 🧪 Orq.ai Experiment Running

**Deployment:** ${deploymentKey}  
**Experiment:** ${experimentKey}

🔄 Your experiment is currently running. Results will be posted here once complete.

---
${experimentUrl ? `[View running experiment in Orq.ai](${experimentUrl})` : ''}
`
  }

  formatExperimentResultsComment(
    experimentKey: string,
    deploymentKey: string,
    evalTable: EvalTable,
    filename: string,
    experimentUrl: string
  ): string {
    const key = this.generateCommentKey(filename)

    const content = `${key}
## 🧪 Orq.ai Experiment Results

**Deployment:** ${deploymentKey}  
**Experiment:** ${experimentKey}

${generateMarkdownTable(evalTable.headers, evalTable.rows)}

---
[View detailed results in Orq.ai](${experimentUrl})`

    return content
  }

  formatExperimentErrorComment(
    error: Error,
    filename: string,
    experimentKey?: string,
    deploymentKey?: string,
    workspaceKey?: string,
    experimentId?: string,
    experimentRunId?: string
  ): string {
    const key = this.generateCommentKey(filename)

    return `${key}
## ❌ Orq.ai Experiment Run Failed

${deploymentKey ? `**Deployment:** ${deploymentKey}` : ''}  
${experimentKey ? `**Experiment:** ${experimentKey}` : ''}  

**Error:** ${error.message}

Please check your configuration and try again.
---
${experimentId && experimentRunId && workspaceKey ? `[View running experiment in Orq.ai](${CONSTANTS.API_BASE_URL}/experiments/${workspaceKey}/${experimentId}/run/${experimentRunId})` : ''}
`
  }
}
