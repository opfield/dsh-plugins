window.__ModuleLoader__.load({
  id: '@opfield/dsh-mcp-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    /** DSH controls; the same module the Plugins page uses. Absent in tests and very old builds. */
    let UI = null
    try {
      UI = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      UI = null
    }

    const NS = 'mcp-hub'
    const BUNDLE = '@opfield/dsh-mcp-hub'
    const ENTRY_ID = 'mcp-hub'
    const STATUS_ROUTE = 'mcp-hub/status'
    const ACTION_ROUTE = 'mcp-hub/action'
    const POLL_MS = 2500
    const CSS_ID = '@opfield/dsh-mcp-hub/style'
    const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

    // Controls copied from ui-primitives (SegmentedControl, Switch, Tag, StateDot,
    // settings-form) and the Plugins page cards; only --dsw-alias-* tokens.
    const CSS = [
      '.mch-page{display:flex;flex-direction:column;gap:28px}',
      '.mch-note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.mch-note[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.mch-section{display:flex;flex-direction:column;gap:12px}',
      '.mch-section-head{display:flex;align-items:center;gap:12px}',
      '.mch-section-titles{flex:1;min-width:0}',
      '.mch-section-title{margin:0;font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.mch-section-desc{margin:2px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.mch-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}',
      '.mch-card{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);padding:12px 14px;display:flex;flex-direction:column;gap:8px}',
      '.mch-card[data-disabled=true] .mch-name,.mch-card[data-disabled=true] .mch-line{opacity:.55}',
      '.mch-row{display:flex;align-items:center;gap:10px;min-width:0}',
      '.mch-name{font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mch-grow{flex:1;min-width:0}',
      '.mch-line{margin:0;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.mch-line[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.mch-line[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}',
      '.mch-sub{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}',
      '.mch-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:12px/1.5 var(--dsw-font-mono,ui-monospace,monospace);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto}',
      '.mch-actions{display:flex;flex-wrap:wrap;gap:6px}',
      // dot (StateDot)
      '.mch-dot{position:relative;display:inline-block;flex:none;width:12px;height:12px}',
      ".mch-dot::after{content:'';position:absolute;inset:20%;border-radius:50%;background:currentColor}",
      '.mch-dot[data-state=done]{color:var(--dsw-alias-state-success-primary)}',
      '.mch-dot[data-state=warning]{color:var(--dsw-alias-state-warn-primary)}',
      '.mch-dot[data-state=error]{color:var(--dsw-alias-state-error-primary)}',
      '.mch-dot[data-state=idle]{color:var(--dsw-alias-state-idle-primary,var(--dsw-alias-label-caption))}',
      '.mch-dot[data-state=busy]::after{animation:mch-pulse 1.2s ease-in-out infinite;color:var(--dsw-alias-state-business-primary)}',
      '@keyframes mch-pulse{50%{opacity:.3}}',
      '@media (prefers-reduced-motion:reduce){.mch-dot[data-state=busy]::after{animation:none}}',
      // tag
      '.mch-tag{display:inline-flex;align-items:center;flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}',
      ".mch-tag[data-tone=outline]{border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}",
      ".mch-tag[data-tone=neutral]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}",
      ".mch-tag[data-tone=info]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}",
      ".mch-tag[data-tone=success]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}",
      ".mch-tag[data-tone=warning]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}",
      // segmented control
      '.mch-seg{position:relative;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:3px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);flex:none}',
      '.mch-seg-ind{position:absolute;top:3px;left:3px;width:calc((100% - 6px - 2px * (var(--n) - 1)) / var(--n));height:calc(100% - 6px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft);transform:translateX(calc(var(--i) * (100% + 2px)));transition:transform 160ms ease;pointer-events:none}',
      '.mch-seg-tab{position:relative;z-index:1;height:24px;padding:0 12px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;line-height:18px;font-weight:500;white-space:nowrap;cursor:pointer}',
      '.mch-seg-tab:hover:not(:disabled),.mch-seg-tab[aria-selected=true]{color:var(--dsw-alias-label-primary)}',
      '.mch-seg-tab:disabled{cursor:default;opacity:.4}',
      '@media (prefers-reduced-motion:reduce){.mch-seg-ind{transition:none}}',
      // switch
      '.mch-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}',
      '.mch-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}',
      '.mch-switch:disabled{cursor:default;opacity:.5}',
      '.mch-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}',
      '.mch-switch[aria-checked=false] .mch-thumb{background:var(--dsw-alias-switch-thumb)}',
      '.mch-switch[aria-checked=true] .mch-thumb{transform:translateX(16px)}',
      // buttons
      '.mch-btn{flex:none;appearance:none;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);padding:2px 10px;font:inherit;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.mch-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.mch-btn:disabled{opacity:.5;cursor:default}',
      '.mch-btn[data-tone=primary]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}',
      '.mch-btn[data-tone=danger]{color:var(--dsw-alias-state-error-primary)}',
      '.mch-btn[data-tone=quiet]{border-color:transparent;background:none;color:var(--dsw-alias-label-secondary)}',
      '.mch-btn[data-tone=quiet]:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.mch-switch:focus-visible,.mch-btn:focus-visible,.mch-seg-tab:focus-visible,.mch-link:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.mch-link{border:0;background:none;padding:0;font:inherit;color:var(--dsw-alias-state-business-primary);cursor:pointer;text-decoration:underline;text-underline-offset:2px}',
      // tools list
      '.mch-tools{display:flex;flex-direction:column;margin:0;padding:6px 0 0;border-top:.5px solid var(--dsw-alias-border-l2);list-style:none;max-height:320px;overflow:auto}',
      '.mch-tool{display:flex;gap:10px;padding:4px 0;font-size:12px;line-height:18px}',
      '.mch-tool-name{flex:none;max-width:45%;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mch-tool-sum{flex:1;min-width:0;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mch-tool-tok{flex:none;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}',
      // form
      '.mch-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.mch-field{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.mch-field[data-wide=true]{grid-column:1/-1}',
      '.mch-label{font-size:12.5px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.mch-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}',
      'textarea.mch-input{height:auto;min-height:60px;padding:6px 10px;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;line-height:1.5}',
      '.mch-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
      ".mch-input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}",
      '.mch-input:disabled{color:var(--dsw-alias-label-tertiary)}',
      '.mch-hint{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.mch-hint[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.mch-inline{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:32px}',
      '.mch-form-foot{grid-column:1/-1;display:flex;align-items:center;gap:8px;justify-content:flex-end}',
      '.mch-form-foot .mch-note{flex:1}',
      '@media (max-width:640px){.mch-form{grid-template-columns:minmax(0,1fr)}}',
      '.mch-stats{margin:0;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.mch-note[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}',
      '.mch-card{padding:8px 12px 8px 8px;gap:6px}',
      '.mch-toggle{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:40%;flex:none;border:0;background:none;padding:2px 4px;margin:-2px 0;border-radius:var(--dsw-radius-sm);font:inherit;color:inherit;cursor:pointer;text-align:left}',
      '.mch-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.mch-toggle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.mch-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform 120ms ease}.mch-chevron[data-open=true]{transform:rotate(90deg)}',
      '.mch-meta{flex:1;min-width:0;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mch-meta[data-tone=error]{color:var(--dsw-alias-state-error-primary)}.mch-meta[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}',
      '.mch-body{display:flex;flex-direction:column;gap:8px;padding:6px 4px 4px 28px}',
      '.mch-target{margin:0;font:12px/18px var(--dsw-font-mono,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mch-details{display:block}',
      '.mch-details-summary{display:flex;flex-direction:column;gap:2px;cursor:pointer;list-style:none}.mch-details-summary::-webkit-details-marker{display:none}',
      '.mch-details-summary .mch-section-title::after{content:"\u203a";display:inline-block;margin-left:6px;color:var(--dsw-alias-label-tertiary);transition:transform 120ms ease}',
      '.mch-details[open] .mch-details-summary .mch-section-title::after{transform:rotate(90deg)}',
      '.mch-details>.mch-form{margin-top:12px}',
      '@media (prefers-reduced-motion:reduce){.mch-chevron{transition:none}}',
      'button.mch-danger{color:var(--dsw-alias-state-error-primary)}',
      '.mch-tag-hint{display:inline-flex;flex:none}',
      '.mch-dot-ui{display:inline-flex;align-items:center;justify-content:center;flex:none;width:12px;height:14px}',
      '.mch-uinput{box-sizing:border-box;width:100%;display:flex}.mch-ushort{width:120px;flex:none}.mch-ushort input{text-align:right;font-variant-numeric:tabular-nums}',
      '.mch-uinvalid{border-color:var(--dsw-alias-state-error-primary)}',
    ].join('')

    const en = {
      summary: 'All MCP servers in one place: full tool schemas or a compact catalog, per server.',
      loading: 'Loading…',
      unavailable: 'Settings are not available: the hub is not loaded. Restart DSH after installing or updating the plugin.',
      hostMissing: 'This Harness lacks {what}; the hub cannot run here.',
      readOnly: 'This deployment stores settings read-only.',
      memory: 'Servers can only be changed from the machine that runs DSH.',
      'stats.servers': '{n} servers',
      'stats.running': '{n} running',
      'stats.eager': '~{tokens} tokens of full schemas',
      'stats.lazy': '~{tokens} in the lazy catalog',
      'servers.title': 'Your servers',
      'servers.desc': 'Eager servers give the model every tool schema up front. Lazy servers show one line per tool inside mcp_call; the model fetches a schema with mcp_describe when it needs one. Auto picks by size.',
      'servers.empty': 'No servers yet. Add one to get started.',
      'contrib.desc': 'Added by the {title} plugin. Add, change or remove them in its settings.',
      'contrib.problem': '{name} is not running: {reason}.',
      'hidden.tag': 'for the plugin only',
      add: 'Add server',
      'mode.label': 'Exposure',
      'mode.auto': 'Auto',
      'mode.eager': 'Eager',
      'mode.lazy': 'Lazy',
      'mode.auto.title': 'Eager when the schemas fit the threshold below, lazy otherwise',
      'mode.eager.title': 'Every tool schema in the model context',
      'mode.lazy.title': 'One catalog line per tool; schemas on demand',
      'effective.eager': 'eager',
      'effective.lazy': 'lazy',
      'enabled.label': 'Enabled',
      'status.running': 'Running',
      'status.starting': 'Starting…',
      'status.stopped': 'Stopped — starts on first use',
      'status.disabled': 'Disabled',
      'status.auth': 'Sign-in required',
      'status.error': 'Error',
      'line.tools': '{count} tools',
      'line.tokens': '~{tokens} tokens of schemas',
      'line.catalog': '~{tokens} in catalog',
      'line.cached': 'tools from cache',
      'line.signedIn': 'signed in',
      'line.imported': 'signed in (imported from mcp-remote)',
      'line.direct': 'node, v{version}',
      'line.npx': 'via npx',
      'line.checking': 'Checking for updates…',
      'line.updated': 'updated {from} → {to}',
      'action.update': 'Check for updates',
      'action.signin': 'Sign in',
      'action.signout': 'Sign out',
      'action.restart': 'Restart',
      'action.start': 'Start',
      'action.stop': 'Stop',
      'action.refresh': 'Refresh tools',
      'action.tools': 'Tools',
      'action.hideTools': 'Hide tools',
      'action.edit': 'Edit',
      'action.remove': 'Remove',
      'action.confirmRemove': 'Click again to remove',
      'action.openLink': 'open the sign-in page',
      'signin.waiting': 'Finish signing in in the browser. If it did not open, {link}.',
      'tools.none': 'No tools reported yet.',
      'f.name': 'Name',
      'f.name.hint': 'Letters, digits, - and _. Tool names become mcp__<name>__<tool>.',
      'f.name.invalid': 'Use 1–32 letters, digits, - or _.',
      'f.name.taken': 'Another server already uses this name.',
      'f.transport': 'Transport',
      'f.transport.stdio': 'Command (stdio)',
      'f.transport.http': 'URL (HTTP)',
      'f.command': 'Command',
      'f.command.hint': 'Executable, e.g. npx or an absolute path to node.',
      'f.command.missing': 'Enter the command to run.',
      'f.args': 'Arguments',
      'f.args.hint': 'One argument per line.',
      'f.env': 'Environment',
      'f.env.hint': 'KEY=value per line. $cred:NAME reads a stored credential instead of writing the secret here.',
      'f.cwd': 'Working directory',
      'f.url': 'URL',
      'f.url.hint': 'Streamable HTTP endpoint. OAuth servers get a Sign in button after saving.',
      'f.url.invalid': 'Enter an http(s) URL.',
      'f.headers': 'Headers',
      'f.headers.hint': 'Name: value per line; $cred:NAME works here too.',
      'f.description': 'Catalog description',
      'f.description.hint': "One line shown before the server's tools in the lazy catalog. Empty = the server's own description.",
      'f.idle': 'Stop after idle, min',
      'f.idle.hint': '0 = keep running. The server starts again on the next call.',
      'f.timeout': 'Tool call timeout, s',
      'f.startup': 'Start with DSH',
      'f.startup.hint': 'Off: use the cached tool list and start on first use.',
      'f.names': 'Catalog: names only',
      'f.names.hint': 'For very large servers: list tool names without descriptions.',
      'f.direct': 'Run npx packages directly',
      'f.direct.hint': 'For npx <package> commands: once the package is in the npx cache it runs as node <bin>, without the npm exec process (~50–90 MB). @latest packages are checked for updates every 12 hours.',
      'f.instructions': 'Server instructions in the prompt',
      'f.instructions.auto': 'Auto',
      'f.instructions.full': 'Always',
      'f.instructions.off': 'Never',
      'f.instructions.hint': 'Auto: eager servers include theirs, lazy servers only a summary line.',
      invalidNumber: 'Enter a number from {min} to {max}.',
      save: 'Save',
      saving: 'Saving…',
      cancel: 'Cancel',
      saveFailed: 'DSH did not accept these values.',
      'hub.title': 'Advanced',
      'hub.desc': 'Auto threshold, catalog line length and start-up wait, for every server.',
      'hub.threshold': 'Auto: eager up to, tokens',
      'hub.threshold.hint': 'A server in Auto mode loads its full schemas when they fit this budget.',
      'hub.lineChars': 'Catalog line length, characters',
      'hub.startup': 'Startup wait, s',
      'hub.startup.hint': 'How long DSH waits for a server without a cached tool list before the first turn.',
    }

    function ensureStyle() {
      if (document.getElementById(CSS_ID) !== null) return () => {}
      const style = document.createElement('style')
      style.id = CSS_ID
      style.textContent = CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n ?? 0))

    async function request(path, body) {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      })
      if (!response.ok && response.status !== 200) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    /** Live hub status, polled while a page is mounted. */
    function useStatus() {
      const [status, setStatus] = React.useState(null)
      const [failed, setFailed] = React.useState(false)
      const load = React.useCallback(async () => {
        try {
          setStatus(await request(STATUS_ROUTE))
          setFailed(false)
        } catch {
          setFailed(true)
        }
      }, [])
      React.useEffect(() => {
        let live = true
        let timer
        const tick = async () => {
          if (!live) return
          if (document.visibilityState === 'visible') await load()
          if (live) timer = setTimeout(tick, POLL_MS)
        }
        tick()
        return () => {
          live = false
          clearTimeout(timer)
        }
      }, [load])
      return { status, failed, reload: load }
    }

    // ── controls: DSH primitives (@deepseek-ai/dsh-client-ui-primitives) ──
    // The look-alike fallbacks below run only where the primitives are missing
    // (tests, very old builds).
    const DOT_STATE = { done: 'done', busy: 'ongoing', warning: 'warning', error: 'error', idle: 'idle' }
    const classes = (...names) => names.filter(Boolean).join(' ')

    function Switch({ checked, onChange, label, disabled, title }) {
      if (UI?.Switch) return h(UI.Switch, { checked, onChange, label, disabled, title })
      return h('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, title, disabled, className: 'mch-switch', onClick: () => onChange(!checked) }, h('span', { className: 'mch-thumb' }))
    }

    function Segmented({ id, value, options, onChange, label, disabled }) {
      if (UI?.SegmentedControl) {
        const base = id ?? `mch-seg-${String(label ?? '').replace(/[^A-Za-z0-9]+/g, '-')}`
        return h(UI.SegmentedControl, { id: base, value, options: options.map((o) => ({ value: o.value, label: o.label, title: o.title, disabled: o.disabled })), onChange, label, disabled })
      }
      const index = Math.max(0, options.findIndex((o) => o.value === value))
      return h(
        'div',
        { role: 'tablist', 'aria-label': label, className: 'mch-seg', style: { '--n': String(options.length), '--i': String(index) } },
        h('span', { 'aria-hidden': true, className: 'mch-seg-ind' }),
        options.map((o) =>
          h('button', { key: o.value, type: 'button', role: 'tab', 'aria-selected': o.value === value, title: o.title, disabled: disabled || o.disabled, className: 'mch-seg-tab', onClick: () => o.value !== value && onChange(o.value) }, o.label),
        ),
      )
    }

    /** tone: primary | quiet (ghost) | danger | default (outline). */
    function Button({ tone, onClick, disabled, children, title, icon }) {
      if (UI?.Button) {
        const variant = tone === 'primary' ? 'primary' : tone === 'quiet' ? 'ghost' : 'outline'
        return h(UI.Button, { variant, size: 'sm', icon, className: tone === 'danger' ? 'mch-danger' : undefined, onClick, disabled, title }, children)
      }
      return h('button', { type: 'button', className: 'mch-btn', 'data-tone': tone, onClick, disabled, title }, children)
    }

    function Tag({ tone = 'outline', title, children }) {
      const tag = UI?.Tag ? h(UI.Tag, { tone }, children) : h('span', { className: 'mch-tag', 'data-tone': tone }, children)
      return title ? h('span', { className: 'mch-tag-hint', title }, tag) : tag
    }

    function Dot({ state }) {
      if (UI?.StateDot) return h('span', { className: 'mch-dot-ui', 'aria-hidden': true }, h(UI.StateDot, { state: DOT_STATE[state] ?? 'idle' }))
      return h('span', { className: 'mch-dot', 'data-state': state, 'aria-hidden': true })
    }

    /** Single-line text field; `className` styles the fallback only. */
    function TextInput({ className, short, ...rest }) {
      if (UI?.Input) return h(UI.Input, { className: classes('mch-uinput', short && 'mch-ushort', rest['aria-invalid'] && 'mch-uinvalid'), ...rest })
      return h('input', { className, ...rest })
    }

    function Field({ label, hint, error, wide, children, id }) {
      return h(
        'div',
        { className: 'mch-field', 'data-wide': wide ? true : undefined },
        h('label', { className: 'mch-label', htmlFor: id }, label),
        children,
        error ? h('p', { className: 'mch-hint', 'data-tone': 'error' }, error) : hint ? h('p', { className: 'mch-hint' }, hint) : null,
      )
    }

    // ── server form ─────────────────────────────────────────────────────
    const lines = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
    const dictToText = (dict, sep) => Object.entries(dict ?? {}).map(([k, v]) => `${k}${sep}${v}`).join('\n')
    function textToDict(text, sep) {
      const out = {}
      for (const line of lines(text)) {
        const i = line.indexOf(sep)
        if (i <= 0) continue
        out[line.slice(0, i).trim()] = line.slice(i + sep.length).trim()
      }
      return out
    }

    function draftOf(server) {
      return {
        name: server?.name ?? '',
        transport: server?.transport ?? 'stdio',
        command: server?.command ?? '',
        args: (server?.args ?? []).join('\n'),
        env: dictToText(server?.env, '='),
        cwd: server?.cwd ?? '',
        url: server?.url ?? '',
        headers: dictToText(server?.headers, ': '),
        description: server?.description ?? '',
        idleStopMinutes: String(server?.idleStopMinutes ?? 0),
        toolCallTimeoutS: String(Math.round((server?.toolCallTimeoutMs ?? 60000) / 1000)),
        connectAtStartup: server?.connectAtStartup !== false,
        namesOnly: server?.catalog === 'names',
        direct: server?.launcher !== 'npx',
        instructions: server?.instructions === 'summary' ? 'auto' : server?.instructions ?? 'auto',
      }
    }

    function validate(draft, others, isNew, t) {
      const errors = {}
      if (isNew) {
        if (!NAME_RE.test(draft.name)) errors.name = t('f.name.invalid')
        else if (others.some((s) => s.name === draft.name)) errors.name = t('f.name.taken')
      }
      if (draft.transport === 'stdio' && draft.command.trim() === '') errors.command = t('f.command.missing')
      if (draft.transport === 'http' && !/^https?:\/\/\S+$/.test(draft.url.trim())) errors.url = t('f.url.invalid')
      const idle = Number(draft.idleStopMinutes)
      if (!Number.isFinite(idle) || idle < 0 || idle > 1440) errors.idleStopMinutes = t('invalidNumber', { min: 0, max: 1440 })
      const timeout = Number(draft.toolCallTimeoutS)
      if (!Number.isFinite(timeout) || timeout < 1 || timeout > 3600) errors.toolCallTimeoutS = t('invalidNumber', { min: 1, max: 3600 })
      return errors
    }

    function serverFromDraft(draft, base) {
      const out = {
        ...(base ?? { enabled: true, mode: 'auto' }),
        name: draft.name,
        transport: draft.transport,
        description: draft.description.trim(),
        idleStopMinutes: Number(draft.idleStopMinutes),
        toolCallTimeoutMs: Math.round(Number(draft.toolCallTimeoutS) * 1000),
        connectAtStartup: draft.connectAtStartup,
        catalog: draft.namesOnly ? 'names' : 'full',
        instructions: draft.instructions,
      }
      if (draft.transport === 'stdio') {
        Object.assign(out, { command: draft.command.trim(), args: lines(draft.args), env: textToDict(draft.env, '='), cwd: draft.cwd.trim(), launcher: draft.direct ? 'direct' : 'npx' })
        delete out.url
        delete out.headers
      } else {
        Object.assign(out, { url: draft.url.trim(), headers: textToDict(draft.headers, ':') })
        delete out.command
        delete out.args
        delete out.env
        delete out.cwd
      }
      return out
    }

    function ServerForm({ t, server, others, onSave, onCancel, disabled }) {
      const isNew = server === undefined
      const [draft, setDraft] = React.useState(() => draftOf(server))
      const [phase, setPhase] = React.useState('idle')
      const errors = validate(draft, others, isNew, t)
      const invalid = Object.keys(errors).length > 0
      const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e && e.target ? e.target.value : e }))
      const idp = `mch-f-${server?.name ?? 'new'}`
      const input = (key, extra = {}) => h(TextInput, { id: `${idp}-${key}`, className: 'mch-input', type: 'text', spellCheck: false, autoComplete: 'off', value: draft[key], onChange: set(key), disabled, ...(errors[key] ? { 'aria-invalid': true } : {}), ...extra })
      const area = (key, rows = 3) => h('textarea', { id: `${idp}-${key}`, className: 'mch-input', rows, spellCheck: false, value: draft[key], onChange: set(key), disabled })
      const stdio = draft.transport === 'stdio'
      return h(
        'div',
        { className: 'mch-form' },
        isNew ? h(Field, { id: `${idp}-name`, label: t('f.name'), hint: t('f.name.hint'), error: draft.name && errors.name }, input('name', { placeholder: 'github' })) : null,
        h(
          Field,
          { label: t('f.transport'), wide: !isNew },
          h(Segmented, { id: `${idp}-transport`, label: t('f.transport'), value: draft.transport, disabled, onChange: set('transport'), options: [{ value: 'stdio', label: t('f.transport.stdio') }, { value: 'http', label: t('f.transport.http') }] }),
        ),
        stdio
          ? [
              h(Field, { key: 'command', id: `${idp}-command`, label: t('f.command'), hint: t('f.command.hint'), error: errors.command, wide: true }, input('command', { placeholder: 'npx' })),
              h(Field, { key: 'args', id: `${idp}-args`, label: t('f.args'), hint: t('f.args.hint') }, area('args')),
              h(Field, { key: 'env', id: `${idp}-env`, label: t('f.env'), hint: t('f.env.hint') }, area('env')),
              h(Field, { key: 'cwd', id: `${idp}-cwd`, label: t('f.cwd'), wide: true }, input('cwd')),
            ]
          : [
              h(Field, { key: 'url', id: `${idp}-url`, label: t('f.url'), hint: t('f.url.hint'), error: draft.url && errors.url, wide: true }, input('url', { placeholder: 'https://example.com/mcp' })),
              h(Field, { key: 'headers', id: `${idp}-headers`, label: t('f.headers'), hint: t('f.headers.hint'), wide: true }, area('headers', 2)),
            ],
        h(Field, { id: `${idp}-description`, label: t('f.description'), hint: t('f.description.hint'), wide: true }, input('description')),
        h(Field, { id: `${idp}-idleStopMinutes`, label: t('f.idle'), hint: t('f.idle.hint'), error: errors.idleStopMinutes }, input('idleStopMinutes', { inputMode: 'numeric' })),
        h(Field, { id: `${idp}-toolCallTimeoutS`, label: t('f.timeout'), error: errors.toolCallTimeoutS }, input('toolCallTimeoutS', { inputMode: 'numeric' })),
        h(
          'div',
          { className: 'mch-field' },
          h('div', { className: 'mch-inline' }, h('span', { className: 'mch-label' }, t('f.startup')), h(Switch, { checked: draft.connectAtStartup, label: t('f.startup'), disabled, onChange: set('connectAtStartup') })),
          h('p', { className: 'mch-hint' }, t('f.startup.hint')),
        ),
        h(
          'div',
          { className: 'mch-field' },
          h('div', { className: 'mch-inline' }, h('span', { className: 'mch-label' }, t('f.names')), h(Switch, { checked: draft.namesOnly, label: t('f.names'), disabled, onChange: set('namesOnly') })),
          h('p', { className: 'mch-hint' }, t('f.names.hint')),
        ),
        stdio
          ? h(
              'div',
              { className: 'mch-field', 'data-wide': true },
              h('div', { className: 'mch-inline' }, h('span', { className: 'mch-label' }, t('f.direct')), h(Switch, { checked: draft.direct, label: t('f.direct'), disabled, onChange: set('direct') })),
              h('p', { className: 'mch-hint' }, t('f.direct.hint')),
            )
          : null,
        h(
          Field,
          { label: t('f.instructions'), hint: t('f.instructions.hint'), wide: true },
          h(Segmented, {
            id: `${idp}-instructions`,
            label: t('f.instructions'),
            value: draft.instructions,
            disabled,
            onChange: set('instructions'),
            options: ['auto', 'full', 'off'].map((v) => ({ value: v, label: t(`f.instructions.${v}`) })),
          }),
        ),
        h(
          'div',
          { className: 'mch-form-foot' },
          phase === 'failed' ? h('p', { className: 'mch-note', 'data-tone': 'error', role: 'status' }, t('saveFailed')) : h('span', { className: 'mch-grow' }),
          h(Button, { tone: 'quiet', onClick: onCancel, disabled: phase === 'saving' }, t('cancel')),
          h(
            Button,
            {
              tone: 'primary',
              disabled: disabled || invalid || phase === 'saving',
              onClick: async () => {
                setPhase('saving')
                const ok = await onSave(serverFromDraft(draft, server))
                setPhase(ok ? 'idle' : 'failed')
              },
            },
            phase === 'saving' ? t('saving') : t('save'),
          ),
        ),
      )
    }

    // ── server card ─────────────────────────────────────────────────────
    function dotState(view, enabled) {
      if (!enabled || !view) return 'idle'
      switch (view.status) {
        case 'running':
          return 'done'
        case 'starting':
          return 'busy'
        case 'auth':
          return 'warning'
        case 'error':
          return 'error'
        default:
          return 'idle'
      }
    }

    function Chevron({ open }) {
      return h(
        'svg',
        { className: 'mch-chevron', 'data-open': open, width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
        h('path', { d: 'M4.5 2.5 8 6l-3.5 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** One short line for the collapsed card. */
    function metaOf(t, status, view) {
      switch (status) {
        case 'running':
          return { text: [t('line.tools', { count: view?.tools.length ?? 0 }), view?.exposed === false ? t('hidden.tag') : view?.effectiveMode === 'lazy' ? t('line.catalog', { tokens: compact(view.catalogTokens) }) : t('line.tokens', { tokens: compact(view?.tokens ?? 0) })].join(' · ') }
        case 'error':
          return { text: view?.error ? `${t('status.error')}: ${view.error}` : t('status.error'), tone: 'error' }
        case 'auth':
          return { text: t('status.auth'), tone: 'warn' }
        default:
          return { text: t(`status.${status}`) }
      }
    }

    function ServerCard({ t, server, view, others, disabled, onUpdate, onRemove, act, contributed }) {
      const [open, setOpen] = React.useState(false)
      const [editing, setEditing] = React.useState(false)
      const [showTools, setShowTools] = React.useState(false)
      const [confirming, setConfirming] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const [signin, setSignin] = React.useState(null)
      const [actionError, setActionError] = React.useState(null)
      React.useEffect(() => {
        if (!confirming) return undefined
        const timer = setTimeout(() => setConfirming(false), 4000)
        return () => clearTimeout(timer)
      }, [confirming])
      React.useEffect(() => {
        if (view?.status === 'running') setSignin(null)
      }, [view?.status])

      const enabled = server.enabled !== false
      const run = async (action) => {
        setBusy(action)
        setActionError(null)
        try {
          const result = await act(server.name, action)
          if (!result?.ok) setActionError(result?.message ?? 'failed')
          else if (action === 'signin' && result.url) {
            setSignin(result.url)
            setOpen(true)
          }
        } catch (error) {
          setActionError(String(error?.message ?? error))
        } finally {
          setBusy(null)
        }
      }

      const status = enabled ? (view?.status ?? 'stopped') : 'disabled'
      const oauth = server.transport === 'http'
      const needsSignIn = enabled && oauth && (status === 'auth' || (view?.oauth && !view.oauth.signedIn))
      const meta = metaOf(t, status, view)
      const facts = []
      if (view) {
        facts.push(t('line.tools', { count: view.tools.length }))
        facts.push(t('line.tokens', { tokens: compact(view.tokens) }))
        if (view.exposed !== false && view.effectiveMode === 'lazy') facts.push(t('line.catalog', { tokens: compact(view.catalogTokens) }))
        if (view.oauth?.signedIn) facts.push(view.oauth.imported ? t('line.imported') : t('line.signedIn'))
        if (view.fromCache && status !== 'running') facts.push(t('line.cached'))
        if (view.launch?.npx) facts.push(view.launch.direct ? t('line.direct', { version: view.launch.version ?? '?' }) : t('line.npx'))
        if (view.update?.checking) facts.push(t('line.checking'))
        else if (view.update?.updated) facts.push(t('line.updated', { from: view.update.from ?? '?', to: view.update.to ?? '?' }))
      }
      const target = server.transport === 'http' ? server.url : [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')
      const bodyId = `mch-body-${server.name}`

      return h(
        'li',
        { className: 'mch-card', 'data-disabled': !enabled, 'data-open': open, 'data-server': server.name },
        h(
          'div',
          { className: 'mch-row' },
          h(
            'button',
            { type: 'button', className: 'mch-toggle', 'aria-expanded': open, 'aria-controls': bodyId, onClick: () => setOpen((v) => !v) },
            h(Chevron, { open }),
            h(Dot, { state: dotState(view, enabled) }),
            h('span', { className: 'mch-name', title: server.name }, server.name),
          ),
          h(Tag, { tone: 'outline' }, server.transport === 'http' ? 'HTTP' : 'stdio'),
          enabled && view && view.exposed !== false && !contributed
            ? h(Tag, { tone: view.effectiveMode === 'eager' ? 'neutral' : 'info', title: server.mode === 'auto' ? t('mode.auto.title') : undefined }, `${server.mode === 'auto' ? `${t('mode.auto')} → ` : ''}${t(`effective.${view.effectiveMode}`)}`)
            : null,
          h('span', { className: 'mch-meta', 'data-tone': meta.tone, title: meta.text }, meta.text),
          needsSignIn ? h(Button, { tone: 'primary', disabled: busy !== null, onClick: () => run('signin') }, busy === 'signin' ? '…' : t('action.signin')) : null,
          contributed
            ? null
            : h(Segmented, {
                id: `mch-mode-${server.name}`,
                label: t('mode.label'),
                value: server.mode ?? 'auto',
                disabled: disabled || !enabled,
                onChange: (mode) => onUpdate({ ...server, mode }),
                options: ['auto', 'eager', 'lazy'].map((v) => ({ value: v, label: t(`mode.${v}`), title: t(`mode.${v}.title`) })),
              }),
          contributed ? null : h(Switch, { checked: enabled, label: t('enabled.label'), disabled, onChange: (on) => onUpdate({ ...server, enabled: on }) }),
        ),
        open
          ? h(
              'div',
              { className: 'mch-body', id: bodyId },
              view?.summary ? h('p', { className: 'mch-sub' }, view.summary) : null,
              target ? h('p', { className: 'mch-target', title: target }, target) : null,
              h('p', { className: 'mch-line', 'data-tone': meta.tone, role: 'status' }, [t(`status.${status}`), ...(status === 'error' && view?.error ? [view.error] : []), ...facts].join(' · ')),
              status === 'error' && view?.stderr ? h('pre', { className: 'mch-pre' }, view.stderr) : null,
              signin
                ? h(
                    'p',
                    { className: 'mch-line', 'data-tone': 'warn' },
                    t('signin.waiting', { link: '\u0000' }).split('\u0000')[0],
                    h('button', { type: 'button', className: 'mch-link', onClick: () => window.open(signin, '_blank', 'noopener') }, t('action.openLink')),
                    t('signin.waiting', { link: '\u0000' }).split('\u0000')[1] ?? '',
                  )
                : null,
              actionError ? h('p', { className: 'mch-line', 'data-tone': 'error', role: 'alert' }, actionError) : null,
              editing
                ? h(ServerForm, {
                    t,
                    server,
                    others,
                    disabled,
                    onCancel: () => setEditing(false),
                    onSave: async (next) => {
                      const ok = await onUpdate(next)
                      if (ok) setEditing(false)
                      return ok
                    },
                  })
                : h(
                    'div',
                    { className: 'mch-actions' },
                    enabled ? h(Button, { disabled: busy !== null, onClick: () => run('restart') }, busy === 'restart' ? '…' : view?.running ? t('action.restart') : t('action.start')) : null,
                    enabled && view?.running ? h(Button, { disabled: busy !== null, onClick: () => run('stop') }, t('action.stop')) : null,
                    enabled ? h(Button, { disabled: busy !== null, onClick: () => run('refresh') }, busy === 'refresh' ? '…' : t('action.refresh')) : null,
                    enabled && view?.launch?.direct
                      ? h(Button, { disabled: busy !== null || view.update?.checking, onClick: () => run('update') }, busy === 'update' || view.update?.checking ? t('line.checking') : t('action.update'))
                      : null,
                    h(Button, { tone: 'quiet', onClick: () => setShowTools((v) => !v), disabled: !view || view.tools.length === 0 }, showTools ? t('action.hideTools') : t('action.tools')),
                    h('span', { className: 'mch-grow' }),
                    oauth && view?.oauth?.signedIn ? h(Button, { tone: 'quiet', disabled: busy !== null, onClick: () => run('signout') }, t('action.signout')) : null,
                    contributed ? null : h(Button, { tone: 'quiet', onClick: () => setEditing(true), disabled }, t('action.edit')),
                    contributed ? null : h(Button, { tone: 'danger', disabled, onClick: () => (confirming ? onRemove(server) : setConfirming(true)) }, confirming ? t('action.confirmRemove') : t('action.remove')),
                  ),
              showTools && view && !editing
                ? h(
                    'ul',
                    { className: 'mch-tools' },
                    view.tools.map((tool) =>
                      h(
                        'li',
                        { key: tool.name, className: 'mch-tool' },
                        h('span', { className: 'mch-tool-name', title: tool.name }, tool.name),
                        h('span', { className: 'mch-tool-sum', title: tool.summary }, tool.summary),
                        h('span', { className: 'mch-tool-tok' }, `~${compact(tool.tokens)}`),
                      ),
                    ),
                  )
                : null,
            )
          : null,
      )
    }

    // ── hub settings ────────────────────────────────────────────────────
    const HUB_FIELDS = [
      { key: 'autoEagerMaxTokens', label: 'hub.threshold', hint: 'hub.threshold.hint', min: 0, max: 1000000, scale: 1 },
      { key: 'catalogLineChars', label: 'hub.lineChars', min: 40, max: 1000, scale: 1 },
      { key: 'startupTimeoutMs', label: 'hub.startup', hint: 'hub.startup.hint', min: 1, max: 600, scale: 1000 },
    ]

    function HubSettings({ t, value, disabled, onSave }) {
      const initial = () => Object.fromEntries(HUB_FIELDS.map((f) => [f.key, String(Math.round((value?.[f.key] ?? 0) / f.scale))]))
      const [draft, setDraft] = React.useState(initial)
      const [phase, setPhase] = React.useState('idle')
      const signature = JSON.stringify(HUB_FIELDS.map((f) => value?.[f.key]))
      React.useEffect(() => setDraft(initial()), [signature])
      const errors = {}
      for (const f of HUB_FIELDS) {
        const n = Number(draft[f.key])
        if (draft[f.key] === '' || !Number.isFinite(n) || n < f.min || n > f.max) errors[f.key] = t('invalidNumber', { min: f.min, max: f.max })
      }
      const dirty = HUB_FIELDS.some((f) => String(Math.round((value?.[f.key] ?? 0) / f.scale)) !== draft[f.key])
      return h(
        'div',
        { className: 'mch-form', style: { borderTop: 0, paddingTop: 0 } },
        HUB_FIELDS.map((f) =>
          h(
            Field,
            { key: f.key, id: `mch-hub-${f.key}`, label: t(f.label), hint: f.hint ? t(f.hint) : undefined, error: errors[f.key] },
            h(TextInput, {
              id: `mch-hub-${f.key}`,
              className: 'mch-input',
              type: 'text',
              inputMode: 'numeric',
              value: draft[f.key],
              disabled,
              ...(errors[f.key] ? { 'aria-invalid': true } : {}),
              onChange: (e) => setDraft((d) => ({ ...d, [f.key]: e.target.value })),
            }),
          ),
        ),
        h(
          'div',
          { className: 'mch-form-foot' },
          phase === 'failed' ? h('p', { className: 'mch-note', 'data-tone': 'error' }, t('saveFailed')) : h('span', { className: 'mch-grow' }),
          h(Button, { tone: 'quiet', disabled: !dirty || phase === 'saving', onClick: () => setDraft(initial()) }, t('cancel')),
          h(
            Button,
            {
              tone: 'primary',
              disabled: disabled || !dirty || Object.keys(errors).length > 0 || phase === 'saving',
              onClick: async () => {
                setPhase('saving')
                const ops = HUB_FIELDS.map((f) => ({ op: 'set', path: [f.key], value: Number(draft[f.key]) * f.scale }))
                setPhase((await onSave(ops)) ? 'idle' : 'failed')
              },
            },
            phase === 'saving' ? t('saving') : t('save'),
          ),
        ),
      )
    }

    // ── page ────────────────────────────────────────────────────────────
    function Section({ id, title, desc, action, children }) {
      return h(
        'section',
        { className: 'mch-section', 'aria-labelledby': id },
        h(
          'div',
          { className: 'mch-section-head' },
          h('div', { className: 'mch-section-titles' }, h('h3', { className: 'mch-section-title', id }, title), desc ? h('p', { className: 'mch-section-desc' }, desc) : null),
          action ?? null,
        ),
        children,
      )
    }

    function HubPage({ view, t, form }) {
      const snap = React.useSyncExternalStore(form.subscribe, form.getSnapshot)
      const { status, reload } = useStatus()
      const [adding, setAdding] = React.useState(false)
      if (view === 'summary') return t('summary')
      if (snap.status === 'loading') return h('p', { className: 'mch-note', role: 'status' }, t('loading'))
      if (snap.status !== 'ready') return h('p', { className: 'mch-note', role: 'status' }, t('unavailable'))

      const disabled = !snap.writable
      const configured = Array.isArray(snap.value?.servers) ? snap.value.servers : []
      const all = status?.servers ?? []
      const views = new Map(all.filter((s) => s.owner === undefined).map((s) => [s.name, s]))
      const contributors = status?.contributors ?? []
      const writeServers = async (next) => {
        const ok = await form.mutate([{ op: 'set', path: ['servers'], value: next }], form.getSnapshot().revision)
        setTimeout(reload, 400)
        return ok
      }
      const act = async (server, action) => {
        const result = await request(ACTION_ROUTE, { server, action })
        reload()
        return result
      }
      const running = all.filter((s) => s.running).length
      const stats = [
        t('stats.servers', { n: all.length }),
        t('stats.running', { n: running }),
        t('stats.eager', { tokens: compact(status?.eagerTokens ?? 0) }),
        t('stats.lazy', { tokens: compact(status?.lazyTokens ?? 0) }),
      ].join(' · ')

      return h(
        'div',
        { className: 'mch-page', 'data-mcp-hub-settings': true },
        disabled ? h('p', { className: 'mch-note', role: 'status' }, snap.mode === 'memory' ? t('memory') : t('readOnly')) : null,
        status?.missing?.length ? h('p', { className: 'mch-note', 'data-tone': 'error' }, t('hostMissing', { what: status.missing.join(', ') })) : null,
        status ? h('p', { className: 'mch-stats', role: 'status' }, stats) : null,
        h(
          Section,
          {
            id: 'mch-servers',
            title: t('servers.title'),
            desc: t('servers.desc'),
            action: h(Button, { tone: adding ? 'quiet' : undefined, disabled, onClick: () => setAdding((v) => !v) }, adding ? t('cancel') : t('add')),
          },
          adding
            ? h(
                'div',
                { className: 'mch-card' },
                h(ServerForm, {
                  t,
                  others: all,
                  disabled,
                  onCancel: () => setAdding(false),
                  onSave: async (server) => {
                    const ok = await writeServers([...configured, server])
                    if (ok) setAdding(false)
                    return ok
                  },
                }),
              )
            : null,
          configured.length === 0 && !adding ? h('p', { className: 'mch-note' }, t('servers.empty')) : null,
          h(
            'ul',
            { className: 'mch-list' },
            configured.map((server) =>
              h(ServerCard, {
                key: server.name,
                t,
                server,
                view: views.get(server.name),
                others: all.filter((s) => s.name !== server.name),
                disabled,
                act,
                onUpdate: (next) => writeServers(configured.map((s) => (s.name === server.name ? next : s))),
                onRemove: (gone) => writeServers(configured.filter((s) => s.name !== gone.name)),
              }),
            ),
          ),
        ),
        contributors.map((c) =>
          h(
            Section,
            { key: c.id, id: `mch-from-${c.id}`, title: c.title, desc: c.description || t('contrib.desc', { title: c.title }) },
            c.problems.map((p) => h('p', { key: p.name, className: 'mch-note', 'data-tone': 'warn' }, t('contrib.problem', { name: p.name, reason: p.reason }))),
            h(
              'ul',
              { className: 'mch-list' },
              all
                .filter((s) => s.owner === c.id)
                .map((s) =>
                  h(ServerCard, {
                    key: s.name,
                    t,
                    server: { name: s.name, transport: s.transport, mode: s.mode, enabled: s.enabled, url: s.url },
                    view: s,
                    contributed: true,
                    disabled,
                    act,
                  }),
                ),
            ),
          ),
        ),
        h(
          'details',
          { className: 'mch-details' },
          h('summary', { className: 'mch-details-summary' }, h('span', { className: 'mch-section-title' }, t('hub.title')), h('span', { className: 'mch-section-desc' }, t('hub.desc'))),
          h(HubSettings, { t, value: snap.value, disabled, onSave: (ops) => form.mutate(ops, form.getSnapshot().revision) }),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ensureStyle(), 'mcp-hub: style')
        ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), 'mcp-hub: dictionaries')
        ctx.inject(['configForms'], (scope) => {
          if (scope.configForms === undefined) return
          // The shared form is a class instance; hand React bound functions.
          const shared = scope.configForms.get(ENTRY_ID)
          const form = {
            getSnapshot: () => shared.getSnapshot(),
            subscribe: (listener) => shared.subscribe(listener),
            mutate: (ops, revision) => shared.mutate(ops, revision),
          }
          scope.slots.inject('plugins.bundle.config', () =>
            scope.slots.register({ name: 'plugins.bundle.config', key: BUNDLE, locale: NS, inject: () => ({ form }) }, HubPage),
          )
        })
      },
    }
  },
})
