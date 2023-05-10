const { readFileSync } = require('fs')
const { exit } = require('process')

const { getInput, warning, setOutput, setFailed } = require('@actions/core')
const { exec } = require('@actions/exec')
const github = require('@actions/github')
const { Octokit } = require('@octokit/rest')
const recommendedBump = require('recommended-bump')
const { inc } = require('semver')

const EVENT = 'pull_request'

const githubToken = getInput('github-token')
const base = getInput('base-branch')
const head = getInput('head-branch')
const initialVersion = getInput('initial-version')
const targetPath = getInput('path')

const actor = process.env.GITHUB_ACTOR
const repository = process.env.GITHUB_REPOSITORY
const remote = `https://${actor}:${githubToken}@github.com/${repository}.git`

const octokit = new Octokit({ auth: githubToken })
const { context } = github

const checkEvent = () => {
  const { eventName, payload } = context
  const { pull_request } = payload

  if (eventName !== EVENT)
    throw Error(`Event ${eventName} not supported. It should be ${EVENT}`)
  const prBase = pull_request?.base?.ref
  const prHead = pull_request?.head?.ref

  if (prBase === base && prHead === head) return

  throw Error(
    `base_branch "${prBase}" and head_branch "${prHead}" provided doesn't match with the pull request base "${base}" and head "${head}"!`,
  )
}

const getLastVersion = async (base, initial = '0.0.0', targetPath = '') => {
  try {
    const pkgFile = await octokit.repos.getContent({
      ...context.repo,
      ref: base,
      path: `${targetPath ? `${targetPath}/` : ''}package.json`,
    })

    const content = Buffer.from(pkgFile.data.content, 'base64')

    const { version } = JSON.parse(content)

    return version
  } catch (e) {
    if (e.toString() === 'HttpError: Not Found') return initial
    throw e
  }
}

const validatePullRequest = async () => {
  const { payload } = context

  const pull_number = payload.number
  const { data: pull_request } = await octokit.pulls.get({
    ...context.repo,
    pull_number,
  })

  if (!pull_request.mergeable) throw Error(`PR isn't mergeable`)
}

const validateCommitMessage = message => {
  if (typeof message !== 'string') return false

  const [header = message] = message.split('\n\n')
  const commitRegex =
    /^(feat|fix|chore|refactor|style|test|docs)(?:\((.+)\))?: (.+)$/g

  return commitRegex.test(header.trim())
}

const getPullRequestCommits = async parameters => {
  const commits = []

  for await (const response of octokit.paginate.iterator(
    'GET /repos/:owner/:repo/pulls/:pull_number/commits',
    parameters,
  )) {
    commits.push(...response.data)
  }

  return commits
}

const getRelease = async () => {
  const { context } = github
  const { payload } = context

  const pull_number = payload.number

  const commits = await getPullRequestCommits({
    ...context.repo,
    pull_number,
  })

  const messages = commits
    .map(({ commit }) => commit.message)
    .filter(validateCommitMessage)

  const { increment: release } = recommendedBump(messages)

  return release
}

const bump = async (lastVersion, release, targetPath = '') => {
  const version = inc(lastVersion, release)

  if (targetPath) {
    await exec(`ls /usr/bin`)
    await exec(`cd ${targetPath}`)
  }

  await exec(
    `npm version --new-version ${version} --allow-same-version -m "Release v%s"`,
  )

  const file = readFileSync(`${targetPath ? `${targetPath}/` : ''}package.json`)
  const { version: bumped } = JSON.parse(file.toString())

  return bumped
}

const configGit = async head => {
  await exec(`git fetch ${remote} ${head}:${head}`)
  await exec(`git config --local user.email "action@github.com"`)
  await exec(`git config --local user.name "Version Bump Action"`)
  await exec(`git checkout ${head}`)
}

const pushBumpedVersionAndTag = async head => {
  await exec(`git push "${remote}" HEAD:${head}`)
  await exec(`git push -f --tags`)
}

const run = async () => {
  try {
    checkEvent(base, head)
    await configGit(head)
    await validatePullRequest()
    console.log('pull request validated')
    const release = await getRelease()
    if (!release) {
      warning('no release needed!')
      exit(0)
    }

    console.log(`starting ${release} release`)
    const lastVersion = await getLastVersion(base, initialVersion, targetPath)
    console.log(`got last version: ${lastVersion}`)
    const version = await bump(lastVersion, release, targetPath)
    console.log(`bumped to version ${version}!`)
    await pushBumpedVersionAndTag(head)
    console.log(`version ${version} pushed!`)
    setOutput('version', version)
  } catch (e) {
    setFailed(e)
  }
}

run()
