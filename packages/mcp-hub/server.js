/**
 * One configured MCP server: connection lifecycle, tool catalog, disk cache.
 *
 * Calls go through `ensure()`, so a stopped server (idle stop, connect-on-use,
 * crash) starts again on demand. The tool catalog survives restarts: it is
 * loaded from disk at construction and replaced only by a successful listing.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { AuthRequiredError, FileOAuthProvider } from './oauth.js'
import { followsLatest, planLaunch, updateCached } from './launcher.js'

const STDERR_TAIL = 4000

/** Fields whose change needs a new process / connection. */
export const CONNECTION_KEYS = ['transport', 'command', 'args', 'env', 'cwd', 'url', 'headers', 'launcher']

/** How often a directly launched `@latest` package is checked against the registry. */
export const UPDATE_CHECK_MS = 12 * 3600 * 1000

export function connectionSignature(cfg) {
  return JSON.stringify(CONNECTION_KEYS.map((k) => cfg[k]))
}

function catalogFile(dir, name) {
  return join(dir, 'catalog', `${name}.json`)
}

export class McpServer {
  /**
   * @param cfg - one entry of the hub's `servers` config.
   * @param deps - `{ install, dataDir, listener, logger, resolveValue, onChange }`.
   */
  constructor(cfg, deps) {
    this.cfg = cfg
    this.deps = deps
    this.name = cfg.name
    this.status = cfg.enabled === false ? 'disabled' : 'stopped'
    this.error = undefined
    this.authUrl = undefined
    this.client = undefined
    this.transport = undefined
    this.connecting = undefined
    this.stderr = ''
    this.idleTimer = undefined
    this.startedAt = undefined
    this.lastUsedAt = undefined
    this.calls = 0
    this.inflight = 0
    this.launch = undefined // { direct, version, spec, parsed } of the current process
    this.upgrade = undefined // { checking } | { from, to, updated, at } | { error, at }
    this.updateTimer = undefined
    this.restartWhenIdle = false
    this.closingOnPurpose = false
    this.disposed = false
    const cached = this.readCache()
    this.tools = cached?.tools ?? []
    this.instructions = cached?.instructions ?? ''
    this.serverInfo = cached?.serverInfo
    this.syncedAt = cached?.syncedAt
    this.fromCache = cached !== undefined
    this.oauth = cfg.transport === 'http' ? this.makeOAuth() : undefined
  }

  makeOAuth() {
    return new FileOAuthProvider({
      server: this.name,
      url: this.cfg.url,
      dir: join(this.deps.dataDir, 'oauth'),
      listener: this.deps.listener,
      onAuthRequired: (url) => {
        this.authUrl = url
      },
    })
  }

  readCache() {
    try {
      const data = JSON.parse(readFileSync(catalogFile(this.deps.dataDir, this.name), 'utf8'))
      return Array.isArray(data.tools) ? data : undefined
    } catch {
      return undefined
    }
  }

  writeCache() {
    try {
      mkdirSync(join(this.deps.dataDir, 'catalog'), { recursive: true })
      writeFileSync(
        catalogFile(this.deps.dataDir, this.name),
        `${JSON.stringify({ syncedAt: this.syncedAt, serverInfo: this.serverInfo, instructions: this.instructions, tools: this.tools }, null, 1)}\n`,
      )
    } catch (error) {
      this.deps.logger.warn(`mcp-hub(${this.name}): could not write catalog cache: ${error}`)
    }
  }

  get enabled() {
    return this.cfg.enabled !== false
  }

  get running() {
    return this.client !== undefined
  }

  /** Apply a new config entry; returns true when a restart is needed. */
  update(cfg) {
    const restart = connectionSignature(cfg) !== connectionSignature(this.cfg)
    const urlChanged = cfg.url !== this.cfg.url || cfg.transport !== this.cfg.transport
    this.cfg = cfg
    if (urlChanged) this.oauth = cfg.transport === 'http' ? this.makeOAuth() : undefined
    if (!this.enabled) {
      this.stop()
      this.status = 'disabled'
    } else if (this.status === 'disabled') {
      this.status = 'stopped'
    }
    this.scheduleIdle()
    return restart
  }

  async createTransport() {
    const { install, resolveValue } = this.deps
    const cfg = this.cfg
    const resolved = async (dict) => Object.fromEntries(await Promise.all(Object.entries(dict ?? {}).map(async ([k, v]) => [k, await resolveValue(v)])))
    if (cfg.transport === 'http') {
      if (!cfg.url) throw new Error('no URL configured')
      return new install.StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit: { headers: await resolved(cfg.headers) },
        authProvider: this.oauth,
      })
    }
    if (!cfg.command) throw new Error('no command configured')
    const plan = planLaunch(cfg, this.deps.npmCacheDir)
    this.launch = { direct: plan.direct, version: plan.version, spec: plan.parsed?.spec, parsed: plan.parsed }
    const transport = new install.StdioClientTransport({
      command: plan.command,
      args: plan.args,
      env: { ...install.scrubbedParentEnv(), ...plan.env, ...(await resolved(cfg.env)) },
      cwd: cfg.cwd || undefined,
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk) => {
      this.stderr = (this.stderr + String(chunk)).slice(-STDERR_TAIL)
    })
    return transport
  }

  /** Connected client, starting the server if needed. */
  async ensure() {
    if (this.disposed) throw new Error(`${this.name}: hub stopped`)
    if (!this.enabled) throw new Error(`MCP server "${this.name}" is disabled`)
    if (this.client) return this.client
    this.connecting ??= this.connect().finally(() => {
      this.connecting = undefined
    })
    return this.connecting
  }

  async connect() {
    const { install, logger } = this.deps
    this.status = 'starting'
    this.error = undefined
    this.stderr = ''
    this.deps.onChange(this, 'status')
    const client = new install.Client(
      { name: 'dsh-mcp-hub', version: '0.1.0' },
      {
        capabilities: {},
        versionNegotiation: { mode: 'auto' },
        listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: () => this.refreshTools(client) } },
      },
    )
    let transport
    try {
      transport = await this.createTransport()
      const timeoutMs = Math.max(1000, Number(this.cfg.startupTimeoutMs ?? this.deps.startupTimeoutMs?.() ?? 30000))
      await withTimeout(client.connect(transport), timeoutMs, `did not answer within ${Math.round(timeoutMs / 1000)} s`)
      this.serverInfo = client.getServerVersion?.() ?? this.serverInfo
      this.instructions = client.getInstructions?.()?.trimEnd() ?? ''
      await this.listTools(client)
    } catch (error) {
      await closeQuietly(client, transport)
      const auth = error instanceof AuthRequiredError || error?.name === 'UnauthorizedError' || /unauthori[sz]ed|401/i.test(String(error?.message))
      this.status = auth && this.oauth ? 'auth' : 'error'
      this.error = auth && this.oauth ? 'Sign-in required' : describeError(error, this.stderr)
      logger.warn(`mcp-hub(${this.name}): ${this.error}`)
      this.deps.onChange(this, 'status')
      throw new Error(`MCP server "${this.name}": ${this.error}`)
    }
    if (this.disposed) {
      await closeQuietly(client, transport)
      throw new Error(`${this.name}: hub stopped`)
    }
    this.client = client
    this.transport = transport
    this.startedAt = Date.now()
    this.status = 'running'
    this.authUrl = undefined
    client.onclose = () => {
      if (this.client !== client) return
      this.client = undefined
      this.transport = undefined
      if (this.closingOnPurpose || this.disposed) return
      this.status = 'error'
      this.error = describeError(new Error('connection closed'), this.stderr)
      logger.warn(`mcp-hub(${this.name}): connection lost; it restarts on the next call`)
      this.deps.onChange(this, 'status')
    }
    this.scheduleUpdateCheck()
    this.scheduleIdle()
    this.deps.onChange(this, 'status')
    return client
  }

  async listTools(client) {
    const response = client.getServerCapabilities()?.tools === undefined ? { tools: [] } : await client.listTools(undefined, { cacheMode: 'refresh' })
    const tools = response.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object' },
      ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
      ...(t.execution?.taskSupport === 'required' ? { taskRequired: true } : {}),
    }))
    const changed = JSON.stringify(tools) !== JSON.stringify(this.tools)
    this.tools = tools
    this.syncedAt = new Date().toISOString()
    this.fromCache = false
    this.writeCache()
    if (changed) this.deps.onChange(this, 'tools')
  }

  async refreshTools(client) {
    if (this.client !== client) return
    try {
      await this.listTools(client)
    } catch (error) {
      this.deps.logger.warn(`mcp-hub(${this.name}): tool re-sync failed: ${error}`)
    }
  }

  touch() {
    this.lastUsedAt = Date.now()
    this.calls += 1
    this.scheduleIdle()
  }

  scheduleIdle() {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    const minutes = Number(this.cfg.idleStopMinutes) || 0
    if (minutes <= 0 || !this.client) return
    this.idleTimer = setTimeout(() => {
      this.deps.logger.info(`mcp-hub(${this.name}): idle for ${minutes} min, stopping`)
      this.stop()
    }, minutes * 60000)
    this.idleTimer.unref?.()
  }

  async call(rawName, args, exec) {
    const client = await this.ensure()
    this.touch()
    this.inflight += 1
    const tool = this.tools.find((t) => t.name === rawName)
    try {
      return await client.callTool(
        { name: rawName, arguments: args },
        { signal: exec?.signal, timeout: Number(this.cfg.toolCallTimeoutMs) || 60000, ...(tool ? { toolDefinition: tool } : {}) },
      )
    } finally {
      this.inflight -= 1
      this.touch()
      if (this.restartWhenIdle && this.inflight === 0) this.applyUpdate()
    }
  }

  /**
   * Directly launched `@latest` packages are checked against the registry
   * once the last check is UPDATE_CHECK_MS old (immediately on first start).
   */
  scheduleUpdateCheck(delay) {
    clearTimeout(this.updateTimer)
    this.updateTimer = undefined
    const parsed = this.launch?.parsed
    if (this.disposed || !this.launch?.direct || !parsed || !followsLatest(parsed.range) || this.deps.updates === false) return
    const due = delay ?? Math.max(0, (this.upgrade?.at ?? 0) + UPDATE_CHECK_MS - Date.now())
    this.updateTimer = setTimeout(() => this.checkUpdate(), due)
    this.updateTimer.unref?.()
  }

  async checkUpdate() {
    const parsed = this.launch?.parsed ?? (this.cfg.transport === 'stdio' ? planLaunch(this.cfg, this.deps.npmCacheDir).parsed : undefined)
    if (!parsed) return { error: 'not an npx package' }
    if (this.upgrade?.checking) return this.upgrade
    this.upgrade = { ...this.upgrade, checking: true }
    this.deps.onChange(this, 'status')
    const result = await updateCached(this.cfg, parsed, this.deps.npmCacheDir)
    this.upgrade = { ...result, at: Date.now() }
    if (result.updated) {
      this.deps.logger.info(`mcp-hub(${this.name}): ${parsed.name} ${result.from} → ${result.to}`)
      this.restartWhenIdle = true
      if (this.inflight === 0) this.applyUpdate()
    }
    this.deps.onChange(this, 'status')
    this.scheduleUpdateCheck(UPDATE_CHECK_MS)
    return this.upgrade
  }

  applyUpdate() {
    this.restartWhenIdle = false
    if (this.running) this.restart().catch(() => {})
  }

  /** Resource provider for the mcpResources registry. */
  get resources() {
    return {
      request: async (request, exec) => {
        const client = await this.ensure()
        this.touch()
        const options = { signal: exec?.signal, timeout: Number(this.cfg.toolCallTimeoutMs) || 60000 }
        switch (request.method) {
          case 'resources/list':
            return client.listResources(request.cursor === undefined ? undefined : { cursor: request.cursor }, options)
          case 'resources/templates/list':
            return client.listResourceTemplates(request.cursor === undefined ? undefined : { cursor: request.cursor }, options)
          case 'resources/read':
            return client.readResource({ uri: request.uri }, options)
          default:
            throw new Error(`unsupported resource request ${request.method}`)
        }
      },
    }
  }

  async stop() {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    const client = this.client
    const transport = this.transport
    this.client = undefined
    this.transport = undefined
    if (this.status === 'running' || this.status === 'starting') this.status = 'stopped'
    if (client) {
      this.closingOnPurpose = true
      await closeQuietly(client, transport)
      this.closingOnPurpose = false
    }
    this.deps.onChange(this, 'status')
  }

  async restart() {
    await this.stop()
    if (this.connecting) await this.connecting.catch(() => {})
    return this.ensure()
  }

  /**
   * Interactive OAuth: returns `{ url }` once the browser leg is ready, and
   * finishes in the background when the browser comes back.
   */
  async signIn() {
    if (!this.oauth) throw new Error('this server does not use OAuth')
    const { install, listener } = this.deps
    await listener.start()
    this.oauth.interactive = true
    this.oauth.pendingUrl = undefined
    let result
    try {
      result = await install.auth(this.oauth, { serverUrl: new URL(this.cfg.url) })
    } finally {
      this.oauth.interactive = false
    }
    if (result === 'AUTHORIZED') {
      listener.maybeStop()
      await this.restart().catch(() => {})
      return { status: 'authorized' }
    }
    const state = this.oauth.lastState
    const url = this.oauth.pendingUrl
    if (!url || !state) throw new Error('the authorization server did not provide a sign-in URL')
    this.authUrl = url
    this.status = 'auth'
    this.deps.onChange(this, 'status')
    listener
      .expect(state)
      .then(async (params) => {
        this.oauth.interactive = true
        try {
          await install.auth(this.oauth, { serverUrl: new URL(this.cfg.url), authorizationCode: params.get('code'), iss: params.get('iss') ?? undefined })
        } finally {
          this.oauth.interactive = false
        }
        this.authUrl = undefined
        this.deps.logger.info(`mcp-hub(${this.name}): signed in`)
        await this.restart()
      })
      .catch((error) => {
        this.status = 'auth'
        this.error = `Sign-in failed: ${error?.message ?? error}`
        this.deps.onChange(this, 'status')
      })
    return { status: 'redirect', url }
  }

  async signOut() {
    if (!this.oauth) return
    this.oauth.signOut()
    await this.stop()
    this.status = 'auth'
    this.error = 'Signed out'
    this.deps.onChange(this, 'status')
  }

  async dispose({ forget = false } = {}) {
    this.disposed = true
    clearTimeout(this.updateTimer)
    await this.stop()
    if (forget) {
      this.oauth?.forget()
      const file = catalogFile(this.deps.dataDir, this.name)
      if (existsSync(file)) unlinkSync(file)
    }
  }

  /** Snapshot for the settings page. */
  view() {
    return {
      name: this.name,
      status: this.status,
      error: this.error,
      stderr: this.status === 'error' ? this.stderr.trim().split('\n').slice(-6).join('\n') : undefined,
      running: this.running,
      startedAt: this.startedAt,
      lastUsedAt: this.lastUsedAt,
      calls: this.calls,
      syncedAt: this.syncedAt,
      fromCache: this.fromCache,
      serverInfo: this.serverInfo ? { name: this.serverInfo.name, version: this.serverInfo.version, title: this.serverInfo.title } : undefined,
      hasInstructions: this.instructions.length > 0,
      launch: this.launch ? { direct: this.launch.direct, version: this.launch.version, npx: this.launch.parsed !== undefined } : undefined,
      update: this.upgrade
        ? { checking: this.upgrade.checking === true, from: this.upgrade.from, to: this.upgrade.to, updated: this.upgrade.updated === true, error: this.upgrade.error, at: this.upgrade.at }
        : undefined,
      oauth: this.oauth ? { signedIn: this.oauth.signedIn, imported: this.oauth.data.imported === 'mcp-remote', url: this.authUrl, scopes: String(this.oauth.data.tokens?.scope ?? '').split(/\s+/).filter(Boolean) } : undefined,
    }
  }
}

function withTimeout(promise, ms, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

async function closeQuietly(client, transport) {
  try {
    if (client?.transport !== undefined) await withTimeout(client.close(), 5000, 'close timeout')
    else await transport?.close()
  } catch {
    // already gone
  }
}

function describeError(error, stderr) {
  const message = String(error?.message ?? error)
  const tail = stderr
    ?.trim()
    .split('\n')
    .filter(Boolean)
    .slice(-1)[0]
  return tail && !message.includes(tail) ? `${message} — ${tail.slice(0, 300)}` : message
}
