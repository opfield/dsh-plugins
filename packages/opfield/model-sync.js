/**
 * Keeps one llm-pi-ai route's model list in step with what the Opfield
 * gateway advertises at GET <route baseURL>/models: ids, display names,
 * context and output caps, input modalities (text/image) and reasoning
 * efforts. pi-ai cannot learn modalities or efforts from the wire by itself,
 * so without this every gateway model looks text-only and non-reasoning.
 *
 * The write goes through the Settings service (the same path the Models page
 * uses), so it lands in the profile's cordis.patch.yml and applies live.
 */

/** pi-ai thinking levels a gateway effort can map onto one-to-one. */
const PI_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
/** Input modalities pi-ai accepts on a model entry. */
const PI_MODALITIES = ['text', 'image']

const posInt = (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined)

function globToRegExp(glob) {
  const body = String(glob)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}$`)
}

/** Selector over model ids: empty `include` admits everything, `exclude` wins. */
export function modelFilter({ include = [], exclude = [] } = {}) {
  const inc = include.map(globToRegExp)
  const exc = exclude.map(globToRegExp)
  return (id) => (inc.length === 0 || inc.some((r) => r.test(id))) && !exc.some((r) => r.test(id))
}

/**
 * One gateway catalog entry → one pi-ai model entry, or undefined when the
 * entry is unusable. Gateway efforts pi-ai has no level for (e.g. `ultra`)
 * are dropped.
 */
export function piModelOf(entry) {
  if (typeof entry?.id !== 'string' || entry.id.length === 0) return undefined
  const model = { id: entry.id }
  if (typeof entry.display_name === 'string' && entry.display_name.length > 0) model.name = entry.display_name
  const contextWindow = posInt(entry.context_window) ?? posInt(entry.max_input_tokens)
  if (contextWindow !== undefined) model.contextWindow = contextWindow
  const maxTokens = posInt(entry.max_output_tokens)
  if (maxTokens !== undefined) model.maxTokens = maxTokens
  if (Array.isArray(entry.input_modalities)) {
    const input = PI_MODALITIES.filter((m) => entry.input_modalities.includes(m))
    if (input.includes('text')) model.input = input
  }
  const reasoning = entry.capabilities?.reasoning
  if (reasoning === false) {
    model.reasoningEfforts = false
  } else if (Array.isArray(entry.supported_reasoning_efforts)) {
    const efforts = {}
    for (const level of PI_LEVELS) if (entry.supported_reasoning_efforts.includes(level)) efforts[level] = level
    if (Object.keys(efforts).length > 0) model.reasoningEfforts = efforts
  }
  return model
}

/** Gateway `/models` document → pi-ai model list, filtered, in gateway order. */
export function piModelsOf(doc, filter = () => true) {
  const list = Array.isArray(doc?.data) ? doc.data : []
  const out = []
  const seen = new Set()
  for (const entry of list) {
    const model = piModelOf(entry)
    if (model === undefined || seen.has(model.id) || !filter(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}

/**
 * Overlay synced facts on the existing entries: fields the gateway does not
 * describe (compat, hand-tuned extras) survive; models the gateway no longer
 * lists are dropped.
 */
export function mergeModels(existing, synced) {
  const byId = new Map((Array.isArray(existing) ? existing : []).filter((m) => m && typeof m.id === 'string').map((m) => [m.id, m]))
  return synced.map((model) => {
    const previous = byId.get(model.id)
    if (previous === undefined) return model
    const merged = { ...previous, ...model }
    // A gateway that stopped reporting a field must not leave a stale value behind.
    for (const key of ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts']) {
      if (!(key in model)) delete merged[key]
    }
    return merged
  })
}

const canonical = (value) =>
  JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v))

/**
 * One sync pass. `deps.settings` is the Settings service, `deps.resolveKey`
 * resolves a credential reference, `deps.fetch` the HTTP carrier.
 * @returns a small report: `{ status: 'unchanged'|'updated'|'skipped', ... }`
 */
export async function syncModels(cfg, deps) {
  const form = deps.settings.describe().find((row) => row.ns === cfg.piAiEntry)
  if (form === undefined) return { status: 'skipped', reason: `no configurable entry "${cfg.piAiEntry}"` }
  const route = form.value?.providers?.[cfg.route]
  if (route === undefined) return { status: 'skipped', reason: `route "${cfg.route}" is not configured` }
  if (typeof route.baseURL !== 'string' || route.baseURL.length === 0) return { status: 'skipped', reason: `route "${cfg.route}" has no baseURL` }
  const key = typeof route.apiKeyEnv === 'string' ? await deps.resolveKey(route.apiKeyEnv) : undefined
  if (key === undefined || key === '') return { status: 'skipped', reason: `credential ${route.apiKeyEnv ?? '(none)'} is not set` }

  const url = `${route.baseURL.replace(/\/+$/, '')}/models`
  const response = await deps.fetch(url, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(cfg.timeoutMs),
  })
  if (!response.ok) return { status: 'skipped', reason: `GET ${url} answered HTTP ${response.status}` }
  const synced = piModelsOf(await response.json(), modelFilter(cfg))
  // An empty answer is far more likely an outage or a filter typo than a real
  // catalog; never wipe the route over it.
  if (synced.length === 0) return { status: 'skipped', reason: 'gateway listed no matching models' }

  // Compare against and write over the user layer: the effective value carries
  // schema-materialized defaults (empty compat blocks) that would only add noise.
  const current = form.user?.providers?.[cfg.route]?.models ?? form.value.providers[cfg.route].models ?? []
  const next = mergeModels(current, synced)
  if (canonical(next) === canonical(current)) return { status: 'unchanged', models: next.length, ids: next.map((m) => m.id) }
  await deps.settings.mutate(cfg.piAiEntry, [{ op: 'set', path: ['providers', cfg.route, 'models'], value: next }], form.revision)
  return { status: 'updated', models: next.length, ids: next.map((m) => m.id) }
}
