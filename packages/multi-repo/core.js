/**
 * Pure helpers of the multi-root workspace plugin: path handling, the root
 * list operations, the sandbox argv extension, and the model-facing context.
 * Nothing here touches DSH services, so every function is unit-testable.
 */
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

export const NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

/** Plugin config defaults (the `multi-repo` entry of `cordis.patch.yml`). */
export const DEFAULTS = Object.freeze({
  /** Make attached roots writable under workspace-write (fs tools and the bash sandbox). */
  extendSandbox: true,
  /** Instruction files read at the top of every attached root, in order. */
  instructionFiles: Object.freeze(['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']),
  /** Byte budget for the attached roots' instruction files in the model context. */
  instructionMaxBytes: 32768,
  gitTimeoutMs: 15000,
  maxChangedFiles: 50,
  /** Folders whose Git repositories the composer panel offers as suggestions. */
  suggestionDirs: Object.freeze(['~/projects']),
  /** Rename the sidebar workspace group to `primary + root + ...` (default/auto titles only). */
  workspaceTitle: true,
})

/**
 * Read the raw entry config with type checks: a value of the wrong type falls
 * back to its default instead of breaking the plugin at use time. Instruction
 * files must be plain file names (no path separators), so they stay at the
 * top of each root.
 */
export function normalizeConfig(raw) {
  const value = typeof raw === 'object' && raw !== null ? raw : {}
  const bool = (key) => (typeof value[key] === 'boolean' ? value[key] : DEFAULTS[key])
  const int = (key, min, max) => {
    const n = value[key]
    return Number.isInteger(n) && n >= min && n <= max ? n : DEFAULTS[key]
  }
  const strings = (key, accept) => (Array.isArray(value[key]) ? value[key].filter((s) => typeof s === 'string' && accept(s)) : [...DEFAULTS[key]])
  return {
    extendSandbox: bool('extendSandbox'),
    instructionFiles: strings('instructionFiles', (s) => s !== '' && s !== '.' && s !== '..' && !/[\\/]/.test(s)),
    instructionMaxBytes: int('instructionMaxBytes', 0, 1048576),
    gitTimeoutMs: int('gitTimeoutMs', 1000, 600000),
    maxChangedFiles: int('maxChangedFiles', 0, 10000),
    suggestionDirs: strings('suggestionDirs', (s) => s.trim() !== ''),
    workspaceTitle: bool('workspaceTitle'),
  }
}

/** Resolve `~`, `~/x`, absolute, or workspace-relative input to an absolute path. */
export function expandPath(input, base) {
  const path = String(input).trim()
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return isAbsolute(path) ? resolve(path) : resolve(base, path)
}

/** Canonical (symlink-free) spelling; the input as-is when it does not exist. */
export function canonical(path) {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

/** Lexical containment of two canonical paths (equal counts as inside). */
export function isUnder(path, root) {
  if (path === root) return true
  const prefix = root.endsWith(sep) ? root : root + sep
  return path.startsWith(prefix)
}

export function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Whether a folder is too broad to be a workspace root: the home directory or
 * any of its ancestors (`/`, `/home`, ...), or a shared temp area itself.
 * Attaching one would make that whole tree writable for the agent.
 */
export function isTooBroad(path) {
  if (isUnder(canonical(homedir()), path)) return true
  return path === canonical('/tmp') || path === canonical(tmpdir())
}

/** Display name of a root: its directory name, made unique among `taken`. */
export function uniqueName(wanted, taken) {
  const base = String(wanted).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60) || 'root'
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Validate and append one root. Returns `{ roots, root, added }`; throws an
 * Error with a user-facing message when the folder cannot be attached.
 * @param primary - canonical primary root (the session working directory).
 * @param roots - current attached roots `[{ name, path }]`.
 * @param input - path typed by the user.
 * @param name - optional display name.
 */
export function addRootTo(primary, roots, input, name) {
  if (typeof input !== 'string' || input.trim() === '') throw new Error('Folder path is required.')
  const path = canonical(expandPath(input, primary))
  if (!isDirectory(path)) throw new Error(`${path} is not an existing directory.`)
  if (isTooBroad(path)) throw new Error(`Refusing to attach ${path}: it is too broad to be a workspace root.`)
  if (path === primary) throw new Error(`${path} is already the primary root of this workspace.`)
  if (isUnder(path, primary)) throw new Error(`${path} is inside the primary root, so it is already part of the workspace.`)
  if (isUnder(primary, path)) throw new Error(`${path} contains the primary root; open a session in ${path} instead.`)
  const existing = roots.find((root) => root.path === path)
  if (existing) return { roots, root: existing, added: false }
  const overlapping = roots.find((root) => isUnder(path, root.path) || isUnder(root.path, path))
  if (overlapping) throw new Error(`${path} overlaps the attached root "${overlapping.name}" (${overlapping.path}).`)
  const taken = new Set([basename(primary), ...roots.map((root) => root.name)])
  let finalName
  if (typeof name === 'string' && name.trim() !== '') {
    finalName = name.trim()
    if (!NAME_PATTERN.test(finalName)) throw new Error(`Invalid name "${finalName}": use letters, digits, ".", "_" or "-" (up to 64).`)
    if (taken.has(finalName)) throw new Error(`The name "${finalName}" is already used in this workspace.`)
  } else {
    finalName = uniqueName(basename(path), taken)
  }
  const root = { name: finalName, path }
  return { roots: [...roots, root], root, added: true }
}

/** Remove a root by name or path. Returns `{ roots, removed }`. */
export function removeRootFrom(primary, roots, nameOrPath) {
  const wanted = String(nameOrPath ?? '').trim()
  if (wanted === '') throw new Error('Root name or path is required.')
  const asPath = canonical(expandPath(wanted, primary))
  const removed = roots.find((root) => root.name === wanted) ?? roots.find((root) => root.path === asPath)
  if (!removed) {
    const known = roots.map((root) => root.name).join(', ') || '(none)'
    throw new Error(`No attached root "${wanted}". Attached: ${known}.`)
  }
  return { roots: roots.filter((root) => root !== removed), removed }
}

/** Validate one stored workspace record `{ roots: [{ name, path }] }`. */
export function parseRecord(value) {
  if (typeof value !== 'object' || value === null || !Array.isArray(value.roots)) throw new TypeError('multi-repo record must be { roots: [] }')
  for (const root of value.roots) {
    if (typeof root?.name !== 'string' || !NAME_PATTERN.test(root.name)) throw new TypeError('multi-repo root name is invalid')
    if (typeof root?.path !== 'string' || !isAbsolute(root.path)) throw new TypeError('multi-repo root path must be absolute')
  }
  return value
}

/**
 * Extend a confined command line so the runner also grants write access to
 * `roots`. Understands the three POSIX runners DSH ships: bwrap (bind mounts),
 * the Landlock launcher (`--rw` grants), and Seatbelt (`-p` SBPL profile).
 * Unknown runners are returned unchanged (fail closed: no extra access).
 * @returns `{ argv, runner }` where runner is the recognized kind or null.
 */
export function extendConfinedArgv(argv, roots) {
  if (!Array.isArray(argv) || roots.length === 0) return { argv, runner: null }
  const separator = argv.indexOf('--')
  if (separator < 0) return { argv, runner: null }
  const head = argv.slice(0, separator)
  const tail = argv.slice(separator)
  // The runner is named by its program (argv[0]), never guessed from flags alone.
  const program = basename(String(head[0] ?? ''))
  if (program === 'bwrap' && head.includes('--ro-bind')) {
    const binds = roots.flatMap((root) => ['--bind', root, root])
    return { argv: [...head, ...binds, ...tail], runner: 'bwrap' }
  }
  if (program === 'landlock-run' && (head.includes('--rw') || head.includes('--ro'))) {
    const grants = roots.flatMap((root) => ['--rw', root])
    return { argv: [...head, ...grants, ...tail], runner: 'landlock' }
  }
  const profileAt = head.indexOf('-p')
  if (program === 'sandbox-exec' && profileAt >= 0 && typeof head[profileAt + 1] === 'string' && head[profileAt + 1].includes('(deny file-write*)')) {
    const quote = (path) => `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
    const profile = `${head[profileAt + 1]} (allow file-write* ${roots.map((root) => `(subpath ${quote(root)})`).join(' ')})`
    const next = [...head]
    next[profileAt + 1] = profile
    return { argv: [...next, ...tail], runner: 'seatbelt' }
  }
  return { argv, runner: null }
}

/** The file-policy rule of the context, matching what the sandbox extension actually grants. */
function filePolicyLine(access) {
  const files = access?.files === true
  const shell = access?.shell === true
  if (files && shell) return '- File policy: wherever the session workspace is writable (workspace-write), every root above is writable too.'
  if (files) return '- File policy: under workspace-write, file tools (write, edit) can write to every root above, but shell commands can write only to the primary root; writing to attached roots from a shell needs danger-full-access or an approved escalation.'
  if (shell) return '- File policy: under workspace-write, shell commands can write to every root above, but file tools can write only to the primary root; writing to attached roots with file tools needs danger-full-access or an approved escalation.'
  return '- File policy: attached roots are outside the sandbox write boundary; writing there needs danger-full-access or an approved escalation.'
}

/**
 * The runtime-context text the model receives while extra roots exist.
 * @param input.primary - `{ name, path }` of the session working directory.
 * @param input.roots - attached roots `[{ name, path, exists }]`.
 * @param input.instructions - `[{ root, file, text, truncated }]`.
 * @param input.access - `{ files, shell }`: whether file tools and shell
 *   commands may write to attached roots under workspace-write.
 * @param input.omitted - instruction files dropped by the byte budget.
 */
export function renderContext({ primary, roots, instructions, access, omitted = [] }) {
  if (roots.length === 0) return ''
  const lines = [
    '# Workspace roots',
    "This session's workspace has several roots, like a multi-root project. The primary root is the session working directory; the user attached the other roots to this workspace. Treat all of them as one workspace, but each root is a separate project or Git repository.",
    `- ${primary.name} (primary): ${primary.path}`,
    ...roots.map((root) => `- ${root.name}: ${root.path}${root.exists === false ? ' (missing on disk)' : ''}`),
    '',
    'Working rules:',
    '- Use absolute paths for files outside the primary root. Set `workdir` to the root a shell command concerns, and run git per root (`git -C <root>`), never across roots from the primary root.',
    '- Keep branches, commits, and change summaries separate per root, and name the root of every change you report.',
    '- Follow the instruction files of the root you work in; those of attached roots are included below.',
    '- `workspace_roots` reports the branch, last commit, and uncommitted changes of every root. Only the user attaches or detaches roots (`/roots` command or the roots button under the composer).',
    filePolicyLine(access),
  ]
  for (const item of instructions) {
    lines.push('', `## Instructions for ${item.root} (${item.file})`, item.text.trimEnd())
    if (item.truncated) lines.push(`[truncated: ${item.file} exceeds the instruction budget; read the file for the rest]`)
  }
  if (omitted.length > 0) lines.push('', `[instruction budget exhausted; read these files directly: ${omitted.join(', ')}]`)
  return lines.join('\n')
}

/** Git repositories directly inside `dirs` (for add suggestions), canonical, sorted. */
export function listRepoCandidates(dirs, readdir, exclude, limit = 200) {
  const out = new Set()
  for (const dir of dirs) {
    let entries
    try {
      entries = readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const path = join(dir, entry)
      if (!existsSync(join(path, '.git'))) continue
      const real = canonical(path)
      if (!exclude.has(real)) out.add(real)
      if (out.size >= limit) break
    }
  }
  return [...out].sort()
}

/** Parent directory of a root, or undefined at the filesystem root. */
export function parentOf(path) {
  const parent = dirname(path)
  return parent === path ? undefined : parent
}

/** Split `/roots` input into words, honoring "double" and 'single' quotes. */
export function splitArgs(raw) {
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = re.exec(String(raw))) !== null) out.push(match[1] ?? match[2] ?? match[3])
  return out
}

/** Sidebar title of a multi-root workspace: `ppc + payca`, or the bare name with no extra roots. */
export function autoTitle(primaryName, roots) {
  return [primaryName, ...roots.map((root) => root.name)].join(' + ')
}

/**
 * Whether the plugin may replace a workspace title: only the default title
 * (the directory name) or one it generated itself. A title the user typed
 * stays untouched.
 */
export function isAutoTitle(title, primaryName) {
  if (typeof title !== 'string') return false
  return title === primaryName || title.startsWith(`${primaryName} + `)
}
