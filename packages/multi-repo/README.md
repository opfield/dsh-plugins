# Multi-root workspaces for DeepSeek Harness

[Русский](README.ru.md)

The `@opfield/dsh-multi-repo` plugin for DeepSeek Harness (DSH) adds multi-root workspaces, like multi-folder projects in the Codex app. Open a session in one repository as usual, then attach other repositories to that workspace. The agent then works across all of them in one session.

- **Shared per workspace.** The root list is stored in DSH storage (`~/.dsh/storages/multi_repo.json`), keyed by the workspace path, so every session of the workspace shares it. Nothing is written into the repositories, and no extra workspace folder or manifest file is needed.
- **Writable like the primary root.** Under `workspace-write`, file tools and shell commands can write to attached roots.
- **In the model context.** The agent sees every root, per-root working rules, and the `AGENTS.md` / `CLAUDE.md` of the attached roots.
- **Only the user changes the list.** The agent has the read-only `workspace_roots` tool, so it cannot widen its own write access.

No build step: these are plain JS files.

## Install

1. **Plugins → Add plugin**: enter `@opfield/dsh-multi-repo` (or `github:opfield/dsh-plugins#path:/packages/multi-repo` to install from GitHub), then **Enable now**.
2. Restart DSH: the plugin extends the file and shell sandbox when the host starts.

DSH does not update plugins yet: to upgrade, remove the plugin and add the new version.

## Use

- **Composer button:** the folder icon under the composer, next to the context meter. It shows every root with its branch and number of changed files. Attach a folder by path, or pick one of the nearby repositories (siblings of the workspace and `~/projects/*`). Detach a root with `×`.
- **Command:**
  - `/roots` lists the roots.
  - `/roots add ~/projects/web [--name web]` attaches a folder.
  - `/roots remove web` detaches one. Files on disk are not touched.

A root cannot be the home directory or one of its ancestors, `/tmp` itself, a folder inside the primary root or one that contains it, or a folder that overlaps another attached root.

### Where the roots are visible

- **Sidebar:** the workspace group is renamed to `api + web`. Only the default title (the folder name) or a title the plugin made is replaced; a title you set yourself is kept. Detaching the last root restores the folder name.
- **Session hover card in the sidebar:** a `Roots: api + web` line.
- **Session header:** an `api + web` chip that opens the roots panel. It is hidden when there are no extra roots.
- **Composer:** a folder button with a `2 roots` counter. It is always shown, because this is where roots are attached.

## What the agent gets

- **Runtime context:** a section listing every root, per-root working rules, and the instruction files of the attached roots (`AGENTS.md`, `CLAUDE.md`, ... within `instructionMaxBytes`; identical files are included once). The primary root's own instruction files load through DSH as usual. The section changes only when the roots, the write grants, or those files change, so the prompt cache is preserved.
- **Write access:** under `workspace-write`, attached roots are writable just like the primary root:
  - file tools (`write`, `edit`);
  - shell commands and terminals, through bwrap bind mounts, Landlock `--rw` grants, or a Seatbelt `subpath`.

  `read-only` and `danger-full-access` behave as before.
- **`workspace_roots` tool:** branch, upstream ahead/behind, last commit, and uncommitted changes for every root.

### How write access works

The DSH sandbox policy has exactly one writable workspace root per session, with no setting for more. This plugin wraps two methods of the running DSH instance:

- `checkedTarget` of the sandboxed filesystem: a write denied under `workspace-write` is allowed when its freshly canonicalized target lies inside an attached root;
- `confine` of the sandbox provider: the attached roots are added to the runner's writable set. The runner is recognized by its program (`bwrap`, `landlock-run`, `sandbox-exec`); any other runner keeps its command line unchanged.

The wrapping is undone when the plugin unloads. When a DSH update renames these methods, or the sandbox uses a runner the plugin does not know, the plugin leaves it alone and the context tells the agent exactly which kind of write (file tools or shell) cannot reach the attached roots. Set `extendSandbox: false` to turn the extension off completely.

## Config

Entry `multi-repo` in the profile `cordis.patch.yml`. A value of the wrong type falls back to its default.

| Field | Default | Meaning |
|---|---|---|
| `extendSandbox` | `true` | Make attached roots writable under `workspace-write` |
| `instructionFiles` | `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `AGENTS.local.md`, `CLAUDE.local.md` | File names read at the top of each attached root (no paths) |
| `instructionMaxBytes` | `32768` | Budget for those files in the model context |
| `gitTimeoutMs` | `15000` | Timeout per git command |
| `maxChangedFiles` | `50` | Changed files listed per root by `workspace_roots` |
| `suggestionDirs` | `['~/projects']` | Folders whose Git repositories the composer panel suggests |
| `workspaceTitle` | `true` | Rename the sidebar workspace group to `primary + root + ...` |

## Limits

- The Files sidebar and the per-turn changed-files card show only the primary root.
- The Windows ACL sandbox runner is not extended: on Windows, shell commands cannot write to attached roots under `workspace-write`; file tools can.
- Git status runs with `core.fsmonitor` turned off, so an attached repository's config cannot start a program through it.

## Development

From the repository root:

```sh
npm install
npm test
```

## License

MIT
