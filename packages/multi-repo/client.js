window.__ModuleLoader__.load({
  id: '@opfield/dsh-multi-repo',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'multi-repo'
    /** Browser-relative Host routes (same convention as other plugin routes). */
    const STATE_ROUTE = 'multi-repo/state'
    const ROOTS_ROUTE = 'multi-repo/roots'
    const PLUGIN_ID = '@opfield/dsh-multi-repo'
    const CSS_ID = `${PLUGIN_ID}/style`
    const MAX_SUGGESTIONS = 6

    // Trigger and panel follow the host context meter / composer pill look.
    const CSS = [
      '.mrr-root{flex:none;display:inline-flex}',
      '.mrr-trigger{border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);font-family:inherit;',
      'font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));',
      'white-space:nowrap;cursor:pointer;background:0 0;border:none;flex:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}',
      '.mrr-trigger:hover,.mrr-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.mrr-trigger svg{flex:none}',
      '.mrr-trigger[data-variant=header]{max-width:320px;padding:2px 8px}',
      '.mrr-trigger-text{min-width:0;overflow:hidden;text-overflow:ellipsis}',
      // Sidebar hover-card line: same look as the card's path/time lines.
      '.mrr-hover{color:#cfd3d6;font-size:12px;line-height:16px;display:flex;align-items:flex-start;gap:6px;overflow-wrap:anywhere}',
      '.mrr-hover svg{flex:none;margin-top:1px}',
      '.mrr-panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);',
      'width:min(420px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);',
      'box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:12px;',
      'font-size:12px;line-height:18px;position:fixed;display:flex;flex-direction:column;gap:10px}',
      '.mrr-head{display:flex;flex-direction:column;gap:2px}',
      '.mrr-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}',
      '.mrr-sub{color:var(--dsw-alias-label-tertiary)}',
      '.mrr-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}',
      '.mrr-row{display:flex;align-items:center;gap:8px;border-radius:var(--dsw-radius-sm);padding:4px 4px 4px 6px}',
      '.mrr-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.mrr-main{min-width:0;flex:1;display:flex;flex-direction:column}',
      '.mrr-name{color:var(--dsw-alias-label-primary);font-weight:500;display:flex;gap:6px;align-items:baseline;min-width:0}',
      '.mrr-tag{color:var(--dsw-alias-label-caption);font-weight:400;font-size:11px}',
      '.mrr-path{color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}',
      '.mrr-meta{flex:none;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.mrr-meta[data-dirty]{color:var(--dsw-alias-state-warn-primary)}',
      '.mrr-meta[data-missing]{color:var(--dsw-alias-state-error-primary)}',
      '.mrr-icon-btn{corner-shape:round;width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;',
      'justify-content:center;align-items:center;padding:0;display:inline-flex;flex:none}',
      '.mrr-icon-btn:hover{background:var(--dsw-alias-interactive-bg-pressed,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-secondary)}',
      '.mrr-icon-btn:disabled{opacity:.4;cursor:default}',
      '.mrr-form{display:flex;gap:6px}',
      '.mrr-input{flex:1;min-width:0;font:inherit;font-size:12px;line-height:20px;padding:3px 8px;border-radius:var(--dsw-radius-sm);',
      'border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));background:var(--dsw-alias-bg-l1,transparent);color:var(--dsw-alias-label-primary);outline:none}',
      '.mrr-input:focus{border-color:var(--dsw-alias-accent-primary,var(--dsw-alias-border-l3))}',
      '.mrr-btn{font:inherit;font-size:12px;line-height:20px;border:none;cursor:pointer;border-radius:var(--dsw-radius-sm);padding:3px 12px;',
      'background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);flex:none}',
      '.mrr-btn:hover{background:var(--dsw-alias-interactive-bg-pressed,var(--dsw-alias-interactive-bg-hover))}',
      '.mrr-btn:disabled{opacity:.5;cursor:default}',
      '.mrr-suggest{display:flex;flex-direction:column;gap:1px;margin:0;padding:0;list-style:none}',
      '.mrr-suggest button{width:100%;font:inherit;font-size:12px;text-align:left;background:0 0;border:none;cursor:pointer;',
      'border-radius:var(--dsw-radius-sm);padding:3px 6px;color:var(--dsw-alias-label-secondary);display:flex;gap:8px;align-items:baseline}',
      '.mrr-suggest button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.mrr-suggest span:last-child{color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.mrr-label{color:var(--dsw-alias-label-caption);font-size:11px;text-transform:uppercase;letter-spacing:.04em}',
      '.mrr-error{color:var(--dsw-alias-state-error-primary)}',
      '.mrr-note{color:var(--dsw-alias-state-warn-primary)}',
      // Hover bubble copied from the host Tooltip primitive (side=top).
      '.mrr-tip{display:inline-flex}',
      '.mrr-bubble{position:fixed;z-index:1100;width:max-content;max-width:min(50vw,360px);padding:3px 7px;',
      'border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);',
      'font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:none;',
      'transform:translate(-50%,-100%)}',
      '.mrr-bubble[data-side=bottom]{transform:translateX(-50%)}',
    ].join('')

    const en = {
      'trigger.count': '{count} roots',
      'hover.roots': 'Roots: {names}',
      'trigger.tip': 'Workspace roots: {names}',
      'trigger.tipEmpty': 'Attach other repositories to this workspace',
      'panel.title': 'Workspace roots',
      'panel.sub': 'Shared by every session in this workspace. The agent sees all roots and can work in each of them.',
      'row.primary': 'primary',
      'row.clean': 'clean',
      'row.changes': '{count} changed',
      'row.missing': 'missing',
      'row.notGit': 'not git',
      'row.remove': 'Detach {name}',
      'add.placeholder': 'Folder path, e.g. ~/projects/api',
      'add.action': 'Attach',
      'add.busy': 'Attaching…',
      'add.suggestions': 'Repositories nearby',
      'note.readonly': 'The sandbox extension is off: under workspace-write the agent cannot write to attached roots.',
      'note.shellReadonly': 'This sandbox runner is not extended: under workspace-write, shell commands cannot write to attached roots; file tools can.',
      'error.load': 'Cannot load workspace roots: {message}',
    }

    function interpolate(text, vars) {
      return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k]))) : text
    }
    /** Host `t` when it resolves the key, the bundled English otherwise. */
    function translator(t) {
      return (key, vars) => {
        let value
        try {
          value = typeof t === 'function' ? t(key, vars) : undefined
        } catch {
          value = undefined
        }
        return typeof value === 'string' && value !== '' && value !== key ? value : interpolate(en[key] ?? key, vars)
      }
    }

    async function request(url, init) {
      const response = await fetch(url, { cache: 'no-store', ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } })
      if (!response.ok && response.headers.get('content-type')?.includes('application/json') !== true) {
        return { ok: false, code: 'http', message: `HTTP ${response.status}` }
      }
      return response.json()
    }

    // ── shared bits (same patterns as the host composer pills) ───────────
    function FolderIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' },
        h('path', { d: 'M1.8 4.2c0-.6.5-1.1 1.1-1.1h3l1.5 1.6h5.7c.6 0 1.1.5 1.1 1.1v6.3c0 .6-.5 1.1-1.1 1.1H2.9c-.6 0-1.1-.5-1.1-1.1z' }),
        h('path', { d: 'M5 8.6h6M8 6v5.2', strokeLinecap: 'round' }),
      )
    }
    function CloseIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' },
        h('path', { d: 'M4 4l8 8M12 4l-8 8' }),
      )
    }

    const TIP_DELAY_MS = 200
    const TIP_GAP = 8
    const EDGE = 12

    function Tip({ label, disabled = false, children }) {
      const anchorRef = React.useRef(null)
      const bubbleRef = React.useRef(null)
      const timer = React.useRef(null)
      const [rect, setRect] = React.useState(null)
      const cancel = () => {
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = null
      }
      const show = () => {
        cancel()
        timer.current = setTimeout(() => {
          timer.current = null
          const r = anchorRef.current?.getBoundingClientRect()
          if (r) setRect({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
        }, TIP_DELAY_MS)
      }
      const hide = () => {
        cancel()
        setRect(null)
      }
      React.useEffect(() => cancel, [])
      React.useEffect(() => {
        if (disabled) hide()
      }, [disabled])
      React.useLayoutEffect(() => {
        const el = bubbleRef.current
        if (rect === null || el === null) return
        const w = el.offsetWidth
        const ht = el.offsetHeight
        const x = Math.min(Math.max(rect.x, EDGE + w / 2), window.innerWidth - EDGE - w / 2)
        const below = rect.top - TIP_GAP - ht < EDGE
        el.style.left = `${x}px`
        el.style.top = `${below ? rect.bottom + TIP_GAP : rect.top - TIP_GAP}px`
        el.dataset.side = below ? 'bottom' : 'top'
        el.style.visibility = 'visible'
      }, [rect, label])
      const visible = rect !== null && !disabled && Boolean(label)
      return h(
        'span',
        { ref: anchorRef, className: 'mrr-tip', onPointerEnter: show, onPointerLeave: hide, onFocus: show, onBlur: hide },
        children,
        visible
          ? ReactDOM.createPortal(
              h('div', { ref: bubbleRef, className: 'mrr-bubble', role: 'tooltip', 'data-side': 'top', style: { visibility: 'hidden', left: rect.x, top: rect.top - TIP_GAP } }, label),
              document.body,
            )
          : null,
      )
    }

    function useAnchored(open, anchorRef, panelRef, deps) {
      const [pos, setPos] = React.useState(null)
      React.useLayoutEffect(() => {
        if (!open) {
          setPos(null)
          return undefined
        }
        const place = () => {
          const a = anchorRef.current
          const p = panelRef.current
          if (!a || !p) return
          const r = a.getBoundingClientRect()
          const margin = 12
          const left = Math.min(Math.max(margin, r.left + r.width / 2 - p.offsetWidth / 2), window.innerWidth - p.offsetWidth - margin)
          let top = r.top - 8 - p.offsetHeight
          if (top < margin) top = r.bottom + 8
          setPos({ left, top })
        }
        place()
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return () => {
          window.removeEventListener('resize', place)
          window.removeEventListener('scroll', place, true)
        }
      }, [open, ...deps])
      return pos
    }

    function useDismiss(open, setOpen, rootRef, panelRef) {
      React.useEffect(() => {
        if (!open) return undefined
        const onDown = (e) => {
          if (rootRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
          setOpen(false)
        }
        const onKey = (e) => {
          if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])
    }

    function homeShort(path) {
      return path.replace(/^\/home\/[^/]+(?=\/|$)/, '~').replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
    }

    // ── panel ────────────────────────────────────────────────────────────
    function RootRow({ root, tr, busy, onRemove }) {
      let meta
      if (!root.exists) meta = h('span', { className: 'mrr-meta', 'data-missing': true }, tr('row.missing'))
      else if (!root.git) meta = h('span', { className: 'mrr-meta' }, tr('row.notGit'))
      else {
        const changes = root.changes > 0 ? tr('row.changes', { count: root.changes }) : tr('row.clean')
        meta = h('span', { className: 'mrr-meta', 'data-dirty': root.changes > 0 ? true : undefined }, `${root.branch ?? '?'} · ${changes}`)
      }
      return h(
        'li',
        { className: 'mrr-row' },
        h(
          'div',
          { className: 'mrr-main' },
          h('span', { className: 'mrr-name' }, root.name, root.primary ? h('span', { className: 'mrr-tag' }, tr('row.primary')) : null),
          h('span', { className: 'mrr-path', title: root.path }, h('bdi', null, homeShort(root.path))),
        ),
        meta,
        root.primary
          ? h('span', { style: { width: 24, flex: 'none' } })
          : h(
              Tip,
              { label: tr('row.remove', { name: root.name }) },
              h('button', { type: 'button', className: 'mrr-icon-btn', 'aria-label': tr('row.remove', { name: root.name }), disabled: busy, onClick: () => onRemove(root) }, h(CloseIcon)),
            ),
      )
    }

    function RootsPanel({ state, tr, panelRef, pos, busy, error, onAdd, onRemove }) {
      const [value, setValue] = React.useState('')
      const inputRef = React.useRef(null)
      React.useEffect(() => {
        inputRef.current?.focus()
      }, [])
      const needle = value.trim().toLowerCase()
      const suggestions = (state.suggestions ?? [])
        .filter((path) => needle === '' || path.toLowerCase().includes(needle.replace(/^~/, '')))
        .slice(0, MAX_SUGGESTIONS)
      const submit = async (path) => {
        if (path.trim() === '' || busy) return
        if (await onAdd(path.trim())) setValue('')
      }
      return h(
        'div',
        { ref: panelRef, className: 'mrr-panel', role: 'dialog', 'aria-label': tr('panel.title'), style: pos ?? { visibility: 'hidden', left: 0, top: 0 } },
        h('div', { className: 'mrr-head' }, h('span', { className: 'mrr-title' }, tr('panel.title')), h('span', { className: 'mrr-sub' }, tr('panel.sub'))),
        h('ul', { className: 'mrr-list' }, state.roots.map((root) => h(RootRow, { key: root.path, root, tr, busy, onRemove }))),
        h(
          'form',
          {
            className: 'mrr-form',
            onSubmit: (e) => {
              e.preventDefault()
              submit(value)
            },
          },
          h('input', {
            ref: inputRef,
            className: 'mrr-input',
            value,
            placeholder: tr('add.placeholder'),
            spellCheck: false,
            autoComplete: 'off',
            onChange: (e) => setValue(e.target.value),
          }),
          h('button', { type: 'submit', className: 'mrr-btn', disabled: busy || value.trim() === '' }, busy ? tr('add.busy') : tr('add.action')),
        ),
        error ? h('div', { className: 'mrr-error', role: 'alert' }, error) : null,
        suggestions.length > 0
          ? h(
              'div',
              null,
              h('div', { className: 'mrr-label' }, tr('add.suggestions')),
              h(
                'ul',
                { className: 'mrr-suggest' },
                suggestions.map((path) =>
                  h(
                    'li',
                    { key: path },
                    h('button', { type: 'button', disabled: busy, onClick: () => submit(path) }, h('span', null, path.split('/').pop()), h('span', null, homeShort(path))),
                  ),
                ),
              ),
            )
          : null,
        state.writable === false
          ? h('div', { className: 'mrr-note' }, tr('note.readonly'))
          : state.shellWritable === false
            ? h('div', { className: 'mrr-note' }, tr('note.shellReadonly'))
            : null,
      )
    }

    // ── shared state: one cache per Session, refreshed after any mutation ──
    const cache = new Map() // `${sessionId}|${lite}` -> state
    const inflight = new Map() // `${sessionId}|${lite}` -> { generation, run }: one fetch per key however many views mount
    /** Bumped by every mutation; answers to older requests are dropped. */
    let generation = 0
    const listeners = new Set()
    const notify = () => listeners.forEach((fn) => fn())
    function publish(sessionId, lite, state) {
      cache.set(`${sessionId}|${lite}`, state)
      notify()
    }
    /** Drop every cached state so all mounted views reload (roots are shared per workspace). */
    function invalidateAll() {
      generation += 1
      cache.clear()
      notify()
    }

    function useRootsState(sessionId, lite) {
      const key = `${sessionId}|${lite}`
      const [, bump] = React.useState(0)
      const load = React.useCallback(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return Promise.resolve()
        const pending = inflight.get(key)
        if (pending !== undefined && pending.generation === generation) return pending.run
        const started = generation
        const run = (async () => {
          let next
          try {
            next = await request(`${STATE_ROUTE}?session=${encodeURIComponent(sessionId)}${lite ? '&lite=1' : ''}`)
          } catch (e) {
            next = { ok: false, code: 'network', message: String(e?.message ?? e) }
          } finally {
            if (inflight.get(key)?.run === run) inflight.delete(key)
          }
          // A mutation since the request started makes this answer stale: drop it.
          if (started === generation) publish(sessionId, lite, next)
        })()
        inflight.set(key, { generation: started, run })
        return run
      }, [key])
      React.useEffect(() => {
        const onChange = () => {
          if (!cache.has(key)) load()
          bump((n) => n + 1)
        }
        listeners.add(onChange)
        if (!cache.has(key)) load()
        const onVisible = () => {
          if (document.visibilityState === 'visible' && !lite) load()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          listeners.delete(onChange)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [key, load])
      return { state: cache.get(key) ?? null, load }
    }

    /**
     * Roots button plus its panel. `composer` always renders (it is where roots
     * are attached); `header` renders only when the workspace has extra roots
     * and names them, so a multi-root session is recognizable at a glance.
     */
    function makeRootsButton(variant) {
      return React.memo(function RootsButton({ sessionId, t }) {
        const tr = React.useMemo(() => translator(t), [t])
        const { state, load } = useRootsState(sessionId, false)
        const [open, setOpen] = React.useState(false)
        const [busy, setBusy] = React.useState(false)
        const [error, setError] = React.useState(null)
        const rootRef = React.useRef(null)
        const panelRef = React.useRef(null)

        React.useEffect(() => {
          if (open) load()
          else setError(null)
        }, [open])

        const mutate = async (body) => {
          setBusy(true)
          setError(null)
          try {
            const next = await request(ROOTS_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: sessionId, ...body }) })
            invalidateAll()
            if (Array.isArray(next.roots)) publish(sessionId, false, { ...next, ok: true })
            if (next.ok === false) {
              setError(next.message ?? next.code ?? 'error')
              return false
            }
            return true
          } catch (e) {
            setError(String(e?.message ?? e))
            return false
          } finally {
            setBusy(false)
          }
        }

        const roots = state?.ok === true && Array.isArray(state.roots) ? state.roots : null
        const pos = useAnchored(open && roots !== null, rootRef, panelRef, [roots?.length ?? 0, error])
        useDismiss(open, setOpen, rootRef, panelRef)
        if (roots === null) return null
        const extras = roots.filter((root) => !root.primary)
        if (variant === 'header' && extras.length === 0) return null

        const label = extras.length > 0 ? tr('trigger.tip', { names: roots.map((root) => root.name).join(', ') }) : tr('trigger.tipEmpty')
        const text = variant === 'header' ? roots.map((root) => root.name).join(' + ') : extras.length > 0 ? tr('trigger.count', { count: roots.length }) : null
        return h(
          'span',
          { ref: rootRef, className: 'mrr-root', 'data-multi-repo': variant },
          h(
            Tip,
            { label, disabled: open },
            h(
              'button',
              { type: 'button', className: 'mrr-trigger', 'data-variant': variant, 'aria-label': label, 'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: () => setOpen(!open) },
              h(FolderIcon),
              text !== null ? h('span', { className: 'mrr-trigger-text' }, text) : null,
            ),
          ),
          open
            ? ReactDOM.createPortal(
                h(RootsPanel, {
                  state,
                  tr,
                  panelRef,
                  pos,
                  busy,
                  error,
                  onAdd: (path) => mutate({ action: 'add', path }),
                  onRemove: (root) => mutate({ action: 'remove', name: root.name }),
                }),
                document.body,
              )
            : null,
        )
      })
    }

    /** Line in the sidebar Session hover card: which roots that Session's workspace has. */
    const SessionHoverRoots = React.memo(function SessionHoverRoots({ sessionId, t }) {
      const tr = React.useMemo(() => translator(t), [t])
      const { state } = useRootsState(sessionId, true)
      const roots = state?.ok === true && Array.isArray(state.roots) ? state.roots : []
      if (!roots.some((root) => !root.primary)) return null
      return h(
        'div',
        { className: 'mrr-hover', 'data-multi-repo': 'hover' },
        h(FolderIcon),
        h('span', null, tr('hover.roots', { names: roots.map((root) => root.name).join(' + ') })),
      )
    })

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en }), 'multi-repo: dictionaries')
        ctx.effect(() => {
          document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)?.remove()
          const tag = document.createElement('style')
          tag.dataset.plugin = PLUGIN_ID
          tag.dataset.pluginCss = CSS_ID
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'multi-repo: styles')
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'multi-repo-roots', order: 3, locale: NS }, makeRootsButton('composer')),
        )
        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register({ name: 'conversation.session.header.actions', id: 'multi-repo-roots', order: 50, locale: NS }, makeRootsButton('header')),
        )
        ctx.slots.inject('sidebar.session.row.hover', () =>
          ctx.slots.register({ name: 'sidebar.session.row.hover', id: 'multi-repo-roots', order: 10, locale: NS }, SessionHoverRoots),
        )
      },
    }
  },
})
