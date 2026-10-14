// Hub against a real stdio MCP server, using the Harness installation's SDK.
// Needs the Harness packages: the repository's devDependencies (npm install at the
// root) or DSH_NODE_MODULES=<app.asar>/dsh/node_modules; skipped when absent.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

process.env.DSH_NODE_MODULES ??= fileURLToPath(new URL('../../../node_modules', import.meta.url))
const available = existsSync(join(process.env.DSH_NODE_MODULES, '@modelcontextprotocol/client'))
const mod = await import('../index.js')
const { Hub, resolveConfig, buildConfig, Config } = mod
const { CALL_TOOL, DESCRIBE_TOOL } = await import('../catalog.js')
const { loadInstall } = await import('../install.js')
const install = await loadInstall()

const fake = new URL('./fake-server.mjs', import.meta.url).pathname
const dataDir = mkdtempSync(join(tmpdir(), 'mcp-hub-test-'))
after(() => rmSync(dataDir, { recursive: true, force: true }))

function fakeCtx() {
  const registry = new Map()
  return {
    registry,
    logger: { info() {}, warn() {}, error: (...a) => console.error(...a) },
    tools: {
      register(def) {
        if (registry.has(def.name)) throw new Error(`duplicate ${def.name}`)
        install.assertSupportedJsonSchema?.(def.parameters)
        registry.set(def.name, def)
        return () => registry.delete(def.name)
      },
    },
  }
}

const exec = () => ({ signal: new AbortController().signal })
const server = (over = {}) => ({ name: 'fake', command: process.execPath, args: [fake], ...over })
const settle = () => new Promise((r) => setTimeout(r, 20))
// Every hub is disposed even when an assertion fails, so no child keeps the runner alive.
const hubs = []
after(async () => { await Promise.all(hubs.map((h) => h.dispose())) })
const track = (hub) => (hubs.push(hub), hub)

test('config schema accepts a server list and stays volatile', { skip: !available }, () => {
  const parsed = Config({ servers: [server({ mode: 'lazy' })] })
  assert.equal(typeof parsed.servers.get, 'function')
  const cfg = resolveConfig(parsed)
  assert.equal(cfg.servers[0].mode, 'lazy')
  assert.equal(cfg.servers[0].transport, 'stdio')
  assert.equal(cfg.servers[0].idleStopMinutes, 0)
  assert.throws(() => Config({ servers: [{ name: 'bad name!' }] }))
  assert.throws(() => Config({ servers: [server({ mode: 'sometimes' })] }))
  assert.ok(buildConfig(install.z))
})

test('eager: native tool names, calls reach the server', { skip: !available }, async () => {
  const ctx = fakeCtx()
  let cfg = resolveConfig({ servers: [server({ mode: 'eager' })] })
  const hub = track(new Hub(ctx, () => cfg, { install, dataDir }))
  await Promise.all(hub.reconcile())
  await settle()
  assert.deepEqual([...ctx.registry.keys()].sort(), ['mcp__fake__big', 'mcp__fake__echo'])
  const value = await ctx.registry.get('mcp__fake__echo').execute({ text: 'hi' }, exec())
  assert.equal(value.content[0].text, 'echo:hi')
  assert.equal(hub.status().servers[0].status, 'running')
  assert.equal(hub.instructionsFor(hub.servers.get('fake')), '### MCP server: fake\n\nFake server for tests.')

  // switching to lazy swaps the native tools for the two meta tools, live
  cfg = resolveConfig({ servers: [server({ mode: 'lazy' })] })
  hub.reconcile()
  await settle()
  assert.deepEqual([...ctx.registry.keys()].sort(), [CALL_TOOL, DESCRIBE_TOOL])
  assert.equal(hub.instructionsFor(hub.servers.get('fake')), '', 'lazy servers keep their instructions out of the prompt')
  await hub.dispose()
})

test('lazy: catalog in the description, describe, call, schema on bad args', { skip: !available }, async () => {
  const ctx = fakeCtx()
  const cfg = resolveConfig({ servers: [server({ mode: 'lazy', description: 'Test server' })] })
  const hub = track(new Hub(ctx, () => cfg, { install, dataDir }))
  await Promise.all(hub.reconcile())
  await settle()
  const call = ctx.registry.get(CALL_TOOL)
  assert.match(call.description, /## fake — Test server/)
  assert.match(call.description, /- echo: Echo the text back\./)
  assert.doesNotMatch(call.description, /Second sentence/)
  assert.deepEqual(call.parameters.properties.server.enum, ['fake'])

  const described = await ctx.registry.get(DESCRIBE_TOOL).execute({ server: 'fake', tool: 'echo' }, exec())
  assert.match(described, /"required": \[\n\s+"text"/)

  const value = await call.execute({ server: 'fake', tool: 'echo', args: { text: 'yo' } }, exec())
  assert.equal(value.content[0].text, 'echo:yo')
  await assert.rejects(call.execute({ server: 'fake', tool: 'echo', args: {} }, exec()), /Input schema of fake\/echo/)
  await assert.rejects(call.execute({ server: 'fake', tool: 'nope', args: {} }, exec()), /Its tools: echo, big/)
  await assert.rejects(call.execute({ server: 'other', tool: 'echo' }, exec()), /Unknown MCP server/)
  await hub.dispose()
})

test('auto picks by size; catalog cache serves a stopped server; idle restart on call', { skip: !available }, async () => {
  const ctx = fakeCtx()
  let cfg = resolveConfig({ autoEagerMaxTokens: 400, servers: [server({ name: 'small' }), server({ name: 'large', env: { BIG: '30' } })] })
  let hub = track(new Hub(ctx, () => cfg, { install, dataDir }))
  await Promise.all(hub.reconcile())
  await settle()
  const status = Object.fromEntries(hub.status().servers.map((s) => [s.name, s.effectiveMode]))
  assert.deepEqual(status, { small: 'eager', large: 'lazy' })
  await hub.dispose()

  // a new hub with connectAtStartup off sees the cached catalog and starts on first call
  cfg = resolveConfig({ servers: [server({ name: 'small', mode: 'eager', connectAtStartup: false })] })
  hub = track(new Hub(ctx, () => cfg, { install, dataDir }))
  hub.reconcile()
  await settle()
  const s = hub.servers.get('small')
  assert.equal(s.fromCache, true)
  assert.equal(s.running, false)
  assert.ok(ctx.registry.has('mcp__small__echo'))
  const value = await ctx.registry.get('mcp__small__echo').execute({ text: 'cold' }, exec())
  assert.equal(value.content[0].text, 'echo:cold')
  assert.equal(s.running, true)
  await hub.dispose()
})

test('broken server reports error with stderr; disabled server registers nothing', { skip: !available }, async () => {
  const ctx = fakeCtx()
  const cfg = resolveConfig({
    startupTimeoutMs: 3000,
    servers: [server({ name: 'broken', args: ['-e', 'console.error("boom: missing token"); process.exit(1)'] }), server({ name: 'off', enabled: false })],
  })
  const hub = track(new Hub(ctx, () => cfg, { install, dataDir }))
  await Promise.all(hub.reconcile())
  await settle()
  const views = Object.fromEntries(hub.status().servers.map((s) => [s.name, s]))
  assert.equal(views.broken.status, 'error')
  assert.match(views.broken.error, /boom: missing token/)
  assert.equal(views.off.status, 'disabled')
  assert.equal(ctx.registry.size, 0)
  await hub.dispose()
})

test('mcpHub service: contributed servers, hidden from the model, raw calls, conflicts, change events', { skip: !available }, async () => {
  const ctx = fakeCtx()
  const cfg = resolveConfig({ servers: [server({ name: 'plain', mode: 'eager' })] })
  const hub = track(new Hub(ctx, () => cfg, { install, dataDir }))
  const api = hub.service()
  assert.equal(api.version, 1)
  let changes = 0
  api.onChange(() => changes++)
  await Promise.all(hub.reconcile())
  // a plugin contributes one server the model sees and one it does not, plus two bad entries
  const reg = api.register({ id: 'acme', title: 'Acme', description: 'Acme instances' }, [
    server({ name: 'owned', mode: 'eager' }),
    server({ name: 'quiet', mode: 'eager', expose: false }),
    { name: 'bad name', command: 'x' },
    { name: 'nourl', transport: 'http' },
  ])
  await Promise.all(['owned', 'quiet'].map((n) => hub.servers.get(n).ensure()))
  await settle()
  assert.deepEqual([...ctx.registry.keys()].filter((n) => n.startsWith('mcp__')).sort(), ['mcp__owned__big', 'mcp__owned__echo', 'mcp__plain__big', 'mcp__plain__echo'])
  assert.equal(api.status('owned').owner, 'acme')
  assert.equal(api.status('quiet').exposed, false)
  assert.deepEqual(api.servers({ owner: 'acme' }).map((s) => s.name), ['owned', 'quiet'])
  assert.deepEqual(reg.problems.map((p) => p.name), ['bad name', 'nourl'])
  const [contributor] = hub.status().contributors
  assert.deepEqual([contributor.id, contributor.title, contributor.description], ['acme', 'Acme', 'Acme instances'])
  const value = await api.call('quiet', 'echo', { text: 'raw' })
  assert.equal(value.content[0].text, 'echo:raw')
  assert.ok(changes > 0)
  // the user's own server keeps its name; the plugin's clash is reported, not applied
  reg.update([server({ name: 'plain', mode: 'lazy' })])
  await settle()
  assert.equal(api.status('plain').owner, undefined)
  assert.deepEqual(reg.problems, [{ name: 'plain', reason: 'name used by a server in this hub' }])
  // a second plugin cannot take a name the first one holds
  reg.update([server({ name: 'owned', mode: 'lazy' })])
  const other = api.register('other', [server({ name: 'owned' })])
  await settle()
  assert.equal(api.status('owned').owner, 'acme')
  assert.match(other.problems[0].reason, /Acme/)
  other()
  reg.dispose()
  await settle()
  assert.equal(api.status('owned'), undefined)
  assert.deepEqual(hub.status().contributors, [])
  assert.throws(() => api.register('', []), /owner id/)
  await hub.dispose()
})
