# Opfield plugins for DeepSeek Harness

[![M8ven Score](https://m8ven.ai/badge/mcp/opfield/dsh-plugins)](https://m8ven.ai/mcp/opfield/dsh-plugins?s=readme)

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

| Package | What it does |
|---|---|
| [`@opfield/dsh-mcp-hub`](packages/mcp-hub) | Every MCP server in one place: eager / lazy / auto tool exposure per server, OAuth for HTTP servers, direct launch of `npx` packages, and an API for plugins that bring their own servers. Works with any MCP server, not only Opfield. |
| [`@opfield/dsh-opfield`](packages/opfield) | Opfield instances as MCP servers, models from one instance with an automatic inference token and model sync, plus budget, prompt-cache timer and `/compact` offer components. Requires MCP Hub. |
| [`@opfield/dsh-multi-repo`](packages/multi-repo) | Multi-root workspaces: attach other repositories to a workspace. Attached roots are writable under `workspace-write`, listed in the model context with their `AGENTS.md`, and edited from the composer or `/roots`. Works on its own. |

## Install

In DSH open **Plugins → Add plugin**, enter a spec from the table, then **Enable now**. Install MCP Hub first: the Opfield plugin needs it. Restart DSH after adding Opfield.

| Plugin | From npm | From this repository |
|---|---|---|
| MCP Hub | `@opfield/dsh-mcp-hub` | `github:opfield/dsh-plugins#path:/packages/mcp-hub` |
| Opfield | `@opfield/dsh-opfield` | `github:opfield/dsh-plugins#path:/packages/opfield` |
| Multi-root workspaces | `@opfield/dsh-multi-repo` | `github:opfield/dsh-plugins#path:/packages/multi-repo` |

To pin a version from the repository, add its tag before `path`: `github:opfield/dsh-plugins#mcp-hub-v0.4.1&path:/packages/mcp-hub`, `github:opfield/dsh-plugins#opfield-v0.5.2&path:/packages/opfield`.

Then open **Plugins → Opfield → Add instance**, enter the instance address and press **Sign in**. Each package's README covers the details: [MCP Hub](packages/mcp-hub#install), [Opfield](packages/opfield#install), [Multi-root workspaces](packages/multi-repo#install).

DSH does not update plugins yet: to upgrade, remove the plugin and add the new version.

## Development

```sh
npm install   # Harness packages the tests run against
npm test
```

The plugins have no build step. To try a working copy, add it in DSH by absolute path (`/path/to/dsh-plugins/packages/mcp-hub`).

## Release

Bump `version` in `packages/<dir>/package.json`, commit, and push a tag `<dir>-v<version>`, for example `mcp-hub-v0.4.1`. The Release workflow tests, publishes the package to npm with provenance, and creates a GitHub release.

## License

[MIT](LICENSE)
