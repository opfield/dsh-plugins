# Opfield for DeepSeek Harness

[Русский](https://github.com/opfield/dsh-plugins/blob/main/packages/opfield/README.ru.md)

`@opfield/dsh-opfield` connects Opfield to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). An Opfield instance needs only its address and a sign-in; no keys to copy by hand.

- **Instances.** Any number of Opfield installations. Each one reaches the model as an MCP server through [MCP Hub](https://github.com/opfield/dsh-plugins/tree/main/packages/mcp-hub), always as a compact catalog (lazy): Opfield has hundreds of tools.
- **Models from one instance**, picked from a list. The plugin issues an inference token, points the `opfield` model route at the instance, and syncs the model list with names, limits, image support and reasoning levels.
- **Components**: separate rows in Plugins → Components, each with its own switch:
  - **Opfield budget**: the remaining budget under the composer;
  - **Prompt cache timer**: time left in the prompt cache (5m or 1h);
  - **Compact offer**: suggests `/compact` once the cache has gone cold.

No build step: plain JavaScript files.

## Install

1. **Install [MCP Hub](https://github.com/opfield/dsh-plugins/tree/main/packages/mcp-hub)** (`@opfield/dsh-mcp-hub`). Sign-in and every request to Opfield go through it.
2. **Plugins → Add plugin**: enter `@opfield/dsh-opfield`, then **Enable now**. Restart DSH.
3. **Plugins → Opfield → Add instance**: enter the address, for example `https://ops.example.com`, then **Sign in**. The first instance becomes the model source right away.

A few seconds after sign-in Opfield shows up in the model picker and the budget under the composer.

DSH does not update plugins yet: to upgrade, remove the plugin and add the new version.

## How it works

- **Sign-in** is OAuth in MCP Hub. Tokens live in `<profile>/mcp-hub/oauth/` with mode 0600 and refresh on their own.
- **The budget** is read with the `manage_inference_usage` tool over the same MCP session. No REST token is needed.
- **The inference token.** When the route has no key, the plugin issues one with `manage_inference_token`, named "DeepSeek Harness · <host>", and stores it in the DSH credential store as `OPFIELD_<NAME>_INFERENCE_KEY`. Without the `feat:ai:use` permission the instance is marked "no inference access". When Opfield refuses to issue a token, the page offers a field to paste one issued by hand.
- **Switching the instance** rewrites the address and key of the `opfield` route and syncs the models again. When the default model is missing on the new instance, it moves to the first available one and the page says so. Open chats keep their model until you change it.
- **Removing an instance** revokes the token the plugin issued and deletes the key from the store. Tokens issued by hand are left alone.
- **MCP off** for an instance hides its tools from the model; the session keeps working for the budget and tokens when the instance is the model source.

MCP Hub lists these servers in an "Opfield" group. They are changed and removed only here.

## Settings

Everything is on **Plugins → Opfield** and applies immediately:

- **Instances**: one row per instance with status, Sign in and the MCP switch. The arrow opens restart, stop, refresh tools, sign out, edit and remove.
- **Models**: the model source (or "None"), the model count, the last sync, the remaining budget, and Refresh.
- **Components**: settings of the enabled components: prompt cache lifetime (5m / 1h) for the timer and the `/compact` threshold. The components themselves are switched in Plugins → Components.
- **Advanced** (collapsed): budget colors and refresh rate, a custom cache lifetime, sync interval and model masks, the route and `llm-pi-ai` entry names, timeouts.

It is the `opfield-usage` entry in the profile's `cordis.patch.yml`:

```yaml
- id: opfield-usage
  name: '@opfield/dsh-opfield'
  config:
    instances:
      - { name: opfield, url: https://ops.example.com, mcp: true }
    inference: opfield
    promptCacheTtlMinutes: 60
    compactMinTokens: 30000
```

The components are the `opfield-budget`, `opfield-cache-timer` and `opfield-compact-offer` entries of the same package (`@opfield/dsh-opfield/budget` and so on); a disabled one gets `disabled: true`.

Version 0.3 settings (`baseURL`, `display`, `modelSync`…) are read as a single `opfield` instance and written in the new format on the first change.

## Development

From the repository root:

```sh
npm install
npm test
```

## License

MIT
