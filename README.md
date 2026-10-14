# Opfield plugins for DeepSeek Harness

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

| Package | What it does |
|---|---|
| [`@opfield/dsh-mcp-hub`](packages/mcp-hub) | Every MCP server in one place: eager / lazy / auto tool exposure per server, OAuth for HTTP servers, direct launch of `npx` packages, and an API for plugins that bring their own servers. Works with any MCP server, not only Opfield. |
| [`@opfield/dsh-opfield`](packages/opfield) | Opfield instances as MCP servers, models from one instance with an automatic inference token and model sync, plus budget, prompt-cache timer and `/compact` offer components. Requires MCP Hub. |

## Install

In DSH open **Plugins → Add plugin** and enter the package name, for example `@opfield/dsh-mcp-hub`. Without npm, install straight from this repository:

```
github:opfield/dsh-plugins#path:/packages/mcp-hub
github:opfield/dsh-plugins#mcp-hub-v0.4.1&path:/packages/mcp-hub
```

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
