# Guide to Detecting Changes in a PR for Experiment Action

This guide explains how to detect file changes in pull requests.

## Step 1: Get PR Information

GitHub Context in GitHub Actions refers to contextual information that's automatically available during workflow execution. It provides access to data about the workflow run, repository, event that triggered the workflow, and the runtime environment.

```typescript
import * as github from '@actions/github'

const { payload, repo, issue } = github.context
const base = payload.pull_request?.base.sha  // base branch commit
const head = payload.pull_request?.head.sha  // PR branch commit
const issue_number = issue.number // PR number/identifier
const owner = repo.owner
const repo = repo.repo
```

## Step 2: Find Relevant Changed Files

Compare the commits to get the changed files in a PR
```typescript
const response = await octokit.rest.repos.compareCommits({
   base,
   head,
   owner: repo.owner,
   repo: repo.repo
})
// Returns: [{"filename": "experiments/experiment1.yml", "status": "modified"}]
```

In this example we are interested in
- a file status that was change/modified or added
- yml files that is inside a specific directory (`experiments`)
```typescript
const yamlFiles = response.data.files.filter(file => 
   file.filename.endsWith('.yml') && 
   file.filename.startsWith('experiments') &&
   (file.status === 'modified' || file.status === 'added')
)
```

## Step 3: Get File Contents

Only possible if the workflow has a step for checkout

```yaml
   steps:
      - name: Checkout
        id: checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
```

**From PR (current version):**
```typescript
const newContent = fs.readFileSync(filename, 'utf8')
```

if no checkout in the workflow steps then have to use this example below which getting the content from a commit hash for a specific file

**From base branch (original version):**
```typescript
const response = await octokit.rest.repos.getContent({
   owner: repo.owner,
   repo: repo.repo,
   path: filename,
   ref: baseSha
})
const originalContent = Buffer.from(response.data.content, 'base64').toString() // response content is in base64 format - needed to convert to plaintext
```

## Step 4: Compare Contents

```typescript
const originalData = yaml.parse(originalContent)
const newData = yaml.parse(newContent)

// Example: Check if specific fields changed in values
if (originalData.deployment_key !== newData.deployment_key) {
    // Field changed - take action
}
```

## Step 5: Post Results to PR

**Find existing comment:**
```typescript
const comments = await octokit.rest.issues.listComments({
   owner, repo, issue_number: prNumber
})

const existingComment = comments.data.find(c => 
   c.body?.includes('<!-- unique-identifier -->')
)
```

**Create or update comment:**
```typescript
const body = `Results: <!-- unique-identifier -->\n${results}` // message you wanted to show in the PR comment

if (existingComment) {
   await octokit.rest.issues.updateComment({
      owner, repo, comment_id: existingComment.id, body
   })
} else {
   await octokit.rest.issues.createComment({
      owner, repo, issue_number: prNumber, body
   })
}
```