// Smoke test of the settings page with a stub React: registration, render of
// server cards from config + status, and writes through the shared form.
import assert from 'node:assert/strict'
import { test } from 'node:test'

const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms) => {
  const id = realSetTimeout(fn, ms)
  return ms >= 1000 ? id.unref() : id
}
globalThis.window = { __ModuleLoader__: { load: (m) => (globalThis.__mod = m) }, open() {} }
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ remove() {} }),
  head: { appendChild() {} },
  visibilityState: 'visible',
  activeElement: null,
}
const requests = []
let statusBody = { ok: true, missing: [], eagerTokens: 0, lazyTokens: 0, servers: [] }
globalThis.fetch = async (path, init) => {
  requests.push([path, init?.body])
  return { ok: true, status: 200, json: async () => (path.endsWith('status') ? statusBody : { ok: true }) }
}
await import('../client.js')

let runEffects = false
let states = []
let stateIndex = 0
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: (v) => {
    const i = stateIndex++
    if (!(i in states)) states[i] = typeof v === 'function' ? v() : v
    return [states[i], (n) => (states[i] = typeof n === 'function' ? n(states[i]) : n)]
  },
  useEffect: (f) => {
    if (runEffects) f()
  },
  useCallback: (f) => f,
  useRef: () => ({ current: null }),
  useSyncExternalStore: (sub, get) => {
    sub(() => {})()
    return get()
  },
}
const plugin = globalThis.__mod.factory((name) => (name === 'react' ? React : null))

class FakeForm {
  constructor(value) {
    this.snap = { status: 'ready', value, revision: 1, writable: true, mode: 'file' }
    this.ops = []
  }
  getSnapshot() {
    return this.snap
  }
  subscribe() {
    return () => {}
  }
  async mutate(ops, revision) {
    assert.equal(revision, this.snap.revision)
    this.ops.push(...ops)
    return true
  }
}

const regs = []
let shared
function mount(value, target = plugin) {
  regs.length = 0
  shared = new FakeForm(value)
  const slots = { inject: (_n, f) => f(), register: (o, C) => regs.push([o, C]) }
  target.apply({
    effect: (f) => f(),
    locale: { register: () => () => {} },
    slots,
    inject: (_deps, f) => f({ slots, configForms: { get: (id) => (assert.equal(id, 'mcp-hub'), shared) } }),
  })
  return regs[0]
}

const t = (k, v) => k + (v ? JSON.stringify(v) : '')
// Render the tree, expanding function components (fresh hook slots per render).
function render(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(render)
  if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children }))
  return { ...node, children: node.children.map(render) }
}
function page(view = 'page') {
  stateIndex = 0
  states = []
  const [opts, Page] = regs[0]
  return render(React.createElement(Page, { view, t, ...opts.inject() }))
}
const text = (n) => (n === null || n === undefined || n === false ? '' : typeof n !== 'object' ? String(n) : Array.isArray(n) ? n.map(text).join(' ') : text(n.children))
function find(n, pred, out = []) {
  if (n && typeof n === 'object') {
    if (Array.isArray(n)) n.forEach((c) => find(c, pred, out))
    else {
      if (pred(n)) out.push(n)
      find(n.children, pred, out)
    }
  }
  return out
}

const servers = [
  { name: 'memory', enabled: true, mode: 'eager', transport: 'stdio', command: 'npx', args: ['-y', 'x'] },
  { name: 'staging', enabled: true, mode: 'lazy', transport: 'http', url: 'https://example.com/mcp' },
]

test('registers on the plugin config slot with bound form functions', () => {
  const [opts] = mount({ servers })
  assert.equal(opts.name, 'plugins.bundle.config')
  assert.equal(opts.key, '@opfield/dsh-mcp-hub')
  assert.equal(page('summary'), 'summary')
})

// Re-render keeping hook state (expanded cards, loaded status).
function rerender() {
  stateIndex = 0
  return render(React.createElement(regs[0][1], { view: 'page', t, ...regs[0][0].inject() }))
}
async function loaded(body, value = { servers }) {
  statusBody = body
  mount(value)
  runEffects = true
  page() // first render kicks off the status load
  runEffects = false
  await new Promise((r) => realSetTimeout(r, 10))
  // keep only the page's own hook slots: the stub numbers hooks globally, and
  // children rendered before the status arrived would leave misplaced slots
  stateIndex = 0
  regs[0][1]({ view: 'page', t, ...regs[0][0].inject() })
  states.length = stateIndex
  return rerender()
}
const card = (tree, name) => find(tree, (n) => n.type === 'li' && n.props['data-server'] === name)[0]
const button = (node, label) => find(node, (n) => n.type === 'button' && text(n) === label)[0]

const runningStatus = {
  ok: true,
  missing: [],
  eagerTokens: 1200,
  lazyTokens: 4500,
  servers: [
    { name: 'memory', status: 'running', running: true, enabled: true, exposed: true, effectiveMode: 'eager', tokens: 1200, catalogTokens: 0, tools: [{ name: 'save', summary: 'Save.', tokens: 300 }] },
    { name: 'staging', status: 'auth', running: false, enabled: true, exposed: true, effectiveMode: 'lazy', tokens: 61000, catalogTokens: 4500, oauth: { signedIn: false }, tools: [] },
  ],
  contributors: [],
}

test('collapsed cards show one status line; sign-in stays reachable', async () => {
  const tree = await loaded(runningStatus)
  assert.deepEqual(find(tree, (n) => n.type === 'li' && n.props['data-server']).map((c) => c.props['data-server']), ['memory', 'staging'])
  assert.ok(requests.some(([p]) => p === 'mcp-hub/status'))
  const all = text(tree)
  assert.match(all, /servers\.title/)
  assert.match(all, /hub\.title/)
  assert.match(all, /stats\.lazy\{"tokens":"4\.5K"\}/)
  assert.match(text(card(tree, 'memory')), /line\.tools\{"count":1\}/)
  assert.match(text(card(tree, 'staging')), /status\.auth/)
  assert.ok(button(card(tree, 'staging'), 'action.signin'), 'OAuth server that is not signed in offers Sign in without expanding')
  assert.equal(button(card(tree, 'memory'), 'action.restart'), undefined, 'actions are inside the collapsed body')
  // expanding shows the actions
  find(card(tree, 'memory'), (n) => n.props?.className === 'mch-toggle')[0].props.onClick()
  const open = rerender()
  assert.ok(button(card(open, 'memory'), 'action.restart'))
  assert.equal(card(open, 'memory').props['data-open'], true)
})

test('servers from plugins: own section, no edit / remove / mode, problems shown', async () => {
  const tree = await loaded({
    ...runningStatus,
    servers: [...runningStatus.servers, { name: 'ops', owner: 'opfield', transport: 'http', status: 'running', running: true, enabled: true, exposed: true, effectiveMode: 'lazy', tokens: 9000, catalogTokens: 800, oauth: { signedIn: true }, tools: [{ name: 'a', summary: '', tokens: 1 }] }],
    contributors: [{ id: 'opfield', title: 'Opfield', description: '', servers: ['ops'], problems: [{ name: 'dup', reason: 'name used by a server in this hub' }] }],
  })
  const section = find(tree, (n) => n.type === 'section' && n.props['aria-labelledby'] === 'mch-from-opfield')[0]
  assert.ok(section)
  assert.match(text(section), /Opfield/)
  assert.match(text(section), /contrib\.desc/)
  assert.match(text(section), /contrib\.problem\{"name":"dup"/)
  const ops = card(section, 'ops')
  assert.ok(ops)
  assert.equal(find(ops, (n) => n.props?.role === 'tablist').length, 0)
  assert.equal(find(ops, (n) => n.props?.role === 'switch').length, 0)
  find(ops, (n) => n.props?.className === 'mch-toggle')[0].props.onClick()
  const open = rerender()
  const opsOpen = card(open, 'ops')
  assert.ok(button(opsOpen, 'action.restart'))
  assert.ok(button(opsOpen, 'action.signout'))
  assert.equal(button(opsOpen, 'action.edit'), undefined)
  assert.equal(button(opsOpen, 'action.remove'), undefined)
  // the own list does not repeat it
  const own = find(open, (n) => n.type === 'section' && n.props['aria-labelledby'] === 'mch-servers')[0]
  assert.equal(card(own, 'ops'), undefined)
})

test('mode switch and enable switch write the servers array', async () => {
  mount({ servers })
  const tree = page()
  const memory = card(tree, 'memory')
  const lazyTab = find(memory, (n) => n.type === 'button' && n.props.role === 'tab' && text(n) === 'mode.lazy')[0]
  lazyTab.props.onClick()
  await new Promise((r) => realSetTimeout(r, 0))
  assert.equal(shared.ops[0].op, 'set')
  assert.deepEqual(shared.ops[0].path, ['servers'])
  assert.equal(shared.ops[0].value[0].mode, 'lazy')
  assert.equal(shared.ops[0].value[1].mode, 'lazy')
  const sw = find(memory, (n) => n.type === 'button' && n.props.role === 'switch')[0]
  sw.props.onClick()
  await new Promise((r) => realSetTimeout(r, 0))
  assert.equal(shared.ops[1].value[0].enabled, false)
})

test('remove needs a second click', async () => {
  const tree = await loaded(runningStatus)
  find(card(tree, 'staging'), (n) => n.props?.className === 'mch-toggle')[0].props.onClick()
  const open = rerender()
  button(card(open, 'staging'), 'action.remove').props.onClick()
  assert.equal(shared.ops.length, 0)
  assert.ok(button(card(rerender(), 'staging'), 'action.confirmRemove'))
})

test('read-only form disables controls', () => {
  mount({ servers })
  shared.snap = { ...shared.snap, writable: false, mode: 'memory' }
  const tree = page()
  assert.match(text(tree), /memory/)
  const tabs = find(tree, (n) => n.type === 'button' && n.props.role === 'tab')
  assert.ok(tabs.length > 0 && tabs.every((b) => b.props.disabled))
})

// DSH primitives stub: each control renders as a marker element so the page tree shows which ones were used.
const UI_STUB = Object.fromEntries(['Button', 'Switch', 'SegmentedControl', 'Tag', 'StateDot', 'Input', 'Menu', 'IconChevronDownOutlineRegular'].map((n) => [n, (props) => ({ type: `ui:${n}`, props: props ?? {}, children: [] })]))

test('with DSH primitives the page uses them, not look-alikes', async () => {
  const withUI = globalThis.__mod.factory((name) => (name === 'react' ? React : name === '@deepseek-ai/dsh-client-ui-primitives' ? UI_STUB : null))
  statusBody = runningStatus
  mount({ servers }, withUI)
  runEffects = true
  page()
  runEffects = false
  await new Promise((r) => realSetTimeout(r, 10))
  stateIndex = 0
  regs[0][1]({ view: 'page', t, ...regs[0][0].inject() })
  states.length = stateIndex
  // expand a card and open the add form so buttons and inputs render too
  let tree = rerender()
  find(card(tree, 'memory'), (n) => n.props?.className === 'mch-toggle')[0].props.onClick()
  tree = rerender()
  const types = new Set(find(tree, (n) => typeof n.type === 'string' && n.type.startsWith('ui:')).map((n) => n.type))
  for (const t of ['ui:Button', 'ui:Switch', 'ui:SegmentedControl', 'ui:Tag', 'ui:StateDot']) assert.ok(types.has(t), t)
  assert.equal(find(tree, (n) => ['mch-btn', 'mch-switch', 'mch-seg', 'mch-tag', 'mch-dot'].includes(n.props?.className)).length, 0, 'no look-alike controls')
  const modes = find(tree, (n) => n.type === 'ui:SegmentedControl').map((n) => n.props.id)
  assert.equal(new Set(modes).size, modes.length, 'unique segmented ids')
  const remove = find(tree, (n) => n.type === 'ui:Button' && text(n.props.children) === 'action.remove')[0]
  assert.equal(remove.props.className, 'mch-danger')
})
