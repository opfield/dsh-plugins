/**
 * OAuth for remote MCP servers, driven by the MCP SDK's own `auth()` flow.
 *
 * State per server lives in `<dataDir>/oauth/<server>.json` (mode 0600):
 * client registration, tokens, PKCE verifier and discovery state. The browser
 * leg uses a loopback listener on 127.0.0.1 that runs only while a sign-in is
 * pending. Outside an explicit sign-in the provider never opens a browser: it
 * records that authorization is required and fails the connection instead.
 */

import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

export class AuthRequiredError extends Error {
  constructor(server, url) {
    super(`${server}: sign-in required`)
    this.name = 'AuthRequiredError'
    this.authorizationUrl = url
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

/** Open a URL in the system browser (best effort). */
export function openExternal(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]]
  try {
    execFile(cmd, args, { stdio: 'ignore' }, () => {})
  } catch {
    // the UI shows the link as a fallback
  }
}

/**
 * Tokens obtained earlier by `mcp-remote` for this exact URL (same md5 file
 * key mcp-remote uses) or for the same host. Returns `{client, tokens}`.
 */
export function findMcpRemoteCredentials(url, root = join(homedir(), '.mcp-auth')) {
  let host
  try {
    host = new URL(url).host
  } catch {
    return undefined
  }
  const key = createHash('md5').update(url).digest('hex')
  let dirs = []
  try {
    dirs = readdirSync(root)
      .filter((d) => d.startsWith('mcp-remote'))
      .sort()
      .reverse()
  } catch {
    return undefined
  }
  for (const dir of dirs) {
    let files = []
    try {
      files = readdirSync(join(root, dir))
    } catch {
      continue
    }
    for (const f of files.filter((f) => f.endsWith('_tokens.json'))) {
      const id = f.slice(0, -'_tokens.json'.length)
      const tokens = readJson(join(root, dir, f))
      const client = readJson(join(root, dir, `${id}_client_info.json`))
      if (!tokens?.access_token || !client?.client_id) continue
      let issuerHost
      try {
        issuerHost = new URL(tokens.issuer ?? client.issuer).host
      } catch {
        issuerHost = undefined
      }
      if (id === key || issuerHost === host) return { client, tokens }
    }
  }
  return undefined
}

/** Loopback listener shared by every pending sign-in. */
export class CallbackListener {
  constructor(port, logger) {
    this.port = port
    this.logger = logger
    this.pending = new Map() // state -> { resolve, timer }
    this.server = null
    this.listening = null
  }

  get redirectUrl() {
    return `http://127.0.0.1:${this.port}/callback`
  }

  async start() {
    if (this.listening) return this.listening
    this.server = createServer((req, res) => this.handle(req, res))
    this.listening = new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.port, '127.0.0.1', () => {
        this.port = this.server.address().port
        resolve()
      })
    }).catch((error) => {
      this.server = null
      this.listening = null
      throw error
    })
    return this.listening
  }

  /** Wait for the browser to come back with `state`. */
  expect(state, timeoutMs = 10 * 60000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(state)
        reject(new Error('sign-in timed out'))
        this.maybeStop()
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(state, { resolve, reject, timer })
    })
  }

  handle(req, res) {
    const url = new URL(req.url ?? '/', this.redirectUrl)
    if (url.pathname !== '/callback') {
      res.statusCode = 404
      res.end()
      return
    }
    const state = url.searchParams.get('state') ?? ''
    const entry = this.pending.get(state)
    const page = (title, text) =>
      `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;padding:48px;color:#ddd;background:#1b1b1d"><h2>${title}</h2><p>${text}</p></body>`
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (entry === undefined) {
      res.statusCode = 400
      res.end(page('Unknown sign-in', 'This sign-in link expired or was already used. Start it again from DeepSeek Harness.'))
      return
    }
    this.pending.delete(state)
    clearTimeout(entry.timer)
    const error = url.searchParams.get('error')
    if (error) {
      res.end(page('Sign-in failed', `${error}: ${url.searchParams.get('error_description') ?? ''}`.replace(/[<>&]/g, '')))
      entry.reject(new Error(`authorization server answered ${error}`))
    } else {
      res.end(page('Signed in', 'You can close this tab and return to DeepSeek Harness.'))
      entry.resolve(url.searchParams)
    }
    this.maybeStop()
  }

  maybeStop() {
    if (this.pending.size > 0 || this.server === null) return
    const server = this.server
    this.server = null
    this.listening = null
    server.close()
  }

  close() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('hub stopped'))
    }
    this.pending.clear()
    this.maybeStop()
  }
}

/**
 * The SDK's `OAuthClientProvider` over one JSON file.
 * `interactive` is true only during an explicit sign-in.
 */
export class FileOAuthProvider {
  constructor({ server, url, dir, listener, onAuthRequired }) {
    this.server = server
    this.url = url
    this.dir = dir
    this.file = join(dir, `${server}.json`)
    this.listener = listener
    this.onAuthRequired = onAuthRequired
    this.interactive = false
    this.lastState = undefined
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    this.data = readJson(this.file) ?? {}
    if (!this.data.tokens && !this.data.imported) {
      const found = findMcpRemoteCredentials(url)
      if (found) {
        this.data = { client: found.client, tokens: found.tokens, imported: 'mcp-remote' }
        this.save()
      }
    }
  }

  save() {
    writeJson(this.file, this.data)
  }

  get signedIn() {
    return typeof this.data.tokens?.access_token === 'string'
  }

  get redirectUrl() {
    return this.listener.redirectUrl
  }

  get clientMetadata() {
    return {
      client_name: 'DeepSeek Harness MCP hub',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  state() {
    this.lastState = randomBytes(16).toString('hex')
    return this.lastState
  }

  clientInformation() {
    const client = this.data.client
    if (!client) return undefined
    // A registration made for another redirect URI cannot complete this sign-in.
    if (this.interactive && Array.isArray(client.redirect_uris) && !client.redirect_uris.includes(this.redirectUrl)) return undefined
    return client
  }

  saveClientInformation(info) {
    this.data.client = info
    this.save()
  }

  tokens() {
    return this.data.tokens
  }

  saveTokens(tokens) {
    this.data.tokens = tokens
    delete this.data.imported
    this.save()
  }

  saveCodeVerifier(verifier) {
    this.data.codeVerifier = verifier
    this.save()
  }

  codeVerifier() {
    if (!this.data.codeVerifier) throw new Error('no PKCE verifier saved')
    return this.data.codeVerifier
  }

  saveDiscoveryState(state) {
    this.data.discovery = state
    this.save()
  }

  discoveryState() {
    return this.data.discovery
  }

  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'client') delete this.data.client
    if (scope === 'all' || scope === 'tokens') delete this.data.tokens
    if (scope === 'all' || scope === 'verifier') delete this.data.codeVerifier
    if (scope === 'all' || scope === 'discovery') delete this.data.discovery
    this.save()
  }

  redirectToAuthorization(url) {
    if (this.interactive) {
      this.pendingUrl = String(url)
      return
    }
    this.onAuthRequired?.(String(url))
    throw new AuthRequiredError(this.server, String(url))
  }

  /** Forget everything; `imported` stops the next start from re-importing mcp-remote tokens. */
  signOut() {
    this.data = { imported: 'signed-out' }
    this.save()
  }

  /** Delete the file (server removed from the hub). */
  forget() {
    if (existsSync(this.file)) unlinkSync(this.file)
  }
}
