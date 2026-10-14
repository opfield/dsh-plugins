/**
 * Direct launch for `npx -y <package>` servers.
 *
 * `npx` keeps an `npm exec` process (~50–90 MB) alive next to every server.
 * When the package is already in the npx cache, the hub runs its bin with
 * `node` instead, and keeps `@latest` semantics by checking the registry in
 * the background and reinstalling into the same cache directory
 * (`npm exec --package=<spec>` resolves to the same `_npx/<hash>` as `npx <spec>`).
 */

import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'

const NPX_FLAGS = new Set(['-y', '--yes', '-q', '--quiet', '--no-install', '--prefer-offline', '--prefer-online'])

/** `{ spec, name, range, rest }` when `command args` is a plain `npx [-y] <spec> ...args`. */
export function parseNpx(command, args = []) {
  const base = basename(String(command ?? '')).replace(/\.(cmd|exe)$/i, '')
  if (base !== 'npx') return undefined
  let i = 0
  while (i < args.length && NPX_FLAGS.has(args[i])) i++
  const spec = args[i]
  if (typeof spec !== 'string' || spec === '' || spec.startsWith('-')) return undefined
  if (/^(\.|\/|file:|git\+|https?:)/.test(spec)) return undefined
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0)
  const name = at === -1 ? spec : spec.slice(0, at)
  const range = at === -1 ? '' : spec.slice(at + 1)
  return { spec, name, range, rest: args.slice(i + 1) }
}

/** A tag or an empty range follows the registry; an exact version does not. */
export function followsLatest(range) {
  return range === '' || !/^[\d^~<>=v]/.test(range)
}

export function npmCacheDir(env = process.env) {
  return env.npm_config_cache || env.NPM_CONFIG_CACHE || join(homedir(), '.npm')
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** The installed package for `spec` in the npx cache: `{ dir, root, version, bin }`. */
export function findCached(parsed, cacheDir = npmCacheDir()) {
  const npxDir = join(cacheDir, '_npx')
  let entries = []
  try {
    entries = readdirSync(npxDir)
  } catch {
    return undefined
  }
  const candidates = []
  for (const hash of entries) {
    const root = join(npxDir, hash)
    const manifest = readJson(join(root, 'package.json'))
    if (!manifest) continue
    const exact = manifest._npx?.packages?.length === 1 && manifest._npx.packages[0] === parsed.spec
    if (!exact && !(manifest.dependencies && parsed.name in manifest.dependencies)) continue
    const dir = join(root, 'node_modules', parsed.name)
    const pkg = readJson(join(dir, 'package.json'))
    if (!pkg) continue
    const bin = binOf(pkg, parsed.name)
    if (!bin || !existsSync(join(dir, bin))) continue
    let mtime = 0
    try {
      mtime = statSync(join(dir, 'package.json')).mtimeMs
    } catch {
      // keep 0
    }
    candidates.push({ exact, mtime, root, dir, version: pkg.version, bin: join(dir, bin) })
  }
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || b.mtime - a.mtime)
  return candidates[0]
}

function binOf(pkg, name) {
  if (typeof pkg.bin === 'string') return pkg.bin
  if (!pkg.bin || typeof pkg.bin !== 'object') return undefined
  const keys = Object.keys(pkg.bin)
  const short = name.split('/').pop()
  return pkg.bin[short] ?? pkg.bin[name] ?? (keys.length === 1 ? pkg.bin[keys[0]] : undefined)
}

/** `node` beside the configured npx when it exists, else whatever is on PATH. */
export function nodeBeside(command) {
  const dir = dirname(String(command))
  if (dir && dir !== '.') {
    for (const exe of ['node', 'node.exe']) if (existsSync(join(dir, exe))) return join(dir, exe)
  }
  return 'node'
}

function toolBeside(command, tool) {
  const dir = dirname(String(command))
  if (dir && dir !== '.' && existsSync(join(dir, tool))) return join(dir, tool)
  return tool
}

/**
 * Launch plan for one stdio server config.
 * @returns `{ command, args, env, direct, version?, parsed? }`.
 */
export function planLaunch(cfg, cacheDir) {
  const base = { command: cfg.command, args: cfg.args ?? [], env: {}, direct: false }
  if (cfg.launcher === 'npx') return base
  const parsed = parseNpx(cfg.command, cfg.args)
  if (!parsed) return base
  const cached = findCached(parsed, cacheDir)
  if (!cached) return { ...base, parsed }
  const binDir = join(cached.root, 'node_modules', '.bin')
  return {
    command: nodeBeside(cfg.command),
    args: [cached.bin, ...parsed.rest],
    env: { PATH: [binDir, dirname(String(cfg.command)), process.env.PATH ?? ''].filter(Boolean).join(delimiter) },
    direct: true,
    version: cached.version,
    parsed,
  }
}

function run(file, args, env, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd: tmpdir(), env, timeout: timeoutMs, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout).trim(), stderr: String(stderr).trim() })
    })
  })
}

/**
 * Bring a cached `@latest` package up to date.
 * @returns `{ updated, from, to }` or `{ error }`.
 */
export async function updateCached(cfg, parsed, cacheDir) {
  const env = { ...process.env, PATH: [dirname(String(cfg.command)), process.env.PATH ?? ''].join(delimiter) }
  const npm = toolBeside(cfg.command, 'npm')
  const before = findCached(parsed, cacheDir)?.version
  const view = await run(npm, ['view', parsed.range ? `${parsed.name}@${parsed.range}` : parsed.name, 'version'], env, 30000)
  if (!view.ok) return { error: view.stderr.split('\n').pop() || 'npm view failed' }
  const latest = view.stdout.split('\n').pop().replace(/^.*'(.+)'.*$/, '$1')
  if (!latest || latest === before) return { updated: false, from: before, to: before }
  const install = await run(npm, ['exec', '--yes', `--package=${parsed.spec}`, '--', 'node', '-e', ''], env, 180000)
  if (!install.ok) return { error: install.stderr.split('\n').pop() || 'npm exec failed' }
  const after = findCached(parsed, cacheDir)?.version
  return { updated: after !== before, from: before, to: after }
}
