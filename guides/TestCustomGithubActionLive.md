# Guide to test custom github action live after release

To test the live version it need to be merge first to main branch which will automatically create a new release `v1.0.x`

Either create a new repo or use existing repo then add the new workflow below in `.github/workflows/<workflow-name>.yml`

```yaml
name: Run experiment action on PR # name of the workflow
 
on:
  pull_request:
    types: [opened, synchronize] # triggered on PR creating and new commit pushed in a PR
 
permissions:
  pull-requests: write # needed permission to write a comment in a PR
  contents: read # to read the contents of files of the current branch
 
jobs:
  eval: # job name
    name: Run experiment
    runs-on: ubuntu-latest # ubuntu base
 
    steps:
      - name: Checkout # to get the current branch all files content (needed to read the new change)
        id: checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
 
      - name: Setup Node.js # needed for the custom action to run as its base on node runtime
        id: setup-node
        uses: actions/setup-node@v4
        with:
          node-version: 20
 
      - name: Run experiments
        uses: <org_name>/<repo_name>/actions/<custom-action-name>@<latest-release-tag-version> or v1 # actual custom action, v1 is always the latest release tag if wanted to use a specific version explicitly specify it v1.0.<version>
        with:
          <input_key1>: ${{ secrets.<SECRET_NAME> }} # pass input 1
          <input_key2>: <input_value>  # pass input 2
```