// Smoke test of the browser module with stub React/DOM: factory loads, apply
// registers both dock entries, and the components pick the right branches.
import assert from 'node:assert/strict'
import { test } from 'node:test'

// The plugin's 60 s poll must not keep the test process alive.
const realSetInterval = globalThis.setInterval
globalThis.setInterval = (fn, ms) => realSetInterval(fn, ms).unref()
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms) => {
  const id = realSetTimeout(fn, ms)
  return ms >= 1000 ? id.unref() : id
}
globalThis.window = { __ModuleLoader__: { load: (m) => (globalThis.__mod = m) } }
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, remove() {} }),
  head: { appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
}
let usageBody = {}
globalThis.fetch = async () => ({ ok: true, json: async () => usageBody })
await import('../client.js')

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  memo: (f) => f,
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  // Like React: both callbacks are called detached from their object.
  useSyncExternalStore: (sub, get) => {
    sub(() => {})()
    return get()
  },
}
const plugin = globalThis.__mod.factory((name) => (name === 'react' ? React : name === 'react-dom' ? { createPortal: (x) => x } : null))
const regs = []
const executed = []
let execResult = { ok: true, value: {} }
const slots = { inject: (_n, f) => f(), register: (o, C) => regs.push([o, C]) }
const remote = { commands: { execute: async (...args) => (executed.push(args), execResult) } }
plugin.apply({
  effect: (f) => f(),
  locale: { register: () => () => {} },
  slots,
  inject: (_deps, f) => f({ slots, remote }),
})
const t = (k, v) => k + (v ? JSON.stringify(v) : '')
const [[o1, Usage], [o2, Cache], [o3, Compact]] = regs
const tick = () => new Promise((r) => setTimeout(r, 10))

test('registers dock entries', () => {
  assert.deepEqual([o1.name, o1.id, o2.id], ['conversation.composer.dock', 'opfield-usage', 'prompt-cache-warm'])
  assert.deepEqual([o1.order, o2.order], [1, 2])
  assert.deepEqual([o3.name, o3.id], ['conversation.input.dock', 'opfield-compact-offer'])
})

test('usage pill shows the smallest remaining share', async () => {
  usageBody = {
    ok: true,
    enabled: true,
    providers: ['gateway'],
    measuredAt: new Date().toISOString(),
    windows: [
      { id: '7d', percentage: 30, active: true, recoveryAt: new Date().toISOString() },
      { id: 'api', percentage: 85, active: true, recoveryAt: new Date().toISOString() },
    ],
  }
  plugin // store refresh was kicked off in apply; force another by a fresh fetch cycle
  await tick()
  // first load happened with {} body; trigger a reload via the effect-less path:
  // the store is internal, so re-run apply to get a fresh store with the new body.
  const regs2 = []
  plugin.apply({ effect: (f) => f(), locale: { register: () => () => {} }, slots: { inject: (_n, f) => f(), register: (o, C) => regs2.push([o, C]) }, inject: () => {} })
  await tick()
  const out = JSON.stringify(regs2[0][1]({ useProjection: (k) => (k === 'modelSelection' ? { next: { provider: 'gateway' } } : undefined), t }))
  assert.match(out, /"15%"/)
  assert.match(out, /"data-level":"warn"/)
  const other = regs2[0][1]({ useProjection: (k) => (k === 'modelSelection' ? { next: { provider: 'zai' } } : undefined), t })
  assert.equal(other, null)
})

const text = (node) => JSON.stringify(node)
const pillReading = (node) => node.children[0].children[0].children[1].children[0]

test('cache pill: icon + coarse time, full TTL while running', () => {
  const now = Date.now()
  const view = (v) => ({ useProjection: (k) => (k === 'promptCacheWarm' ? v : undefined), t })
  const base = { running: false, cacheReadTokens: 1000, cacheWriteTokens: null, lastCompactionAt: null }
  assert.equal(pillReading(Cache(view({ ...base, lastRequestAt: now - 10 * 60000 }))), '50m')
  assert.equal(pillReading(Cache(view({ ...base, lastRequestAt: now - 59.5 * 60000 }))), '1m')
  assert.equal(pillReading(Cache(view({ ...base, lastRequestAt: now }))), '1h')
  assert.equal(pillReading(Cache(view({ ...base, lastRequestAt: now - 30 * 60000, running: true }))), '1h', 'running = full TTL')
  assert.equal(pillReading(Cache(view({ ...base, lastRequestAt: now - 2 * 3600000, running: true }))), '0m', 'stale running = cold')
  assert.doesNotMatch(text(Cache(view({ ...base, lastRequestAt: now }))), /"title"|Cache/, 'no native tooltip, no word')
  assert.equal(Cache(view(undefined)), null)
})

test('compact offer: only cold, idle, big, uncompacted, undismissed', async () => {
  const now = Date.now()
  const cold = { lastRequestAt: now - 2 * 3600000, running: false, lastCompactionAt: null, cacheReadTokens: null, cacheWriteTokens: null }
  const props = (warm, tokens, sessionId = 's1') => ({
    sessionId,
    compact: async () => {
      const r = await remote.commands.execute(sessionId, '/compact', [])
      return r.ok ? null : r.error.message
    },
    t,
    useProjection: (k) => (k === 'promptCacheWarm' ? warm : k === 'contextPressure' ? { pressureTokens: tokens } : undefined),
  })
  assert.match(text(Compact(props(cold, 120000))), /compact\.title/)
  assert.equal(Compact(props({ ...cold, lastRequestAt: now - 60000 }, 120000)), null, 'still warm')
  assert.equal(Compact(props(cold, 5000)), null, 'small context')
  assert.equal(Compact(props({ ...cold, lastCompactionAt: now - 3600000 }, 120000)), null, 'already compacted since')
  assert.equal(Compact(props({ ...cold, running: true, lastRequestAt: now - 10 * 60000 }, 120000)), null, 'running')
  // the Compact button runs /compact through the command remote
  const node = Compact(props(cold, 120000, 's2'))
  const button = node.children[0].children[3].children[0]
  await button.props.onClick()
  assert.deepEqual(executed.at(-1), ['s2', '/compact', []])
})

// ── settings page ─────────────────────────────────────────────────────────
function settingsHarness(snapshot, target = plugin) {
  const regs3 = []
  const mutations = []
  const listeners = new Set()
  let snap = snapshot
  // Same shape as DSH's ConfigFormController: methods that depend on `this`.
  class FakeForm {
    state = { listeners }
    getSnapshot() {
      return this.state && snap
    }
    subscribe(fn) {
      this.state.listeners.add(fn)
      return () => this.state.listeners.delete(fn)
    }
    async mutate(ops, rev) {
      mutations.push([ops, rev, this.state !== undefined])
      return true
    }
  }
  const form = new FakeForm()
  const credentialsSet = []
  const scope = {
    slots: { inject: (_n, f) => f(), register: (o, C) => regs3.push([o, C]) },
    effect: (f) => f(),
    configForms: { get: (id) => (assert.equal(id, 'opfield-usage'), form) },
    remote: {
      commands: remote.commands,
      credentials: {
        describe: async (refs) => ({ ok: true, value: Object.fromEntries(refs.map((r) => [r, { configured: true, writable: true }])) }),
        set: async (ref, value) => (credentialsSet.push([ref, value]), { ok: true }),
      },
      $on: () => () => {},
    },
  }
  target.apply({
    effect: (f) => f(),
    locale: { register: () => () => {} },
    slots: { inject: () => {}, register: () => {} },
    inject: (deps, f) => deps.includes('configForms') && f(scope),
  })
  return { regs3, mutations, credentialsSet, form }
}

// render nested function components (the stub React is shallow)
const deep = (n) => {
  if (Array.isArray(n)) return n.map(deep)
  if (n === null || typeof n !== 'object') return n
  if (typeof n.type === 'function') return deep(n.type({ ...n.props, children: n.children }))
  return { ...n, children: n.children.map(deep) }
}
const find = (n, pred, out = []) => {
  if (Array.isArray(n)) n.forEach((x) => find(x, pred, out))
  else if (n && typeof n === 'object') {
    if (pred(n)) out.push(n)
    find(n.children, pred, out)
  }
  return out
}

const pageValue = {
  instances: [
    { name: 'opfield', url: 'https://ops.example', mcp: true, mode: 'lazy', keyRef: 'OPFIELD_INFERENCE_KEY' },
    { name: 'staging', url: 'https://staging.example', mcp: false, mode: 'lazy' },
  ],
  inference: 'opfield',
  components: { usagePill: true, cachePill: false, compactSuggestion: true },
  promptCacheTtlMinutes: 60,
  compactMinTokens: 30000,
  advanced: { piAiEntry: 'llm-pi-ai', route: 'opfield', pollSeconds: 60, warnPercent: 20, errorPercent: 5, syncIntervalMinutes: 60, include: [], exclude: [], cacheMs: 15000, timeoutMs: 15000 },
}

test('settings page: instances, one inference source, components, collapsed advanced', async () => {
  const { regs3, mutations } = settingsHarness({ status: 'ready', value: pageValue, base: pageValue, user: { advanced: { warnPercent: 30 } }, revision: 'r1', writable: true, mode: 'host' })
  assert.equal(regs3.length, 1)
  const [opts, Page] = regs3[0]
  assert.equal(opts.name, 'plugins.bundle.config')
  assert.equal(opts.key, '@opfield/dsh-opfield')
  const props = { view: 'page', t, ...opts.inject() }
  // the page's first hook is the host status; hand it one with two components on
  const useState = React.useState
  let first = true
  React.useState = (v) => (first ? ((first = false), [{ ok: true, hub: true, components: ['usagePill', 'cachePill'], inference: { status: 'ready', models: 10 }, instances: [] }, () => {}]) : useState(v))
  const tree = deep(Page(props))
  React.useState = useState
  const out = JSON.stringify(tree)
  for (const id of ['inst.title', 'inf.title', 'comp.title', 'adv.title']) assert.ok(out.includes(id), id)
  // two compact instance cards: no exposure mode (always lazy), MCP switch only
  const cards = find(tree, (n) => n.props?.['data-instance'])
  assert.deepEqual(cards.map((c) => c.props['data-instance']), ['opfield', 'staging'])
  for (const c of cards) assert.equal(find(c, (n) => n.props?.role === 'tablist').length, 0)
  assert.doesNotMatch(out, /"mode\./)
  // one dropdown with None + both instances, current value selected
  const [select] = find(tree, (n) => n.type === 'select')
  assert.equal(select.props.value, 'opfield')
  assert.deepEqual(find(select, (n) => n.type === 'option').map((o) => o.props.value), ['', 'opfield', 'staging'])
  // the source row: selector on the right, Refresh inside the status line
  const sourceRow = find(tree, (n) => n.props?.className === 'opfh-source')[0]
  assert.equal(find(sourceRow, (n) => n.type === 'select').length, 1)
  assert.match(JSON.stringify(find(sourceRow, (n) => n.props?.role === 'status')), /inf\.refresh/, 'Refresh sits in the status line')
  // component settings: only those of enabled components (cache timer on, compact offer off)
  const comps = find(tree, (n) => n.type === 'section' && n.props['aria-labelledby'] === 'opfh-sec-components')[0]
  assert.equal(find(comps, (n) => n.props?.role === 'tablist').length, 1, 'cache TTL switch')
  assert.equal(find(comps, (n) => n.props?.id === 'opfh-compact-min').length, 0)
  assert.equal(find(comps, (n) => n.props?.role === 'switch').length, 0, 'on/off toggles live in Plugins')
  // advanced is a closed <details> with the overridden marker
  const [details] = find(tree, (n) => n.type === 'details')
  assert.ok(!details.props.open)
  assert.match(JSON.stringify(details), /s\.overridden/)
  assert.doesNotMatch(out, /apiKeyEnv|Credential name/, 'no credential-name field any more')
  // picking another source writes `inference`
  await select.props.onChange({ target: { value: 'staging' } })
  assert.deepEqual(mutations.at(-1)[0], [{ op: 'set', path: ['inference'], value: 'staging' }])
  // switching MCP off on a card writes the instance list
  const mcpSwitch = find(cards[0], (n) => n.props?.role === 'switch')[0]
  await mcpSwitch.props.onClick()
  assert.equal(mutations.at(-1)[0][0].value[0].mcp, false)
  assert.equal(mutations.at(-1)[0][0].value[0].keyRef, 'OPFIELD_INFERENCE_KEY', 'plugin-owned fields survive')
  assert.equal(Page({ ...props, view: 'summary' }), 's.summary')
  const unavailable = settingsHarness({ status: 'unavailable', writable: false, mode: 'host' })
  assert.match(JSON.stringify(unavailable.regs3[0][1]({ view: 'page', t, ...unavailable.regs3[0][0].inject() })), /s\.unavailable/)
})

test('source picker uses the DSH Menu when the primitives are there', async () => {
  let menu
  const UI = { Menu: (p) => ((menu = p), p.anchor), IconChevronDownOutlineRegular: () => null }
  const withUI = globalThis.__mod.factory((name) => (name === 'react' ? React : name === 'react-dom' ? { createPortal: (x) => x } : name === '@deepseek-ai/dsh-client-ui-primitives' ? UI : null))
  const { regs3, mutations } = settingsHarness({ status: 'ready', value: pageValue, base: pageValue, user: {}, revision: 'r1', writable: true, mode: 'host' }, withUI)
  const [opts, Page] = regs3[0]
  const tree = deep(Page({ view: 'page', t, ...opts.inject() }))
  assert.equal(find(tree, (n) => n.type === 'select').length, 0, 'no native select')
  assert.deepEqual(menu.items.map((i) => i.id), ['__none__', 'opfield', 'staging'])
  assert.equal(menu.selectedId, 'opfield')
  assert.equal(menu.portal, true)
  const [trigger] = find(tree, (n) => n.props?.className === 'opfh-selector')
  assert.equal(trigger.props['aria-haspopup'], 'menu')
  menu.onSelect('opfield')
  assert.equal(mutations.length, 0, 'picking the current source writes nothing')
  menu.onSelect('__none__')
  assert.deepEqual(mutations.at(-1)[0], [{ op: 'set', path: ['inference'], value: '' }])
  menu.onSelect('staging')
  assert.deepEqual(mutations.at(-1)[0], [{ op: 'set', path: ['inference'], value: 'staging' }])
})

// DSH primitives stub: each control renders as a marker element so the page tree shows which ones were used.
const UI_STUB = Object.fromEntries(['Button', 'Switch', 'SegmentedControl', 'Tag', 'StateDot', 'Input', 'Menu', 'IconChevronDownOutlineRegular'].map((n) => [n, (props) => ({ type: `ui:${n}`, props: props ?? {}, children: [] })]))

test('settings page renders DSH primitives when they are there', () => {
  const withUI = globalThis.__mod.factory((name) => (name === 'react' ? React : name === 'react-dom' ? { createPortal: (x) => x } : name === '@deepseek-ai/dsh-client-ui-primitives' ? UI_STUB : null))
  const { regs3 } = settingsHarness({ status: 'ready', value: pageValue, base: pageValue, user: { advanced: { warnPercent: 30 } }, revision: 'r1', writable: true, mode: 'host' }, withUI)
  const [opts, Page] = regs3[0]
  const useState = React.useState
  let first = true
  React.useState = (v) => (first ? ((first = false), [{ ok: true, hub: true, components: ['cachePill', 'compactSuggestion'], inference: { status: 'ready', models: 10 }, instances: [{ name: 'opfield', source: true, server: { status: 'running', running: true, signedIn: true, tools: 3 } }] }, () => {}]) : useState(v))
  const tree = deep(Page({ view: 'page', t, ...opts.inject() }))
  React.useState = useState
  const types = new Set(find(tree, (n) => typeof n.type === 'string' && n.type.startsWith('ui:')).map((n) => n.type))
  for (const t of ['ui:Button', 'ui:Switch', 'ui:SegmentedControl', 'ui:Tag', 'ui:StateDot', 'ui:Input', 'ui:Menu']) assert.ok(types.has(t), t)
  assert.equal(find(tree, (n) => ['opfh-btn', 'opfh-switch', 'opfh-seg', 'opfh-tag', 'opfh-dot', 'opfs-input', 'opfh-input'].includes(n.props?.className)).length, 0, 'no look-alike controls')
  const short = find(tree, (n) => n.type === 'ui:Input' && n.props.id === 'opfh-compact-min')[0]
  assert.match(short.props.className, /opfh-ushort/)
})
