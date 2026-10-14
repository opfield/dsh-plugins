# MCP Hub for DeepSeek Harness

[Русский](https://github.com/opfield/dsh-plugins/blob/main/packages/mcp-hub/README.ru.md)

`@opfield/dsh-mcp-hub` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that runs every MCP server in one place, instead of one `dsh-mcp-client` entry per server.

- **A mode per server.** `eager` exposes full tool schemas, `lazy` a compact catalog, `auto` picks by size. Servers with hundreds of tools no longer fill the context.
- **HTTP with OAuth, directly.** No `mcp-remote` and no extra processes: a Sign in button, and tokens refresh on their own.
- **stdio without `npx`.** A package already in the `npx` cache starts as `node <bin>`, without an `npm exec` process next to every server. `@latest` updates are checked in the background.
- **A settings page** in Plugins → MCP Hub: status, modes, adding and editing servers, sign-in. Changes apply without a restart.
- **An API for other plugins.** A plugin can add its own servers to the hub and use their sessions. The hub page shows them in a separate group under the plugin's name.

No build step: plain JavaScript files. The plugin uses the MCP SDK that ships inside DSH.

## Install

1. In DSH open **Plugins → Add plugin**, enter `@opfield/dsh-mcp-hub` (or `github:opfield/dsh-plugins#path:/packages/mcp-hub` to install from GitHub), then **Enable now**.
2. **Move existing MCP servers** (only if they are configured through `dsh-mcp-client`). Quit DSH and run the migration with the Node built into DSH (it needs `yaml` from the DSH installation):
   ```sh
   DSH="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
   HUB=~/.dsh/profiles/desktop/node_modules/@opfield/dsh-mcp-hub
   ELECTRON_RUN_AS_NODE=1 "$DSH" "$HUB/scripts/migrate.mjs" ~/.dsh/profiles/desktop --dry-run   # preview
   ELECTRON_RUN_AS_NODE=1 "$DSH" "$HUB/scripts/migrate.mjs" ~/.dsh/profiles/desktop
   ```
   `desktop` is the default profile of the desktop app. The script moves `@deepseek-ai/dsh-mcp-client` entries from `cordis.patch.yml` into the hub and recognizes wrappers: `npx mcp-remote <url>` becomes a direct HTTP server, `mcp-lazy … -- <command>` a `lazy` server. The backup is `cordis.patch.yml.bak-before-mcp-hub`. Without migration, add servers on the settings page.
3. **Start DSH** and open **Plugins → MCP Hub**. For HTTP servers with OAuth press **Sign in** unless the hub picked up `mcp-remote` tokens by itself.

DSH does not update plugins yet: to upgrade, remove the plugin and add the new version.

## Modes

| Mode | What the model sees |
|---|---|
| `eager` | Every tool as usual: `mcp__<server>__<tool>` with full schemas. |
| `lazy` | No tools are loaded. Each server is a list of "tool: short description" lines in the description of `mcp_call`. The model reads a schema with `mcp_describe(server, tool)`; a call with wrong arguments returns the schema in the error. |
| `auto` | `eager` when the server's schemas fit the threshold (2500 tokens by default), otherwise `lazy`. |

The catalog changes only when a server's tool set changes, so the request prefix stays cacheable.

## Servers

- **stdio**: command, arguments, env, working directory. A `$cred:NAME` value in env or headers reads a secret from the DSH credential store.
- **`npx <package>`**: when the package is in the `npx` cache (`~/.npm/_npx`), the server starts as `node <bin>`. On the first start, before the package is cached, it runs through `npx`. For `@latest` and other tags the hub checks the registry every 12 hours, installs a new version into the same cache, and restarts the server when no call is running. Turn this off with "Run npx packages directly" (`launcher: npx`).
- **HTTP**: Streamable HTTP. OAuth: **Sign in** opens the browser and the answer arrives at `http://127.0.0.1:33419/callback`. On the first start the hub picks up `mcp-remote` tokens from `~/.mcp-auth` for the same URL or host.

Servers start with DSH and keep running. Optionally they stop after N idle minutes or start only on the first call. A stopped or crashed server comes back on the next call. The last tool list is kept on disk, so the model sees the tools before the servers connect.

Data lives in `<profile>/mcp-hub/`: `catalog/*.json` caches tool lists, `oauth/*.json` holds tokens (mode 0600).

## Settings

Everything is on **Plugins → MCP Hub**. It is the `mcp-hub` entry in the profile's `cordis.patch.yml` and can be edited by hand.

| Server field | Default | Meaning |
|---|---|---|
| `name` | — | Name; tools are called `mcp__<name>__<tool>` |
| `mode` | `auto` | `eager` / `lazy` / `auto` |
| `transport` | `stdio` | `stdio` or `http` |
| `command`, `args`, `env`, `cwd` | — | How to start a stdio server |
| `url`, `headers` | — | HTTP server |
| `launcher` | `direct` | `direct` runs `npx` packages without the wrapper, `npx` as written |
| `idleStopMinutes` | `0` | Stop after idling; `0` keeps the server running |
| `connectAtStartup` | `true` | `false` takes the tool list from the cache and starts on the first call |
| `catalog` | `full` | `names` lists only tool names in the catalog |
| `instructions` | `auto` | Server instructions in the system prompt: `auto` (eager servers), `full`, `off` |
| `description` | — | A line about the server in the catalog |
| `toolCallTimeoutMs` | `60000` | Call timeout |

Hub-wide: `autoEagerMaxTokens` (2500), `catalogLineChars` (120), `startupTimeoutMs` (30000), `oauthCallbackPort` (33419).

## Plugin API

The hub provides the `mcpHub` service. Full reference with types: [types/mcp-hub.d.ts](https://github.com/opfield/dsh-plugins/blob/main/packages/mcp-hub/types/mcp-hub.d.ts) (also exported as `@opfield/dsh-mcp-hub/types`).

```js
export function apply(ctx) {
  // optional dependency: without the hub the plugin simply has no servers
  ctx.inject(['mcpHub'], (scope) => {
    const registration = scope.mcpHub.register(
      { id: 'my-plugin', title: 'My plugin', description: 'Configured in Plugins → My plugin.' },
      [{ name: 'acme', transport: 'http', url: 'https://acme.example/mcp', mode: 'lazy' }],
    )
    return registration // the servers leave the hub when the plugin unloads
  })
}
```

| Method | What it does |
|---|---|
| `register(owner, servers)` | Adds the plugin's servers. Calling again with the same `owner.id` replaces the list. Returns a disposer with `update(servers)` and `problems` |
| `servers({ owner })` | State of all servers, or of one plugin's |
| `status(name)` | One server: status, tools, token counts, OAuth state and scopes |
| `action(name, action)` | `restart`, `stop`, `refresh`, `signin`, `signout`, `update`, like the page buttons |
| `call(name, tool, args)` | A direct `tools/call` for the plugin's own needs |
| `onChange(listener)` | Called on any change; returns an unsubscribe function |

Rules:

- Server names are shared across the hub. The user's own servers win; between plugins, the first registration keeps the name. Conflicts and invalid entries do not throw: they go to `problems` and show up on the hub page.
- `expose: false` keeps the session for the plugin only: the model sees neither the tools, nor the catalog, nor the server's instructions.
- OAuth, the tool cache, direct `npx` launch and modes work as for the user's servers.
- Only the owning plugin can add, change or remove its servers. The hub page offers sign-in, restart and the tool list for them.
- The service `version` is `1` and changes on incompatible changes.

## Revert

`ELECTRON_RUN_AS_NODE=1 "$DSH" "$HUB/scripts/migrate.mjs" ~/.dsh/profiles/desktop --revert` restores the previous `cordis.patch.yml`; then remove the plugin in Plugins.

## Development

From the repository root:

```sh
npm install
npm test
```

The integration tests start a real stdio MCP server through the SDK from the `devDependencies`. To test against an installed DSH instead, set `DSH_NODE_MODULES=<extracted app.asar>/dsh/node_modules`.

## License

MIT
