# release-action

Bumps package version and creates release.

## Inputs

| Name           | Description                                                   | Required | Default |
| -------------- | ------------------------------------------------------------- | -------- | ------- |
| base-branch    | Branch in which release will be merged                        | true     | main    |
| head-branch    | Branch to be released                                         | true     | develop |
| github-token   | Github token with access to commit in head-branch             | true     |         |
| initial-branch | Initial version used if base-branch doesn't have package.json | false    | 0.0.0   |

## Output

| Name | Description |
| version | the next version |

## Usage

```yml
- uses: lemonenergy/release-action@main
  with:
    github-token: ${{secrets.PERSONAL_GITHUB_TOKEN}}
```

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
