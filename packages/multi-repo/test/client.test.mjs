// Smoke test of the browser module with stub React/DOM: the factory loads,
// apply registers the three seats, and the views pick the right branches.
import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.window = { __ModuleLoader__: { load: (m) => (globalThis.__mrMod = m) } }
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, remove() {} }),
  head: { appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
}
const twoRoots = {
  ok: true,
  roots: [
    { name: 'ppc', path: '/p/ppc', primary: true, exists: true, git: true, branch: 'main', changes: 2 },
    { name: 'payca', path: '/p/payca', primary: false, exists: true, git: true, branch: 'dev', changes: 0 },
  ],
  writable: true,
  suggestions: [],
}
const oneRoot = { ...twoRoots, roots: [twoRoots.roots[0]] }
let body = twoRoots
const fetched = []
globalThis.fetch = async (url) => (fetched.push(url), { ok: true, headers: { get: () => 'application/json' }, json: async () => body })
await import('../client.js')

// Effects run synchronously so the shared cache fills during the first render.
const effects = []
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  memo: (f) => f,
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useRef: () => ({ current: null }),
  useMemo: (f) => f(),
  useCallback: (f) => f,
  useEffect: (f) => effects.push(f),
  useLayoutEffect: () => {},
}
const plugin = globalThis.__mrMod.factory((name) => (name === 'react' ? React : name === 'react-dom' ? { createPortal: (x) => x } : null))
const regs = new Map()
plugin.apply({
  effect: (f) => f(),
  locale: { register: () => () => {} },
  slots: { inject: (_n, f) => f(), register: (o, C) => regs.set(o.name, [o, C]) },
})

const flush = async () => {
  for (const f of effects.splice(0)) f()
  await new Promise((r) => setImmediate(r))
}
const text = (node) => (node === null || node === undefined || node === false ? '' : typeof node !== 'object' ? String(node) : (node.children ?? []).map(text).join(''))
const find = (node, pred) => {
  if (node === null || typeof node !== 'object') return null
  if (pred(node)) return node
  for (const c of node.children ?? []) {
    const hit = find(c, pred)
    if (hit) return hit
  }
  return null
}
const render = async (name, props) => {
  const C = regs.get(name)[1]
  C(props)
  await flush()
  return C(props)
}

test('registers composer, header and sidebar hover seats', () => {
  assert.deepEqual([...regs.keys()].sort(), ['conversation.composer.dock', 'conversation.session.header.actions', 'sidebar.session.row.hover'])
})

test('views with two roots', async () => {
  const header = await render('conversation.session.header.actions', { sessionId: 's1', t: undefined })
  assert.equal(text(find(header, (n) => n.props?.className === 'mrr-trigger-text')), 'ppc + payca')
  const composer = await render('conversation.composer.dock', { sessionId: 's1', t: undefined })
  assert.equal(text(find(composer, (n) => n.props?.className === 'mrr-trigger-text')), '2 roots')
  const hover = await render('sidebar.session.row.hover', { sessionId: 's1', t: undefined })
  assert.match(text(hover), /Roots: ppc \+ payca/)
  assert.ok(fetched.some((u) => u.includes('lite=1')), 'hover uses the lite state')
})

test('views of one session share a single request', async () => {
  const C = regs.get('conversation.composer.dock')[1]
  const before = fetched.length
  C({ sessionId: 's3', t: undefined })
  C({ sessionId: 's3', t: undefined })
  await flush()
  assert.equal(fetched.filter((u, i) => i >= before && u.includes('session=s3')).length, 1)
})

test('views with no extra roots', async () => {
  body = oneRoot
  assert.equal(await render('conversation.session.header.actions', { sessionId: 's2', t: undefined }), null)
  assert.equal(await render('sidebar.session.row.hover', { sessionId: 's2', t: undefined }), null)
  const composer = await render('conversation.composer.dock', { sessionId: 's2', t: undefined })
  assert.ok(composer !== null, 'composer button stays to attach roots')
  assert.equal(find(composer, (n) => n.props?.className === 'mrr-trigger-text'), null)
})
