# Guide to test custom github action live

To test the new branch with your custom action you first need to run the bundle `npm run bundle` then commit it.

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
        uses: <orq_name>/<repo_name>/actions/<custom-action-name>@<branch-name-or-tag-version> # actual custom action
        with:
          <input_key1>: ${{ secrets.<SECRET_NAME> }} # pass input 1
          <input_key2>: <input_value>  # pass input 2
```