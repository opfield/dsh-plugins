import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { DEFAULTS, addRootTo, autoTitle, extendConfinedArgv, isAutoTitle, isTooBroad, listRepoCandidates, normalizeConfig, removeRootFrom, renderContext, splitArgs } from '../core.js'
import { readdirSync } from 'node:fs'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'mr-core-')))
after(() => rmSync(base, { recursive: true, force: true }))
const dir = (...parts) => {
  const path = join(base, ...parts)
  mkdirSync(path, { recursive: true })
  return path
}
const primary = dir('payca')
const ppc = dir('ppc')
dir('ppc', '.git')
const other = dir('lib')

test('add attaches canonical path with unique name', () => {
  const r1 = addRootTo(primary, [], ppc)
  assert.equal(r1.added, true)
  assert.deepEqual(r1.root, { name: 'ppc', path: ppc })
  const r2 = addRootTo(primary, r1.roots, '../ppc')
  assert.equal(r2.added, false)
  assert.equal(r2.roots, r1.roots)
  const r3 = addRootTo(primary, r1.roots, other, 'shared')
  assert.equal(r3.root.name, 'shared')
})

test('add rejects bad targets', () => {
  assert.throws(() => addRootTo(primary, [], join(base, 'nope')), /not an existing directory/)
  assert.throws(() => addRootTo(primary, [], primary), /already the primary root/)
  assert.throws(() => addRootTo(primary, [], dir('payca', 'sub')), /inside the primary root/)
  assert.throws(() => addRootTo(primary, [], base), /contains the primary root/)
  assert.throws(() => addRootTo(primary, [], '/'), /too broad/)
  assert.throws(() => addRootTo(primary, [], other, 'payca'), /already used/)
  assert.throws(() => addRootTo(primary, [], other, 'bad name'), /Invalid name/)
  const { roots } = addRootTo(primary, [], ppc)
  assert.throws(() => addRootTo(primary, roots, dir('ppc', 'inner')), /overlaps/)
})

test('name collision gets a suffix', () => {
  const twin = dir('x', 'ppc')
  const { roots } = addRootTo(primary, [], ppc)
  assert.equal(addRootTo(primary, roots, twin).root.name, 'ppc-2')
})

test('remove by name or path', () => {
  const { roots } = addRootTo(primary, [], ppc)
  assert.equal(removeRootFrom(primary, roots, 'ppc').roots.length, 0)
  assert.equal(removeRootFrom(primary, roots, ppc).removed.name, 'ppc')
  assert.throws(() => removeRootFrom(primary, roots, 'zzz'), /No attached root "zzz". Attached: ppc/)
})

test('bwrap gets bind mounts before the separator', () => {
  const argv = ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent', '--tmpfs', '/tmp', '--bind', '/w', '/w', '--', 'bash', '-c', 'x -- y']
  const out = extendConfinedArgv(argv, ['/a', '/b'])
  assert.equal(out.runner, 'bwrap')
  assert.deepEqual(out.argv.slice(out.argv.indexOf('--') - 6), ['--bind', '/a', '/a', '--bind', '/b', '/b', '--', 'bash', '-c', 'x -- y'])
})

test('landlock gets --rw grants', () => {
  const out = extendConfinedArgv(['/x/landlock-run', '--ro', '/', '--rw', '/dev/null', '--rw', '/tmp', '--rw', '/w', '--', 'bash'], ['/a'])
  assert.equal(out.runner, 'landlock')
  assert.deepEqual(out.argv.slice(-4), ['--rw', '/a', '--', 'bash'])
})

test('seatbelt profile gains a subpath grant', () => {
  const out = extendConfinedArgv(['sandbox-exec', '-p', '(version 1) (allow default) (deny file-write*)', '--', 'bash'], ['/a "q"'])
  assert.equal(out.runner, 'seatbelt')
  assert.match(out.argv[2], /\(allow file-write\* \(subpath "\/a \\"q\\""\)\)$/)
})

test('unknown runner is left unchanged', () => {
  const argv = ['runner.exe', '--write-sid', 'S-1', '--', 'cmd']
  assert.deepEqual(extendConfinedArgv(argv, ['/a']), { argv, runner: null })
  assert.deepEqual(extendConfinedArgv(['bash'], ['/a']).runner, null)
  assert.equal(extendConfinedArgv(['other', '--ro', '/', '--rw', '/w', '--', 'bash'], ['/a']).runner, null, 'flags alone do not identify a runner')
  assert.equal(extendConfinedArgv(['/usr/bin/bwrap', '--ro-bind', '/', '/', '--', 'bash'], ['/a']).runner, 'bwrap')
})

test('context renders roots, rules and instructions', () => {
  const all = { files: true, shell: true }
  assert.equal(renderContext({ primary: { name: 'p', path: '/p' }, roots: [], instructions: [], access: all }), '')
  const text = renderContext({
    primary: { name: 'payca', path: '/p/payca' },
    roots: [{ name: 'ppc', path: '/p/ppc', exists: true }, { name: 'gone', path: '/p/gone', exists: false }],
    instructions: [{ root: 'ppc', file: '/p/ppc/AGENTS.md', text: 'Use pnpm.\n', truncated: true }],
    access: all,
    omitted: ['/p/ppc/CLAUDE.md'],
  })
  assert.match(text, /- payca \(primary\): \/p\/payca/)
  assert.match(text, /- gone: \/p\/gone \(missing on disk\)/)
  assert.match(text, /every root above is writable/)
  assert.match(text, /## Instructions for ppc \(\/p\/ppc\/AGENTS.md\)\nUse pnpm\.\n\[truncated/)
  assert.match(text, /read these files directly: \/p\/ppc\/CLAUDE.md/)
  const one = (access) => renderContext({ primary: { name: 'a', path: '/a' }, roots: [{ name: 'b', path: '/b' }], instructions: [], access })
  assert.match(one({ files: false, shell: false }), /outside the sandbox write boundary/)
  assert.match(one(undefined), /outside the sandbox write boundary/)
  assert.match(one({ files: true, shell: false }), /shell commands can write only to the primary root/)
  assert.match(one({ files: false, shell: true }), /file tools can write only to the primary root/)
})

test('home, its ancestors and temp areas are too broad', () => {
  assert.equal(isTooBroad('/'), true)
  assert.equal(isTooBroad(realpathSync(homedir())), true)
  assert.equal(isTooBroad(dirname(realpathSync(homedir()))), true)
  assert.equal(isTooBroad(realpathSync('/tmp')), true)
  assert.equal(isTooBroad(realpathSync(tmpdir())), true)
  assert.equal(isTooBroad(ppc), false)
  assert.throws(() => addRootTo(primary, [], dirname(realpathSync(homedir()))), /too broad/)
})

test('config falls back to defaults on wrong types', () => {
  assert.deepEqual(normalizeConfig(undefined), { ...DEFAULTS, instructionFiles: [...DEFAULTS.instructionFiles], suggestionDirs: [...DEFAULTS.suggestionDirs] })
  const config = normalizeConfig({
    extendSandbox: 'yes',
    instructionFiles: ['AGENTS.md', '../secret', 'a/b.md', '', 7],
    instructionMaxBytes: -1,
    gitTimeoutMs: 5000,
    maxChangedFiles: 1.5,
    suggestionDirs: ['~/src', ' '],
    workspaceTitle: false,
  })
  assert.equal(config.extendSandbox, true)
  assert.deepEqual(config.instructionFiles, ['AGENTS.md'])
  assert.equal(config.instructionMaxBytes, DEFAULTS.instructionMaxBytes)
  assert.equal(config.gitTimeoutMs, 5000)
  assert.equal(config.maxChangedFiles, DEFAULTS.maxChangedFiles)
  assert.deepEqual(config.suggestionDirs, ['~/src'])
  assert.equal(config.workspaceTitle, false)
})

test('repo candidates list git dirs only, excluding given', () => {
  const found = listRepoCandidates([base, join(base, 'missing')], (d) => readdirSync(d), new Set())
  assert.deepEqual(found, [ppc])
  assert.deepEqual(listRepoCandidates([base], (d) => readdirSync(d), new Set([ppc])), [])
})

test('splitArgs honors quotes', () => {
  assert.deepEqual(splitArgs(' add "~/my repo" --name x '), ['add', '~/my repo', '--name', 'x'])
  assert.deepEqual(splitArgs(''), [])
})

writeFileSync(join(base, 'marker'), '')

test('auto titles never replace a user title', () => {
  assert.equal(autoTitle('ppc', [{ name: 'payca' }, { name: 'lib' }]), 'ppc + payca + lib')
  assert.equal(autoTitle('ppc', []), 'ppc')
  assert.equal(isAutoTitle('ppc', 'ppc'), true)
  assert.equal(isAutoTitle('ppc + payca', 'ppc'), true)
  assert.equal(isAutoTitle('Payments', 'ppc'), false)
  assert.equal(isAutoTitle('ppc-old', 'ppc'), false)
})
