// Move every @deepseek-ai/dsh-mcp-client entry of a profile into the hub.
//   node migrate.mjs <profileDir>            apply (backup: cordis.patch.yml.bak-before-mcp-hub)
//   node migrate.mjs <profileDir> --dry-run  print the servers it would add (no values of env/headers)
//   node migrate.mjs <profileDir> --revert   restore the backup
// Wrappers are unwrapped: `mcp-remote <url>` becomes a direct HTTP server and
// `mcp-lazy … -- <cmd>` becomes a lazy server. Needs the `yaml` package of the
// Harness installation: DSH_NODE_MODULES=<app.asar>/dsh/node_modules.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CLIENT = '@deepseek-ai/dsh-mcp-client'
const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

function safeName(name) {
  const clean = String(name ?? 'server').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32)
  return NAME_RE.test(clean) ? clean : 'server'
}

/** `npx [-y] mcp-remote <url> [--header "K: V"]…` → `{ url, headers }`. */
function unwrapMcpRemote(command, args) {
  if (!/^npx(\.cmd)?$/.test(basename(String(command ?? '')))) return undefined
  const at = args.findIndex((a) => /^mcp-remote(@.*)?$/.test(a))
  if (at === -1) return undefined
  const url = args.slice(at + 1).find((a) => /^https?:\/\//.test(a))
  if (!url) return undefined
  const headers = {}
  for (let i = at + 1; i < args.length; i++) {
    if (args[i] !== '--header') continue
    const pair = String(args[i + 1] ?? '')
    const colon = pair.indexOf(':')
    if (colon > 0) headers[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim()
  }
  return { url, headers }
}

/** One dsh-mcp-client entry → one hub server (or undefined when not convertible). */
export function convertEntry(entry) {
  const c = entry?.config
  if (!c || typeof c !== 'object') return undefined
  let name = c.serverName ?? entry.id
  let mode = 'auto'
  const common = { enabled: entry.disabled !== true, ...(c.toolCallTimeoutMs ? { toolCallTimeoutMs: c.toolCallTimeoutMs } : {}) }
  if (c.transport === 'streamable-http') {
    return { name: safeName(name), mode, transport: 'http', url: c.url, ...(c.headers && Object.keys(c.headers).length ? { headers: c.headers } : {}), ...common }
  }
  let command = c.command
  let args = Array.isArray(c.args) ? c.args : []
  // mcp-lazy wrapper: <node> mcp-lazy.js [--name N] stdio -- <cmd…> | http <url> [--header …]
  const lazyAt = args.findIndex((a) => /mcp-lazy(\.js)?$/.test(String(a)))
  if (lazyAt !== -1) {
    mode = 'lazy'
    const rest = args.slice(lazyAt + 1)
    const n = rest.indexOf('--name')
    if (n !== -1) name = rest[n + 1]
    else name = String(name).replace(/^lazy-/, '')
    const http = rest.indexOf('http')
    const dd = rest.indexOf('--')
    if (http !== -1 && (dd === -1 || http < dd)) {
      const headers = {}
      for (let i = http + 2; i < rest.length; i++) {
        if (rest[i] !== '--header') continue
        const pair = String(rest[i + 1] ?? '')
        const colon = pair.indexOf(':')
        if (colon > 0) headers[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim()
      }
      return { name: safeName(name), mode, transport: 'http', url: rest[http + 1], ...(Object.keys(headers).length ? { headers } : {}), ...common }
    }
    if (dd === -1 || !rest[dd + 1]) return undefined
    command = rest[dd + 1]
    args = rest.slice(dd + 2)
  }
  const remote = unwrapMcpRemote(command, args)
  if (remote) return { name: safeName(name), mode, transport: 'http', url: remote.url, ...(Object.keys(remote.headers).length ? { headers: remote.headers } : {}), ...common }
  if (!command) return undefined
  return {
    name: safeName(name),
    mode,
    transport: 'stdio',
    command,
    args,
    ...(c.env && Object.keys(c.env).length ? { env: c.env } : {}),
    ...(c.cwd ? { cwd: c.cwd } : {}),
    ...common,
  }
}

function loadYaml() {
  const base = process.env.DSH_NODE_MODULES ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules'
  return createRequire(join(base, 'x.js'))('yaml')
}

export function migrate(profileDir, { dryRun = false } = {}) {
  const YAML = loadYaml()
  const patchFile = join(profileDir, 'cordis.patch.yml')
  const doc = YAML.parseDocument(readFileSync(patchFile, 'utf8'))
  const ops = doc.contents
  const found = []
  // Remove the old entries from `insert` ops (and empty ops).
  for (let i = ops.items.length - 1; i >= 0; i--) {
    const op = ops.items[i].toJSON()
    if (!Array.isArray(op?.insert)) continue
    const keep = []
    for (const entry of op.insert) (entry?.name === CLIENT ? found : keep).push(entry)
    if (keep.length === op.insert.length) continue
    if (keep.length === 0) ops.items.splice(i, 1)
    else ops.items[i].set('insert', doc.createNode(keep))
  }
  found.reverse()
  const converted = found.map(convertEntry)
  const skipped = found.filter((_, i) => converted[i] === undefined).map((e) => e.id)
  let servers = converted.filter(Boolean)
  const hubIndex = ops.items.findIndex((item) => item.toJSON()?.id === 'mcp-hub')
  const existing = hubIndex === -1 ? [] : (ops.items[hubIndex].toJSON().config?.servers ?? [])
  const taken = new Set(existing.map((s) => s.name))
  servers = servers.filter((s) => !taken.has(s.name) && taken.add(s.name))
  if (dryRun) return { servers: servers.map((s) => ({ name: s.name, mode: s.mode, transport: s.transport, target: s.url ?? `${s.command} ${s.args.join(' ')}` })), skipped }
  if (found.length === 0) return { servers: [], skipped, message: 'no dsh-mcp-client entries in this profile' }
  const backup = `${patchFile}.bak-before-mcp-hub`
  if (!existsSync(backup)) copyFileSync(patchFile, backup)
  if (hubIndex === -1) {
    const hubOp = doc.createNode({ id: 'mcp-hub', name: '@opfield/dsh-mcp-hub', config: { servers } })
    hubOp.commentBefore = ' MCP hub: every MCP server lives here (Plugins → MCP hub). Backup: cordis.patch.yml.bak-before-mcp-hub'
    ops.items.push(hubOp)
  } else {
    ops.items[hubIndex].setIn(['config', 'servers'], doc.createNode([...existing, ...servers]))
  }
  writeFileSync(patchFile, doc.toString({ lineWidth: 0 }))
  return { servers: servers.map((s) => s.name), skipped, removed: found.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [profileDir, flag] = process.argv.slice(2)
  if (!profileDir) {
    console.error('usage: migrate.mjs <profileDir> [--dry-run | --revert]')
    process.exit(2)
  }
  if (flag === '--revert') {
    const backup = join(profileDir, 'cordis.patch.yml.bak-before-mcp-hub')
    if (!existsSync(backup)) throw new Error('no backup to restore')
    copyFileSync(backup, join(profileDir, 'cordis.patch.yml'))
    console.log('restored', backup)
  } else {
    console.log(JSON.stringify(migrate(profileDir, { dryRun: flag === '--dry-run' }), null, 2))
  }
}
