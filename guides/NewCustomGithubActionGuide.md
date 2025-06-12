# Guide to creating a new custom github action

This guide provides detailed instructions on how to create a new custom github action in this repository using the `script/new-action` script.

## Overview

The `script/new-action` script automates the process of creating a new custom github action within this repository. It sets up the necessary directory structure, creates boilerplate files, and updates the build configuration.

## Prerequisites

- Bash shell environment
- Node.js (20) and npm installed
- Basic understanding of GitHub Actions
- Access to the repository
- Create a new branch

## Usage

### Basic Command

```bash
./script/new-action <action-name>
```

### Parameters

- `<action-name>`: The name of your new action (required)
  - Must contain only letters, numbers, and hyphens
  - Will be automatically converted to lowercase
  - Examples: `my-action`, `deploy-app`, `test-runner`

### Example

```bash
./script/new-action deploy-app
```

## What the Script Does

### 1. Validates Input

- Ensures exactly one parameter is provided
- Validates that the action name contains only alphanumeric characters and hyphens
- Converts the name to lowercase for consistency

### 2. Name Conversions

The script converts your action name into different formats:
- **Lowercase**: Used for directory names (e.g., `deploy-app`)
- **camelCase**: Used for TypeScript variables (e.g., `deployApp`)
- **PascalCase**: Used for class names (e.g., `DeployApp`)

### 3. Creates Directory Structure

```
actions/
└── <action-name>/
    └── action.yml

src/
└── <action-name>/
    └── index.ts
```

### 4. Generates action.yml

Creates a basic action configuration file at `actions/<action-name>/action.yml` with:
- Action name and description placeholders
- Example input and output definitions
- Node.js 20 runtime configuration
- Reference to the compiled JavaScript file

### 5. Creates index.ts

Generates a TypeScript entry point at `src/<action-name>/index.ts` with:
- Basic imports from `@actions/core`
- Async `run()` function with error handling
- Placeholder for action logic

### 6. Updates Build Configuration

Automatically adds an entry to `rollup.config.ts` to ensure your new action is compiled during the build process.

## Post-Creation Steps

After running the script, you need to:

### 1. Update action.yml

Edit `actions/<action-name>/action.yml` to:
- Add a meaningful description
- Define your actual inputs with proper descriptions and requirements
- Define any outputs your action will produce
- Update the author field if needed

Example:
```yaml
name: 'Deploy App'
description: 'Deploys the application to the specified environment'
author: 'your-name'

inputs:
  environment:
    description: 'Target deployment environment'
    required: true
  version:
    description: 'Application version to deploy'
    required: false
    default: 'latest'

outputs:
  deployment_url:
    description: 'URL of the deployed application'

runs:
  using: node20
  main: ../../dist/deploy-app/index.js
```

### 2. Implement Action Logic

Edit `src/<action-name>/index.ts` to implement your action's functionality:

```typescript
import * as core from '@actions/core'

async function run(): Promise<void> {
  try {
    // Get inputs
    const environment = core.getInput('environment', { required: true })
    const version = core.getInput('version')
    
    // Your action logic here
    console.info(`Deploying version ${version} to ${environment}`)
    
    // Set outputs
    core.setOutput('deployment_url', 'https://example.com')
    
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
```

### 3. Compile the Action

Run the build command to compile your TypeScript code:
```bash
npm run bundle
```

### 4. Test Locally

Test your action locally using the GitHub local-action tool:
```bash
npx @github/local-action . src/<action-name>/index.ts .env
```

Make sure to create a `.env` file with any required inputs:
```
INPUT_ENVIRONMENT=staging
INPUT_VERSION=1.0.0
```

## Best Practices

### File Organization

Consider organizing your action code into multiple files for better maintainability:

```
src/<action-name>/
├── index.ts           # Entry point
├── action.ts          # Main action logic
├── types.ts           # TypeScript interfaces and types
├── utils.ts           # Utility functions
├── constants.ts       # Constants and configuration
└── services/          # External service integrations
    └── api-client.ts
```

### Error Handling

Always implement proper error handling:
- Use try-catch blocks
- Provide meaningful error messages
- Use `core.setFailed()` for action failures
- Consider using `core.warning()` for non-fatal issues

### Extracting Input

Use the github action core library in getting the inputs from the workflow
```typescript
import * as core from '@actions/core'

core.getInput('<input-name>')
```

### Install new package/library

Need to install a new package/library run the below command
```bash
npm install <package-name>
```

### Input Validation

Validate all inputs before processing (either via simple checking or use zod schema package):
```typescript
const input = core.getInput('my_input')
if (!input || input.trim() === '') {
  throw new Error('my_input is required and cannot be empty')
}
```

### Logging

Use the github action core library in logging
```typescript
import * as core from '@actions/core'

core.info('sample info')
```

Use appropriate logging levels:
- `core.info()` for general information
- `core.debug()` for debugging (only shown when debug is enabled)
- `core.warning()` for warnings
- `core.error()` for errors

## Troubleshooting

### Script Fails with "Action already exists"

The script checks if directories already exist. If you need to recreate an action:
1. Remove the existing directories: `rm -rf actions/<action-name> src/<action-name>`
2. Remove the entry from `rollup.config.ts`
3. Run the script again

### Build Errors

If you encounter build errors after creating a new action:
1. Ensure all TypeScript syntax is correct
2. Check that all imports are properly defined
3. Run `npm install` if you've added new dependencies
4. Check the rollup configuration was correctly updated

### Action Not Found

If GitHub can't find your action:
1. Ensure you've run `npm run bundle` to compile the TypeScript
2. Check that the `main` path in `action.yml` is correct in `actions/<action-name>`
3. Verify the compiled file exists in `dist/<action-name>/index.js`

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Actions Toolkit](https://github.com/actions/toolkit)
- [Creating a JavaScript Action](https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action)