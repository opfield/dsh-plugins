/**
 * Multi-root workspaces for DeepSeek Harness, modeled on the Codex app's
 * multi-folder projects: a DSH workspace (the session working directory) can
 * carry extra roots — other repositories the user attaches. The list lives in
 * DSH storage (`~/.dsh/storages`), keyed by the workspace path, so every
 * session of that workspace shares it and nothing is written into the
 * repositories themselves.
 *
 * What a session in such a workspace gets:
 * - a runtime-context section listing every root plus the instruction files
 *   (AGENTS.md, CLAUDE.md, ...) of the attached roots;
 * - write access to the attached roots under `workspace-write`, the same as
 *   the primary root (filesystem tools and the bash/terminal sandbox);
 * - the read-only `workspace_roots` tool (branch, last commit, changes);
 * - the `/roots` command and a composer button for the user to edit the list.
 *
 * Only the user edits the list: the model cannot widen its own write access.
 */
import { execFile } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  addRootTo,
  autoTitle,
  canonical,
  expandPath,
  extendConfinedArgv,
  isAutoTitle,
  isDirectory,
  isUnder,
  listRepoCandidates,
  normalizeConfig,
  parentOf,
  parseRecord,
  removeRootFrom,
  renderContext,
  splitArgs,
} from './core.js'

export { DEFAULTS } from './core.js'

export const name = 'multi-repo'
export const inject = ['storageDomain']

export const STATE_ROUTE = '/multi-repo/state'
export const ROOTS_ROUTE = '/multi-repo/roots'

/** Context order: right after the sandbox policy (110), before approval policy (115). */
const CONTEXT_ORDER = 112
/** Instruction files larger than this are never read into the context. */
const MAX_SOURCE_BYTES = 262144
/**
 * Marks a method this plugin wrapped. The key is shared by every copy of the
 * plugin (npm package or a linked working copy), so two loaded copies never
 * wrap the same method twice.
 */
const PATCH_MARK = Symbol.for('dsh-multi-repo/patched')
/** Delay before the first workspace-title sync, so the registry has loaded its workspaces. */
const TITLE_SYNC_DELAY_MS = 4000

const safeParse = (value) => {
  try {
    return { success: true, data: parseRecord(value) }
  } catch (error) {
    return { success: false, error }
  }
}

/**
 * Storage domain declaration; table `workspaces` holds `{ roots: [{ name, path }] }`
 * per canonical workspace path. A record that fails validation is backed up
 * and skipped instead of failing the whole domain.
 */
export const DOMAIN = {
  name: 'multi_repo',
  version: 1,
  invalidRecords: 'backup-and-skip',
  tables: { workspaces: { valueSchema: { parse: parseRecord, safeParse } } },
}

/**
 * Run one read-only git command in `cwd`. Never rejects. `core.fsmonitor` is
 * forced off: an attached repository's own config must not make a status
 * query run a program of its choice.
 */
function runGit(args, cwd, timeoutMs, signal) {
  return new Promise((resolvePromise) => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-C', cwd, ...args], {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      signal,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    }, (error, stdout, stderr) => {
      resolvePromise({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || error?.message || '' })
    })
  })
}

/**
 * Wrap one method on the prototype that owns it. Returns an undo function, or
 * null when the method is missing or already wrapped by this plugin.
 */
export function patchMethod(instance, method, wrap) {
  let proto = instance === null || instance === undefined ? null : Object.getPrototypeOf(instance)
  while (proto !== null && !Object.prototype.hasOwnProperty.call(proto, method)) proto = Object.getPrototypeOf(proto)
  if (proto === null) return null
  const original = proto[method]
  if (typeof original !== 'function' || original[PATCH_MARK]) return null
  const wrapped = wrap(original)
  Object.defineProperty(wrapped, PATCH_MARK, { value: true })
  proto[method] = wrapped
  return () => {
    if (proto[method] === wrapped) proto[method] = original
  }
}

/** `checkedTarget` wrapper: a write denied under workspace-write passes when it lands in an attached root. */
export function wrapCheckedTarget(original, writableRootsFor) {
  return async function checkedTarget(target, sandboxPolicy) {
    try {
      return await original.call(this, target, sandboxPolicy)
    } catch (error) {
      if (error?.code !== 'FS_SANDBOX_DENIED') throw error
      const policy = sandboxPolicy ?? this.ctx?.sandboxPolicy?.resolve?.()
      if (policy?.mode !== 'workspace-write' || typeof policy.workspaceRoot !== 'string') throw error
      const roots = writableRootsFor(policy.workspaceRoot)
      if (roots.length === 0) throw error
      // Re-canonicalize now, like the original fence, and return that fresh target.
      const fresh = await this.resolve(target.displayPath)
      const key = String(fresh?.targetKey ?? '')
      if (key !== '' && roots.some((root) => isUnder(key, root))) return fresh
      throw error
    }
  }
}

/** `confine` wrapper: add the attached roots to the runner's writable set. */
export function wrapConfine(original, writableRootsFor, onUnknownRunner) {
  return async function confine(argv, policy, signal) {
    const result = await original.call(this, argv, policy, signal)
    if (policy?.mode !== 'workspace-write' || typeof policy.workspaceRoot !== 'string') return result
    const roots = writableRootsFor(policy.workspaceRoot)
    if (roots.length === 0) return result
    const extended = extendConfinedArgv(result?.argv, roots)
    if (extended.runner === null) {
      onUnknownRunner?.(String(result?.argv?.[0] ?? 'unknown'))
      return result
    }
    return { ...result, argv: extended.argv }
  }
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJsonBody(req, limit = 16384) {
  return new Promise((resolvePromise, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('not an object')
        resolvePromise(body)
      } catch {
        reject(new Error('request body is not a JSON object'))
      }
    })
    req.on('error', reject)
  })
}

const textResult = (value) => [{ type: 'text', text: String(value) }]
const message = (error) => String(error?.message ?? error)

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  /** Open storage domain; null until it has loaded. */
  let domain = null
  /** Serializes list mutations. */
  let queue = Promise.resolve()
  /** canonical primary -> { key, text } */
  const contextCache = new Map()
  const patched = { fs: false, sandbox: false }
  /** Sandbox runners seen that this plugin cannot extend (shell writes to attached roots then fail). */
  const unsupportedRunners = new Set()

  /** What the sandbox extension grants right now: file tools and shell commands separately. */
  function access() {
    if (!config.extendSandbox) return { files: false, shell: false }
    return {
      files: patched.fs,
      // The Windows ACL runner is never extended; other unknown runners are learned at their first use.
      shell: patched.sandbox && process.platform !== 'win32' && unsupportedRunners.size === 0,
    }
  }

  // ── storage ───────────────────────────────────────────────────────────
  ctx.effect(() => {
    let disposed = false
    ctx.storageDomain.open(DOMAIN).then(
      (opened) => {
        if (disposed) {
          opened.close()
          return
        }
        domain = opened
        contextCache.clear()
        // The registry may already be up; a no-op until it has workspaces.
        syncTitles()
      },
      (error) => ctx.logger.error('multi-repo: cannot open storage domain %s: %s', DOMAIN.name, message(error)),
    )
    return () => {
      disposed = true
      const open = domain
      domain = null
      open?.close()
    }
  }, 'multi-repo: storage')

  // ── root list ─────────────────────────────────────────────────────────
  /** The registered workspaces; empty while the registry is missing or still loading. */
  function registryWorkspaces() {
    try {
      return ctx.get('workspaceRegistry')?.list?.() ?? []
    } catch {
      return []
    }
  }

  /**
   * Show the roots in the sidebar: the workspace group title becomes
   * `api + web`. Only a default or plugin-made title is replaced, and a
   * failure never blocks the root change itself.
   */
  async function retitle(primary, roots) {
    if (!config.workspaceTitle) return
    try {
      const workspace = registryWorkspaces().find((entry) => canonical(entry.path) === primary)
      if (workspace === undefined) return
      const primaryName = basename(primary)
      const next = autoTitle(primaryName, roots)
      if (workspace.title === next || !isAutoTitle(workspace.title, primaryName)) return
      await workspace.setTitle(next)
    } catch (error) {
      ctx.logger.warn('multi-repo: cannot retitle workspace %s: %s', primary, message(error))
    }
  }

  /** Bring every stored workspace title in line once storage and the registry are up. */
  function syncTitles() {
    if (domain === null || !config.workspaceTitle) return
    for (const [primary, record] of domain.table('workspaces').entries()) {
      queue = queue.then(() => retitle(primary, record.roots)).catch(() => undefined)
    }
  }
  ctx.inject(['workspaceRegistry'], (scope) => {
    scope.effect(() => {
      const timer = setTimeout(syncTitles, TITLE_SYNC_DELAY_MS)
      return () => clearTimeout(timer)
    }, 'multi-repo: workspace titles')
  })

  function rootsOf(primary) {
    return domain?.table('workspaces').get(primary)?.roots ?? []
  }

  function mutate(workspace, change) {
    const run = queue.then(async () => {
      if (domain === null) throw new Error('Workspace root storage is not ready yet; try again in a moment.')
      const primary = canonical(workspace)
      const result = change(primary, rootsOf(primary))
      if (result.added !== false) {
        const table = domain.table('workspaces')
        if (result.roots.length === 0) await table.delete(primary)
        else await table.put(primary, { roots: result.roots.map(({ name: rootName, path }) => ({ name: rootName, path })) })
        contextCache.delete(primary)
        await retitle(primary, result.roots)
      }
      return result
    })
    queue = run.catch(() => undefined)
    return run
  }

  const addRoot = (workspace, path, rootName) => mutate(workspace, (primary, roots) => addRootTo(primary, roots, path, rootName))
  const removeRoot = (workspace, nameOrPath) => mutate(workspace, (primary, roots) => removeRootFrom(primary, roots, nameOrPath))

  /**
   * Canonical attached roots of a workspace that exist and are not already
   * inside it: the extra writable set for the sandbox. Roots under `/tmp` are
   * kept: bwrap mounts a private `/tmp`, so without their own bind they would
   * not even be visible to shell commands.
   */
  function writableRootsFor(workspaceRoot) {
    if (domain === null) return []
    const primary = canonical(workspaceRoot)
    const out = []
    for (const root of rootsOf(primary)) {
      const path = canonical(root.path)
      if (!isDirectory(path) || isUnder(path, primary)) continue
      out.push(path)
    }
    return out
  }

  /** The working directory of a session, live or persisted under a workspace. */
  function workspaceOfSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    try {
      const cwd = ctx.get('sessions')?.get?.(sessionId)?.header?.cwd
      if (typeof cwd === 'string') return cwd
    } catch {
      // sessions service not ready
    }
    for (const workspace of registryWorkspaces()) {
      if (workspace.sessionIds?.includes?.(sessionId)) return workspace.path
    }
    return undefined
  }

  // ── sandbox extension ─────────────────────────────────────────────────
  if (config.extendSandbox) {
    ctx.inject(['fs'], (scope) => {
      scope.effect(() => {
        const undo = patchMethod(scope.fs, 'checkedTarget', (original) => wrapCheckedTarget(original, writableRootsFor))
        patched.fs = undo !== null
        if (undo === null) ctx.logger.warn('multi-repo: the fs service has no checkedTarget to extend; attached roots stay read-only for file tools')
        contextCache.clear()
        return () => {
          undo?.()
          patched.fs = false
          contextCache.clear()
        }
      }, 'multi-repo: fs write fence for attached roots')
    })
    ctx.inject(['sandbox'], (scope) => {
      scope.effect(() => {
        const undo = patchMethod(scope.sandbox, 'confine', (original) =>
          wrapConfine(original, writableRootsFor, (runner) => {
            if (unsupportedRunners.has(runner)) return
            unsupportedRunners.add(runner)
            contextCache.clear()
            ctx.logger.warn('multi-repo: sandbox runner %s is not supported; attached roots stay read-only for shell commands', runner)
          }),
        )
        patched.sandbox = undo !== null
        if (undo === null) ctx.logger.warn('multi-repo: the sandbox service has no confine to extend; attached roots stay read-only for shell commands')
        contextCache.clear()
        return () => {
          undo?.()
          patched.sandbox = false
          contextCache.clear()
        }
      }, 'multi-repo: shell sandbox grants for attached roots')
    })
  }

  // ── model context ─────────────────────────────────────────────────────
  /** Instruction files of the attached roots: a cheap stat stamp, and a loader for the text. */
  function instructionsOf(roots) {
    const files = []
    for (const root of roots) {
      if (root.exists === false) continue
      for (const file of config.instructionFiles) {
        const path = join(root.path, file)
        let info
        try {
          info = statSync(path)
        } catch {
          continue
        }
        if (!info.isFile()) continue
        files.push({ root: root.name, path, size: info.size, mtimeMs: info.mtimeMs })
      }
    }
    const stamp = files.map((f) => `${f.path}:${f.size}:${f.mtimeMs}`).join('|')
    const load = () => {
      let budget = config.instructionMaxBytes
      const seen = new Set()
      const instructions = []
      const omitted = []
      for (const file of files) {
        if (file.size > MAX_SOURCE_BYTES) {
          omitted.push(file.path)
          continue
        }
        let text
        try {
          text = readFileSync(file.path, 'utf8')
        } catch {
          continue
        }
        const trimmed = text.trim()
        // Skip empty files and exact duplicates (AGENTS.md and CLAUDE.md often share one text).
        if (trimmed === '' || seen.has(trimmed)) continue
        seen.add(trimmed)
        if (budget <= 0) {
          omitted.push(file.path)
          continue
        }
        const bytes = Buffer.byteLength(text)
        if (bytes <= budget) {
          instructions.push({ root: file.root, file: file.path, text, truncated: false })
          budget -= bytes
        } else {
          // Cut at the byte budget and drop a character split by the cut.
          const cut = Buffer.from(text).subarray(0, budget).toString('utf8').replace(/\uFFFD$/, '')
          instructions.push({ root: file.root, file: file.path, text: cut, truncated: true })
          budget = 0
        }
      }
      return { instructions, omitted }
    }
    return { stamp, load }
  }

  function contextFor(cwd) {
    const primary = canonical(cwd)
    const stored = rootsOf(primary)
    if (stored.length === 0) return ''
    const roots = stored.map((root) => ({ ...root, exists: isDirectory(root.path) }))
    const granted = access()
    const { stamp, load } = instructionsOf(roots)
    // The text changes only when the roots, the grants, or the instruction files change: the prompt cache survives.
    const key = JSON.stringify([granted, roots, stamp])
    const cached = contextCache.get(primary)
    if (cached !== undefined && cached.key === key) return cached.text
    const { instructions, omitted } = load()
    const text = renderContext({ primary: { name: basename(primary), path: primary }, roots, instructions, access: granted, omitted })
    contextCache.set(primary, { key, text })
    return text
  }

  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(() => scope.systemPrompt.context({
      name: 'multi-repo:roots',
      order: CONTEXT_ORDER,
      text: (context) => {
        const cwd = context?.agent?.session?.header?.cwd
        if (typeof cwd !== 'string') return ''
        try {
          return contextFor(cwd)
        } catch (error) {
          ctx.logger.warn('multi-repo: cannot build the roots context: %s', message(error))
          return ''
        }
      },
    }), 'multi-repo: roots context')
  })

  // ── git status ────────────────────────────────────────────────────────
  async function gitSummary(path, signal) {
    if (!isDirectory(path)) return { exists: false }
    const [status, head] = await Promise.all([
      runGit(['status', '--porcelain=v1', '--branch'], path, config.gitTimeoutMs, signal),
      runGit(['log', '-1', '--format=%h %s (%cr)'], path, config.gitTimeoutMs, signal),
    ])
    if (!status.ok) return { exists: true, git: false, error: status.stderr.trim() }
    const lines = status.stdout.split('\n').filter(Boolean)
    const branchLine = lines[0]?.startsWith('## ') ? lines.shift().slice(3) : ''
    return {
      exists: true,
      git: true,
      branchLine,
      branch: branchLine.split('...')[0].replace(/^No commits yet on /, '') || null,
      head: head.ok ? head.stdout.trim() : null,
      changes: lines,
    }
  }

  async function statusText(root, signal) {
    const header = `## ${root.name}${root.primary ? ' (primary)' : ''}  ${root.path}`
    const info = await gitSummary(root.path, signal)
    if (!info.exists) return `${header}\nerror: path does not exist`
    if (!info.git) return `${header}\nnot a Git repository (${info.error})`
    const shown = info.changes.slice(0, config.maxChangedFiles)
    return [
      header,
      `branch: ${info.branchLine || '(unknown)'}`,
      `head: ${info.head ?? '(no commits)'}`,
      info.changes.length === 0 ? 'changes: clean' : `changes (${info.changes.length}):`,
      ...shown.map((line) => `  ${line}`),
      ...(info.changes.length > shown.length ? [`  ... ${info.changes.length - shown.length} more`] : []),
    ].join('\n')
  }

  function allRoots(cwd) {
    const primary = canonical(cwd)
    return [{ name: basename(primary), path: primary, primary: true }, ...rootsOf(primary).map((root) => ({ ...root, primary: false }))]
  }

  ctx.inject(['tools'], (scope) => {
    scope.effect(() => scope.tools.register({
      name: 'workspace_roots',
      description: 'List every root of this workspace (the primary root plus the repositories the user attached) with branch, upstream ahead/behind, last commit, and uncommitted changes. Pass `root` to inspect one root by name.',
      parameters: {
        type: 'object',
        properties: { root: { type: 'string', description: 'Root name to inspect. Omit for all roots.' } },
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => textResult(value) },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const cwd = exec?.agent?.session?.header?.cwd
        if (typeof cwd !== 'string') throw new Error('this session has no working directory')
        const roots = allRoots(cwd)
        const selected = typeof args?.root === 'string' && args.root !== '' ? roots.filter((root) => root.name === args.root) : roots
        if (selected.length === 0) return `Unknown root "${args.root}". Roots: ${roots.map((root) => root.name).join(', ')}`
        const parts = await Promise.all(selected.map((root) => statusText(root, exec?.signal)))
        const footer = roots.length === 1 ? '\n\nNo extra roots are attached; the user can attach repositories with /roots add <path>.' : ''
        return parts.join('\n\n') + footer
      },
    }), 'multi-repo: workspace_roots tool')
  })

  // ── /roots command ────────────────────────────────────────────────────
  const USAGE = 'Usage: /roots [list] | /roots add <path> [--name <name>] | /roots remove <name|path>'

  function listText(cwd) {
    const roots = allRoots(cwd)
    const lines = roots.map((root) => `- ${root.name}${root.primary ? ' (primary)' : ''}: ${root.path}${!root.primary && !isDirectory(root.path) ? ' (missing)' : ''}`)
    return [`Workspace roots (${roots.length}):`, ...lines, ...(roots.length === 1 ? ['Attach a repository with /roots add <path>.'] : [])].join('\n')
  }

  ctx.inject(['commands'], (scope) => {
    scope.effect(() => scope.commands.register({
      name: 'roots',
      description: 'Show, attach, or detach extra workspace roots (other repositories in this workspace)',
      input: { hint: '[list | add <path> [--name <name>] | remove <name>]' },
      handler: async ({ agent, rawInput }) => {
        const cwd = agent?.session?.header?.cwd
        if (typeof cwd !== 'string') return { kind: 'error', text: 'This session has no working directory.' }
        const words = splitArgs(rawInput ?? '')
        const verb = (words.shift() ?? 'list').toLowerCase()
        try {
          if (verb === 'list' || verb === 'ls') return { kind: 'success', text: listText(cwd) }
          if (verb === 'add') {
            let rootName
            const nameAt = words.indexOf('--name')
            if (nameAt >= 0) {
              rootName = words[nameAt + 1]
              if (rootName === undefined) return { kind: 'error', text: USAGE }
              words.splice(nameAt, 2)
            }
            if (words.length !== 1) return { kind: 'error', text: USAGE }
            const { root, added } = await addRoot(cwd, words[0], rootName)
            return { kind: 'success', text: added ? `Attached "${root.name}" (${root.path}) to this workspace.\n\n${listText(cwd)}` : `${root.path} is already attached as "${root.name}".` }
          }
          if (verb === 'remove' || verb === 'rm') {
            if (words.length !== 1) return { kind: 'error', text: USAGE }
            const { removed } = await removeRoot(cwd, words[0])
            return { kind: 'success', text: `Detached "${removed.name}" (${removed.path}). Files on disk were not touched.` }
          }
          return { kind: 'error', text: USAGE }
        } catch (error) {
          return { kind: 'error', text: message(error) }
        }
      },
    }), 'multi-repo: /roots command')
  })

  // ── HTTP routes for the composer panel ───────────────────────────────
  function suggestionsFor(primary, roots) {
    const dirs = new Set()
    const parent = parentOf(primary)
    if (parent !== undefined) dirs.add(parent)
    for (const root of roots) {
      const p = parentOf(root.path)
      if (p !== undefined) dirs.add(p)
    }
    for (const dir of config.suggestionDirs) dirs.add(expandPath(dir, homedir()))
    const exclude = new Set([primary, ...roots.map((root) => root.path)])
    return listRepoCandidates([...dirs], (dir) => readdirSync(dir), exclude).filter((path) => !isUnder(path, primary) && !isUnder(primary, path))
  }

  async function stateOf(sessionId, lite = false) {
    const cwd = workspaceOfSession(sessionId)
    if (cwd === undefined) return { ok: false, code: 'unknown-session', message: 'This session has no working directory.' }
    const primary = canonical(cwd)
    const roots = allRoots(primary)
    const granted = access()
    const common = { ok: true, ready: domain !== null, workspace: primary, writable: granted.files, shellWritable: granted.shell }
    // `lite` skips git and suggestions: enough for labels such as the sidebar hover card.
    if (lite) {
      const light = roots.map((root) => ({ name: root.name, path: root.path, primary: root.primary, exists: isDirectory(root.path), git: null, branch: null, changes: 0 }))
      return { ...common, lite: true, roots: light, suggestions: [] }
    }
    const summaries = await Promise.all(roots.map(async (root) => {
      const info = await gitSummary(root.path)
      return {
        name: root.name,
        path: root.path,
        primary: root.primary,
        exists: info.exists !== false,
        git: info.git === true,
        branch: info.branch ?? null,
        changes: Array.isArray(info.changes) ? info.changes.length : 0,
      }
    }))
    return { ...common, roots: summaries, suggestions: suggestionsFor(primary, rootsOf(primary)) }
  }

  ctx.inject(['webServer', 'connection'], (scope) => {
    const guard = (req, res) => {
      const rejection = scope.connection.requestRejection(req)
      if (rejection === undefined) return true
      res.statusCode = rejection
      res.end()
      return false
    }
    /** Route handler shell: connection guard, one method, and a JSON 500 instead of an unhandled rejection. */
    const route = (method, handle) => async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== method) {
        res.setHeader('allow', method)
        return sendJson(res, 405, { ok: false, code: 'method-not-allowed', message: `${method} only` })
      }
      try {
        await handle(req, res)
      } catch (error) {
        ctx.logger.warn('multi-repo: %s %s failed: %s', req.method, req.url, message(error))
        if (!res.headersSent && !res.writableEnded) sendJson(res, 500, { ok: false, code: 'internal', message: message(error) })
      }
    }
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: STATE_ROUTE,
      handler: route('GET', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        sendJson(res, 200, await stateOf(url.searchParams.get('session') ?? '', url.searchParams.get('lite') === '1'))
      }),
    }), `multi-repo: GET ${STATE_ROUTE}`)
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: ROOTS_ROUTE,
      handler: route('POST', async (req, res) => {
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          return sendJson(res, 400, { ok: false, code: 'bad-request', message: message(error) })
        }
        const cwd = workspaceOfSession(body.session)
        if (cwd === undefined) return sendJson(res, 404, { ok: false, code: 'unknown-session', message: 'This session has no working directory.' })
        try {
          if (body.action === 'add') await addRoot(cwd, body.path, body.name)
          else if (body.action === 'remove') await removeRoot(cwd, body.name ?? body.path)
          else return sendJson(res, 400, { ok: false, code: 'bad-request', message: 'action must be "add" or "remove"' })
        } catch (error) {
          return sendJson(res, 200, { ...(await stateOf(body.session)), ok: false, code: 'rejected', message: message(error) })
        }
        sendJson(res, 200, await stateOf(body.session))
      }),
    }), `multi-repo: POST ${ROOTS_ROUTE}`)
  })
}
