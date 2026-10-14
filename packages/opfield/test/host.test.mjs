import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cacheWarmProjection as P, createOpfield, ENTRY_ID, normalizeUsage, resolveConfig } from '../index.js'
import { hubServerOf, issuedToken, routeOps } from '../instances.js'

const usageDoc = {
  measuredAt: '2026-10-13T00:47:08.739Z',
  enabled: true,
  api: { active: true, configured: true, percentage: 0, recoveryAt: '2026-10-20T00:22:37.000Z' },
  subscription: {
    '5h': { active: true, configured: false, percentage: 100, recoveryAt: 'x' },
    '7d': { active: true, configured: true, percentage: 3, recoveryAt: '2026-10-18T03:25:27.708Z' },
    '30d': { active: true, configured: false, percentage: 100, recoveryAt: 'x' },
  },
}
const SECRET = 'gwi_0123456789abcdef0123456789abcdef'
const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

function setAt(obj, path, value) {
  if (path.length === 0) return value
  const [k, ...rest] = path
  const base = obj !== null && typeof obj === 'object' ? obj : {}
  return { ...base, [k]: setAt(base[k], rest, value) }
}

function fakeSettings(rows) {
  const map = new Map(Object.entries(rows).map(([ns, value]) => [ns, { ns, value, user: value, revision: 1 }]))
  const writes = []
  return {
    writes,
    value: (ns) => map.get(ns)?.value,
    describe: () => [...map.values()],
    async mutate(ns, ops, revision) {
      const row = map.get(ns)
      assert.equal(revision, row.revision, `fresh revision for ${ns}`)
      let v = row.value
      for (const op of ops) v = setAt(v, op.path, op.value)
      map.set(ns, { ...row, value: v, user: v, revision: row.revision + 1 })
      writes.push({ ns, ops })
      return true
    },
  }
}

function fakeHub({ scopes = ['feat:ai:use'], signedIn = true, failCreate } = {}) {
  const calls = []
  return {
    calls,
    status: (name) => ({ name, status: 'running', running: true, tools: [{}, {}], oauth: { signedIn, scopes } }),
    action: async (name, action) => ({ ok: true, name, action }),
    async call(name, tool, args) {
      calls.push({ name, tool, args })
      if (!signedIn) {
        const e = new Error(`${name}: sign-in required`)
        e.name = 'AuthRequiredError'
        throw e
      }
      if (tool === 'manage_inference_usage') return text(usageDoc)
      if (tool === 'manage_inference_token' && args.operation === 'create') {
        if (failCreate) return { isError: true, content: [{ type: 'text', text: failCreate }] }
        return text({ token: { id: 'efc593df-0046-4a78-bec8-d101da185cf1', tokenPrefix: 'gwi_01234567' }, secret: SECRET })
      }
      if (tool === 'manage_inference_token' && args.operation === 'revoke') return text({ ok: true })
      throw new Error(`unexpected ${tool}`)
    },
  }
}

function fakeCredentials(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    describe: async (ref) => ({ configured: store.has(ref), writable: true }),
    resolve: async (ref) => (store.has(ref) ? { value: store.get(ref) } : undefined),
    set: async (ref, value) => void store.set(ref, value),
    unset: async (ref) => void store.delete(ref),
  }
}

const catalog = { data: [{ id: 'claude-opus-5.5', display_name: 'Claude Opus 5.5', context_window: 1000000, input_modalities: ['text', 'image'] }, { id: 'gpt-6' }] }

function setup({ opfield, piAi, hub = fakeHub(), creds = fakeCredentials(), defaultModel = { provider: 'opfield', model: 'old-model' } }) {
  const settings = fakeSettings({ [ENTRY_ID]: opfield, 'llm-pi-ai': piAi, 'agent-default-model': defaultModel })
  const fetched = []
  const app = createOpfield(() => resolveConfig(settings.value(ENTRY_ID)), {
    hub: () => hub,
    settings: () => settings,
    credentials: () => creds,
    fetch: async (url, init) => {
      fetched.push({ url, auth: init.headers.authorization })
      return { ok: true, status: 200, json: async () => catalog }
    },
  })
  return { app, settings, hub, creds, fetched }
}

test('normalize drops unconfigured windows', () => {
  assert.deepEqual(normalizeUsage(usageDoc).windows.map((w) => w.id), ['7d', 'api'])
})

test('budget comes from the inference instance over MCP, cached', async () => {
  let t = 0
  const hub = fakeHub()
  const app = createOpfield(() => resolveConfig({ instances: [{ name: 'ops', url: 'https://ops.test' }], inference: 'ops', advanced: { cacheMs: 1000 } }), {
    hub: () => hub,
    settings: () => undefined,
    credentials: () => undefined,
    now: () => t,
  })
  const [a, b] = await Promise.all([app.readUsage(), app.readUsage()])
  assert.equal(a, b)
  assert.deepEqual(a.windows.map((w) => w.id), ['7d', 'api'])
  assert.deepEqual(hub.calls, [{ name: 'ops', tool: 'manage_inference_usage', args: { operation: 'self' } }])
  t = 2000
  await app.readUsage()
  assert.equal(hub.calls.length, 2)
  const none = createOpfield(() => resolveConfig({ instances: [{ name: 'ops', url: 'https://ops.test' }] }), { hub: () => hub, settings: () => undefined, credentials: () => undefined })
  assert.equal((await none.readUsage()).code, 'no-source')
  const out = createOpfield(() => resolveConfig({ instances: [{ name: 'ops', url: 'https://ops.test' }], inference: 'ops' }), { hub: () => fakeHub({ signedIn: false }), settings: () => undefined, credentials: () => undefined })
  assert.equal((await out.readUsage()).code, 'signin')
  const nohub = createOpfield(() => resolveConfig({ instances: [{ name: 'ops', url: 'https://ops.test' }], inference: 'ops' }), { hub: () => undefined, settings: () => undefined, credentials: () => undefined })
  assert.equal((await nohub.readUsage()).code, 'no-hub')
})

test('picking an instance issues a token, points the route at it, syncs models, moves the default model', async () => {
  const { app, settings, hub, creds, fetched } = setup({
    opfield: { instances: [{ name: 'ops', url: 'https://ops.test' }], inference: 'ops' },
    piAi: { providers: { opfield: { displayName: 'Opfield', apiKeyEnv: 'OLD', api: 'openai-responses', baseURL: 'https://other.test/api/inference/v1', reasoning: 'high', models: [{ id: 'old-model' }] } } },
  })
  await app.ensureInference()
  assert.equal(app.state.inference.status, 'ready', app.state.inference.message)
  assert.equal(creds.store.get('OPFIELD_OPS_INFERENCE_KEY'), SECRET)
  assert.match(hub.calls.find((c) => c.args.operation === 'create').args.name, /^DeepSeek Harness · /)
  const own = settings.value(ENTRY_ID).instances[0]
  assert.equal(own.keyRef, 'OPFIELD_OPS_INFERENCE_KEY')
  assert.equal(own.tokenId, 'efc593df-0046-4a78-bec8-d101da185cf1')
  const route = settings.value('llm-pi-ai').providers.opfield
  assert.equal(route.baseURL, 'https://ops.test/api/inference/v1')
  assert.equal(route.apiKeyEnv, 'OPFIELD_OPS_INFERENCE_KEY')
  assert.equal(route.reasoning, 'high', 'other route fields stay')
  assert.deepEqual(route.models.map((m) => m.id), ['claude-opus-5.5', 'gpt-6'])
  assert.deepEqual(fetched, [{ url: 'https://ops.test/api/inference/v1/models', auth: `Bearer ${SECRET}` }])
  assert.equal(settings.value('agent-default-model').model, 'claude-opus-5.5')
  assert.deepEqual(app.state.sync.defaultModel, { from: 'old-model', to: 'claude-opus-5.5' })
  // a second pass changes nothing and issues nothing
  const writes = settings.writes.length
  await app.ensureInference()
  assert.equal(hub.calls.filter((c) => c.args.operation === 'create').length, 1)
  assert.equal(settings.writes.length, writes)
  // removing the instance revokes the issued token and forgets the key
  const before = resolveConfig(settings.value(ENTRY_ID))
  await app.releaseRemoved(before, resolveConfig({ instances: [] }))
  assert.deepEqual(hub.calls.at(-1), { name: 'ops', tool: 'manage_inference_token', args: { operation: 'revoke', tokenId: 'efc593df-0046-4a78-bec8-d101da185cf1' } })
  assert.equal(creds.store.has('OPFIELD_OPS_INFERENCE_KEY'), false)
})

test('a route already on the instance keeps its key; nothing is issued', async () => {
  const { app, settings, hub } = setup({
    opfield: { instances: [{ name: 'opfield', url: 'https://ops.test' }], inference: 'opfield' },
    piAi: { providers: { opfield: { apiKeyEnv: 'OPFIELD_INFERENCE_KEY', api: 'openai-responses', baseURL: 'https://ops.test/api/inference/v1', models: [] } } },
    creds: fakeCredentials({ OPFIELD_INFERENCE_KEY: 'gwi_existing_key_000000000000' }),
    defaultModel: { provider: 'opfield', model: 'gpt-6' },
  })
  await app.ensureInference()
  assert.equal(app.state.inference.status, 'ready')
  assert.equal(hub.calls.length, 0)
  assert.equal(settings.value(ENTRY_ID).instances[0].keyRef, 'OPFIELD_INFERENCE_KEY')
  assert.equal(settings.value('agent-default-model').model, 'gpt-6', 'a served default model stays')
})

test('no inference access, a refused issue, and a missing models plugin explain themselves', async () => {
  const denied = setup({ opfield: { instances: [{ name: 'staging', url: 'https://staging.test' }], inference: 'staging' }, piAi: { providers: {} }, hub: fakeHub({ scopes: ['docker:containers:view'] }) })
  await denied.app.ensureInference()
  assert.equal(denied.app.state.inference.code, 'no-access')
  assert.equal(denied.hub.calls.length, 0)
  const refused = setup({ opfield: { instances: [{ name: 'ops', url: 'https://ops.test' }], inference: 'ops' }, piAi: { providers: {} }, hub: fakeHub({ failCreate: 'missing permission feat:ai:use' }) })
  await refused.app.ensureInference()
  assert.equal(refused.app.state.inference.code, 'token')
  assert.match(refused.app.state.inference.message, /missing permission/)
  assert.equal(refused.app.state.inference.keyRef, 'OPFIELD_OPS_INFERENCE_KEY')
  const status = await refused.app.status()
  assert.equal(status.inference.keyConfigured, false)
  assert.equal(status.instances[0].inference, true)
  // the user pastes a token: the next pass uses it and creates the route
  await refused.creds.set('OPFIELD_OPS_INFERENCE_KEY', SECRET)
  await refused.app.ensureInference()
  assert.equal(refused.app.state.inference.status, 'ready')
  assert.equal(refused.settings.value('llm-pi-ai').providers.opfield.displayName, 'Opfield')
})

test('pure helpers', () => {
  assert.deepEqual(hubServerOf({ name: 'ops', url: 'https://ops.test', mcp: false, mode: 'lazy' }, true), {
    name: 'ops',
    transport: 'http',
    url: 'https://ops.test/api/mcp',
    mode: 'lazy',
    enabled: true,
    expose: false,
    connectAtStartup: true,
  })
  assert.deepEqual(routeOps({ baseURL: 'https://ops.test/api/inference/v1', apiKeyEnv: 'K', api: 'x' }, { url: 'https://ops.test' }, 'K', 'opfield'), [])
  assert.deepEqual(issuedToken({ tokenPrefix: 'gwi_short', token: SECRET, id: '1abd864a-c965-43c1-bf6f-0b2e043d38cb' }), { secret: SECRET, id: '1abd864a-c965-43c1-bf6f-0b2e043d38cb' })
  assert.equal(issuedToken(`Created. Secret: ${SECRET} (shown once)`).secret, SECRET)
})

test('cache-warm projection folds only this session', () => {
  const ev = (type, time, data = {}) => ({ type, time, data })
  let s = P.stateSchema.parse(P.init())
  s = P.apply(s, ev('turn/start', 1))
  assert.equal(s.running, true)
  s = P.apply(s, ev('step/start', 10))
  s = P.apply(s, ev('assistant/message', 20, { usage: { cacheReadTokens: 5000, cacheWriteTokens: 300 } }))
  s = P.apply(s, ev('step/start', 30))
  s = P.apply(s, ev('assistant/message', 40, {}))
  assert.equal(s.cacheReadTokens, 5000)
  assert.equal(P.apply(s, ev('tool/call', 50)), s, 'unrelated events keep the reference')
  s = P.apply(s, ev('turn/end', 60))
  assert.equal(s.running, false)
  assert.equal(s.lastRequestAt, 30)
  s = P.apply(s, ev('compaction/summary', 70))
  assert.equal(s.lastCompactionAt, 70)
  P.wire.viewSchema.parse(P.wire.view(s))
  assert.throws(() => P.stateSchema.parse({}))
})
