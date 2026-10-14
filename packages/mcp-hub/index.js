/**
 * MCP hub: one Host plugin holding every configured MCP server.
 *
 * Each server is exposed one of two ways:
 * - eager — its tools are registered natively as `mcp__<server>__<tool>`
 *   (the same names and result handling as the built-in MCP client);
 * - lazy  — its tools appear only as catalog lines inside the `mcp_call`
 *   description; `mcp_describe` returns a full schema on demand.
 * `auto` picks eager when the server's schemas are small.
 *
 * Servers run in-process (HTTP, with OAuth) or as stdio children, start with
 * the Host, and restart on demand after an idle stop or a crash. The last
 * successful tool listing is cached on disk so tools are available before the
 * servers finish starting.
 */

import { homedir } from 'node:os'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { loadInstall } from './install.js'
import { McpServer } from './server.js'
import { CallbackListener, openExternal } from './oauth.js'
import {
  CALL_TOOL,
  DESCRIBE_TOOL,
  callToolParameters,
  contentText,
  describeServerText,
  describeText,
  describeToolParameters,
  effectiveMode,
  estimateToolTokens,
  estimateTokens,
  looksLikeArgumentError,
  publicToolName,
  renderCatalog,
  serverSummary,
  summaryLine,
} from './catalog.js'

export const name = 'mcp-hub'
export const inject = ['tools', 'webServer', 'connection']

export const STATUS_PATH = '/mcp-hub/status'
export const ACTION_PATH = '/mcp-hub/action'
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** Bumped on incompatible changes of the `mcpHub` service. */
export const SERVICE_VERSION = 1
const OWNER_ID = /^[A-Za-z0-9_.@/-]{1,64}$/

/** `'id'` or `{ id, title?, description? }` → a full owner record. */
export function normalizeOwner(owner) {
  const o = typeof owner === 'string' ? { id: owner } : (owner ?? {})
  if (typeof o.id !== 'string' || !OWNER_ID.test(o.id)) throw new TypeError(`mcpHub.register: owner id must match ${OWNER_ID}`)
  return {
    id: o.id,
    title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : o.id,
    description: typeof o.description === 'string' ? o.description.trim() : '',
  }
}

/** Why a contributed server cannot run, or undefined when it can. */
function invalidContribution(s) {
  if (s === null || typeof s !== 'object') return 'not an object'
  if (typeof s.name !== 'string' || !SERVER_NAME.test(s.name)) return `name must match ${SERVER_NAME}`
  const transport = s.transport ?? 'stdio'
  if (transport === 'http') {
    if (typeof s.url !== 'string' || !/^https?:\/\/\S+$/.test(s.url)) return 'http server needs an http(s) url'
  } else if (transport === 'stdio') {
    if (typeof s.command !== 'string' || s.command.trim() === '') return 'stdio server needs a command'
  } else return 'transport must be "stdio" or "http"'
  if (s.mode !== undefined && !['eager', 'lazy', 'auto'].includes(s.mode)) return 'mode must be eager, lazy or auto'
  return undefined
}

export const SERVER_DEFAULTS = {
  enabled: true,
  mode: 'auto',
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
  cwd: '',
  url: '',
  headers: {},
  idleStopMinutes: 0,
  connectAtStartup: true,
  catalog: 'full',
  instructions: 'auto',
  description: '',
  toolCallTimeoutMs: 60000,
  launcher: 'direct',
}

export const DEFAULTS = {
  servers: [],
  autoEagerMaxTokens: 2500,
  startupTimeoutMs: 30000,
  catalogLineChars: 120,
  oauthCallbackPort: 33419,
}

export function buildConfig(z) {
  const oneOf = (...values) => z.union(values.map((v) => z.const(v)))
  const Server = z.object({
    name: z.string().pattern(SERVER_NAME).required(),
    enabled: z.boolean().default(true),
    mode: oneOf('eager', 'lazy', 'auto').default('auto'),
    transport: oneOf('stdio', 'http').default('stdio'),
    command: z.string().default(''),
    args: z.array(String).default([]),
    env: z.dict(String).default({}),
    cwd: z.string().default(''),
    url: z.string().default(''),
    headers: z.dict(String).default({}),
    idleStopMinutes: z.number().min(0).max(1440).default(0),
    connectAtStartup: z.boolean().default(true),
    catalog: oneOf('full', 'names').default('full'),
    instructions: oneOf('auto', 'full', 'summary', 'off').default('auto'),
    description: z.string().default(''),
    toolCallTimeoutMs: z.number().min(1000).max(3600000).default(60000),
    // direct: an `npx <package>` server already in the npx cache runs as `node <bin>`.
    launcher: oneOf('direct', 'npx').default('direct'),
  })
  return z.object({
    servers: z.array(Server).default([]).volatile(),
    autoEagerMaxTokens: z.number().min(0).max(1000000).default(DEFAULTS.autoEagerMaxTokens).volatile(),
    startupTimeoutMs: z.number().min(1000).max(600000).default(DEFAULTS.startupTimeoutMs).volatile(),
    catalogLineChars: z.number().min(40).max(1000).default(DEFAULTS.catalogLineChars).volatile(),
    oauthCallbackPort: z.number().min(0).max(65535).default(DEFAULTS.oauthCallbackPort),
  })
}

const install = await loadInstall()
export const Config = install.z === undefined ? undefined : buildConfig(install.z)

const isRef = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.get === 'function'
const plain = (v) => (isRef(v) ? plain(v.get()) : v)

export function resolveConfig(config) {
  const raw = config ?? {}
  const out = {}
  for (const key of Object.keys(DEFAULTS)) {
    const v = plain(raw[key])
    out[key] = v === undefined ? DEFAULTS[key] : v
  }
  const seen = new Set()
  out.servers = (Array.isArray(out.servers) ? out.servers : [])
    .map((s) => ({ ...SERVER_DEFAULTS, ...s }))
    .filter((s) => typeof s.name === 'string' && SERVER_NAME.test(s.name) && !seen.has(s.name) && seen.add(s.name))
  return out
}

/** Where the hub keeps catalogs and OAuth state: the profile directory when known. */
export function dataDirectory() {
  let base = process.env.DSH_PROFILE_DIR
  if (!base) {
    base = process.argv.find((a) => typeof a === 'string' && isAbsolute(a) && /[\\/]profiles[\\/][^\\/]+$/.test(a) && existsSync(a) && statSync(a).isDirectory())
  }
  if (!base) base = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(base, 'mcp-hub')
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readBody(req, limit = 64 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function guarded(ctx, methods, handle) {
  return async (req, res) => {
    const rejection = Reflect.get(ctx, 'connection').requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if (!methods.includes(req.method)) {
      res.setHeader('allow', methods.join(', '))
      sendJson(res, 405, { ok: false, message: `${methods.join(' or ')} only` })
      return
    }
    try {
      await handle(req, res)
    } catch (error) {
      sendJson(res, 500, { ok: false, message: String(error?.message ?? error) })
    }
  }
}

/**
 * The hub. Exported for tests; `apply` wires it to a Cordis context.
 * @param ctx - Host plugin context (tools, logger, optional services via ctx.get).
 * @param readConfig - returns the resolved config on every call (volatile).
 * @param deps - `{ install, dataDir }`.
 */
export class Hub {
  constructor(ctx, readConfig, deps) {
    this.ctx = ctx
    this.readConfig = readConfig
    this.install = deps.install
    this.dataDir = deps.dataDir
    this.npmCacheDir = deps.npmCacheDir
    this.updates = deps.updates
    this.servers = new Map()
    this.eager = new Map() // public name -> { signature, dispose }
    this.meta = { signature: undefined, disposers: [] }
    this.contexts = new Map() // server -> [disposers]
    this.publishQueued = false
    this.disposed = false
    this.contributors = new Map() // owner id -> { id, title, description, servers, rejected }
    this.listeners = new Set()
    /** Optional services, set while their scopes are alive (see apply). */
    this.services = { resources: undefined, prompt: undefined }
    this.listener = new CallbackListener(Number(readConfig().oauthCallbackPort) || 0, ctx.logger)
  }

  get config() {
    return this.readConfig()
  }

  serverDeps() {
    return {
      install: this.install,
      dataDir: this.dataDir,
      npmCacheDir: this.npmCacheDir,
      updates: this.updates,
      listener: this.listener,
      logger: this.ctx.logger,
      startupTimeoutMs: () => this.config.startupTimeoutMs,
      resolveValue: (v) => this.resolveValue(v),
      onChange: (_server, what) => {
        if (what === 'tools' || what === 'status') this.schedulePublish()
      },
    }
  }

  /** `$cred:NAME` → the credential's value; anything else is literal. */
  async resolveValue(value) {
    const match = typeof value === 'string' ? value.match(/^\$cred:([A-Za-z0-9_.-]+)$/) : null
    if (!match) return value
    const credentials = this.ctx.get?.('credentials')
    try {
      const resolved = await credentials?.resolve(match[1])
      if (resolved?.value !== undefined) return resolved.value
    } catch {
      // fall through
    }
    const ambient = process.env[match[1]]
    if (ambient) return ambient
    throw new Error(`credential ${match[1]} is not set`)
  }

  /**
   * Servers a plugin contributes (see the `mcpHub` service). Replaces that
   * owner's previous list; an empty list withdraws them. Invalid entries are
   * kept aside with a reason instead of throwing, so one bad entry does not
   * take the owner's other servers down.
   */
  setContributed(ownerInput, servers) {
    const owner = normalizeOwner(ownerInput)
    const accepted = []
    const rejected = []
    const seen = new Set()
    for (const raw of Array.isArray(servers) ? servers : []) {
      const reason = invalidContribution(raw)
      if (reason) rejected.push({ name: String(raw?.name ?? '?'), reason })
      else if (seen.has(raw.name)) rejected.push({ name: raw.name, reason: 'duplicate name in this list' })
      else {
        seen.add(raw.name)
        accepted.push({ ...SERVER_DEFAULTS, ...raw, owner: owner.id })
      }
    }
    if (accepted.length === 0 && rejected.length === 0) this.contributors.delete(owner.id)
    else this.contributors.set(owner.id, { ...owner, servers: accepted, rejected })
    return this.reconcile()
  }

  /**
   * Who runs under each name. The user's own servers come first; plugin
   * servers follow in registration order, and a name that is already taken
   * is reported as a conflict on the plugin that came later.
   */
  plan() {
    const wanted = new Map(this.config.servers.map((s) => [s.name, s]))
    const conflicts = new Map() // owner id -> [{ name, reason }]
    for (const [id, contributor] of this.contributors) {
      for (const s of contributor.servers) {
        if (!wanted.has(s.name)) {
          wanted.set(s.name, s)
          continue
        }
        const holder = wanted.get(s.name).owner
        const reason = holder === undefined ? 'name used by a server in this hub' : `name used by ${this.contributors.get(holder)?.title ?? holder}`
        conflicts.set(id, [...(conflicts.get(id) ?? []), { name: s.name, reason }])
      }
    }
    return { wanted, conflicts }
  }

  wantedServers() {
    return this.plan().wanted
  }

  /** Does the model see this server's tools, catalog, resources and instructions? */
  exposed(server) {
    return server.enabled && server.cfg.expose !== false
  }

  /** Bring the running set in line with the config. */
  reconcile() {
    if (this.disposed) return []
    const wanted = this.wantedServers()
    const started = []
    for (const [n, server] of this.servers) {
      if (!wanted.has(n)) {
        this.servers.delete(n)
        this.dropContext(n)
        // OAuth state and the catalog stay on disk: the same server may come
        // back (a plugin reload, an undo), and only Sign out forgets a login.
        server.dispose()
      }
    }
    for (const cfg of wanted.values()) {
      const existing = this.servers.get(cfg.name)
      if (existing === undefined) {
        const server = new McpServer(cfg, this.serverDeps())
        this.servers.set(cfg.name, server)
        this.addContext(server)
        if (server.enabled && cfg.connectAtStartup !== false) started.push(server.ensure().catch(() => {}))
      } else {
        const wasEnabled = existing.enabled
        const wasExposed = this.exposed(existing)
        const restart = existing.update(cfg)
        if (wasExposed !== this.exposed(existing)) {
          this.dropContext(cfg.name)
          this.addContext(existing)
        }
        if (restart || (!wasEnabled && existing.enabled)) {
          if (existing.enabled && (existing.running || cfg.connectAtStartup !== false)) started.push(existing.restart().catch(() => {}))
        }
      }
    }
    // keep config order
    this.servers = new Map([...wanted.keys()].filter((n) => this.servers.has(n)).map((n) => [n, this.servers.get(n)]))
    this.schedulePublish()
    return started
  }

  /** Resources and instructions for one server, for as long as it is configured. */
  addContext(server) {
    const disposers = []
    this.contexts.set(server.name, disposers)
    if (server.cfg.expose === false) return
    const resources = this.services.resources
    if (resources) {
      try {
        disposers.push(resources.register(server.name, server.resources))
      } catch (error) {
        this.ctx.logger.warn(`mcp-hub(${server.name}): resources not registered: ${error}`)
      }
    }
    const prompt = this.services.prompt
    if (prompt) {
      try {
        disposers.push(
          prompt.section({
            name: `mcp:${server.name}`,
            order: prompt.getSectionOrder('MCP_SERVERS'),
            interpolate: false,
            text: () => this.instructionsFor(server),
          }),
        )
      } catch (error) {
        this.ctx.logger.warn(`mcp-hub(${server.name}): instructions not registered: ${error}`)
      }
    }
  }

  /** A service scope came or went: rebuild every server's context registrations. */
  setService(key, value) {
    for (const n of [...this.contexts.keys()]) this.dropContext(n)
    this.services[key] = value
    if (!this.disposed) for (const server of this.servers.values()) this.addContext(server)
  }

  dropContext(serverName) {
    for (const dispose of this.contexts.get(serverName) ?? []) {
      try {
        dispose?.()
      } catch {
        // already gone
      }
    }
    this.contexts.delete(serverName)
  }

  modeOf(server) {
    return effectiveMode(server.cfg.mode, server.tools, Number(this.config.autoEagerMaxTokens) || 0)
  }

  instructionsFor(server) {
    if (!this.exposed(server) || !server.instructions) return ''
    let level = server.cfg.instructions
    if (level === 'auto') level = this.modeOf(server) === 'eager' ? 'full' : 'summary'
    if (level === 'off') return ''
    // A lazy server's summary already heads its catalog in mcp_call.
    if (level === 'summary') return ''
    return `### MCP server: ${server.name}\n\n${server.instructions}`
  }

  schedulePublish() {
    if (this.publishQueued || this.disposed) return
    this.publishQueued = true
    queueMicrotask(() => {
      this.publishQueued = false
      this.publish()
    })
  }

  /** Register / unregister tools so the model sees exactly the current plan. */
  publish() {
    if (this.disposed) return
    const wantedEager = new Map()
    const lazy = []
    for (const server of this.servers.values()) {
      if (!this.exposed(server)) continue
      if (this.modeOf(server) === 'eager') {
        for (const tool of server.tools) wantedEager.set(publicToolName(server.name, tool.name), { server, tool })
      } else {
        lazy.push(server)
      }
    }
    // eager: dispose what vanished or changed, register what is new
    for (const [publicName, entry] of this.eager) {
      const want = wantedEager.get(publicName)
      if (want === undefined || signature(want) !== entry.signature) {
        entry.dispose()
        this.eager.delete(publicName)
      }
    }
    for (const [publicName, want] of wantedEager) {
      if (this.eager.has(publicName)) continue
      try {
        const dispose = this.ctx.tools.register(this.eagerDefinition(publicName, want.server, want.tool))
        this.eager.set(publicName, { signature: signature(want), dispose })
      } catch (error) {
        this.ctx.logger.warn(`mcp-hub(${want.server.name}): could not register ${publicName}: ${error?.message ?? error}`)
      }
    }
    // lazy: two meta tools whose text carries the catalog
    const lineChars = Number(this.config.catalogLineChars) || DEFAULTS.catalogLineChars
    const catalog = lazy.map((s) => ({ name: s.name, summary: serverSummary(s), catalog: s.cfg.catalog, tools: s.tools }))
    const metaSignature = lazy.length === 0 ? undefined : JSON.stringify([catalog.map((c) => [c.name, c.summary, c.catalog, c.tools.map((t) => [t.name, t.description])]), lineChars])
    if (metaSignature !== this.meta.signature) {
      for (const dispose of this.meta.disposers) dispose()
      this.meta = { signature: metaSignature, disposers: [], tokens: 0 }
      if (metaSignature !== undefined) {
        const names = lazy.map((s) => s.name)
        const description = renderCatalog(catalog, lineChars)
        try {
          this.meta.disposers.push(this.ctx.tools.register(this.callDefinition(description, names)))
          this.meta.disposers.push(this.ctx.tools.register(this.describeDefinition(names)))
          this.meta.tokens = Math.ceil((description.length + 900) / 4)
        } catch (error) {
          this.ctx.logger.error(`mcp-hub: could not register ${CALL_TOOL}/${DESCRIBE_TOOL}: ${error?.message ?? error}`)
        }
      }
    }
    this.notify()
  }

  eagerDefinition(publicName, server, tool) {
    return this.install.createMcpToolDefinition(this.ctx, {
      name: publicName,
      rawName: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      taskRequired: tool.taskRequired === true,
      call: (args, exec) => server.call(tool.name, args, exec),
    })
  }

  lazyTarget(serverName, toolName) {
    const server = this.servers.get(serverName)
    if (server === undefined || !this.exposed(server)) {
      throw new Error(`Unknown MCP server "${serverName}". Available: ${[...this.servers.values()].filter((s) => this.exposed(s)).map((s) => s.name).join(', ')}`)
    }
    if (toolName === undefined) return { server }
    const tool = server.tools.find((t) => t.name === toolName)
    if (tool === undefined) {
      throw new Error(`Server "${serverName}" has no tool "${toolName}". Its tools: ${server.tools.map((t) => t.name).join(', ') || '(none reported yet)'}`)
    }
    return { server, tool }
  }

  callDefinition(description, serverNames) {
    const inner = new Map() // `${server}\0${tool}` -> definition
    const owners = new WeakMap() // exec -> inner definition
    const innerFor = (server, tool) => {
      const key = `${server.name}\0${tool.name}\0${signature({ server, tool })}`
      if (!inner.has(key)) inner.set(key, this.eagerDefinition(`${server.name}.${tool.name}`, server, tool))
      return inner.get(key)
    }
    return {
      name: CALL_TOOL,
      description,
      parameters: callToolParameters(serverNames),
      output: {
        schema: {
          type: 'object',
          properties: { content: { type: 'array', items: {} }, structuredContent: {} },
          required: ['content'],
          additionalProperties: false,
        },
        render: (args, value) => [{ type: 'text', text: contentText(value?.content, args?.tool ?? CALL_TOOL) }],
      },
      execute: async (args, exec) => {
        const { server, tool } = this.lazyTarget(args.server, args.tool)
        const definition = innerFor(server, tool)
        try {
          const value = await definition.execute(args.args ?? {}, exec)
          owners.set(exec, definition)
          return value
        } catch (error) {
          const message = String(error?.message ?? error)
          if (looksLikeArgumentError(message)) {
            throw new Error(`${message}\n\nInput schema of ${server.name}/${tool.name}:\n${JSON.stringify(tool.inputSchema, null, 2)}`)
          }
          throw error
        }
      },
      projectContent: (exec, result) => owners.get(exec)?.projectContent?.(exec, result),
    }
  }

  describeDefinition(serverNames) {
    return {
      name: DESCRIBE_TOOL,
      description: `Get the full description and input schema of a tool listed in ${CALL_TOOL}, or every tool description of one server.`,
      parameters: describeToolParameters(serverNames),
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (args) => {
        const { server, tool } = this.lazyTarget(args.server, args.tool || undefined)
        if (tool) return describeText(server.name, tool)
        return describeServerText(server.name, serverSummary(server), server.tools)
      },
    }
  }

  status() {
    const config = this.config
    let eagerTokens = 0
    const servers = []
    const { wanted, conflicts } = this.plan()
    for (const cfg of wanted.values()) {
      const server = this.servers.get(cfg.name)
      if (server === undefined) continue
      const mode = this.modeOf(server)
      const tokens = estimateTokens(server.tools)
      const exposed = this.exposed(server)
      if (exposed && mode === 'eager') eagerTokens += tokens
      servers.push({
        ...server.view(),
        enabled: server.enabled,
        exposed,
        ...(cfg.owner === undefined ? {} : { owner: cfg.owner }),
        url: cfg.transport === 'http' ? cfg.url : undefined,
        transport: cfg.transport,
        mode: cfg.mode,
        effectiveMode: mode,
        tokens,
        catalogTokens: exposed && mode === 'lazy' ? Math.ceil(renderCatalog([{ name: server.name, summary: serverSummary(server), catalog: cfg.catalog, tools: server.tools }], config.catalogLineChars).length / 4) : 0,
        summary: serverSummary(server),
        tools: server.tools.map((t) => ({ name: t.name, summary: summaryLine(t.description, 160), tokens: estimateToolTokens(t) })),
      })
    }
    return {
      ok: true,
      missing: this.install.missing,
      eagerTokens,
      lazyTokens: this.meta.tokens ?? 0,
      autoEagerMaxTokens: config.autoEagerMaxTokens,
      servers,
      contributors: [...this.contributors.values()].map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        servers: c.servers.map((s) => s.name).filter((n) => wanted.get(n)?.owner === c.id),
        problems: [...c.rejected, ...(conflicts.get(c.id) ?? [])],
      })),
    }
  }

  /** Raw `tools/call` for another plugin (exposed or not); starts the server if needed. */
  async callRaw(serverName, toolName, args, options = {}) {
    const server = this.servers.get(serverName)
    if (server === undefined || !server.enabled) throw new Error(`MCP server "${serverName}" is not available`)
    return server.call(toolName, args ?? {}, { signal: options.signal })
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        this.ctx.logger.warn(`mcp-hub: change listener failed: ${error}`)
      }
    }
  }

  /** The `mcpHub` service other plugins inject; documented in types/mcp-hub.d.ts. */
  service() {
    const views = () => this.status()
    return Object.freeze({
      version: SERVICE_VERSION,
      register: (owner, servers) => {
        const id = normalizeOwner(owner).id
        this.setContributed(owner, servers)
        let live = true
        const dispose = () => {
          if (!live) return
          live = false
          this.setContributed(id, [])
        }
        dispose.dispose = dispose
        dispose.update = (next) => {
          if (live) this.setContributed(owner, next)
        }
        Object.defineProperty(dispose, 'problems', { get: () => views().contributors.find((c) => c.id === id)?.problems ?? [] })
        return dispose
      },
      servers: (filter = {}) => views().servers.filter((s) => filter.owner === undefined || s.owner === filter.owner),
      status: (name) => views().servers.find((s) => s.name === name),
      action: (name, action) => this.action({ server: name, action }),
      call: (name, tool, args, options) => this.callRaw(name, tool, args, options),
      onChange: (listener) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
    })
  }

  async action({ server: serverName, action }) {
    const server = this.servers.get(serverName)
    if (server === undefined) return { ok: false, message: `unknown server ${serverName}` }
    switch (action) {
      case 'restart':
        await server.restart()
        return { ok: true }
      case 'stop':
        await server.stop()
        return { ok: true }
      case 'refresh': {
        const client = await server.ensure()
        await server.listTools(client)
        return { ok: true }
      }
      case 'signin': {
        const result = await server.signIn()
        if (result.url && this.openExternal) this.openExternal(result.url)
        return { ok: true, ...result }
      }
      case 'signout':
        await server.signOut()
        return { ok: true }
      case 'update': {
        const result = await server.checkUpdate()
        return result?.error ? { ok: false, message: result.error } : { ok: true, ...result }
      }
      default:
        return { ok: false, message: `unknown action ${action}` }
    }
  }

  async dispose() {
    this.disposed = true
    for (const entry of this.eager.values()) entry.dispose()
    this.eager.clear()
    for (const dispose of this.meta.disposers) dispose()
    this.meta = { signature: undefined, disposers: [] }
    for (const n of [...this.contexts.keys()]) this.dropContext(n)
    this.listener.close()
    await Promise.all([...this.servers.values()].map((s) => s.dispose()))
  }
}

function signature({ server, tool }) {
  return JSON.stringify([server.name, tool])
}

export async function apply(ctx, config) {
  if (install.missing.length > 0) {
    ctx.logger.error(`mcp-hub: this Harness lacks ${install.missing.join(', ')}; the hub is inactive`)
  }
  const readConfig = () => resolveConfig(config)
  const hub = new Hub(ctx, readConfig, { install, dataDir: dataDirectory() })
  hub.openExternal = openExternal

  ctx.effect(() => () => hub.dispose(), 'mcp-hub: servers')
  // Other plugins (Opfield) own servers through this service.
  ctx.provide('mcpHub', hub.service())
  ctx.on('loader/volatile-update', () => {
    hub.reconcile()
  })

  ctx.inject(['mcpResources'], (scope) => {
    hub.setService('resources', scope.mcpResources)
    scope.effect(() => () => hub.setService('resources', undefined), 'mcp-hub: resources')
  })
  ctx.inject(['systemPrompt'], (scope) => {
    hub.setService('prompt', scope.systemPrompt)
    scope.effect(() => () => hub.setService('prompt', undefined), 'mcp-hub: instructions')
  })

  ctx.inject(['settings'], (scope) => {
    scope.effect(() => {
      try {
        return scope.settings.configure({ auto: false }, ctx.fiber)
      } catch {
        return () => {}
      }
    }, 'mcp-hub: settings presentation')
  })

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: STATUS_PATH, handler: guarded(ctx, ['GET'], async (_req, res) => sendJson(res, 200, hub.status())) }),
    `mcp-hub: ${STATUS_PATH}`,
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ACTION_PATH,
        handler: guarded(ctx, ['POST'], async (req, res) => {
          const body = await readBody(req)
          try {
            sendJson(res, 200, await hub.action(body))
          } catch (error) {
            sendJson(res, 200, { ok: false, message: String(error?.message ?? error) })
          }
        }),
      }),
    `mcp-hub: ${ACTION_PATH}`,
  )

  if (install.missing.length > 0) return
  const started = hub.reconcile()
  // Wait (bounded) only for servers the model cannot see yet: no cached catalog.
  const blocking = [...hub.servers.values()].filter((s) => s.enabled && !s.fromCache && s.cfg.connectAtStartup !== false)
  if (blocking.length > 0) {
    const limit = readConfig().startupTimeoutMs
    await Promise.race([Promise.all(started), new Promise((r) => setTimeout(r, limit).unref?.())])
    hub.publish()
  }
}
