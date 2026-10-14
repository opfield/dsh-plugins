/**
 * Modules borrowed from the running Harness installation. A profile bundle has
 * no dependencies of its own, so every package is resolved beside the Host
 * entry script (absolute paths on argv inside the installation tree).
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

function bases() {
  const out = []
  for (const arg of process.argv.slice(1)) {
    if (typeof arg !== 'string' || !isAbsolute(arg)) continue
    out.push(/\.[cm]?js$/.test(arg) ? arg : join(arg, 'package.json'))
  }
  if (process.env.DSH_NODE_MODULES) out.push(join(process.env.DSH_NODE_MODULES, 'package.json'))
  return out
}

/** Directory of an installed package, or undefined. */
export function packageDir(name) {
  for (const base of bases()) {
    const require = createRequire(base)
    try {
      return dirname(require.resolve(`${name}/package.json`))
    } catch {
      // packages whose exports hide package.json: walk up from the main entry
    }
    try {
      let dir = dirname(require.resolve(name))
      while (dir !== dirname(dir)) {
        const manifest = join(dir, 'package.json')
        if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return dir
        dir = dirname(dir)
      }
    } catch {
      // next candidate
    }
  }
  return undefined
}

async function load(name, file) {
  const dir = packageDir(name)
  if (dir === undefined) return undefined
  try {
    return await import(pathToFileURL(join(dir, file)).href)
  } catch {
    return undefined
  }
}

/**
 * Everything the hub needs, or `missing` naming what could not be loaded.
 * Paths match the packages' ESM `import` targets so these are the very module
 * instances the built-in MCP client uses.
 */
export async function loadInstall() {
  const [schemastery, sdk, stdio, mcpClient, subprocess, tools] = await Promise.all([
    load('@deepseek-ai/schemastery', 'lib/index.mjs'),
    load('@modelcontextprotocol/client', 'dist/index.mjs'),
    load('@modelcontextprotocol/client', 'dist/stdio.mjs'),
    load('@deepseek-ai/dsh-mcp-client', 'lib/index.js'),
    load('@deepseek-ai/dsh-subprocess', 'lib/index.js'),
    load('@deepseek-ai/dsh-tools', 'lib/index.js'),
  ])
  const install = {
    z: schemastery?.default,
    Client: sdk?.Client,
    StreamableHTTPClientTransport: sdk?.StreamableHTTPClientTransport,
    auth: sdk?.auth,
    UnauthorizedError: sdk?.UnauthorizedError,
    StdioClientTransport: stdio?.StdioClientTransport,
    createMcpToolDefinition: mcpClient?.createMcpToolDefinition,
    scrubbedParentEnv: subprocess?.scrubbedParentEnv ?? (() => ({ ...process.env })),
    assertSupportedJsonSchema: tools?.assertSupportedJsonSchema,
  }
  install.missing = ['z', 'Client', 'StreamableHTTPClientTransport', 'auth', 'StdioClientTransport', 'createMcpToolDefinition'].filter((k) => install[k] === undefined)
  return install
}
