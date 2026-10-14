/**
 * The `mcpHub` service of @opfield/dsh-mcp-hub.
 *
 * Any DSH host plugin can contribute MCP servers to the hub and use their
 * sessions. Inject it as an optional service so your plugin stays inactive in
 * profiles without the hub:
 *
 * ```js
 * export function apply(ctx) {
 *   ctx.inject(['mcpHub'], (scope) => {
 *     const hub = scope.mcpHub
 *     const reg = hub.register({ id: 'my-plugin', title: 'My plugin' }, [
 *       { name: 'acme', transport: 'http', url: 'https://acme.example/mcp', mode: 'lazy' },
 *     ])
 *     return reg // disposer: withdraws the servers when the scope ends
 *   })
 * }
 * ```
 *
 * Servers you contribute are listed on the hub page under your title. The user
 * can sign in, restart and inspect them there; adding, editing and removing
 * stay with your plugin.
 */
export interface McpHubService {
  /** 1 for this shape; bumped on incompatible changes. */
  readonly version: 1

  /**
   * Contribute servers. Calling it again with the same owner id replaces the
   * owner's list. Names are global in the hub: the user's own servers win, and
   * between plugins the earlier registration keeps the name. Clashing and
   * invalid entries are not thrown; they show up in `problems`.
   */
  register(owner: McpHubOwner | string, servers: McpHubServerSpec[]): McpHubRegistration

  /** Live views of every running server, or only those of one owner. */
  servers(filter?: { owner?: string }): McpHubServerView[]

  /** Live view of one server by name. */
  status(name: string): McpHubServerView | undefined

  /**
   * Operate a server like the buttons on the hub page. `signin` answers
   * `{ status: 'redirect', url }` while the browser sign-in is pending, or
   * `{ status: 'authorized' }`.
   */
  action(name: string, action: 'restart' | 'stop' | 'refresh' | 'signin' | 'signout' | 'update'): Promise<{ ok: boolean; message?: string; [key: string]: unknown }>

  /**
   * Raw MCP `tools/call`, for your plugin's own use (works for servers with
   * `expose: false` too). Starts a stopped server. Rejects with an error named
   * `AuthRequiredError` when the server needs a sign-in. The result is the MCP
   * `CallToolResult` (check `isError`).
   */
  call(name: string, tool: string, args?: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<McpCallToolResult>

  /** Called after any change of servers, tools or status. Returns the unsubscribe function. */
  onChange(listener: () => void): () => void
}

export interface McpHubOwner {
  /** Stable id, e.g. your plugin name: letters, digits and `_ . @ / -`, up to 64 characters. */
  id: string
  /** Shown as the group title on the hub page. Defaults to `id`. */
  title?: string
  /** One line under the title, e.g. where the user manages these servers. */
  description?: string
}

/** The disposer withdraws the servers; it is also the registration handle. */
export interface McpHubRegistration {
  (): void
  dispose(): void
  /** Replace the contributed list. */
  update(servers: McpHubServerSpec[]): void
  /** Entries that were not applied, with the reason. */
  readonly problems: { name: string; reason: string }[]
}

export interface McpHubServerSpec {
  /** `[A-Za-z0-9_-]{1,32}`; tools become `mcp__<name>__<tool>`. */
  name: string
  transport?: 'stdio' | 'http'
  /** How the model sees the tools; default `auto`. */
  mode?: 'eager' | 'lazy' | 'auto'
  /** `false` keeps the session for your plugin only: the model sees nothing. Default `true`. */
  expose?: boolean
  enabled?: boolean
  /** http: Streamable HTTP endpoint. OAuth is handled by the hub (Sign in on the hub page or `action(name, 'signin')`). */
  url?: string
  headers?: Record<string, string>
  /** stdio: `npx <package>` commands run the cached package with node directly unless `launcher: 'npx'`. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  launcher?: 'direct' | 'npx'
  /** Start with DSH (default) or on the first call. */
  connectAtStartup?: boolean
  /** Stop after this many idle minutes; 0 = keep running. */
  idleStopMinutes?: number
  /** `names`: lazy catalog lists tool names only. */
  catalog?: 'full' | 'names'
  /** Server instructions in the system prompt; `auto` = only while eager. */
  instructions?: 'auto' | 'full' | 'off'
  /** One line about the server in the lazy catalog. */
  description?: string
  toolCallTimeoutMs?: number
}

export interface McpHubServerView {
  name: string
  /** Owner id for contributed servers; absent for the user's own. */
  owner?: string
  transport: 'stdio' | 'http'
  url?: string
  status: 'running' | 'starting' | 'stopped' | 'disabled' | 'auth' | 'error'
  running: boolean
  enabled: boolean
  /** Whether the model sees this server. */
  exposed: boolean
  mode: 'eager' | 'lazy' | 'auto'
  effectiveMode: 'eager' | 'lazy'
  error?: string
  stderr?: string
  /** Estimated tokens of all tool schemas, and of the lazy catalog lines. */
  tokens: number
  catalogTokens: number
  tools: { name: string; summary: string; tokens: number }[]
  oauth?: { signedIn: boolean; imported: boolean; url?: string; scopes: string[] }
  launch?: { direct: boolean; version?: string; npx: boolean }
}

export interface McpCallToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>
  structuredContent?: unknown
  isError?: boolean
}
