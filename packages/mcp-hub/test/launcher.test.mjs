import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { findCached, followsLatest, parseNpx, planLaunch } from '../launcher.js'
import { convertEntry, migrate } from '../scripts/migrate.mjs'

process.env.DSH_NODE_MODULES ??= fileURLToPath(new URL('../../../node_modules', import.meta.url))
const hasInstall = existsSync(join(process.env.DSH_NODE_MODULES, 'yaml'))
const root = mkdtempSync(join(tmpdir(), 'mcp-hub-launch-'))
after(() => rmSync(root, { recursive: true, force: true }))

// fake npm cache with one package whose bin is the fake MCP server
function fakeCache() {
  const cache = join(root, 'npm-cache')
  const pkgRoot = join(cache, '_npx', 'abc123')
  const dir = join(pkgRoot, 'node_modules', '@acme', 'mcp')
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({ dependencies: { '@acme/mcp': '^1.2.3' }, _npx: { packages: ['@acme/mcp@latest'] } }))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@acme/mcp', version: '1.2.3', bin: { mcp: 'dist/index.mjs' } }))
  copyFileSync(new URL('./fake-server.mjs', import.meta.url), join(dir, 'dist', 'index.mjs'))
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'npx'), '#!/bin/sh\nexit 99\n', { mode: 0o755 })
  if (!existsSync(join(bin, 'node'))) symlinkSync(process.execPath, join(bin, 'node'))
  return { cache, bin, dir }
}

test('parseNpx', () => {
  assert.deepEqual(parseNpx('/x/npx', ['-y', '@acme/mcp@latest', '--flag']), { spec: '@acme/mcp@latest', name: '@acme/mcp', range: 'latest', rest: ['--flag'] })
  assert.deepEqual(parseNpx('npx', ['tool']), { spec: 'tool', name: 'tool', range: '', rest: [] })
  assert.equal(parseNpx('node', ['x.js']), undefined)
  assert.equal(parseNpx('npx', ['-p', 'a', 'b']), undefined)
  assert.equal(parseNpx('npx', ['./local']), undefined)
  assert.ok(followsLatest('latest') && followsLatest('') && followsLatest('next'))
  assert.ok(!followsLatest('1.2.3') && !followsLatest('^1.0.0'))
})

test('planLaunch runs a cached package with node, falls back to npx otherwise', () => {
  const { cache, bin, dir } = fakeCache()
  const parsed = parseNpx(join(bin, 'npx'), ['-y', '@acme/mcp@latest'])
  assert.equal(findCached(parsed, cache).version, '1.2.3')
  const plan = planLaunch({ command: join(bin, 'npx'), args: ['-y', '@acme/mcp@latest', '--x'] }, cache)
  assert.equal(plan.direct, true)
  assert.equal(plan.command, join(bin, 'node'))
  assert.deepEqual(plan.args, [join(dir, 'dist', 'index.mjs'), '--x'])
  assert.match(plan.env.PATH, /_npx\/abc123\/node_modules\/\.bin/)
  assert.equal(planLaunch({ command: join(bin, 'npx'), args: ['-y', '@other/pkg'] }, cache).direct, false)
  assert.equal(planLaunch({ command: join(bin, 'npx'), args: ['-y', '@acme/mcp@latest'], launcher: 'npx' }, cache).direct, false)
})

test('a hub server launched directly answers and reports its version', { skip: !hasInstall }, async () => {
  const { cache, bin } = fakeCache()
  const { Hub, resolveConfig } = await import('../index.js')
  const { loadInstall } = await import('../install.js')
  const install = await loadInstall()
  const registry = new Map()
  const ctx = { logger: { info() {}, warn() {}, error() {} }, tools: { register: (d) => (registry.set(d.name, d), () => registry.delete(d.name)) } }
  const cfg = resolveConfig({ servers: [{ name: 'acme', mode: 'eager', command: join(bin, 'npx'), args: ['-y', '@acme/mcp@latest'] }] })
  const hub = new Hub(ctx, () => cfg, { install, dataDir: join(root, 'data'), npmCacheDir: cache, updates: false })
  try {
    const started = hub.reconcile()
    await Promise.all(started)
    await new Promise((r) => setTimeout(r, 20))
    const view = hub.status().servers[0]
    assert.equal(view.status, 'running', `${view.error} | ${view.stderr} | ${JSON.stringify(hub.servers.get('acme').launch)}`)
    assert.deepEqual(view.launch, { direct: true, version: '1.2.3', npx: true })
    const value = await registry.get('mcp__acme__echo').execute({ text: 'direct' }, { signal: new AbortController().signal })
    assert.equal(value.content[0].text, 'echo:direct')
  } finally {
    await hub.dispose()
  }
})

const npx = '/u/.nvm/versions/node/v24/bin/npx'
const node = '/u/.nvm/versions/node/v24/bin/node'
const ENTRIES = [
  { id: 'mcp-agent-memory', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'agent-memory', transport: 'stdio', command: npx, args: ['-y', '@example/memory-mcp@latest'] } },
  { id: 'mcp-lazy-opfield', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'lazy-opfield', transport: 'stdio', command: node, args: ['/w/mcp-lazy/bin/mcp-lazy.js', '--name', 'opfield', 'stdio', '--', npx, '-y', 'mcp-remote', 'https://ops.example/api/mcp'] } },
  { id: 'mcp-remote-plain', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'gh', transport: 'stdio', command: npx, args: ['-y', 'mcp-remote', 'https://gh.example/mcp', '--header', 'Authorization: Bearer ${TOKEN}'] } },
  { id: 'mcp-http', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'docs', transport: 'streamable-http', url: 'https://docs.example/mcp', toolCallTimeoutMs: 120000 } },
  { id: 'mcp-lazy-stdio', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'lazy-big', transport: 'stdio', command: node, args: ['/w/mcp-lazy/bin/mcp-lazy.js', 'stdio', '--', 'big-server', '--x'], env: { K: 'v' } } },
]

test('convertEntry unwraps mcp-lazy and mcp-remote', () => {
  assert.deepEqual(ENTRIES.map(convertEntry), [
    { name: 'agent-memory', mode: 'auto', transport: 'stdio', command: npx, args: ['-y', '@example/memory-mcp@latest'], enabled: true },
    { name: 'opfield', mode: 'lazy', transport: 'http', url: 'https://ops.example/api/mcp', enabled: true },
    { name: 'gh', mode: 'auto', transport: 'http', url: 'https://gh.example/mcp', headers: { Authorization: 'Bearer ${TOKEN}' }, enabled: true },
    { name: 'docs', mode: 'auto', transport: 'http', url: 'https://docs.example/mcp', enabled: true, toolCallTimeoutMs: 120000 },
    { name: 'big', mode: 'lazy', transport: 'stdio', command: 'big-server', args: ['--x'], env: { K: 'v' }, enabled: true },
  ])
})

test('migrate rewrites a profile patch with a backup and keeps other ops', { skip: !hasInstall }, () => {
  const dir = join(root, 'profile')
  mkdirSync(dir, { recursive: true })
  const patch = [
    '- id: ui-chat',
    '  name: x',
    '  config: { a: 1 }',
    ...ENTRIES.slice(0, 2).map((e) => `- insert:\n    - ${JSON.stringify(e)}`),
    `- insert:\n    - { id: other, name: some-plugin }\n    - ${JSON.stringify(ENTRIES[3])}`,
    '',
  ].join('\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  const dry = migrate(dir, { dryRun: true })
  assert.deepEqual(dry.servers.map((s) => s.name), ['agent-memory', 'opfield', 'docs'])
  assert.equal(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'), patch, 'dry run writes nothing')
  const result = migrate(dir)
  assert.equal(result.removed, 3)
  assert.equal(readFileSync(join(dir, 'cordis.patch.yml.bak-before-mcp-hub'), 'utf8'), patch)
  const text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
  assert.doesNotMatch(text, /dsh-mcp-client/)
  assert.match(text, /id: other/)
  assert.match(text, /id: ui-chat/)
  assert.match(text, /id: mcp-hub/)
  // a second run with one more old entry appends without duplicates
  writeFileSync(join(dir, 'cordis.patch.yml'), `${text}- insert:\n    - ${JSON.stringify(ENTRIES[4])}\n    - ${JSON.stringify(ENTRIES[0])}\n`)
  const again = migrate(dir)
  assert.deepEqual(again.servers, ['big'])
})
