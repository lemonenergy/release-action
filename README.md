# release-action

Github action to bump package version, create release and push it

## Inputs

### github-token

_required_

github token with access to merge in head-branch

### base-branch

_default: master_

branch in which bumped branch will be merged in the future

### head-branch

_default: develop_

branch in which package.json will be bumped and pushed

### initial-version

_default: 0.0.0_

initial version used if base-branch doesn't have package.json

## Example usage

```yml
uses: lemonenergy/release-action@master # or use a specific version lemonenergy/release-action@1.0.0
with:
  github-token: ${{secrets.GITHUB_TOKEN}}
```

## Migrating from @prxg22/version-bump-action and @prxg22/push-package-version-tag-action

1. Replace `@prxg22/version-bump-action` from the head branch's PR/merge workflow
1. Remove `@prxg22/push-package-version-tag-action` from the base-branch's PR/merge workflow
