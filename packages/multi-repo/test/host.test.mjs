import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { after, test } from 'node:test'
import { apply, patchMethod, wrapCheckedTarget, wrapConfine } from '../index.js'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'mr-host-')))
after(() => rmSync(base, { recursive: true, force: true }))
const dir = (...parts) => {
  const path = join(base, ...parts)
  mkdirSync(path, { recursive: true })
  return path
}
const primary = dir('payca')
const ppc = dir('ppc')
writeFileSync(join(ppc, 'AGENTS.md'), 'PPC rules: use pnpm.\n')
writeFileSync(join(ppc, 'CLAUDE.md'), 'PPC rules: use pnpm.\n')

class FakeFs {
  constructor(ctx) {
    this.ctx = ctx
  }
  async resolve(path) {
    return { displayPath: path, targetKey: path }
  }
  async checkedTarget(target, policy) {
    if (policy.mode === 'workspace-write' && !target.targetKey.startsWith(policy.workspaceRoot + '/')) {
      throw Object.assign(new Error('denied'), { code: 'FS_SANDBOX_DENIED' })
    }
    return target
  }
}
class FakeSandbox {
  async confine(argv, policy) {
    return { argv: ['bwrap', '--ro-bind', '/', '/', '--die-with-parent', '--bind', policy.workspaceRoot, policy.workspaceRoot, '--', ...argv], enforcement: 'full' }
  }
}

const workspace = {
  path: primary,
  title: 'payca',
  async setTitle(title) {
    this.title = title
  },
}

function harness(initial = []) {
  const disposers = []
  const records = new Map(initial)
  const registered = { tools: [], commands: [], contexts: [], routes: new Map() }
  const services = {
    storageDomain: {
      async open() {
        return {
          table: () => ({
            get: (k) => records.get(k),
            entries: () => records.entries(),
            put: async (k, v) => void records.set(k, v),
            delete: async (k) => void records.delete(k),
          }),
          close() {},
        }
      },
    },
    fs: new FakeFs(null),
    sandbox: new FakeSandbox(),
    systemPrompt: { context: (c) => (registered.contexts.push(c), () => {}) },
    tools: { register: (t) => (registered.tools.push(t), () => {}) },
    commands: { register: (c) => (registered.commands.push(c), () => {}) },
    webServer: { register: (r) => (registered.routes.set(r.path, r.handler), () => {}) },
    connection: { requestRejection: () => undefined },
    sessions: { get: (id) => (id === 's1' ? { header: { cwd: primary } } : undefined) },
    workspaceRegistry: {
      list: () => [workspace],
    },
  }
  const ctx = {
    ...services,
    logger: { error() {}, warn() {}, info() {} },
    get: (name) => services[name],
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') disposers.push(d)
    },
    inject(_names, cb) {
      cb(ctx)
    },
  }
  return { ctx, registered, records, dispose: () => disposers.reverse().forEach((d) => d()) }
}

const tick = () => new Promise((r) => setImmediate(r))

test('patchMethod wraps the owning prototype and undoes', async () => {
  class A {
    m() {
      return 1
    }
  }
  const a = new A()
  const undo = patchMethod(a, 'm', (orig) => function () {
    return orig.call(this) + 1
  })
  assert.equal(a.m(), 2)
  assert.equal(patchMethod(a, 'm', (o) => o), null, 'second patch is refused')
  undo()
  assert.equal(a.m(), 1)
  assert.equal(patchMethod(a, 'nope', (o) => o), null)
})

test('wrappers only widen workspace-write for attached roots', async () => {
  const fs = new FakeFs({ sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/w' }) } })
  const checked = wrapCheckedTarget(FakeFs.prototype.checkedTarget, () => ['/r'])
  const ww = { mode: 'workspace-write', workspaceRoot: '/w' }
  assert.equal((await checked.call(fs, { displayPath: '/r/x', targetKey: '/r/x' }, ww)).targetKey, '/r/x')
  await assert.rejects(checked.call(fs, { displayPath: '/rr/x', targetKey: '/rr/x' }, ww), /denied/)
  const ro = { mode: 'read-only', workspaceRoot: '/w' }
  const roFs = Object.assign(new FakeFs(null), { checkedTarget: undefined })
  await assert.rejects(
    wrapCheckedTarget(async () => { throw Object.assign(new Error('ro'), { code: 'FS_SANDBOX_DENIED' }) }, () => ['/r']).call(roFs, { displayPath: '/r/x', targetKey: '/r/x' }, ro),
    /ro/,
  )
  const confine = wrapConfine(FakeSandbox.prototype.confine, () => ['/r'])
  const out = await confine.call(new FakeSandbox(), ['true'], ww)
  assert.deepEqual(out.argv.slice(-5), ['--bind', '/r', '/r', '--', 'true'])
  const full = await confine.call(new FakeSandbox(), ['true'], { mode: 'danger-full-access', workspaceRoot: '/w' })
  assert.ok(!full.argv.includes('/r'))
})

test('plugin end to end: command, context, sandbox, routes', async () => {
  const { ctx, registered, records, dispose } = harness()
  apply(ctx, {})
  await tick()
  const command = registered.commands.find((c) => c.name === 'roots')
  const agent = { session: { header: { cwd: primary } } }

  const added = await command.handler({ agent, rawInput: ` add "${ppc}"` })
  assert.equal(added.kind, 'success', added.text)
  assert.deepEqual(records.get(primary), { roots: [{ name: 'ppc', path: ppc }] })
  assert.equal(workspace.title, 'payca + ppc', 'sidebar title shows the roots')
  assert.equal((await command.handler({ agent, rawInput: 'add /definitely/missing' })).kind, 'error')
  assert.match((await command.handler({ agent, rawInput: '' })).text, /ppc: /)

  const context = registered.contexts[0]
  const text = context.text({ agent })
  assert.match(text, /# Workspace roots/)
  assert.match(text, /every root above is writable/)
  assert.equal(text.match(/PPC rules/g).length, 1, 'duplicate CLAUDE.md is folded')
  assert.equal(context.text({ agent: { session: { header: { cwd: ppc } } } }), '')

  // fs fence and shell sandbox now accept the attached root.
  const ww = { mode: 'workspace-write', workspaceRoot: primary }
  const target = { displayPath: join(ppc, 'a.txt'), targetKey: join(ppc, 'a.txt') }
  assert.equal((await ctx.fs.checkedTarget(target, ww)).targetKey, target.targetKey)
  await assert.rejects(ctx.fs.checkedTarget({ displayPath: join(base, 'x'), targetKey: join(base, 'x') }, ww))
  const confined = await ctx.sandbox.confine(['true'], ww)
  assert.ok(confined.argv.includes(ppc))

  // tool output lists both roots.
  const tool = registered.tools.find((t) => t.name === 'workspace_roots')
  const status = await tool.execute({}, { agent })
  assert.match(status, /## payca \(primary\)/)
  assert.match(status, /## ppc  /)

  // HTTP routes.
  const call = async (path, method, body, url = path) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method, url })
    let payload
    const res = { statusCode: 0, setHeader() {}, end: (s) => (payload = s ? JSON.parse(s) : undefined) }
    await registered.routes.get(path)(req, res)
    return { status: res.statusCode, body: payload }
  }
  const state = await call('/multi-repo/state', 'GET', undefined, '/multi-repo/state?session=s1')
  assert.equal(state.body.ok, true)
  assert.deepEqual(state.body.roots.map((r) => r.name), ['payca', 'ppc'])
  assert.equal(state.body.writable, true)
  const lite = await call('/multi-repo/state', 'GET', undefined, '/multi-repo/state?session=s1&lite=1')
  assert.equal(lite.body.lite, true)
  assert.deepEqual(lite.body.roots.map((r) => [r.name, r.exists]), [['payca', true], ['ppc', true]])
  const bad = await call('/multi-repo/roots', 'POST', { session: 's1', action: 'add', path: primary })
  assert.equal(bad.body.ok, false)
  assert.match(bad.body.message, /already the primary root/)
  const removed = await call('/multi-repo/roots', 'POST', { session: 's1', action: 'remove', name: 'ppc' })
  assert.deepEqual(removed.body.roots.map((r) => r.name), ['payca'])
  assert.equal(records.has(primary), false)
  assert.equal(workspace.title, 'payca', 'title restored after the last root is detached')
  workspace.title = 'My payments'
  await call('/multi-repo/roots', 'POST', { session: 's1', action: 'add', path: ppc })
  assert.equal(workspace.title, 'My payments', 'a user title is never replaced')
  assert.equal((await call('/multi-repo/roots', 'POST', { session: 'zz', action: 'remove', name: 'x' })).status, 404)

  assert.equal((await call('/multi-repo/roots', 'GET', undefined)).status, 405)
  assert.equal((await call('/multi-repo/roots', 'POST', [1, 2])).status, 400)

  dispose()
  const mark = Symbol.for('dsh-multi-repo/patched')
  assert.equal(FakeFs.prototype.checkedTarget[mark], undefined, 'fs patch undone')
  assert.equal(FakeSandbox.prototype.confine[mark], undefined, 'sandbox patch undone')
})

test('an unknown sandbox runner is reported to the model', async () => {
  const { ctx, registered, dispose } = harness([[primary, { roots: [{ name: 'ppc', path: ppc }] }]])
  ctx.sandbox = new (class {
    async confine(argv) {
      return { argv: ['runner.exe', '--', ...argv], enforcement: 'full' }
    }
  })()
  apply(ctx, {})
  await tick()
  const agent = { session: { header: { cwd: primary } } }
  assert.match(registered.contexts[0].text({ agent }), /every root above is writable/)
  const out = await ctx.sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: primary })
  assert.deepEqual(out.argv, ['runner.exe', '--', 'true'], 'argv left as the runner made it')
  assert.match(registered.contexts[0].text({ agent }), /shell commands can write only to the primary root/)
  dispose()
})

test('extendSandbox false patches nothing and keeps roots read-only', async () => {
  const { ctx, registered, dispose } = harness([[primary, { roots: [{ name: 'ppc', path: ppc }] }]])
  apply(ctx, { extendSandbox: false })
  await tick()
  const mark = Symbol.for('dsh-multi-repo/patched')
  assert.equal(FakeFs.prototype.checkedTarget[mark], undefined)
  assert.equal(FakeSandbox.prototype.confine[mark], undefined)
  assert.match(registered.contexts[0].text({ agent: { session: { header: { cwd: primary } } } }), /outside the sandbox write boundary/)
  dispose()
})

test('stored roots retitle the workspace at startup', async () => {
  workspace.title = 'payca'
  const { ctx, dispose } = harness([[primary, { roots: [{ name: 'ppc', path: ppc }] }]])
  apply(ctx, {})
  await tick()
  await tick()
  assert.equal(workspace.title, 'payca + ppc')
  dispose()
  workspace.title = 'payca'
})
