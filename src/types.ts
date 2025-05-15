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
