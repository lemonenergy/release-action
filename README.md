# release-action

Bumps package version and creates release.

## Inputs

| Name                | Description                                                                                            | Required | Default |
| ------------------- | ------------------------------------------------------------------------------------------------------ | -------- | ------- |
| base-branch         | Branch in which release will be merged                                                                 | true     | main    |
| head-branch         | Branch to be released                                                                                  | true     | develop |
| github-token        | GitHub token (PAT) or GitHub App private key when `github-app-id` is provided                         | true     |         |
| github-app-id       | GitHub App ID. When set, `github-token` is treated as the App private key and a short-lived installation token is generated automatically | false    |         |
| skip-ci             | Append `[skip ci]` to the version bump commit message to prevent triggering new workflow runs          | false    | false   |
| initial-version     | Initial version used if base-branch doesn't have package.json                                          | false    | 0.0.0   |

## Output

| Name    | Description      |
| ------- | ---------------- |
| version | the next version |

## Usage

### With a Personal Access Token (PAT)

```yml
- uses: lemonenergy/release-action@main
  with:
    github-token: ${{secrets.PERSONAL_GITHUB_TOKEN}}
```

### With a GitHub App (recommended for avoiding PATs)

```yml
- uses: lemonenergy/release-action@main
  with:
    github-token: ${{secrets.GITHUB_APP_PRIVATE_KEY}}
    github-app-id: ${{secrets.GITHUB_APP_ID}}
```

The action will automatically generate a short-lived installation token for the current repository using the App credentials.

### Preventing workflow loops with `skip-ci`

```yml
- uses: lemonenergy/release-action@main
  with:
    github-token: ${{secrets.PERSONAL_GITHUB_TOKEN}}
    skip-ci: true
```

When enabled, the version bump commit message becomes `Release v{version} [skip ci]`, preventing GitHub Actions from triggering new workflow runs on that commit.

## Update PR title

In order to update the PR title with the release version for easier identification, add an `id` field to the release action and the following script:

```yml
- uses: lemonenergy/release-action@develop
  id: release-commit
  with:
    github-token: ${{secrets.GITHUB_TOKEN}}

- uses: actions/github-script@v6
  with:
    script: |
      if(!"${{steps.release-commit.outputs.version}}") return
      github.rest.pulls.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: context.issue.number,
        title: "v${{steps.release-commit.outputs.version}}"
      })
```
