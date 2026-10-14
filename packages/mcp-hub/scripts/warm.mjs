// Start the profile's hub servers outside DSH: imports mcp-remote OAuth tokens,
// fills the catalog cache and prints what each server costs.
//   DSH_NODE_MODULES=<app.asar>/dsh/node_modules node warm.mjs <profileDir>
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const profileDir = process.argv[2]
if (!profileDir) throw new Error('usage: warm.mjs <profileDir>')
process.env.DSH_NODE_MODULES ??= '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules'
const YAML = createRequire(join(process.env.DSH_NODE_MODULES, 'x.js'))('yaml')
const { Hub, resolveConfig } = await import('../index.js')
const { loadInstall } = await import('../install.js')
const install = await loadInstall()
const op = YAML.parse(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).find((o) => o?.id === 'mcp-hub')
if (!op) throw new Error('this profile has no mcp-hub entry; run migrate.mjs first')
const quiet = () => {}
const ctx = { logger: { info: quiet, warn: quiet, error: quiet }, tools: { register: () => () => {} } }
const cfg = resolveConfig({ ...op.config, oauthCallbackPort: 0, startupTimeoutMs: 90000 })
const hub = new Hub(ctx, () => cfg, { install, dataDir: join(profileDir, 'mcp-hub') })
await Promise.all(hub.reconcile())
const st = hub.status()
for (const s of st.servers) {
  const launch = s.launch?.npx ? (s.launch.direct ? ` node v${s.launch.version}` : ' via npx') : ''
  console.log(`${s.name.padEnd(22)} ${s.status.padEnd(8)} ${s.mode}->${s.effectiveMode} tools=${s.tools.length} schemas~${s.tokens} catalog~${s.catalogTokens}${launch} ${s.error ?? ''}`)
}
console.log('eager total ~', st.eagerTokens)
await hub.dispose()
