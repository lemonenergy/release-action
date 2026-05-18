const fs = require('fs')
const crypto = require('crypto')
const semver = require('semver')
const recommendedBump = require('recommended-bump')
const core = require('@actions/core')
const github = require('@actions/github')
const { exec } = require('@actions/exec')
const { Octokit } = require('@octokit/rest')
const EVENT = 'pull_request'

const actor = process.env.GITHUB_ACTOR
const repository = process.env.GITHUB_REPOSITORY

let remote
let octokit

const createAppJWT = (appId, privateKey) => {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: String(appId) })).toString('base64url')
  const data = `${header}.${payload}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(data), privateKey)
  return `${data}.${signature.toString('base64url')}`
}

const resolveToken = async () => {
  const appId = core.getInput('github-app-id')
  if (!appId) return core.getInput('github-token')

  const privateKey = core.getInput('github-token')
  const jwt = createAppJWT(appId, privateKey)
  const [owner, repo] = repository.split('/')

  const headers = {
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'lemonenergy/release-action',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const installResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/installation`,
    { headers },
  )
  if (!installResponse.ok)
    throw new Error(`Failed to get App installation: ${installResponse.status} ${await installResponse.text()}`)

  const { id: installationId } = await installResponse.json()

  const tokenResponse = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    { method: 'POST', headers },
  )
  if (!tokenResponse.ok)
    throw new Error(`Failed to get installation token: ${tokenResponse.status} ${await tokenResponse.text()}`)

  const { token } = await tokenResponse.json()
  return token
}

const checkEvent = (base, head) => {
  const { eventName, payload } = github.context
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
  const { context } = github

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
  const { context } = github
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

const bump = async (lastVersion, release, targetPath = '', skipCi = false) => {
  const version = semver.inc(lastVersion, release)

  const message = skipCi ? 'Release v%s [skip ci]' : 'Release v%s'
  const execOptions = targetPath ? { cwd: targetPath } : {}
  await exec(
    `npm version --new-version ${version} --allow-same-version -m "${message}"`,
    [],
    execOptions,
  )

  console.log(`${targetPath ? `${targetPath}/` : ''}package.json`)
  const file = fs.readFileSync(
    `${targetPath ? `${targetPath}/` : ''}package.json`,
  )
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
  await exec(`git push -f --tags "${remote}"`)
}

const updatePRTitleWithNextVersion = async version => {
  const { context } = github
  const { payload } = context
  const pull_number = payload.number

  return octokit.pulls.update({
    ...context.repo,
    pull_number,
    title: `v${version}`,
  })
}

const run = async () => {
  const base = core.getInput('base-branch')
  const head = core.getInput('head-branch')
  const initialVersion = core.getInput('initial-version')
  const targetPath = core.getInput('path')
  const skipCi = core.getBooleanInput('skip-ci')

  try {
    const token = await resolveToken()
    remote = `https://${actor}:${token}@github.com/${repository}.git`
    octokit = new Octokit({ auth: token })

    checkEvent(base, head)
    await configGit(head)
    await validatePullRequest()
    console.log('pull request validated')
    const release = await getRelease()
    if (!release) {
      core.warning('no release needed!')
      return
    }

    console.log(`starting ${release} release`)
    const lastVersion = await getLastVersion(base, initialVersion, targetPath)
    console.log(`got last version: ${lastVersion}`)
    const version = await bump(lastVersion, release, targetPath, skipCi)
    console.log(`bumped to version ${version}!`)
    await pushBumpedVersionAndTag(head)
    console.log(`version ${version} pushed!`)
    await updatePRTitleWithNextVersion(version)
    console.log(`PR title updated with v${version}`)
    core.setOutput('version', version)
  } catch (e) {
    core.setFailed(e)
  }
}

run()
