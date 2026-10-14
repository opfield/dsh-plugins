/**
 * Host half of the Opfield bundle.
 *
 * Opfield instances live in this plugin's config. Each one becomes a server
 * of the MCP hub (service `mcpHub`): the hub owns the OAuth sign-in and the
 * MCP session, and this plugin uses that session for the rest:
 * - the budget pill reads `manage_inference_usage self` of the instance that
 *   serves inference (exactly one, or none);
 * - picking that instance points the llm-pi-ai route at it, issues an
 *   inference token through `manage_inference_token create` when the route
 *   has no key yet, and syncs the model list (model-sync.js).
 *
 * It also folds a per-Session prompt-cache warmth projection for the timer.
 */

import { hostname } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { syncModels } from './model-sync.js'
import {
  ADVANCED_DEFAULTS,
  COMPONENTS,
  DEFAULTS,
  INFERENCE_SCOPE,
  NAME_RE,
  hubServerOf,
  inferenceAllowed,
  inferenceBaseURL,
  issuedToken,
  keyRefOf,
  resolveConfig as resolveRaw,
  resultData,
  resultError,
  routeOps,
  sourceOf,
} from './instances.js'

export { COMPONENTS, DEFAULTS } from './instances.js'

export const name = 'opfield-usage'
export const inject = ['webServer', 'connection']

/** Settings namespace of this plugin's own entry. */
export const ENTRY_ID = 'opfield-usage'
export const ROUTE_PATH = '/opfield-usage/self'
export const STATUS_PATH = '/opfield-usage/status'
export const ACTION_PATH = '/opfield-usage/action'
/** How this plugin appears on the MCP hub page. */
export const HUB_OWNER = {
  id: 'opfield',
  title: 'Opfield',
  description: 'Opfield instances. Add, change or remove them in Plugins → Opfield.',
}
const DEFAULT_MODEL_ENTRY = 'agent-default-model'

/**
 * The Config schema. Every field is `.volatile()`: the Settings service only
 * offers volatile fields to forms, and a volatile change is committed into the
 * running plugin without a remount.
 */
export function buildConfig(z) {
  const A = ADVANCED_DEFAULTS
  const oneOf = (...values) => z.union(values.map((v) => z.const(v)))
  const num = (v, min, max) => {
    let s = z.number()
    if (min !== undefined) s = s.min(min)
    if (max !== undefined) s = s.max(max)
    return s.default(v).volatile()
  }
  const bool = (v) => z.boolean().default(v).volatile()
  const Instance = z.object({
    name: z.string().pattern(NAME_RE).required(),
    url: z.string().required(),
    mcp: z.boolean().default(true),
    // Filled by the plugin: where the inference token lives, and its Opfield id when the plugin issued it.
    keyRef: z.string(),
    tokenId: z.string(),
  })
  return z.object({
    instances: z.array(Instance).default([]).volatile(),
    inference: z.string().default('').volatile(),
    promptCacheTtlMinutes: num(DEFAULTS.promptCacheTtlMinutes, 1, 1440),
    compactMinTokens: num(DEFAULTS.compactMinTokens, 0),
    advanced: z.object({
      piAiEntry: z.string().default(A.piAiEntry).volatile(),
      route: z.string().default(A.route).volatile(),
      pollSeconds: num(A.pollSeconds, 15, 3600),
      warnPercent: num(A.warnPercent, 0, 100),
      errorPercent: num(A.errorPercent, 0, 100),
      syncIntervalMinutes: num(A.syncIntervalMinutes, 0, 10080),
      include: z.array(String).default(A.include).volatile(),
      exclude: z.array(String).default(A.exclude).volatile(),
      cacheMs: num(A.cacheMs, 0, 3600000),
      timeoutMs: num(A.timeoutMs, 1000, 120000),
    }),
  })
}

/**
 * Schemastery from the running Harness installation. A profile bundle has no
 * dependencies of its own, so resolve it beside the Host entry script.
 */
async function loadSchemastery() {
  for (const arg of process.argv.slice(1)) {
    if (typeof arg !== 'string' || !isAbsolute(arg)) continue
    const base = /\.[cm]?js$/.test(arg) ? arg : join(arg, 'package.json')
    try {
      const manifest = createRequire(base).resolve('@deepseek-ai/schemastery/package.json')
      const mod = await import(pathToFileURL(join(dirname(manifest), 'lib', 'index.mjs')).href)
      const z = mod.default ?? mod.Schema
      if (typeof z?.object === 'function') return z
    } catch {
      // try the next candidate
    }
  }
  return undefined
}

const schemastery = await loadSchemastery()

/** Without Schemastery (tests, odd launchers) the plugin runs on defaults + raw config. */
export const Config = schemastery === undefined ? undefined : buildConfig(schemastery)

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isRef = (v) => isPlainObject(v) && typeof v.get === 'function'

/** Unwrap volatile references (any depth) into plain data. */
function plain(v) {
  if (isRef(v)) return plain(v.get())
  if (Array.isArray(v)) return v.map(plain)
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
  return v
}

/** The effective configuration right now (volatile references unwrapped). */
export function resolveConfig(config) {
  return resolveRaw(plain(config ?? {}))
}

/**
 * What the browser's pills need besides the usage reading. `active` holds the
 * components whose sub-plugins are enabled in Plugins.
 */
export function publicConfig(cfg, active = new Set(COMPONENTS)) {
  const source = sourceOf(cfg)
  const a = cfg.advanced
  return {
    source: source?.name ?? null,
    // The budget pill shows only while the chat's model is on this route.
    providers: source ? [a.route] : [],
    cacheTtlMs: Math.max(1, Number(cfg.promptCacheTtlMinutes) || DEFAULTS.promptCacheTtlMinutes) * 60000,
    compactSuggestion: { enabled: active.has('compactSuggestion'), minTokens: cfg.compactMinTokens },
    display: {
      usagePill: active.has('usagePill') && source !== undefined,
      cachePill: active.has('cachePill'),
      pollSeconds: a.pollSeconds,
      warnPercent: a.warnPercent,
      errorPercent: a.errorPercent,
    },
  }
}

/** Session projection key carrying the prompt-cache warmth facts to the browser. */
export const CACHE_WARM_KEY = 'promptCacheWarm'

const nonNegOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)

/** Minimal parse-only schema (the projection registry only calls `.parse`). */
const cacheWarmSchema = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !nonNegOrNull(value.lastRequestAt) ||
      !nonNegOrNull(value.lastResponseAt) ||
      !nonNegOrNull(value.lastCompactionAt) ||
      typeof value.running !== 'boolean' ||
      !nonNegOrNull(value.cacheReadTokens) ||
      !nonNegOrNull(value.cacheWriteTokens)
    ) {
      throw new TypeError('promptCacheWarm: invalid state')
    }
    return value
  },
}

function usageNumber(usage, key) {
  if (typeof usage !== 'object' || usage === null) return null
  const v = usage[key]
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/**
 * Fold of one Session's own log (subagents are separate Sessions, so their
 * requests never move this Session's timer): when the last model request
 * was sent, whether a turn is still running, and the cache figures the
 * provider reported for that request. The state is its own wire view.
 */
export const cacheWarmProjection = {
  key: CACHE_WARM_KEY,
  stateVersion: 2,
  stateSchema: cacheWarmSchema,
  init: () => ({ lastRequestAt: null, lastResponseAt: null, lastCompactionAt: null, running: false, cacheReadTokens: null, cacheWriteTokens: null }),
  apply(state, event) {
    switch (event.type) {
      case 'turn/start':
        return state.running ? state : { ...state, running: true }
      case 'step/start':
      case 'llm/retry-started':
        return { ...state, running: true, lastRequestAt: event.time }
      case 'assistant/message': {
        const usage = event.data?.usage
        return {
          ...state,
          lastResponseAt: event.time,
          cacheReadTokens: usageNumber(usage, 'cacheReadTokens') ?? state.cacheReadTokens,
          cacheWriteTokens: usageNumber(usage, 'cacheWriteTokens') ?? state.cacheWriteTokens,
        }
      }
      case 'turn/end':
        return state.running ? { ...state, running: false } : state
      // The history prefix was replaced: the old cache is useless either way.
      case 'compaction/summary':
        return { ...state, lastCompactionAt: event.time }
      default:
        return state
    }
  },
  wire: { viewSchema: cacheWarmSchema, view: (state) => state },
}
const WINDOW_ORDER = ['5h', '7d', '30d']

/** Clamp a number into [0, 100]; non-numbers become null. */
function pct(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
}

/**
 * Normalize Opfield's self-usage document into display windows. Windows the
 * user's policy does not enable (`configured: false`) are dropped: Opfield
 * reports them as 100% when the limit is zero, which is not real pressure.
 */
export function normalizeUsage(doc) {
  const windows = []
  const sub = doc && typeof doc.subscription === 'object' && doc.subscription !== null ? doc.subscription : {}
  for (const id of WINDOW_ORDER) {
    const w = sub[id]
    if (!w || w.configured !== true) continue
    windows.push({
      id,
      kind: 'subscription',
      percentage: pct(w.percentage) ?? 0,
      active: w.active !== false,
      recoveryAt: typeof w.recoveryAt === 'string' ? w.recoveryAt : null,
    })
  }
  const api = doc?.api
  if (api && api.configured === true) {
    windows.push({
      id: 'api',
      kind: 'api',
      percentage: pct(api.percentage) ?? 0,
      active: api.active !== false,
      recoveryAt: typeof api.recoveryAt === 'string' ? api.recoveryAt : null,
    })
  }
  return {
    ok: true,
    enabled: doc?.enabled !== false,
    measuredAt: typeof doc?.measuredAt === 'string' ? doc.measuredAt : new Date().toISOString(),
    windows,
  }
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

/** An Error carrying a short machine code for the browser. */
function coded(code, message) {
  const error = new Error(message)
  error.code = code
  return error
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

/** Shared guard + method dispatch for the trusted routes. */
function guarded(scope, methods, handle) {
  return async (req, res) => {
    const rejection = Reflect.get(scope, 'connection').requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if (!methods.includes(req.method)) {
      res.setHeader('allow', methods.join(', '))
      sendJson(res, 405, failure('method-not-allowed', methods.join(' or ')))
      return
    }
    try {
      await handle(req, res)
    } catch (error) {
      sendJson(res, 200, failure(error?.code ?? 'failed', String(error?.message ?? error)))
    }
  }
}

const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(coded('timeout', `no answer from ${what} within ${ms} ms`)), ms)
      timer.unref?.()
    }),
  ])

/**
 * Everything the plugin does, independent of Cordis. Exported for tests:
 * `deps.hub` (the mcpHub service or undefined), `deps.settings`,
 * `deps.credentials`, `deps.fetch`, `deps.logger`, `deps.now`.
 */
export function createOpfield(readConfig, deps) {
  const now = deps.now ?? (() => Date.now())
  const logger = deps.logger ?? { info() {}, warn() {} }
  const state = {
    inference: { status: 'idle' },
    sync: { status: 'pending' },
  }
  let usageCache = null
  let usageInflight = null
  let ensuring = null
  let ensureAgain = false

  /** One tool call on an instance through the hub; failures carry a code. */
  async function call(instance, tool, args) {
    const hub = deps.hub()
    if (hub === undefined) throw coded('no-hub', 'The MCP hub plugin is not installed or not enabled')
    let result
    try {
      result = await hub.call(instance, tool, args)
    } catch (error) {
      const message = String(error?.message ?? error)
      if (error?.name === 'AuthRequiredError' || /sign-in required|unauthori[sz]ed|\b401\b/i.test(message)) {
        throw coded('signin', `Sign in to ${instance} in Plugins → Opfield`)
      }
      throw coded('network', message)
    }
    const failed = resultError(result)
    if (failed !== undefined) throw coded('denied', failed)
    return resultData(result)
  }

  async function loadUsage(cfg, source) {
    try {
      const doc = await withTimeout(call(source.name, 'manage_inference_usage', { operation: 'self' }), cfg.advanced.timeoutMs, source.name)
      if (!isPlainObject(doc)) return failure('bad-response', `${source.name} answered with something that is not a usage document`)
      return normalizeUsage(doc)
    } catch (error) {
      return failure(error?.code ?? 'network', String(error?.message ?? error))
    }
  }

  /** Budget of the inference instance; `force` skips the short cache. */
  function readUsage(options = {}) {
    const cfg = readConfig()
    const source = sourceOf(cfg)
    if (source === undefined) return Promise.resolve(failure('no-source', 'No Opfield instance serves inference'))
    const identity = `${source.name}|${source.url}`
    const t = now()
    if (!options.force && usageCache !== null && usageCache.identity === identity && t - usageCache.at < cfg.advanced.cacheMs) return Promise.resolve(usageCache.value)
    if (usageInflight !== null && usageInflight.identity === identity) return usageInflight.promise
    const promise = loadUsage(cfg, source)
      .then((value) => {
        usageCache = { at: now(), identity, value }
        return value
      })
      .finally(() => {
        if (usageInflight?.promise === promise) usageInflight = null
      })
    usageInflight = { identity, promise }
    return promise
  }

  const formOf = (ns) => deps.settings()?.describe().find((row) => row.ns === ns)

  /** Merge `patch` into one instance of this plugin's own entry. */
  async function writeInstance(instanceName, patch) {
    const form = formOf(ENTRY_ID)
    if (form === undefined) return
    const list = readConfig().instances.map((i) => (i.name === instanceName ? { ...i, ...patch } : i))
    await deps.settings().mutate(ENTRY_ID, [{ op: 'set', path: ['instances'], value: list }], form.revision)
  }

  async function keyConfigured(ref) {
    try {
      const view = await deps.credentials()?.describe(ref)
      if (view?.configured) return true
    } catch {
      // fall through
    }
    return typeof process.env[ref] === 'string' && process.env[ref].length > 0
  }

  async function issueToken(source) {
    const view = deps.hub()?.status(source.name)
    if (inferenceAllowed(view) === false) {
      throw coded('no-access', `This ${source.name} login has no inference access (${INFERENCE_SCOPE}). Pick another instance or ask the Opfield administrator.`)
    }
    let data
    try {
      data = await call(source.name, 'manage_inference_token', { operation: 'create', name: `DeepSeek Harness · ${hostname()}` })
    } catch (error) {
      if (error.code === 'signin' || error.code === 'no-hub') throw error
      throw coded('token', `Opfield did not issue an inference token: ${error.message}`)
    }
    const issued = issuedToken(data)
    if (issued.secret === undefined) {
      if (issued.id) await call(source.name, 'manage_inference_token', { operation: 'revoke', tokenId: issued.id }).catch(() => {})
      throw coded('token', 'Opfield created a token but did not return its secret')
    }
    return issued
  }

  async function fixDefaultModel(route, ids) {
    const form = formOf(DEFAULT_MODEL_ENTRY)
    const value = form?.value
    if (!value || value.provider !== route || ids.length === 0 || ids.includes(value.model)) return undefined
    await deps.settings().mutate(DEFAULT_MODEL_ENTRY, [{ op: 'set', path: ['model'], value: ids[0] }], form.revision)
    logger.info('opfield: default model %s is not served by the new instance; switched to %s', value.model, ids[0])
    return { from: value.model, to: ids[0] }
  }

  /** Rewrite the route's model list from the instance's catalog. */
  async function runSync() {
    const cfg = readConfig()
    const a = cfg.advanced
    let report
    try {
      report = await syncModels({ piAiEntry: a.piAiEntry, route: a.route, include: a.include, exclude: a.exclude, timeoutMs: a.timeoutMs }, {
        settings: deps.settings(),
        resolveKey: async (ref) => {
          try {
            const resolved = await deps.credentials()?.resolve(ref)
            if (resolved?.value) return resolved.value
          } catch {
            // fall through
          }
          return process.env[ref] || undefined
        },
        fetch: deps.fetch,
      })
    } catch (error) {
      report = { status: 'failed', reason: String(error?.message ?? error) }
    }
    if (Array.isArray(report.ids)) {
      try {
        const moved = await fixDefaultModel(a.route, report.ids)
        if (moved) report.defaultModel = moved
      } catch (error) {
        logger.warn('opfield: could not move the default model: %s', error?.message ?? error)
      }
    }
    state.sync = { ...report, at: new Date(now()).toISOString() }
    if (report.status === 'updated') logger.info('opfield model sync: %d models on route %s', report.models, a.route)
    else if (report.status !== 'unchanged') logger.warn('opfield model sync %s: %s', report.status, report.reason)
    return state.sync
  }

  async function doEnsure() {
    const cfg = readConfig()
    const source = sourceOf(cfg)
    const { piAiEntry, route } = cfg.advanced
    if (source === undefined) {
      state.inference = { status: 'none' }
      return
    }
    const fail = (code, message, extra = {}) => {
      state.inference = { status: 'error', instance: source.name, code, message, ...extra }
    }
    if (deps.settings() === undefined) return fail('no-settings', 'The settings service is not available')
    if (deps.hub() === undefined) return fail('no-hub', 'The MCP hub plugin is not installed or not enabled')
    const form = formOf(piAiEntry)
    if (form === undefined) return fail('no-models-plugin', `The models plugin entry "${piAiEntry}" is not in this profile`)
    const existing = form.user?.providers?.[route] ?? form.value?.providers?.[route]

    // A route that already talks to this instance keeps its key reference.
    let keyRef = source.keyRef
    if (!keyRef && isPlainObject(existing) && existing.baseURL === inferenceBaseURL(source) && typeof existing.apiKeyEnv === 'string') {
      keyRef = existing.apiKeyEnv
      await writeInstance(source.name, { keyRef })
    }
    keyRef ??= keyRefOf(source)

    if (!(await keyConfigured(keyRef))) {
      state.inference = { status: 'issuing', instance: source.name, keyRef }
      try {
        const issued = await issueToken(source)
        await deps.credentials().set(keyRef, issued.secret)
        await writeInstance(source.name, { keyRef, ...(issued.id ? { tokenId: issued.id } : {}) })
        logger.info('opfield: issued an inference token on %s into %s', source.name, keyRef)
      } catch (error) {
        return fail(error.code ?? 'token', String(error?.message ?? error), { keyRef })
      }
    }

    const ops = routeOps(existing, source, keyRef, route)
    if (ops.length > 0) {
      try {
        await deps.settings().mutate(piAiEntry, ops, formOf(piAiEntry).revision)
      } catch (error) {
        return fail('route', `Could not update the model route: ${error?.message ?? error}`, { keyRef })
      }
    }
    state.inference = { status: 'ready', instance: source.name, keyRef }
    usageCache = null
    await runSync()
  }

  /** Point the route at the inference instance (idempotent; coalesces callers). */
  function ensureInference() {
    if (ensuring !== null) {
      ensureAgain = true
      return ensuring
    }
    ensuring = (async () => {
      do {
        ensureAgain = false
        try {
          await doEnsure()
        } catch (error) {
          state.inference = { status: 'error', code: 'failed', message: String(error?.message ?? error) }
        }
      } while (ensureAgain)
    })().finally(() => {
      ensuring = null
    })
    return ensuring
  }

  /** Instances that left the config give back the token the plugin issued. */
  async function releaseRemoved(previous, next) {
    for (const instance of previous.instances) {
      if (next.instances.some((i) => i.name === instance.name) || !instance.tokenId) continue
      try {
        await call(instance.name, 'manage_inference_token', { operation: 'revoke', tokenId: instance.tokenId })
        logger.info('opfield: revoked the inference token issued on %s', instance.name)
      } catch (error) {
        logger.warn('opfield: could not revoke the token on %s: %s', instance.name, error?.message ?? error)
      }
      try {
        await deps.credentials()?.unset(keyRefOf(instance))
      } catch {
        // nothing stored
      }
    }
  }

  /** What the hub should run for this config. */
  function hubServers(cfg = readConfig()) {
    return cfg.instances.map((i) => hubServerOf(i, i.name === cfg.inference))
  }

  async function status() {
    const cfg = readConfig()
    const hub = deps.hub()
    const route = cfg.advanced.route
    const models = formOf(cfg.advanced.piAiEntry)?.value?.providers?.[route]?.models
    const instances = []
    for (const i of cfg.instances) {
      const view = hub?.status(i.name)
      instances.push({
        name: i.name,
        url: i.url,
        mcp: i.mcp !== false,
        source: i.name === cfg.inference,
        keyRef: keyRefOf(i),
        inference: inferenceAllowed(view) ?? null,
        server: view
          ? {
              status: view.status,
              error: view.error,
              running: view.running === true,
              tools: Array.isArray(view.tools) ? view.tools.length : 0,
              effectiveMode: view.effectiveMode,
              signedIn: view.oauth?.signedIn === true,
              authUrl: view.oauth?.url,
            }
          : null,
      })
    }
    const source = sourceOf(cfg)
    return {
      ok: true,
      hub: hub !== undefined,
      settings: deps.settings() !== undefined,
      inference: {
        ...state.inference,
        instance: cfg.inference,
        route,
        models: Array.isArray(models) ? models.length : 0,
        keyConfigured: source ? await keyConfigured(state.inference.keyRef ?? source.keyRef ?? keyRefOf(source)) : false,
      },
      sync: state.sync,
      components: [...(deps.components?.() ?? COMPONENTS)],
      instances,
    }
  }

  async function action({ instance, action: what }) {
    const hub = deps.hub()
    switch (what) {
      case 'signin':
      case 'signout':
      case 'restart':
      case 'stop':
      case 'refresh': {
        if (hub === undefined) throw coded('no-hub', 'The MCP hub plugin is not installed or not enabled')
        const result = await hub.action(instance, what)
        if (what === 'signout' && instance === readConfig().inference) usageCache = null
        return result
      }
      case 'sync':
        await ensureInference()
        return { ok: true, ...(await status()) }
      case 'check':
        return { ok: true, usage: await readUsage({ force: true }) }
      default:
        return { ok: false, message: `unknown action ${what}` }
    }
  }

  return { state, call, readUsage, ensureInference, runSync, releaseRemoved, hubServers, status, action }
}

export function apply(ctx, config) {
  // Components (budget, cache timer, compact offer) are sub-plugins of this
  // bundle, toggled in Plugins; each one switches its piece on through this
  // service while it is enabled.
  const active = new Set()
  ctx.provide('opfield', {
    component(id) {
      if (!COMPONENTS.includes(id)) throw new TypeError(`opfield: unknown component ${id}`)
      active.add(id)
      return () => active.delete(id)
    },
  })
  // Read on every use: volatile edits from the settings page land here live.
  const current = () => resolveConfig(config)
  let hub
  let settings
  const opfield = createOpfield(current, {
    hub: () => hub,
    settings: () => settings,
    credentials: () => ctx.get('credentials'),
    fetch: (input, init) => fetch(input, init),
    logger: ctx.logger,
    components: () => active,
  })

  // Volatile commits arrive as one event on this plugin; fan it out.
  const onConfigChange = new Set()
  ctx.on('loader/volatile-update', () => {
    for (const fn of onConfigChange) fn()
  })

  // Optional: without the projection registry the browser simply shows no timer.
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(cacheWarmProjection)
  })

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        // GET = cached reading; POST = fresh reading.
        handler: guarded(ctx, ['GET', 'POST'], async (req, res) => {
          const value = await opfield.readUsage({ force: req.method === 'POST' })
          sendJson(res, 200, { ...value, ...publicConfig(current(), active) })
        }),
      }),
    `opfield: ${ROUTE_PATH}`,
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: guarded(ctx, ['GET'], async (_req, res) => sendJson(res, 200, await opfield.status())),
      }),
    `opfield: ${STATUS_PATH}`,
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ACTION_PATH,
        handler: guarded(ctx, ['POST'], async (req, res) => sendJson(res, 200, await opfield.action(await readBody(req)))),
      }),
    `opfield: ${ACTION_PATH}`,
  )

  // What changes the inference set-up: which instance, where it lives, which route.
  const inferenceSignature = () => {
    const cfg = current()
    const source = sourceOf(cfg)
    return JSON.stringify([source?.name, source?.url, cfg.advanced.route, cfg.advanced.piAiEntry, cfg.advanced.include, cfg.advanced.exclude])
  }
  let ready = false
  const kick = () => {
    if (ready && hub !== undefined && settings !== undefined) opfield.ensureInference()
  }

  // Instances → MCP hub servers. Kept on the hub's own context so they leave with it.
  ctx.inject(['mcpHub'], (scope) => {
    hub = scope.mcpHub
    let previous = current()
    let seen
    let withdraw = () => {}
    const register = () => {
      const servers = opfield.hubServers()
      const signature = JSON.stringify(servers)
      if (signature === seen) return
      seen = signature
      withdraw = hub.register(HUB_OWNER, servers)
    }
    register()
    const onChange = async () => {
      const next = current()
      await opfield.releaseRemoved(previous, next)
      previous = next
      register()
    }
    onConfigChange.add(onChange)
    // A login finishing (or a server coming back) may unblock a failed set-up.
    let retry = null
    const offHub = hub.onChange(() => {
      const s = opfield.state.inference
      if (s.status !== 'error' || !['signin', 'network', 'timeout'].includes(s.code)) return
      const view = hub.status(s.instance)
      if (!view?.oauth?.signedIn || view.status !== 'running') return
      clearTimeout(retry)
      retry = setTimeout(kick, 1000)
    })
    kick()
    return () => {
      onConfigChange.delete(onChange)
      clearTimeout(retry)
      offHub()
      withdraw()
      hub = undefined
    }
  })

  ctx.inject(['settings'], (scope) => {
    settings = scope.settings
    // This bundle draws its own settings page; tell schema-driven clients not to.
    scope.effect(() => {
      try {
        return scope.settings.configure({ auto: false }, ctx.fiber)
      } catch {
        return () => {}
      }
    }, 'opfield: settings presentation')

    scope.effect(() => {
      let timer = null
      let seen = inferenceSignature()
      const schedule = (delay) => {
        clearTimeout(timer)
        timer = setTimeout(tick, delay)
        timer.unref?.()
      }
      const plan = () => {
        const minutes = Number(current().advanced.syncIntervalMinutes) || 0
        if (minutes > 0) schedule(Math.max(5, minutes) * 60000)
      }
      const tick = async () => {
        if (opfield.state.inference.status === 'ready') await opfield.runSync()
        else kick()
        plan()
      }
      const replan = () => {
        const next = inferenceSignature()
        if (next === seen) return
        seen = next
        kick()
      }
      onConfigChange.add(replan)
      // Let the Loader settle the rest of the composition before the first pass.
      const first = setTimeout(() => {
        ready = true
        kick()
        plan()
      }, 5000)
      first.unref?.()
      return () => {
        onConfigChange.delete(replan)
        clearTimeout(timer)
        clearTimeout(first)
        settings = undefined
      }
    }, 'opfield: inference set-up')
  })
}
