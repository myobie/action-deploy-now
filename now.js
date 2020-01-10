const { zeitToken: token, path, nowJSON: json, packageJSON, debug } = require('./config')
const { createDeployment } = require('now-client')
const gh = require('./gh')
const nodeFetch = require('node-fetch')

export async function deploy () {
  let deploymentResult
  let deploymentURL
  let error

  const config = await buildFullConfig()

  const actionURL = '#' // TODO: what is the url to this action's logs?

  const deployment = await gh.createDeployment()
  await deployment.update('pending')

  for await (const event of createDeployment(config.client, config.deployment)) {
    if (event.type === 'created') {
      await deployment.update('queued')
    }

    if (event.type === 'build-state-changed') {
      await deployment.update('in_progress')
    }

    if (event.type === 'ready') {
      await deployment.update('success')
      await gh.createComment(`
🎈 \`${gh.shortSHA}\` was deployed to now for the project [${config.project}](${config.projectURL}) and is available now at
🌍 <${config.alias}>.
`.trim())
      deploymentResult = event.payload
    }

    if (event.type === 'warning') {
      console.error(event.payload)
    }

    if (event.type === 'error') {
      await deployment.update('failure')
      await gh.createComment(`
❌ \`${gh.shortSHA}\` failed to deploy to now for the project [${config.project}](${config.projectURL}).

Checkout the [action logs](${actionURL}) here and the [deployment logs](${deploymentURL}) over on now to see what might have happened.
`.trim())

      error = event.payload
      console.error(event)
      break
    }
  }

  if (error) {
    throw error
  } else {
    return deploymentResult
  }
}

async function buildFullConfig () {
  const project = json.name.replace('/', '-').replace('.', '')
  const user = await fetchUser()
  const scope = json.scope || user
  const alias = `https://${project}-git-${gh.branch}.${scope}.now.sh`
  const projectURL = `https://zeit.co/${scope}/${project}`

  const client = {
    force: true, // I really mean it
    path,
    token,
    debug
  }

  const deployment = {
    env: {
      GITHUB_REPO: gh.repo,
      GITHUB_OWNER: gh.owner,
      GITHUB_BRANCH: gh.branch,
      NOW_PREVIEW_ALIAS: alias
    },
    build: {
      env: {
        GITHUB_REPO: gh.repo,
        GITHUB_OWNER: gh.owner,
        GITHUB_BRANCH: gh.branch,
        NOW_PREVIEW_ALIAS: alias
      }
    }
  }

  return {
    project,
    projectURL,
    user,
    scope,
    alias,
    client,
    deployment
  }
}

async function fetchUser () {
  const resp = await fetch('/www/user')
  const json = await resp.json()
  return json.user.username
}

async function fetch (url, opts = {}) {
  const userAgent = opts.userAgent || `deploy-now-action-${packageJSON.version}`

  opts.headers = {
    ...opts.headers,
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'user-agent': userAgent
  }

  if (opts.contentType) {
    opts.headers['Content-type'] = opts.contentType
  }
  delete opts.contentType

  opts.method || (opts.method = 'GET')

  if (debug) {
    console.debug(`FETCH: ${opts.method} ${url}`)
  }

  const time = Date.now()

  const resp = await nodeFetch(url, opts)

  if (debug) {
    console.debug(`DONE in ${Date.now() - time}ms: ${opts.method || 'GET'} ${url}`)
  }

  return resp
}
