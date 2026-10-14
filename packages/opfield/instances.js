/**
 * Pure parts of the Opfield plugin: the config shape, how an instance maps
 * onto an MCP hub server and onto the llm-pi-ai route, and how the answer of
 * the token-issuing tool is read. No I/O here; index.js wires it up.
 */

export const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
export const INFERENCE_SCOPE = 'feat:ai:use'

export const ADVANCED_DEFAULTS = {
  // llm-pi-ai entry id and the route the selected instance serves.
  piAiEntry: 'llm-pi-ai',
  route: 'opfield',
  // Budget pill: how often the browser re-reads, and the colour thresholds.
  pollSeconds: 60,
  warnPercent: 20,
  errorPercent: 5,
  // Model list: re-sync interval (0 = only at start and on Refresh) and id globs.
  syncIntervalMinutes: 60,
  include: [],
  exclude: [],
  // Host-side reuse of one budget reading, and the upstream deadline.
  cacheMs: 15000,
  timeoutMs: 15000,
}

export const DEFAULTS = {
  instances: [],
  // Name of the instance that serves models; '' = none.
  inference: '',
  promptCacheTtlMinutes: 60,
  compactMinTokens: 30000,
  advanced: ADVANCED_DEFAULTS,
}

export const INSTANCE_DEFAULTS = { mcp: true }

/** Pieces the user turns on and off in Plugins → Components (each is its own sub-plugin). */
export const COMPONENTS = ['usagePill', 'cachePill', 'compactSuggestion']

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** `https://ops.example.com/anything` → `https://ops.example.com`; undefined when not http(s). */
export function originOf(url) {
  try {
    const u = new URL(String(url).trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined
    return u.origin
  } catch {
    return undefined
  }
}

/**
 * Settings written by 0.3 and earlier (one `baseURL`, `display`, `modelSync`…)
 * become one instance named `opfield` serving inference.
 */
function fromLegacy(raw) {
  const out = {}
  if (!Array.isArray(raw.instances) && typeof raw.baseURL === 'string' && originOf(raw.baseURL)) {
    out.instances = [{ name: 'opfield', url: originOf(raw.baseURL), mcp: false }]
    if (raw.inference === undefined) out.inference = 'opfield'
  }
  const display = isPlainObject(raw.display) ? raw.display : {}
  const compact = isPlainObject(raw.compactSuggestion) ? raw.compactSuggestion : {}
  const sync = isPlainObject(raw.modelSync) ? raw.modelSync : {}
  if (raw.compactMinTokens === undefined && typeof compact.minTokens === 'number') out.compactMinTokens = compact.minTokens
  if (!isPlainObject(raw.advanced) && (raw.display || raw.modelSync)) {
    const pick = (src, from, to = from) => (src[from] !== undefined ? { [to]: src[from] } : {})
    out.advanced = {
      ...pick(display, 'pollSeconds'),
      ...pick(display, 'warnPercent'),
      ...pick(display, 'errorPercent'),
      ...pick(sync, 'route'),
      ...pick(sync, 'piAiEntry'),
      ...pick(sync, 'intervalMinutes', 'syncIntervalMinutes'),
      ...pick(sync, 'include'),
      ...pick(sync, 'exclude'),
      ...pick(raw, 'cacheMs'),
      ...pick(raw, 'timeoutMs'),
    }
  }
  return out
}

/** Defaults under the entry config; invalid or duplicate instances are dropped. */
export function resolveConfig(raw = {}) {
  const src = { ...raw, ...fromLegacy(raw) }
  const seen = new Set()
  const instances = (Array.isArray(src.instances) ? src.instances : [])
    .filter((i) => isPlainObject(i) && typeof i.name === 'string' && NAME_RE.test(i.name) && originOf(i.url) && !seen.has(i.name) && seen.add(i.name))
    .map(({ mode: _mode, ...i }) => ({ ...INSTANCE_DEFAULTS, ...i, url: originOf(i.url) }))
  const inference = typeof src.inference === 'string' && instances.some((i) => i.name === src.inference) ? src.inference : ''
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    instances,
    inference,
    promptCacheTtlMinutes: num(src.promptCacheTtlMinutes, DEFAULTS.promptCacheTtlMinutes),
    compactMinTokens: num(src.compactMinTokens, DEFAULTS.compactMinTokens),
    advanced: { ...ADVANCED_DEFAULTS, ...(isPlainObject(src.advanced) ? src.advanced : {}) },
  }
}

/** The instance serving models, or undefined. */
export function sourceOf(cfg) {
  return cfg.instances.find((i) => i.name === cfg.inference)
}

/** Credential reference holding an instance's inference token. */
export function keyRefOf(instance) {
  if (typeof instance.keyRef === 'string' && instance.keyRef.length > 0) return instance.keyRef
  return `OPFIELD_${instance.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_INFERENCE_KEY`
}

export const inferenceBaseURL = (instance) => `${instance.url}/api/inference/v1`

/**
 * One instance → one MCP hub server. Every instance keeps its session (the
 * budget and token issuing go through it); `expose` decides whether the model
 * sees its tools. Opfield has hundreds of tools, so they are always lazy.
 */
export function hubServerOf(instance, isSource) {
  return {
    name: instance.name,
    transport: 'http',
    url: `${instance.url}/api/mcp`,
    mode: 'lazy',
    enabled: true,
    expose: instance.mcp !== false,
    connectAtStartup: instance.mcp !== false || isSource,
  }
}

/**
 * Operations that point the llm-pi-ai route at an instance. An existing
 * route keeps its models, reasoning and display name; only where it talks to
 * and with which key change.
 */
export function routeOps(existing, instance, keyRef, route) {
  const at = (...rest) => ['providers', route, ...rest]
  const baseURL = inferenceBaseURL(instance)
  if (!isPlainObject(existing)) {
    return [{ op: 'set', path: at(), value: { displayName: 'Opfield', apiKeyEnv: keyRef, api: 'openai-responses', baseURL, models: [] } }]
  }
  const ops = []
  if (existing.baseURL !== baseURL) ops.push({ op: 'set', path: at('baseURL'), value: baseURL })
  if (existing.apiKeyEnv !== keyRef) ops.push({ op: 'set', path: at('apiKeyEnv'), value: keyRef })
  if (existing.api === undefined) ops.push({ op: 'set', path: at('api'), value: 'openai-responses' })
  return ops
}

/** Text or structured content of an MCP tool result → parsed JSON (or the text). */
export function resultData(result) {
  if (result?.structuredContent !== undefined) return result.structuredContent
  const text = (Array.isArray(result?.content) ? result.content : [])
    .filter((c) => c?.type === 'text')
    .map((c) => c.text)
    .join('\n')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Error text of a failed tool result, or undefined. */
export function resultError(result) {
  if (result?.isError !== true) return undefined
  const data = resultData(result)
  return typeof data === 'string' ? data : (data?.message ?? data?.error?.message ?? JSON.stringify(data))
}

/**
 * The secret and id in the answer of `manage_inference_token create`. The
 * secret is the longest `gwi_…` / `opfi_…` string (the short `tokenPrefix`
 * is not it).
 */
export function issuedToken(data) {
  const secrets = []
  let id
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (/^(gwi|opfi)_[A-Za-z0-9_-]{20,}$/.test(v)) secrets.push(v)
      else if (id === undefined && key === 'id' && /^[0-9a-f-]{16,}$/i.test(v)) id = v
    } else if (Array.isArray(v)) v.forEach((x) => walk(x))
    else if (isPlainObject(v)) for (const [k, x] of Object.entries(v)) walk(x, k)
  }
  walk(data)
  if (typeof data === 'string') {
    const m = data.match(/(?:gwi|opfi)_[A-Za-z0-9_-]{20,}/g)
    if (m) secrets.push(...m)
  }
  secrets.sort((a, b) => b.length - a.length)
  return { secret: secrets[0], id }
}

/** Is inference allowed for this login? true / false, or undefined when unknown. */
export function inferenceAllowed(hubView) {
  const scopes = hubView?.oauth?.scopes
  if (!hubView?.oauth?.signedIn || !Array.isArray(scopes) || scopes.length === 0) return undefined
  return scopes.includes(INFERENCE_SCOPE)
}
