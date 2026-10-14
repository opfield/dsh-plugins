import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import { mergeModels, modelFilter, piModelOf, piModelsOf, syncModels } from '../model-sync.js'

const opus = {
  id: 'claude-opus-5.5',
  display_name: 'Claude Opus 5.5',
  context_window: 372000,
  max_output_tokens: 128000,
  input_modalities: ['text', 'image'],
  capabilities: { reasoning: true, vision: true },
  supported_reasoning_efforts: ['low', 'medium', 'high'],
}
const gpt = { ...opus, id: 'gpt-6-astra', display_name: 'GPT-6 Astra', supported_reasoning_efforts: ['low', 'xhigh', 'max', 'ultra'] }
const gemini = { ...opus, id: 'google/gemini-3.6-flash', input_modalities: ['text', 'image', 'audio'], supported_reasoning_efforts: ['minimal', 'high'] }

test('maps one gateway entry', () => {
  assert.deepEqual(piModelOf(opus), {
    id: 'claude-opus-5.5',
    name: 'Claude Opus 5.5',
    contextWindow: 372000,
    maxTokens: 128000,
    input: ['text', 'image'],
    reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' },
  })
  assert.deepEqual(piModelOf(gpt).reasoningEfforts, { low: 'low', xhigh: 'xhigh', max: 'max' }, 'ultra has no pi-ai level')
  assert.deepEqual(piModelOf(gemini).input, ['text', 'image'], 'audio is not a pi-ai modality')
  assert.equal(piModelOf({ ...opus, capabilities: { reasoning: false } }).reasoningEfforts, false)
  assert.equal(piModelOf({}), undefined)
})

test('filter globs', () => {
  const f = modelFilter({ include: ['claude-*', 'gpt-*'], exclude: ['*fable*'] })
  assert.equal(f('claude-opus-5.5'), true)
  assert.equal(f('claude-fable-5-1'), false)
  assert.equal(f('glm-5.3'), false)
  assert.equal(modelFilter()('anything/at.all'), true)
  assert.deepEqual(piModelsOf({ data: [opus, opus, gpt] }).map((m) => m.id), ['claude-opus-5.5', 'gpt-6-astra'])
})

test('merge keeps extras, drops stale facts and vanished models', () => {
  const existing = [
    { id: 'claude-opus-5.5', name: 'old', compat: { x: 1 }, maxTokens: 5 },
    { id: 'gone', name: 'Gone' },
  ]
  const synced = [{ id: 'claude-opus-5.5', name: 'Claude Opus 5.5', input: ['text', 'image'] }]
  assert.deepEqual(mergeModels(existing, synced), [{ id: 'claude-opus-5.5', name: 'Claude Opus 5.5', compat: { x: 1 }, input: ['text', 'image'] }])
})

function fakeSettings(models) {
  const calls = []
  return {
    calls,
    describe: () => [{ ns: 'llm-pi-ai', revision: 7, value: { providers: { opfield: { baseURL: 'https://g.test/v1/', apiKeyEnv: 'K', models } } } }],
    mutate: async (ns, ops, rev) => calls.push({ ns, ops, rev }),
  }
}
const cfg = { piAiEntry: 'llm-pi-ai', route: 'opfield', include: [], exclude: [], timeoutMs: 1000 }

test('sync writes through settings once, then is idempotent', async () => {
  const settings = fakeSettings([{ id: 'claude-opus-5.5', name: 'Claude Opus 5.5' }])
  let url
  const deps = { settings, resolveKey: async () => 'gwi_x', fetch: async (u) => ((url = u), { ok: true, json: async () => ({ data: [opus] }) }) }
  const r = await syncModels(cfg, deps)
  assert.equal(url, 'https://g.test/v1/models')
  assert.equal(r.status, 'updated')
  assert.deepEqual(settings.calls[0].ops[0].path, ['providers', 'opfield', 'models'])
  assert.equal(settings.calls[0].rev, 7)
  const again = await syncModels(cfg, { ...deps, settings: fakeSettings(settings.calls[0].ops[0].value) })
  assert.equal(again.status, 'unchanged')
})

test('sync never wipes on empty/failed catalog or missing route', async () => {
  const settings = fakeSettings([])
  const base = { settings, resolveKey: async () => 'k' }
  assert.equal((await syncModels(cfg, { ...base, fetch: async () => ({ ok: true, json: async () => ({ data: [] }) }) })).status, 'skipped')
  assert.equal((await syncModels(cfg, { ...base, fetch: async () => ({ ok: false, status: 502 }) })).status, 'skipped')
  assert.equal((await syncModels({ ...cfg, route: 'nope' }, { ...base, fetch: async () => assert.fail() })).status, 'skipped')
  assert.equal((await syncModels(cfg, { ...base, resolveKey: async () => undefined, fetch: async () => assert.fail() })).status, 'skipped')
  assert.equal(settings.calls.length, 0)
})

test('real gateway catalog snapshot maps cleanly', { skip: !existsSync('/tmp/opf-models.json') }, () => {
  const models = piModelsOf(JSON.parse(readFileSync('/tmp/opf-models.json', 'utf8')))
  assert.ok(models.length > 0)
  for (const m of models) {
    assert.ok(m.input?.includes('image'), m.id)
    assert.ok(m.reasoningEfforts && Object.keys(m.reasoningEfforts).length > 0, m.id)
  }
})
