// Config schema against the Harness's own Schemastery (skipped when no extracted
// installation is around: npm install at the repository root, or DSH_NODE_MODULES).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildConfig, DEFAULTS, publicConfig, resolveConfig } from '../index.js'

const root = process.env.DSH_NODE_MODULES ?? fileURLToPath(new URL('../../../node_modules', import.meta.url))
const entry = join(root, '@deepseek-ai/schemastery/lib/index.mjs')
const z = existsSync(entry) ? (await import(pathToFileURL(entry).href)).default : undefined

test('resolveConfig: instances validated, inference must name one of them', () => {
  const cfg = resolveConfig({
    instances: [
      { name: 'ops', url: 'https://ops.test/some/path' },
      { name: 'ops', url: 'https://dup.test' },
      { name: 'bad name', url: 'https://x.test' },
      { name: 'nourl', url: 'ftp://x' },
      { name: 'staging', url: 'https://staging.test', mcp: false, mode: 'eager' },
    ],
    inference: 'ops',
    advanced: { warnPercent: 30 },
  })
  assert.deepEqual(cfg.instances, [
    { mcp: true, name: 'ops', url: 'https://ops.test' },
    { mcp: false, name: 'staging', url: 'https://staging.test' },
  ])
  assert.equal(cfg.inference, 'ops')
  assert.equal(cfg.advanced.warnPercent, 30)
  assert.equal(cfg.advanced.route, 'opfield')
  assert.equal(resolveConfig({ ...cfg, inference: 'gone' }).inference, '')
  const pub = publicConfig(cfg)
  assert.deepEqual(pub.providers, ['opfield'])
  assert.equal(pub.display.usagePill, true)
  assert.equal(pub.cacheTtlMs, 60 * 60000)
  // no inference instance: no budget pill, cache timer stays
  const none = publicConfig(resolveConfig({ instances: cfg.instances }))
  assert.equal(none.display.usagePill, false)
  assert.equal(none.display.cachePill, true)
  assert.deepEqual(none.providers, [])
  // components follow the enabled sub-plugins
  const some = publicConfig(cfg, new Set(['cachePill']))
  assert.deepEqual([some.display.usagePill, some.display.cachePill, some.compactSuggestion.enabled], [false, true, false])
})

test('resolveConfig: 0.3 settings become one inference instance', () => {
  const cfg = resolveConfig({ baseURL: 'https://ops.test', apiKeyEnv: 'X', display: { cachePill: false, warnPercent: 25 }, compactSuggestion: { minTokens: 1000 }, modelSync: { intervalMinutes: 30 } })
  assert.deepEqual(cfg.instances, [{ mcp: false, name: 'opfield', url: 'https://ops.test' }])
  assert.equal(cfg.inference, 'opfield')
  assert.equal(cfg.compactMinTokens, 1000)
  assert.equal(cfg.advanced.warnPercent, 25)
  assert.equal(cfg.advanced.syncIntervalMinutes, 30)
})

test('Config: volatile fields, defaults fill, bundle patch validates', { skip: z === undefined && 'no Schemastery' }, async () => {
  const Config = buildConfig(z)
  assert.deepEqual(resolveConfig(Config({})), resolveConfig({}))
  assert.deepEqual(resolveConfig({}), { ...DEFAULTS, instances: [], inference: '' })
  const yaml = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const { parse } = await import(pathToFileURL(join(root, 'yaml/dist/index.js')).href).catch(() => ({}))
  if (parse !== undefined) {
    const rows = parse(yaml)[0].insert
    const row = rows.find((r) => r.id === 'opfield-usage')
    assert.deepEqual(rows.slice(1).map((r) => r.name), ['@opfield/dsh-opfield/budget', '@opfield/dsh-opfield/cache-timer', '@opfield/dsh-opfield/compact-offer'])
    assert.deepEqual(resolveConfig(Config(row.config)), resolveConfig(row.config))
  }
  // 0.4.0 profiles still carry `mode` and `components`; they must keep validating
  const parsed = Config({ instances: [{ name: 'ops', url: 'https://ops.test', mode: 'eager' }], inference: 'ops', components: { cachePill: false } })
  assert.equal(typeof parsed.instances.get, 'function', 'volatile reference')
  const cfg = resolveConfig(parsed)
  assert.equal(cfg.instances[0].mode, undefined)
  assert.equal(cfg.components, undefined)
  assert.throws(() => Config({ instances: [{ name: 'bad name', url: 'https://x' }] }))
  assert.throws(() => Config({ advanced: { warnPercent: 150 } }))
  assert.ok(JSON.stringify(Config.toJSON()).includes('"volatile":true'))
})
