window.__ModuleLoader__.load({
  id: '@opfield/dsh-opfield',
  factory(require) {
    const React = require('react')
    /** DSH controls; the same module the Plugins page uses. Absent in tests and very old builds. */
    let UI = null
    try {
      UI = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      UI = null
    }
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'opfield-usage'
    /** Browser-relative form of the Host route (same convention as open-in-app). */
    const ROUTE = 'opfield-usage/self'
    const POLL_MS = 60000
    const MIN_REFRESH_GAP_MS = 5000
    const DEFAULT_TTL_MS = 60 * 60000
    const CSS_ID = '@opfield/dsh-opfield/style'
    const RADIUS = 5.5
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS

    // Trigger and panel mirror the host context meter (ui-conversation ContextMeter).
    const CSS = [
      '.opfu-root{flex:none;display:inline-flex}',
      '.opfu-trigger{border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);font-family:inherit;',
      'font-size:var(--dsh-content-font-size-secondary,13px);font-variant-numeric:tabular-nums;',
      'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;cursor:pointer;background:0 0;',
      'border:none;flex:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}',
      'button.opfu-trigger:hover,.opfu-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      'span.opfu-trigger{cursor:default}',
      '.opfu-trigger[data-level=warn]{color:var(--dsw-alias-state-warn-primary)}',
      '.opfu-trigger[data-level=error]{color:var(--dsw-alias-state-error-primary)}',
      '.opfu-trigger[data-level=muted]{color:var(--dsw-alias-label-caption)}',
      '.opfu-trigger svg{flex:none}',
      '.opfu-track{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:2px}',
      '.opfu-fill{fill:none;stroke:currentColor;stroke-width:2px;stroke-linecap:round}',
      '.opfu-panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);',
      'width:min(280px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);',
      'box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:12px;',
      'font-size:12px;line-height:20px;position:fixed}',
      '.opfu-header{align-items:center;gap:6px;display:flex}',
      '.opfu-headline{color:var(--dsw-alias-label-tertiary)}',
      '.opfu-strong{color:var(--dsw-alias-label-primary);font-weight:500;font-variant-numeric:tabular-nums}',
      '.opfu-right{margin-left:auto}',
      '.opfu-rows{margin:8px 0 0;display:flex;flex-direction:column;gap:8px}',
      '.opfu-row-head{display:flex;justify-content:space-between;gap:12px}',
      '.opfu-row-head dt{color:var(--dsw-alias-label-secondary)}',
      '.opfu-row-head dd{margin:0;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      '.opfu-bar{corner-shape:round;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;height:4px;margin:4px 0 2px;overflow:hidden}',
      '.opfu-bar>div{height:100%;min-width:2px;border-radius:999px;background:var(--dsw-alias-label-tertiary)}',
      '.opfu-bar>div[data-level=warn]{background:var(--dsw-alias-state-warn-primary)}',
      '.opfu-bar>div[data-level=error]{background:var(--dsw-alias-state-error-primary)}',
      '.opfu-sub{color:var(--dsw-alias-label-tertiary)}',
      '.opfu-foot{margin-top:10px;color:var(--dsw-alias-label-caption)}',
      // Hover bubble copied from the host Tooltip primitive (side=top).
      '.opfu-tip{display:inline-flex}',
      '.opfu-bubble{position:fixed;z-index:1100;width:max-content;max-width:min(50vw,360px);padding:3px 7px;',
      'border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);',
      'font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:none;',
      'transform:translate(-50%,-100%);animation:opfu-tip-in 150ms var(--ds-ease-in-out)}',
      '.opfu-bubble[data-side=bottom]{transform:translateX(-50%)}',
      '@keyframes opfu-tip-in{from{opacity:0}}',
      // Compact offer: same strip as the host goal bar (ui-goal GoalBar).
      '.opfu-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto}',
      '.opfu-bar-strip{isolation:isolate;box-sizing:border-box;width:100%;max-width:calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset));',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);min-height:36px;box-shadow:var(--dsw-elevation-panel);',
      'border:0;align-items:center;gap:10px;margin:0 auto;padding:4px 5px 4px 12px;display:flex;position:relative}',
      '.opfu-bar-strip:before{z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);content:"";pointer-events:none;position:absolute;inset:0}',
      '.opfu-glyph{color:var(--dsw-alias-state-warn-primary);flex:none;display:inline-flex}',
      '.opfu-strip-label{color:var(--dsw-alias-label-primary);flex:none;font-size:13px;font-weight:500;line-height:24px}',
      '.opfu-strip-text{min-width:0;color:var(--dsw-alias-label-primary-dimmed);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:13px;line-height:20px;overflow:hidden}',
      '.opfu-strip-text[data-error]{color:var(--dsw-alias-state-error-primary);font-size:12px}',
      '.opfu-strip-actions{flex:none;align-items:center;gap:6px;display:flex}',
      '.opfu-btn{font:inherit;font-size:12px;line-height:20px;border:none;cursor:pointer;border-radius:var(--dsw-radius-sm);padding:2px 10px;',
      'background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.opfu-btn:hover{background:var(--dsw-alias-interactive-bg-pressed,var(--dsw-alias-interactive-bg-hover));}',
      '.opfu-btn:disabled{opacity:.5;cursor:default}',
      '.opfu-icon-btn{corner-shape:round;width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;',
      'justify-content:center;align-items:center;padding:0;display:inline-flex}',
      '.opfu-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '@media (prefers-reduced-motion:reduce){.opfu-bubble{animation:none}}',
      // Settings page on Plugins → Opfield: copied from ui-primitives settings-form, Switch and Tag.
      '.opfs-page{display:flex;flex-direction:column;gap:28px}',
      '.opfs-note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.opfs-section{display:flex;flex-direction:column}',
      '.opfs-section-title{margin:0;font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.opfs-section-desc{margin:2px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.opfs-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
      '.opfs-field+.opfs-field{border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.opfs-head{display:flex;align-items:center;gap:8px}',
      '.opfs-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.opfs-badges{display:inline-flex;align-items:center;gap:8px}',
      '.opfs-reset{border:none;background:none;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.opfs-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.opfs-reset:disabled{cursor:default}',
      '.opfs-input{height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);',
      'font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.opfs-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
      '.opfs-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      ".opfs-input[aria-invalid='true']{border-color:var(--dsw-alias-state-error-primary)}",
      '.opfs-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.opfs-invalid{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}',
      '.opfs-tag{display:inline-flex;align-items:center;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}',
      ".opfs-tag[data-tone='neutral']{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}",
      ".opfs-tag[data-tone='quiet']{color:var(--dsw-alias-label-tertiary)}",
      ".opfs-tag[data-tone='success']{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}",
      ".opfs-tag[data-tone='danger']{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}",
      '.opfs-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;',
      'background:var(--dsw-alias-border-l3);cursor:pointer}',
      ".opfs-switch[aria-checked='true']{background:var(--dsw-alias-brand-primary)}",
      '.opfs-switch:disabled{cursor:default;opacity:.5}',
      '.opfs-switch:focus-visible,.opfs-save:focus-visible,.opfs-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.opfs-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}',
      ".opfs-switch[aria-checked='false'] .opfs-thumb{background:var(--dsw-alias-switch-thumb)}",
      ".opfs-switch[aria-checked='true'] .opfs-thumb{transform:translateX(16px)}",
      '.opfs-status{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.opfs-status-text{flex:1;min-width:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      ".opfs-status-text[data-tone='error']{color:var(--dsw-alias-state-error-primary)}",
      '.opfs-btn{flex:none;appearance:none;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);',
      'padding:3px 12px;font:inherit;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.opfs-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.opfs-btn:disabled{opacity:.5;cursor:default}',
      '.opfs-footer{display:flex;align-items:center;gap:8px}',
      '.opfs-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}',
      '.opfs-saved{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.opfs-save{appearance:none;margin-left:auto;border:1px solid transparent;border-radius:var(--dsw-radius-md);padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;',
      'cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
      '.opfs-save:disabled{opacity:.4;cursor:default}',
      '.opfs-ghost{appearance:none;border:none;background:none;padding:5px 8px;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.opfs-ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.opfs-ghost:disabled{opacity:.4;cursor:default}',
      '.opfh-page{display:flex;flex-direction:column;gap:28px}',
      '.opfh-note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.opfh-note[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.opfh-section{display:flex;flex-direction:column;gap:12px}',
      '.opfh-section-head{display:flex;align-items:center;gap:12px}',
      '.opfh-section-titles{flex:1;min-width:0}',
      '.opfh-section-title{margin:0;font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.opfh-section-desc{margin:2px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.opfh-summary{display:flex;flex-wrap:wrap;gap:8px 20px;padding:12px 14px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l4)}',
      '.opfh-stat{display:flex;flex-direction:column;gap:2px;min-width:110px}',
      '.opfh-stat-value{font-size:16px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.opfh-stat-label{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.opfh-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}',
      '.opfh-card{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);padding:12px 14px;display:flex;flex-direction:column;gap:8px}',
      '.opfh-card[data-disabled=true] .opfh-name,.opfh-card[data-disabled=true] .opfh-line{opacity:.55}',
      '.opfh-row{display:flex;align-items:center;gap:10px;min-width:0}',
      '.opfh-name{font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.opfh-grow{flex:1;min-width:0}',
      '.opfh-line{margin:0;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.opfh-line[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.opfh-line[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}',
      '.opfh-sub{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}',
      '.opfh-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:12px/1.5 var(--dsw-font-mono,ui-monospace,monospace);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto}',
      '.opfh-actions{display:flex;flex-wrap:wrap;gap:6px}',
      // dot (StateDot)
      '.opfh-dot{position:relative;display:inline-block;flex:none;width:12px;height:12px}',
      ".opfh-dot::after{content:'';position:absolute;inset:20%;border-radius:50%;background:currentColor}",
      '.opfh-dot[data-state=done]{color:var(--dsw-alias-state-success-primary)}',
      '.opfh-dot[data-state=warning]{color:var(--dsw-alias-state-warn-primary)}',
      '.opfh-dot[data-state=error]{color:var(--dsw-alias-state-error-primary)}',
      '.opfh-dot[data-state=idle]{color:var(--dsw-alias-state-idle-primary,var(--dsw-alias-label-caption))}',
      '.opfh-dot[data-state=busy]::after{animation:opfh-pulse 1.2s ease-in-out infinite;color:var(--dsw-alias-state-business-primary)}',
      '@keyframes opfh-pulse{50%{opacity:.3}}',
      '@media (prefers-reduced-motion:reduce){.opfh-dot[data-state=busy]::after{animation:none}}',
      // tag
      '.opfh-tag{display:inline-flex;align-items:center;flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}',
      ".opfh-tag[data-tone=outline]{border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}",
      ".opfh-tag[data-tone=neutral]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}",
      ".opfh-tag[data-tone=info]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}",
      ".opfh-tag[data-tone=success]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}",
      ".opfh-tag[data-tone=warning]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}",
      // segmented control
      '.opfh-seg{position:relative;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:3px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);flex:none}',
      '.opfh-seg-ind{position:absolute;top:3px;left:3px;width:calc((100% - 6px - 2px * (var(--n) - 1)) / var(--n));height:calc(100% - 6px);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft);transform:translateX(calc(var(--i) * (100% + 2px)));transition:transform 160ms ease;pointer-events:none}',
      '.opfh-seg-tab{position:relative;z-index:1;height:24px;padding:0 12px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;line-height:18px;font-weight:500;white-space:nowrap;cursor:pointer}',
      '.opfh-seg-tab:hover:not(:disabled),.opfh-seg-tab[aria-selected=true]{color:var(--dsw-alias-label-primary)}',
      '.opfh-seg-tab:disabled{cursor:default;opacity:.4}',
      '@media (prefers-reduced-motion:reduce){.opfh-seg-ind{transition:none}}',
      // switch
      '.opfh-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}',
      '.opfh-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}',
      '.opfh-switch:disabled{cursor:default;opacity:.5}',
      '.opfh-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}',
      '.opfh-switch[aria-checked=false] .opfh-thumb{background:var(--dsw-alias-switch-thumb)}',
      '.opfh-switch[aria-checked=true] .opfh-thumb{transform:translateX(16px)}',
      // buttons
      '.opfh-btn{flex:none;appearance:none;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);padding:2px 10px;font:inherit;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.opfh-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.opfh-btn:disabled{opacity:.5;cursor:default}',
      '.opfh-btn[data-tone=primary]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}',
      '.opfh-btn[data-tone=danger]{color:var(--dsw-alias-state-error-primary)}',
      '.opfh-btn[data-tone=quiet]{border-color:transparent;background:none;color:var(--dsw-alias-label-secondary)}',
      '.opfh-btn[data-tone=quiet]:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.opfh-switch:focus-visible,.opfh-btn:focus-visible,.opfh-seg-tab:focus-visible,.opfh-link:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.opfh-link{border:0;background:none;padding:0;font:inherit;color:var(--dsw-alias-state-business-primary);cursor:pointer;text-decoration:underline;text-underline-offset:2px}',
      // tools list
      '.opfh-tools{display:flex;flex-direction:column;margin:0;padding:6px 0 0;border-top:.5px solid var(--dsw-alias-border-l2);list-style:none;max-height:320px;overflow:auto}',
      '.opfh-tool{display:flex;gap:10px;padding:4px 0;font-size:12px;line-height:18px}',
      '.opfh-tool-name{flex:none;max-width:45%;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.opfh-tool-sum{flex:1;min-width:0;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.opfh-tool-tok{flex:none;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}',
      // form
      '.opfh-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.opfh-field{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.opfh-field[data-wide=true]{grid-column:1/-1}',
      '.opfh-label{font-size:12.5px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.opfh-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}',
      'textarea.opfh-input{height:auto;min-height:60px;padding:6px 10px;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;line-height:1.5}',
      '.opfh-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
      ".opfh-input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}",
      '.opfh-input:disabled{color:var(--dsw-alias-label-tertiary)}',
      '.opfh-hint{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.opfh-hint[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.opfh-inline{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:32px}',
      '.opfh-form-foot{grid-column:1/-1;display:flex;align-items:center;gap:8px;justify-content:flex-end}',
      '.opfh-form-foot .opfh-note{flex:1}',
      '@media (max-width:640px){.opfh-form{grid-template-columns:minmax(0,1fr)}}',
      '.opfh-switch-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.opfh-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.opfh-hint[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.opfh-actions[data-wide=true]{grid-column:1/-1}',
      '.opfh-details{display:block}',
      '.opfh-summary{display:flex;flex-direction:column;gap:2px;cursor:pointer;list-style:none}.opfh-summary::-webkit-details-marker{display:none}',
      '.opfh-summary .opfh-section-title::after{content:"\u203a";display:inline-block;margin-left:6px;color:var(--dsw-alias-label-tertiary);transition:transform 120ms ease}',
      '.opfh-details[open] .opfh-summary .opfh-section-title::after{transform:rotate(90deg)}',
      '.opfh-details-body{display:flex;flex-direction:column;padding-top:8px}',
      '.opfh-card{padding:8px 12px 8px 8px;gap:6px}',
      '.opfh-toggle{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:40%;flex:none;border:0;background:none;padding:2px 4px;margin:-2px 0;border-radius:var(--dsw-radius-sm);font:inherit;color:inherit;cursor:pointer;text-align:left}',
      '.opfh-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.opfh-toggle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.opfh-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform 120ms ease}.opfh-chevron[data-open=true]{transform:rotate(90deg)}',
      '.opfh-meta{flex:1;min-width:0;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.opfh-meta[data-tone=error]{color:var(--dsw-alias-state-error-primary)}.opfh-meta[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}',
      '.opfh-body{display:flex;flex-direction:column;gap:8px;padding:6px 4px 4px 28px}.opfh-indent{padding-left:28px}',
      '.opfh-target{margin:0;font:12px/18px var(--dsw-font-mono,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.opfh-card>.opfh-row:first-child>.opfh-label{padding-left:4px}.opfh-card>.opfh-line,.opfh-card>.opfh-sub{padding-left:4px}',
      '.opfh-setting{padding:4px}.opfh-setting+.opfh-setting{border-top:.5px solid var(--dsw-alias-border-l2);padding-top:10px}',
      '.opfh-card[data-kind=source]{padding:12px 14px}.opfh-source{display:flex;align-items:center;gap:12px}',
      '.opfh-source-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.opfh-source-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}',
      '.opfh-refresh{margin-left:8px}',
      '.opfh-selector{box-sizing:border-box;flex:none;max-width:260px;height:36px;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);cursor:pointer;display:inline-flex;align-items:center;gap:12px;padding:0 14px}',
      '.opfh-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.opfh-selector:disabled{cursor:not-allowed;opacity:.4}',
      '.opfh-selector:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.opfh-selector-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.opfh-selector-chevron{flex:none}',
      'button.opfh-danger{color:var(--dsw-alias-state-error-primary)}',
      '.opfh-tag-hint{display:inline-flex;flex:none}',
      '.opfh-dot-ui{display:inline-flex;align-items:center;justify-content:center;flex:none;width:12px;height:14px}',
      '.opfh-uinput{box-sizing:border-box;width:100%;display:flex}.opfh-ushort{width:120px;flex:none}.opfh-ushort input{text-align:right;font-variant-numeric:tabular-nums}',
      '.opfh-uinvalid{border-color:var(--dsw-alias-state-error-primary)}',
      '.opfh-input-short{width:110px;flex:none;text-align:right;font-variant-numeric:tabular-nums}',
      '@media (prefers-reduced-motion:reduce){.opfh-chevron{transition:none}}',
    ].join('')

    /** Settings page and newer pill strings; zh falls back to them. */
    const SETTINGS_EN = {
      'error.signin': 'sign in',
      'error.no-hub': 'needs MCP hub',
      'error.denied': 'no access',
      'error.no-source': 'no instance',
      'error.failed': 'error',
      save: 'Save',
      saving: 'Saving…',
      cancel: 'Cancel',
      failed: 'Failed',
      's.summary': 'Opfield instances, models, budget, cache timer and compact offer.',
      's.loading': 'Loading settings…',
      's.unavailable': 'Settings are not available: the plugin is not loaded or this Harness is too old to edit it here. Restart DSH after updating the plugin.',
      's.readOnly': 'This deployment stores settings read-only.',
      's.memory': 'Settings can only be changed from the machine that runs DSH.',
      's.noHub': 'Opfield needs the MCP hub plugin: install and enable it in Plugins, then restart DSH.',
      's.hostMissing': 'The plugin host is not answering. Restart DSH after updating the plugin.',
      's.overridden': 'Overridden',
      's.reset': 'Reset to default',
      's.discard': 'Discard',
      's.saved': 'Saved. Changes apply right away.',
      's.saveFailed': 'DSH did not accept these values; they were left for you to correct.',
      's.invalidNumber': 'Enter a number from {min} to {max}.',
      's.invalidNumberMin': 'Enter a number of at least {min}.',
      'inst.title': 'Instances',
      'inst.desc': 'Opfield installations you sign in to. With MCP on, the model gets their tools through the MCP Hub as a compact catalog.',
      'inst.add': 'Add instance',
      'inst.empty': 'No instances yet. Add the address of your Opfield.',
      'inst.noHub': 'The MCP hub is not available',
      'inst.starting': 'Connecting…',
      'inst.signin': 'Sign-in needed',
      'inst.error': 'Error',
      'inst.connected': 'Connected',
      'inst.tools': '{n} tools for the model',
      'inst.hidden': 'Connected; tools hidden from the model',
      'inst.stopped': 'Stopped — starts on first use',
      'inst.models': 'Models',
      'inst.noInference': 'no inference access',
      'inst.noInference.title': 'This login has no feat:ai:use scope, so it cannot serve models or show a budget.',
      'inst.mcp': 'MCP',
      'inst.mcp.title': 'Give the model the tools of this instance',
      'inst.waiting': 'Finish signing in in the browser.',
      'inst.openLink': 'Open the sign-in page',
      'action.signin': 'Sign in',
      'action.signout': 'Sign out',
      'action.restart': 'Restart',
      'action.start': 'Start',
      'action.stop': 'Stop',
      'action.refreshTools': 'Refresh tools',
      'action.edit': 'Edit',
      'action.remove': 'Remove',
      'action.confirmRemove': 'Click again to remove',
      'form.name': 'Name',
      'form.name.hint': 'Letters, digits, - and _. Tools are named mcp__<name>__….',
      'form.name.invalid': 'Use 1–32 letters, digits, - or _.',
      'form.name.taken': 'An instance already has this name.',
      'form.name.fixed': 'The name cannot change: the login is kept under it.',
      'form.url': 'Address',
      'form.url.hint': 'Address of the Opfield installation, e.g. https://ops.example.com.',
      'form.url.invalid': 'Enter an http(s) address.',
      'form.add': 'Add',
      'inf.title': 'Models',
      'inf.desc': 'One instance serves the models in the model picker and the budget under the composer.',
      'inf.label': 'Inference from',
      'inf.none': 'None',
      'inf.none.hint': 'No Opfield models; the budget is hidden.',
      'inf.issuing': 'Issuing an inference token…',
      'inf.pending': 'Setting up…',
      'inf.models': '{n} models',
      'inf.synced': 'synced {time}',
      'inf.syncFailed': 'sync failed: {reason}',
      'inf.budget': '{left} of the budget left ({windows})',
      'inf.budgetNone': 'no budget limits',
      'inf.defaultMoved': 'The default model {from} is not on this instance, so it is now {to}. Open chats keep their model until you pick another.',
      'inf.key': 'Inference token',
      'inf.key.hint': 'Create an inference token in Opfield and paste it here. It is kept in the DSH key store.',
      'inf.key.save': 'Save token',
      'inf.refresh': 'Refresh',
      'inf.refreshing': 'Refreshing…',
      'inf.retry': 'Try again',
      'comp.title': 'Components',
      'comp.ttl.hint': 'For the cache timer: how long the provider keeps the prompt cached.',
      'comp.compactMin': 'Offer /compact from',
      'comp.compactMin.hint': 'Tokens of context. Smaller chats are cheap to re-send and get no offer.',
      'inf.refresh.title': 'Re-read the model list of this instance',
      'comp.desc': 'Budget, cache timer and compact offer are turned on and off in Plugins → Components. Settings of the ones that are on appear here.',
      'comp.ttl': 'Prompt cache lifetime',
      'comp.ttl.5': 'Standard 5-minute cache',
      'comp.ttl.60': 'Extended 1-hour cache',
      'adv.title': 'Advanced',
      'adv.desc': 'Thresholds, intervals and model filters. The defaults suit most setups.',
      'f.advanced.pollSeconds': 'Budget refresh, s',
      'f.advanced.pollSeconds.hint': 'The budget is also re-read after each answer and when the window regains focus.',
      'f.advanced.warnPercent': 'Budget warning at, % left',
      'f.advanced.errorPercent': 'Budget critical at, % left',
      'f.promptCacheTtlMinutes': 'Cache lifetime, min',
      'f.promptCacheTtlMinutes.hint': 'Any value; the switch under Components offers 5 and 60.',
      'f.advanced.syncIntervalMinutes': 'Model re-sync, min',
      'f.advanced.syncIntervalMinutes.hint': '0 = only at start and on Refresh models.',
      'f.advanced.include': 'Only models',
      'f.advanced.include.hint': 'Comma-separated id globs, e.g. claude-*, gpt-5*. Empty = every model.',
      'f.advanced.exclude': 'Skip models',
      'f.advanced.exclude.hint': 'Comma-separated id globs removed after the list above.',
      'f.advanced.route': 'Model route',
      'f.advanced.route.hint': 'The llm-pi-ai route the instance serves.',
      'f.advanced.piAiEntry': 'Models plugin entry',
      'f.advanced.piAiEntry.hint': 'Entry id of the llm-pi-ai plugin in the profile; leave as is unless you renamed it.',
      'f.advanced.timeoutMs': 'Opfield timeout, ms',
      'f.advanced.cacheMs': 'Budget reuse, ms',
      'f.advanced.cacheMs.hint': 'How long one budget reading serves every open window.',
    }

    const en = {
      'window.5h': '5 hours',
      'window.7d': '7 days',
      'window.30d': '30 days',
      'window.api': 'API budget',
      'usage.aria': 'Opfield budget: {percent} left',
      'usage.title': 'Opfield budget left',
      'usage.left': '{percent} left',
      'usage.resets': 'resets {time}',
      'usage.notStarted': 'not started — begins with the next request',
      'usage.none': 'No budget windows are enabled for this account.',
      'usage.measured': 'Measured {time}',
      'error.prefix': 'Opfield',
      'error.timeout': 'timeout',
      'error.network': 'offline',
      'error.bad-response': 'error',
      'error.unavailable': 'unavailable',
      'cache.aria': 'Prompt cache: {time} left',
      'cache.title.running': 'Prompt cache is kept warm while the agent works: every request renews its {ttl} min TTL.',
      'cache.title.warm': 'Prompt cache: ~{time} left (TTL {ttl} min after the last request at {at}).',
      'cache.title.cold': 'Prompt cache has likely expired: the last request was at {at}, TTL {ttl} min. The next request re-writes it.',
      'compact.title': 'Prompt cache expired',
      'compact.body': '~{tokens} tokens of context will be re-sent uncached. Compact first?',
      'compact.action': 'Compact',
      'compact.running': 'Compacting…',
      'compact.dismiss': 'Dismiss',
      'compact.unknown': '/compact is not available in this session',
      'cache.title.figures': 'Last request: {read} cached read, {write} cache write tokens.',
      ...SETTINGS_EN,
    }
    const zh = {
      ...SETTINGS_EN,
      'window.5h': '5 小时',
      'window.7d': '7 天',
      'window.30d': '30 天',
      'window.api': 'API 预算',
      'usage.aria': 'Opfield 额度：剩余 {percent}',
      'usage.title': 'Opfield 剩余额度',
      'usage.left': '剩余 {percent}',
      'usage.resets': '{time} 重置',
      'usage.notStarted': '未开始，下一次请求开始计时',
      'usage.none': '此账号未启用任何额度窗口。',
      'usage.measured': '测量于 {time}',
      'error.prefix': 'Opfield',
      'error.timeout': '超时',
      'error.network': '离线',
      'error.bad-response': '错误',
      'error.unavailable': '不可用',
      'cache.aria': '提示缓存：剩余 {time}',
      'cache.title.running': '智能体工作时提示缓存保持有效：每次请求都会刷新 {ttl} 分钟 TTL。',
      'cache.title.warm': '提示缓存：约剩 {time}（最后一次请求 {at} 后 TTL {ttl} 分钟）。',
      'compact.title': '提示缓存已过期',
      'compact.body': '约 {tokens} tokens 上下文将以未缓存方式重新发送。先压缩吗？',
      'compact.action': '压缩',
      'compact.running': '正在压缩…',
      'compact.dismiss': '忽略',
      'compact.unknown': '此会话不支持 /compact',
      'cache.title.cold': '提示缓存可能已过期：最后一次请求在 {at}，TTL {ttl} 分钟。下一次请求会重新写入。',
      'cache.title.figures': '最后一次请求：缓存读取 {read}，缓存写入 {write} tokens。',
    }

    /** One shared, page-wide usage store; every mounted pill reads the same snapshot. */
    function createStore() {
      let snapshot = { value: null, fetchedAt: 0 }
      const listeners = new Set()
      let inflight = null
      let lastStart = 0
      const publish = (value) => {
        snapshot = { value, fetchedAt: Date.now() }
        for (const fn of listeners) fn()
      }
      async function load(fresh) {
        try {
          // POST asks the Host to skip its short cache (settings page "Check", after a save).
          const response = await fetch(ROUTE, { method: fresh ? 'POST' : 'GET', headers: { accept: 'application/json' }, cache: 'no-store' })
          publish(response.ok ? await response.json() : { ok: false, code: 'unavailable', message: `HTTP ${response.status}` })
        } catch (error) {
          publish({ ok: false, code: 'unavailable', message: String(error) })
        }
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        get size() {
          return listeners.size
        },
        refresh(force) {
          const t = Date.now()
          if (inflight !== null) return inflight
          if (!force && t - lastStart < MIN_REFRESH_GAP_MS) return Promise.resolve()
          lastStart = t
          inflight = load(false).finally(() => {
            inflight = null
          })
          return inflight
        },
        /** A fresh upstream reading, past both caches. */
        async check() {
          if (inflight !== null) await inflight.catch(() => {})
          lastStart = Date.now()
          inflight = load(true).finally(() => {
            inflight = null
          })
          await inflight
          return snapshot.value
        },
      }
    }

    // ── formatting ───────────────────────────────────────────────────────
    function formatPercent(p) {
      if (p >= 100) return '100%'
      if (p <= 0) return '0%'
      if (p > 99) return `${Math.floor(p * 10) / 10}%`
      if (p < 1) return `${Math.round(p * 10) / 10}%`
      return `${Math.round(p)}%`
    }
    function formatTime(value) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '?'
      const sameDay = date.toDateString() === new Date().toDateString()
      return sameDay
        ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    }
    /** Coarse remaining time rounded up to whole minutes: 1h, 1h 5m, 59m … 1m. */
    function formatRemaining(ms) {
      const minutes = Math.max(1, Math.ceil(ms / 60000))
      if (minutes < 60) return `${minutes}m`
      const h = Math.floor(minutes / 60)
      const m = minutes % 60
      return m === 0 ? `${h}h` : `${h}h ${m}m`
    }
    function formatTokens(n) {
      if (typeof n !== 'number') return '—'
      if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`
      if (n >= 1e3) return `${Math.round(n / 100) / 10}k`
      return String(n)
    }
    const DEFAULT_DISPLAY = { usagePill: true, cachePill: true, pollSeconds: 60, warnPercent: 20, errorPercent: 5 }
    /** Display settings the Host sent with the last reading. */
    function displayOf(value) {
      return { ...DEFAULT_DISPLAY, ...(value && typeof value.display === 'object' && value.display !== null ? value.display : {}) }
    }
    /** Level from the remaining share (100 = untouched, 0 = exhausted). */
    function levelOfLeft(left, display = DEFAULT_DISPLAY) {
      if (left <= display.errorPercent) return 'error'
      if (left <= display.warnPercent) return 'warn'
      return 'ok'
    }
    /** Remaining share of a window; a window that has not started is untouched. */
    function leftOf(w) {
      return w.active ? Math.max(0, Math.min(100, 100 - w.percentage)) : 100
    }

    // ── shared bits ──────────────────────────────────────────────────────
    function Ring({ fraction }) {
      const f = Math.max(0, Math.min(1, fraction))
      return h(
        'svg',
        { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
        h('circle', { className: 'opfu-track', cx: 7, cy: 7, r: RADIUS }),
        f > 0 &&
          h('circle', {
            className: 'opfu-fill',
            cx: 7,
            cy: 7,
            r: RADIUS,
            strokeDasharray: `${CIRCUMFERENCE * f} ${CIRCUMFERENCE}`,
            transform: 'rotate(-90 7 7)',
          }),
      )
    }

    function TimerIcon() {
      return h(
        'svg',
        { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('circle', { cx: 7, cy: 8, r: 4.9 }),
        h('path', { d: 'M7 5.4V8l1.7 1.1M5.6 1.3h2.8' }),
      )
    }

    const TIP_DELAY_MS = 200
    const TIP_GAP = 8
    const EDGE = 12

    /**
     * Hover/focus bubble in the host Tooltip look (the context meter uses
     * side=top, 200 ms delay, hidden while its panel is open).
     */
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
        { ref: anchorRef, className: 'opfu-tip', onPointerEnter: show, onPointerLeave: hide, onFocus: show, onBlur: hide },
        children,
        visible
          ? ReactDOM.createPortal(
              h('div', { ref: bubbleRef, className: 'opfu-bubble', role: 'tooltip', 'data-side': 'top', style: { visibility: 'hidden', left: rect.x, top: rect.top - TIP_GAP } }, label),
              document.body,
            )
          : null,
      )
    }

    /** Fixed-position anchoring above the trigger, re-measured on resize/scroll. */
    function useAnchored(open, anchorRef, panelRef) {
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
      }, [open])
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

    // ── usage pill ───────────────────────────────────────────────────────
    function UsagePanel({ value, left, t, panelRef, pos }) {
      const display = displayOf(value)
      return h(
        'div',
        { ref: panelRef, className: 'opfu-panel', role: 'dialog', 'aria-label': t('usage.title'), style: pos ?? { visibility: 'hidden', left: 0, top: 0 } },
        h('div', { className: 'opfu-header' }, h('span', { className: 'opfu-headline' }, t('usage.title')), h('span', { className: 'opfu-strong opfu-right' }, formatPercent(left))),
        h(
          'dl',
          { className: 'opfu-rows' },
          value.windows.map((w) => {
            const wl = leftOf(w)
            return h(
              'div',
              { key: w.id },
              h('div', { className: 'opfu-row-head' }, h('dt', null, t(`window.${w.id}`)), h('dd', null, t('usage.left', { percent: formatPercent(wl) }))),
              h('div', { className: 'opfu-bar' }, h('div', { 'data-level': levelOfLeft(wl, display), style: { width: `${wl}%` } })),
              h('div', { className: 'opfu-sub' }, w.active ? t('usage.resets', { time: w.recoveryAt ? formatTime(w.recoveryAt) : '?' }) : t('usage.notStarted')),
            )
          }),
        ),
        h('div', { className: 'opfu-foot' }, t('usage.measured', { time: formatTime(value.measuredAt) })),
      )
    }

    function makeUsagePill(store) {
      return React.memo(function OpfieldUsage({ useProjection, t }) {
        const snap = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
        const selection = useProjection('modelSelection')
        const tokenUsage = useProjection('tokenUsage')
        const [open, setOpen] = React.useState(false)
        const rootRef = React.useRef(null)
        const panelRef = React.useRef(null)

        // A finished request changes the session's token usage: re-read the budget then.
        React.useEffect(() => {
          store.refresh(false)
        }, [tokenUsage])

        const value = snap.value
        // Older hosts sent one `provider`; current ones send `providers`.
        const wanted = Array.isArray(value?.providers) ? value.providers : typeof value?.provider === 'string' ? [value.provider] : []
        const current = selection?.next?.provider
        const display = displayOf(value)
        const hidden = value === null || display.usagePill === false || (wanted.length > 0 && current !== undefined && !wanted.includes(current))
        const failed = !hidden && value.ok !== true
        const empty = !hidden && !failed && (value.enabled === false || !Array.isArray(value.windows) || value.windows.length === 0)
        const canOpen = !hidden && !failed && !empty
        const pos = useAnchored(open && canOpen, rootRef, panelRef)
        useDismiss(open && canOpen, setOpen, rootRef, panelRef)
        if (hidden || empty) return null

        if (failed) {
          const reason = t(`error.${value.code}`) || value.code
          return h(
            'span',
            { className: 'opfu-root', 'data-opfield-usage': true },
            h(Tip, { label: value.message || reason }, h('span', { className: 'opfu-trigger', 'data-level': 'muted' }, h(Ring, { fraction: 0 }), `${t('error.prefix')}: ${reason}`)),
          )
        }

        const left = Math.min(...value.windows.map(leftOf))
        const reading = formatPercent(left)
        return h(
          'span',
          { ref: rootRef, className: 'opfu-root', 'data-opfield-usage': true },
          h(
            Tip,
            { label: t('usage.aria', { percent: reading }), disabled: open },
            h(
            'button',
            {
              type: 'button',
              className: 'opfu-trigger',
              'data-level': levelOfLeft(left, display),
              'aria-label': t('usage.aria', { percent: reading }),
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              onClick: () => setOpen(!open),
            },
            h(Ring, { fraction: left / 100 }),
            h('span', null, reading),
            ),
          ),
          open ? ReactDOM.createPortal(h(UsagePanel, { value, left, t, panelRef, pos }), document.body) : null,
        )
      })
    }

    // ── prompt-cache warmth ──────────────────────────────────────────────
    /** Re-render every `periodMs` while `active`. */
    function useNow(active, periodMs) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!active) return undefined
        setNow(Date.now())
        const id = setInterval(() => setNow(Date.now()), periodMs)
        return () => clearInterval(id)
      }, [active, periodMs])
      return now
    }

    function ttlOf(store) {
      const snap = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
      return typeof snap.value?.cacheTtlMs === 'number' ? snap.value.cacheTtlMs : DEFAULT_TTL_MS
    }

    /**
     * Warmth facts of one Session. A running turn keeps renewing the cache, so
     * it counts as a full TTL; a "running" flag older than the TTL is a turn
     * that never closed (crash) and falls back to the countdown.
     */
    function cacheStateOf(warm, ttl, now) {
      const last = typeof warm?.lastRequestAt === 'number' ? warm.lastRequestAt : null
      if (last === null) return null
      const running = warm.running === true && now - last <= ttl
      const remaining = running ? ttl : last + ttl - now
      return { last, running, remaining, cold: remaining <= 0 }
    }

    function makeCachePill(store) {
      return React.memo(function PromptCacheWarm({ useProjection, t }) {
        const warm = useProjection('promptCacheWarm')
        const ttl = ttlOf(store)
        const snap = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
        const now = useNow(typeof warm?.lastRequestAt === 'number', 15000)
        const state = cacheStateOf(warm, ttl, now)
        if (state === null || displayOf(snap.value).cachePill === false) return null

        const at = formatTime(state.last)
        const ttlMin = Math.round(ttl / 60000)
        const hasFigures = typeof warm.cacheReadTokens === 'number' || typeof warm.cacheWriteTokens === 'number'
        const figures = hasFigures ? `\n${t('cache.title.figures', { read: formatTokens(warm.cacheReadTokens), write: formatTokens(warm.cacheWriteTokens) })}` : ''
        const level = state.cold ? 'muted' : state.remaining <= 5 * 60000 ? 'warn' : 'ok'
        const reading = state.cold ? '0m' : formatRemaining(state.remaining)
        const title =
          (state.running
            ? t('cache.title.running', { ttl: ttlMin })
            : state.cold
              ? t('cache.title.cold', { at, ttl: ttlMin })
              : t('cache.title.warm', { time: formatRemaining(state.remaining), at, ttl: ttlMin })) + figures
        return h(
          'span',
          { className: 'opfu-root', 'data-prompt-cache-warm': true },
          h(
            Tip,
            { label: title },
            h(
              'span',
              { className: 'opfu-trigger', 'data-level': level, tabIndex: 0, 'aria-label': t('cache.aria', { time: reading }) },
              h(TimerIcon),
              h('span', null, reading),
            ),
          ),
        )
      })
    }

    // ── cold-cache compact offer (input dock, above the composer) ────────
    /** Dismissals survive remounts and session switches, keyed per last request. */
    const dismissed = new Set()

    function CloseIcon() {
      return h(
        'svg',
        { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' },
        h('path', { d: 'M3.5 3.5l7 7M10.5 3.5l-7 7' }),
      )
    }

    function makeCompactBar(store) {
      return React.memo(function CompactOffer({ useProjection, t, sessionId, compact }) {
        const warm = useProjection('promptCacheWarm')
        const pressure = useProjection('contextPressure')
        const snap = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
        const ttl = ttlOf(store)
        const now = useNow(typeof warm?.lastRequestAt === 'number', 15000)
        const [pending, setPending] = React.useState(false)
        const [error, setError] = React.useState(null)
        const [, bump] = React.useState(0)

        const suggestion = snap.value?.compactSuggestion ?? { enabled: true, minTokens: 30000 }
        const state = cacheStateOf(warm, ttl, now)
        const tokens = pressure?.projectedTokens ?? pressure?.pressureTokens
        const key = state === null ? '' : `${sessionId}:${state.last}`
        const compactedSince = typeof warm?.lastCompactionAt === 'number' && state !== null && warm.lastCompactionAt >= state.last
        const show =
          suggestion.enabled !== false &&
          state !== null &&
          state.cold &&
          !state.running &&
          !compactedSince &&
          typeof tokens === 'number' &&
          tokens >= (suggestion.minTokens ?? 0) &&
          !dismissed.has(key)
        if (!show && !pending) return null

        const run = async () => {
          setPending(true)
          setError(null)
          try {
            const message = await compact()
            if (message !== null) setError(message)
          } catch (e) {
            setError(String(e?.message ?? e))
          } finally {
            setPending(false)
          }
        }
        return h(
          'div',
          { className: 'opfu-dock', 'data-compact-offer': true },
          h(
            'div',
            { className: 'opfu-bar-strip', role: 'status' },
            h('span', { className: 'opfu-glyph' }, h(TimerIcon)),
            h('span', { className: 'opfu-strip-label' }, t('compact.title')),
            error === null
              ? h('span', { className: 'opfu-strip-text' }, t('compact.body', { tokens: formatTokens(tokens) }))
              : h('span', { className: 'opfu-strip-text', 'data-error': true, role: 'alert' }, error),
            h(
              'div',
              { className: 'opfu-strip-actions' },
              h('button', { type: 'button', className: 'opfu-btn', disabled: pending, onClick: run }, pending ? t('compact.running') : t('compact.action')),
              h(
                Tip,
                { label: t('compact.dismiss') },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'opfu-icon-btn',
                    'aria-label': t('compact.dismiss'),
                    disabled: pending,
                    onClick: () => {
                      dismissed.add(key)
                      bump((n) => n + 1)
                    },
                  },
                  h(CloseIcon),
                ),
              ),
            ),
          ),
        )
      })
    }

    // ── settings page (Plugins → Opfield) ────────────────────────────────
    const BUNDLE = '@opfield/dsh-opfield'
    /** Host entry id = settings namespace. */
    const ENTRY_ID = 'opfield-usage'
    const STATUS_ROUTE = 'opfield-usage/status'
    const ACTION_ROUTE = 'opfield-usage/action'
    const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
    const STATUS_POLL_MS = 3000

    async function getJson(path) {
      try {
        const response = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' })
        return response.ok ? await response.json() : null
      } catch {
        return null
      }
    }
    async function postJson(path, body) {
      try {
        const response = await fetch(path, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
        return response.ok ? await response.json() : { ok: false, message: `HTTP ${response.status}` }
      } catch (error) {
        return { ok: false, message: String(error) }
      }
    }

    /** Host status of instances, inference and sync; re-read while the page is open. */
    function useStatus(revision) {
      const [status, setStatus] = React.useState(null)
      const [nonce, setNonce] = React.useState(0)
      React.useEffect(() => {
        let live = true
        let timer = null
        const load = async () => {
          const next = await getJson(STATUS_ROUTE)
          if (!live) return
          setStatus(next ?? { ok: false })
          timer = setTimeout(load, STATUS_POLL_MS)
        }
        load()
        return () => {
          live = false
          clearTimeout(timer)
        }
      }, [revision, nonce])
      return [status, () => setNonce((n) => n + 1)]
    }

    const hostOf = (url) => {
      try {
        return new URL(url).host
      } catch {
        return String(url ?? '')
      }
    }
    const originOf = (url) => {
      try {
        const u = new URL(String(url).trim())
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : undefined
      } catch {
        return undefined
      }
    }

    // ── controls: DSH primitives (@deepseek-ai/dsh-client-ui-primitives) ──
    // The look-alike fallbacks below run only where the primitives are missing
    // (tests, very old builds).
    const DOT_STATE = { done: 'done', busy: 'ongoing', warning: 'warning', error: 'error', idle: 'idle' }
    const classes = (...names) => names.filter(Boolean).join(' ')

    function Switch({ checked, onChange, label, disabled, title }) {
      if (UI?.Switch) return h(UI.Switch, { checked, onChange, label, disabled, title })
      return h('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, title, disabled, className: 'opfh-switch', onClick: () => onChange(!checked) }, h('span', { className: 'opfh-thumb' }))
    }

    function Segmented({ id, value, options, onChange, label, disabled }) {
      if (UI?.SegmentedControl) {
        const base = id ?? `opfh-seg-${String(label ?? '').replace(/[^A-Za-z0-9]+/g, '-')}`
        return h(UI.SegmentedControl, { id: base, value, options: options.map((o) => ({ value: o.value, label: o.label, title: o.title, disabled: o.disabled })), onChange, label, disabled })
      }
      const index = Math.max(0, options.findIndex((o) => o.value === value))
      return h(
        'div',
        { role: 'tablist', 'aria-label': label, className: 'opfh-seg', style: { '--n': String(options.length), '--i': String(index) } },
        h('span', { 'aria-hidden': true, className: 'opfh-seg-ind' }),
        options.map((o) =>
          h('button', { key: o.value, type: 'button', role: 'tab', 'aria-selected': o.value === value, title: o.title, disabled: disabled || o.disabled, className: 'opfh-seg-tab', onClick: () => o.value !== value && onChange(o.value) }, o.label),
        ),
      )
    }

    /** tone: primary | quiet (ghost) | danger | default (outline). */
    function Button({ tone, onClick, disabled, children, title, icon }) {
      if (UI?.Button) {
        const variant = tone === 'primary' ? 'primary' : tone === 'quiet' ? 'ghost' : 'outline'
        return h(UI.Button, { variant, size: 'sm', icon, className: tone === 'danger' ? 'opfh-danger' : undefined, onClick, disabled, title }, children)
      }
      return h('button', { type: 'button', className: 'opfh-btn', 'data-tone': tone, onClick, disabled, title }, children)
    }

    function Tag({ tone = 'outline', title, children }) {
      const tag = UI?.Tag ? h(UI.Tag, { tone }, children) : h('span', { className: 'opfh-tag', 'data-tone': tone }, children)
      return title ? h('span', { className: 'opfh-tag-hint', title }, tag) : tag
    }

    function Dot({ state }) {
      if (UI?.StateDot) return h('span', { className: 'opfh-dot-ui', 'aria-hidden': true }, h(UI.StateDot, { state: DOT_STATE[state] ?? 'idle' }))
      return h('span', { className: 'opfh-dot', 'data-state': state, 'aria-hidden': true })
    }

    /** Single-line text field; `className` styles the fallback only. */
    function TextInput({ className, short, ...rest }) {
      if (UI?.Input) return h(UI.Input, { className: classes('opfh-uinput', short && 'opfh-ushort', rest['aria-invalid'] && 'opfh-uinvalid'), ...rest })
      return h('input', { className, ...rest })
    }

    function Section({ id, title, desc, action, children }) {
      return h(
        'section',
        { className: 'opfh-section', 'aria-labelledby': `opfh-sec-${id}` },
        h(
          'div',
          { className: 'opfh-section-head' },
          h('div', { className: 'opfh-section-titles' }, h('h3', { className: 'opfh-section-title', id: `opfh-sec-${id}` }, title), desc ? h('p', { className: 'opfh-section-desc' }, desc) : null),
          action ?? null,
        ),
        children,
      )
    }

    // ── instances ────────────────────────────────────────────────────────
    function InstanceForm({ t, instance, taken, disabled, onSave, onCancel }) {
      const editing = instance !== undefined
      const [name, setName] = React.useState(instance?.name ?? '')
      const [url, setUrl] = React.useState(instance?.url ?? '')
      const [saving, setSaving] = React.useState(false)
      const nameError = editing ? null : !NAME_RE.test(name) ? t('form.name.invalid') : taken.includes(name) ? t('form.name.taken') : null
      const urlError = originOf(url) ? null : t('form.url.invalid')
      const touched = name !== '' || url !== ''
      return h(
        'div',
        { className: 'opfh-form' },
        h(
          'div',
          { className: 'opfh-field' },
          h('label', { className: 'opfh-label', htmlFor: 'opfh-f-name' }, t('form.name')),
          h(TextInput, { id: 'opfh-f-name', className: 'opfh-input', value: name, disabled: disabled || editing, spellCheck: false, autoComplete: 'off', placeholder: 'opfield', 'aria-invalid': touched && nameError ? true : undefined, onChange: (e) => setName(e.target.value.trim()) }),
          h('p', { className: 'opfh-hint', 'data-tone': touched && nameError ? 'error' : undefined }, touched && nameError ? nameError : editing ? t('form.name.fixed') : t('form.name.hint')),
        ),
        h(
          'div',
          { className: 'opfh-field' },
          h('label', { className: 'opfh-label', htmlFor: 'opfh-f-url' }, t('form.url')),
          h(TextInput, { id: 'opfh-f-url', className: 'opfh-input', value: url, disabled, spellCheck: false, autoComplete: 'off', placeholder: 'https://ops.example.com', 'aria-invalid': touched && urlError ? true : undefined, onChange: (e) => setUrl(e.target.value) }),
          h('p', { className: 'opfh-hint', 'data-tone': touched && urlError ? 'error' : undefined }, touched && urlError ? urlError : t('form.url.hint')),
        ),
        h(
          'div',
          { className: 'opfh-actions', 'data-wide': true },
          h(
            Button,
            {
              tone: 'primary',
              disabled: disabled || saving || nameError !== null || urlError !== null,
              onClick: async () => {
                setSaving(true)
                const ok = await onSave({ ...(instance ?? { mcp: true }), name, url: originOf(url) })
                setSaving(false)
                return ok
              },
            },
            saving ? t('saving') : editing ? t('save') : t('form.add'),
          ),
          h(Button, { tone: 'quiet', onClick: onCancel }, t('cancel')),
        ),
      )
    }

    function Chevron({ open }) {
      return h(
        'svg',
        { className: 'opfh-chevron', 'data-open': open, width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
        h('path', { d: 'M4.5 2.5 8 6l-3.5 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function dotOf(server) {
      if (!server) return 'idle'
      if (server.status === 'running') return 'done'
      if (server.status === 'starting') return 'busy'
      if (server.status === 'auth' || !server.signedIn) return 'warning'
      if (server.status === 'error') return 'error'
      return 'idle'
    }

    function InstanceCard({ t, instance, view, hub, disabled, onUpdate, onRemove, act }) {
      const [open, setOpen] = React.useState(false)
      const [editing, setEditing] = React.useState(false)
      const [confirming, setConfirming] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const [signin, setSignin] = React.useState(null)
      const [error, setError] = React.useState(null)
      const server = view?.server ?? null
      const signedIn = server?.signedIn === true
      React.useEffect(() => {
        if (signedIn) setSignin(null)
      }, [signedIn])
      React.useEffect(() => {
        if (!confirming) return undefined
        const id = setTimeout(() => setConfirming(false), 4000)
        return () => clearTimeout(id)
      }, [confirming])
      const run = async (what) => {
        setBusy(what)
        setError(null)
        const result = await act(instance.name, what)
        setBusy(null)
        if (result?.ok === false) setError(result.message ?? t('failed'))
        if (what === 'signin' && result?.url) setSignin(result.url)
      }
      const mcp = instance.mcp !== false
      let line
      if (!hub) line = { text: t('inst.noHub'), tone: 'error' }
      else if (!server) line = { text: t('inst.starting') }
      else if (!signedIn || server.status === 'auth') line = { text: t('inst.signin'), tone: 'warn' }
      else if (server.status === 'error') line = { text: `${t('inst.error')}: ${server.error ?? ''}`, tone: 'error' }
      else if (server.status === 'running') line = { text: mcp ? t('inst.tools', { n: server.tools }) : t('inst.hidden') }
      else if (server.status === 'starting') line = { text: t('inst.starting') }
      else line = { text: t('inst.stopped') }
      const bodyId = `opfh-body-${instance.name}`
      return h(
        'li',
        { className: 'opfh-card', 'data-instance': instance.name, 'data-open': open },
        h(
          'div',
          { className: 'opfh-row' },
          h(
            'button',
            { type: 'button', className: 'opfh-toggle', 'aria-expanded': open, 'aria-controls': bodyId, onClick: () => setOpen((v) => !v) },
            h(Chevron, { open }),
            h(Dot, { state: dotOf(server) }),
            h('span', { className: 'opfh-name', title: instance.name }, instance.name),
          ),
          h(Tag, { tone: 'outline', title: instance.url }, hostOf(instance.url)),
          view?.source ? h(Tag, { tone: 'info' }, t('inst.models')) : null,
          view?.inference === false ? h(Tag, { tone: 'neutral', title: t('inst.noInference.title') }, t('inst.noInference')) : null,
          h('span', { className: 'opfh-meta', 'data-tone': line.tone, title: line.text, role: 'status' }, line.text),
          hub && server && !signedIn ? h(Button, { tone: 'primary', disabled: busy !== null, onClick: () => run('signin') }, busy === 'signin' ? '…' : t('action.signin')) : null,
          h('span', { className: 'opfh-switch-label' }, t('inst.mcp')),
          h(Switch, { checked: mcp, label: t('inst.mcp.title'), disabled, onChange: (on) => onUpdate({ ...instance, mcp: on }) }),
        ),
        signin && !signedIn
          ? h(
              'p',
              { className: 'opfh-line opfh-indent', 'data-tone': 'warn' },
              `${t('inst.waiting')} `,
              h('button', { type: 'button', className: 'opfh-link', onClick: () => window.open(signin, '_blank', 'noopener') }, t('inst.openLink')),
            )
          : null,
        error ? h('p', { className: 'opfh-line opfh-indent', 'data-tone': 'error', role: 'alert' }, error) : null,
        open
          ? h(
              'div',
              { className: 'opfh-body', id: bodyId },
              h('p', { className: 'opfh-target', title: instance.url }, instance.url),
              editing
                ? h(InstanceForm, {
                    t,
                    instance,
                    taken: [],
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
                    { className: 'opfh-actions' },
                    hub ? h(Button, { disabled: busy !== null, onClick: () => run('restart') }, busy === 'restart' ? '…' : server?.running ? t('action.restart') : t('action.start')) : null,
                    hub && server?.running ? h(Button, { disabled: busy !== null, onClick: () => run('stop') }, busy === 'stop' ? '…' : t('action.stop')) : null,
                    hub && server ? h(Button, { disabled: busy !== null, onClick: () => run('refresh') }, busy === 'refresh' ? '…' : t('action.refreshTools')) : null,
                    hub && signedIn ? h(Button, { tone: 'quiet', disabled: busy !== null, onClick: () => run('signout') }, t('action.signout')) : null,
                    h('span', { className: 'opfh-grow' }),
                    h(Button, { tone: 'quiet', disabled, onClick: () => setEditing(true) }, t('action.edit')),
                    h(Button, { tone: 'danger', disabled, onClick: () => (confirming ? onRemove(instance) : setConfirming(true)) }, confirming ? t('action.confirmRemove') : t('action.remove')),
                  ),
            )
          : null,
      )
    }

    // ── models (inference) ───────────────────────────────────────────────
    function describeBudget(value, t) {
      if (!value || value.ok !== true) return null
      if (!Array.isArray(value.windows) || value.windows.length === 0) return t('inf.budgetNone')
      const left = Math.min(...value.windows.map(leftOf))
      const windows = value.windows.map((w) => `${t(`window.${w.id}`)} ${formatPercent(leftOf(w))}`).join(', ')
      return t('inf.budget', { left: formatPercent(left), windows })
    }

    const NONE_ID = '__none__'
    /** Selector like Settings → Language: a button with the current value and a DSH Menu. */
    function SourcePicker({ t, value, options, disabled, onChange }) {
      const [open, setOpen] = React.useState(false)
      const current = options.find((o) => o.id === value) ?? options[0]
      if (UI?.Menu === undefined) {
        // fallback (tests, builds without primitives): the browser's own select
        return h(
          'select',
          { className: 'opfh-selector', 'aria-labelledby': 'opfh-inference-label', value, disabled, onChange: (e) => onChange(e.target.value) },
          options.map((o) => h('option', { key: o.id, value: o.id, disabled: o.disabled }, o.label)),
        )
      }
      const Chevron = UI.IconChevronDownOutlineRegular
      return h(UI.Menu, {
        open,
        onClose: () => setOpen(false),
        items: options.map((o) => ({ id: o.id === '' ? NONE_ID : o.id, label: o.label, disabled: o.disabled })),
        selectedId: value === '' ? NONE_ID : value,
        onSelect: (id) => {
          setOpen(false)
          const next = id === NONE_ID ? '' : id
          if (next !== value) onChange(next)
        },
        align: 'end',
        portal: true,
        anchor: h(
          'button',
          { type: 'button', className: 'opfh-selector', 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-labelledby': 'opfh-inference-label', disabled, onClick: () => setOpen((v) => !v) },
          h('span', { className: 'opfh-selector-label' }, current.short ?? current.label),
          Chevron ? h(Chevron, { className: 'opfh-selector-chevron' }) : null,
        ),
      })
    }

    function InferenceSection({ t, config, status, disabled, write, act, remote, store }) {
      const usage = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
      const [busy, setBusy] = React.useState(false)
      const [key, setKey] = React.useState('')
      const [keyError, setKeyError] = React.useState(null)
      const instances = config.instances ?? []
      const views = new Map((status?.instances ?? []).map((i) => [i.name, i]))
      const inf = status?.inference ?? {}
      const selected = config.inference ?? ''
      const sync = status?.sync
      const refresh = async () => {
        setBusy(true)
        await act(undefined, 'sync')
        await store.check().catch(() => {})
        setBusy(false)
      }
      React.useEffect(() => {
        if (selected) store.check().catch(() => {})
      }, [selected, inf.status])

      let line = null
      if (!selected) line = { text: t('inf.none.hint') }
      else if (inf.status === 'issuing') line = { text: t('inf.issuing') }
      else if (inf.status === 'error') line = { text: inf.message ?? t('failed'), tone: 'error' }
      else if (inf.status === 'ready') {
        const parts = [t('inf.models', { n: inf.models ?? 0 })]
        if (sync?.at && (sync.status === 'updated' || sync.status === 'unchanged')) parts.push(t('inf.synced', { time: formatTime(sync.at) }))
        if (sync?.status === 'skipped' || sync?.status === 'failed') parts.push(t('inf.syncFailed', { reason: sync.reason ?? '' }))
        const budget = describeBudget(usage.value, t)
        if (budget) parts.push(budget)
        line = { text: parts.join(' · '), tone: sync?.status === 'skipped' || sync?.status === 'failed' ? 'warn' : undefined }
      } else line = { text: t('inf.pending') }
      const needsKey = selected && inf.status === 'error' && (inf.code === 'token' || inf.code === 'denied') && inf.keyRef && !inf.keyConfigured

      return h(
        Section,
        { id: 'inference', title: t('inf.title'), desc: t('inf.desc') },
        h(
          'div',
          { className: 'opfh-card', 'data-kind': 'source' },
          h(
            'div',
            { className: 'opfh-source' },
            h(
              'div',
              { className: 'opfh-source-text' },
              h('div', { className: 'opfh-source-title', id: 'opfh-inference-label' }, t('inf.label')),
              h(
                'p',
                { className: 'opfh-line', 'data-tone': line?.tone, role: 'status' },
                line?.text ?? '',
                selected
                  ? h(
                      'button',
                      { type: 'button', className: 'opfh-link opfh-refresh', disabled: busy || disabled, title: t('inf.refresh.title'), onClick: refresh },
                      busy ? t('inf.refreshing') : inf.status === 'error' ? t('inf.retry') : t('inf.refresh'),
                    )
                  : null,
              ),
            ),
            selected && inf.status === 'error' && inf.code === 'signin' ? h(Button, { tone: 'primary', disabled: busy, onClick: () => act(selected, 'signin') }, t('action.signin')) : null,
            h(SourcePicker, {
              t,
              value: selected,
              disabled: disabled || instances.length === 0,
              onChange: (value) => write([{ op: 'set', path: ['inference'], value }]),
              options: [
                { id: '', label: t('inf.none') },
                ...instances.map((i) => {
                  const denied = views.get(i.name)?.inference === false
                  return { id: i.name, label: `${i.name} — ${hostOf(i.url)}${denied ? ` (${t('inst.noInference')})` : ''}`, short: i.name, disabled: denied && i.name !== selected }
                }),
              ],
            }),
          ),
          sync?.defaultModel ? h('p', { className: 'opfh-sub' }, t('inf.defaultMoved', sync.defaultModel)) : null,
          needsKey
            ? h(
                'div',
                { className: 'opfh-form' },
                h(
                  'div',
                  { className: 'opfh-field', 'data-wide': true },
                  h('label', { className: 'opfh-label', htmlFor: 'opfh-key' }, t('inf.key')),
                  h(TextInput, { id: 'opfh-key', className: 'opfh-input', type: 'password', autoComplete: 'new-password', spellCheck: false, value: key, disabled, placeholder: 'gwi_…', onChange: (e) => setKey(e.target.value.trim()) }),
                  h('p', { className: 'opfh-hint', 'data-tone': keyError ? 'error' : undefined }, keyError ?? t('inf.key.hint')),
                ),
                h(
                  'div',
                  { className: 'opfh-actions', 'data-wide': true },
                  h(
                    Button,
                    {
                      tone: 'primary',
                      disabled: disabled || busy || key === '',
                      onClick: async () => {
                        setBusy(true)
                        setKeyError(null)
                        try {
                          const result = await remote.credentials.set(inf.keyRef, key)
                          if (result && result.ok === false) throw new Error(result.error?.message ?? t('failed'))
                          setKey('')
                          await act(undefined, 'sync')
                        } catch (error) {
                          setKeyError(String(error?.message ?? error))
                        }
                        setBusy(false)
                      },
                    },
                    t('inf.key.save'),
                  ),
                ),
              )
            : null,
        ),
      )
    }

    // ── component settings ───────────────────────────────────────────────
    /** Settings of the components that are on; the components themselves are toggled in Plugins. */
    function ComponentSettings({ t, config, status, disabled, write }) {
      const active = new Set(Array.isArray(status?.components) ? status.components : [])
      const ttl = Number(config.promptCacheTtlMinutes) || 60
      const saved = String(config.compactMinTokens ?? 30000)
      const [minTokens, setMinTokens] = React.useState(saved)
      React.useEffect(() => setMinTokens(saved), [saved])
      const n = Number(minTokens)
      const invalid = minTokens.trim() === '' || !Number.isFinite(n) || n < 0
      const commit = () => {
        if (!invalid && String(n) !== saved) write([{ op: 'set', path: ['compactMinTokens'], value: n }])
      }
      const rows = []
      if (active.has('cachePill')) {
        rows.push(
          h(
            'div',
            { key: 'ttl', className: 'opfh-row opfh-setting' },
            h('div', { className: 'opfh-grow' }, h('div', { className: 'opfh-label' }, t('comp.ttl')), h('p', { className: 'opfh-hint' }, t('comp.ttl.hint'))),
            h(Segmented, {
              id: 'opfh-ttl',
              label: t('comp.ttl'),
              value: ttl === 5 ? 5 : ttl === 60 ? 60 : undefined,
              disabled,
              onChange: (v) => write([{ op: 'set', path: ['promptCacheTtlMinutes'], value: v }]),
              options: [
                { value: 5, label: '5m', title: t('comp.ttl.5') },
                { value: 60, label: '1h', title: t('comp.ttl.60') },
              ],
            }),
          ),
        )
      }
      if (active.has('compactSuggestion')) {
        rows.push(
          h(
            'div',
            { key: 'compact', className: 'opfh-row opfh-setting' },
            h('div', { className: 'opfh-grow' }, h('label', { className: 'opfh-label', htmlFor: 'opfh-compact-min' }, t('comp.compactMin')), h('p', { className: 'opfh-hint', 'data-tone': invalid ? 'error' : undefined }, invalid ? t('s.invalidNumberMin', { min: 0 }) : t('comp.compactMin.hint'))),
            h(TextInput, {
              id: 'opfh-compact-min',
              className: 'opfh-input opfh-input-short',
              short: true,
              type: 'text',
              inputMode: 'numeric',
              value: minTokens,
              disabled,
              ...(invalid ? { 'aria-invalid': true } : {}),
              onChange: (e) => setMinTokens(e.target.value),
              onBlur: commit,
              onKeyDown: (e) => e.key === 'Enter' && commit(),
            }),
          ),
        )
      }
      return h(
        Section,
        { id: 'components', title: t('comp.title'), desc: t('comp.desc') },
        rows.length > 0 ? h('div', { className: 'opfh-card' }, rows) : null,
      )
    }

    // ── advanced (collapsed; Save / Discard) ─────────────────────────────
    const ADVANCED_FIELDS = [
      { path: ['advanced', 'pollSeconds'], kind: 'number', min: 15, max: 3600 },
      { path: ['advanced', 'warnPercent'], kind: 'number', min: 0, max: 100 },
      { path: ['advanced', 'errorPercent'], kind: 'number', min: 0, max: 100 },
      { path: ['promptCacheTtlMinutes'], kind: 'number', min: 1, max: 1440 },
      { path: ['advanced', 'syncIntervalMinutes'], kind: 'number', min: 0, max: 10080 },
      { path: ['advanced', 'include'], kind: 'list' },
      { path: ['advanced', 'exclude'], kind: 'list' },
      { path: ['advanced', 'route'], kind: 'text' },
      { path: ['advanced', 'piAiEntry'], kind: 'text' },
      { path: ['advanced', 'timeoutMs'], kind: 'number', min: 1000, max: 120000 },
      { path: ['advanced', 'cacheMs'], kind: 'number', min: 0, max: 3600000 },
    ]
    for (const f of ADVANCED_FIELDS) f.key = f.path.join('.')

    const getIn = (obj, path) => path.reduce((o, k) => (o !== null && typeof o === 'object' ? o[k] : undefined), obj)
    const hasIn = (obj, path) => {
      let o = obj
      for (const k of path) {
        if (o === null || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, k)) return false
        o = o[k]
      }
      return true
    }
    function formatField(field, value) {
      if (field.kind === 'list') return Array.isArray(value) ? value.join(', ') : ''
      return value === undefined || value === null ? '' : String(value)
    }
    /** Draft → operation. `undefined` = invalid draft (blocks saving). */
    function parseDraft(field, draft) {
      if (draft.reset) return { op: 'unset', path: field.path }
      const text = String(draft.value).trim()
      if (field.kind === 'list') return { op: 'set', path: field.path, value: text === '' ? [] : text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) }
      if (text === '') return { op: 'unset', path: field.path }
      if (field.kind === 'number') {
        const n = Number(text)
        if (!Number.isFinite(n)) return undefined
        if (field.min !== undefined && n < field.min) return undefined
        if (field.max !== undefined && n > field.max) return undefined
        return { op: 'set', path: field.path, value: n }
      }
      return { op: 'set', path: field.path, value: text }
    }

    function FieldRow({ field, t, shown, overridden, invalid, disabled, onEdit, onReset }) {
      const id = `opfs-${field.key.replace(/\./g, '-')}`
      const label = t(`f.${field.key}`)
      const hintKey = `f.${field.key}.hint`
      const hint = t(hintKey)
      const hasHint = hint && hint !== hintKey
      const range = field.kind === 'number' ? (field.max !== undefined ? t('s.invalidNumber', { min: field.min ?? 0, max: field.max }) : t('s.invalidNumberMin', { min: field.min ?? 0 })) : ''
      return h(
        'div',
        { className: 'opfs-field' },
        h(
          'div',
          { className: 'opfs-head' },
          h('label', { className: 'opfs-label', htmlFor: id }, label),
          overridden ? h('span', { className: 'opfs-badges' }, h(Tag, { tone: 'neutral' }, t('s.overridden')), h(Button, { tone: 'quiet', disabled, onClick: onReset }, t('s.reset'))) : null,
        ),
        h(TextInput, {
          id,
          className: 'opfs-input',
          type: 'text',
          spellCheck: false,
          autoComplete: 'off',
          ...(field.kind === 'number' ? { inputMode: 'numeric' } : {}),
          ...(invalid ? { 'aria-invalid': true } : {}),
          value: shown,
          disabled,
          onChange: (e) => onEdit(e.target.value),
        }),
        invalid ? h('p', { className: 'opfs-invalid' }, range) : hasHint ? h('p', { className: 'opfs-hint' }, hint) : null,
      )
    }

    function AdvancedSection({ t, snap, form, disabled: locked }) {
      const [drafts, setDrafts] = React.useState({})
      const [phase, setPhase] = React.useState('idle') // idle | saving | saved | failed
      const disabled = locked || phase === 'saving'
      const rows = new Map()
      const ops = []
      let invalid = false
      for (const field of ADVANCED_FIELDS) {
        const draft = drafts[field.key]
        let shown = formatField(field, getIn(snap.value, field.path))
        let overridden = hasIn(snap.user, field.path)
        let bad = false
        if (draft !== undefined) {
          const op = parseDraft(field, draft)
          if (op === undefined) {
            bad = true
            invalid = true
          } else ops.push(op)
          shown = draft.reset ? formatField(field, getIn(snap.base, field.path)) : draft.value
          overridden = !draft.reset && op?.op !== 'unset'
        }
        rows.set(field.key, { shown, overridden, invalid: bad })
      }
      const dirty = ops.length > 0 || invalid
      const edit = (field, value) => {
        setPhase('idle')
        setDrafts((d) => {
          const next = { ...d }
          if (value === formatField(field, getIn(snap.value, field.path))) delete next[field.key]
          else next[field.key] = { value }
          return next
        })
      }
      const reset = (field) => {
        setPhase('idle')
        setDrafts((d) => {
          const next = { ...d }
          if (hasIn(snap.user, field.path)) next[field.key] = { reset: true }
          else delete next[field.key]
          return next
        })
      }
      const save = async () => {
        setPhase('saving')
        let ok = false
        try {
          ok = await form.mutate(ops, snap.revision)
        } catch {
          ok = false
        }
        if (ok) setDrafts({})
        setPhase(ok ? 'saved' : 'failed')
      }
      return h(
        'details',
        { className: 'opfh-details' },
        h('summary', { className: 'opfh-summary' }, h('span', { className: 'opfh-section-title' }, t('adv.title')), h('span', { className: 'opfh-section-desc' }, t('adv.desc'))),
        h(
          'div',
          { className: 'opfh-details-body' },
          ADVANCED_FIELDS.map((field) => h(FieldRow, { key: field.key, field, t, ...rows.get(field.key), disabled, onEdit: (v) => edit(field, v), onReset: () => reset(field) })),
          h(
            'div',
            { className: 'opfs-footer' },
            phase === 'failed' ? h('p', { className: 'opfs-failed', role: 'status' }, t('s.saveFailed')) : phase === 'saved' && !dirty ? h('p', { className: 'opfs-saved', role: 'status' }, t('s.saved')) : null,
            h(Button, { tone: 'quiet', disabled: !dirty || phase === 'saving', onClick: () => (setDrafts({}), setPhase('idle')) }, t('s.discard')),
            h(Button, { tone: 'primary', disabled: !dirty || invalid || disabled, onClick: save }, phase === 'saving' ? t('saving') : t('save')),
          ),
        ),
      )
    }

    function SettingsPage({ view, t, form, remote, store }) {
      const snap = React.useSyncExternalStore(form.subscribe, form.getSnapshot)
      const [status, reload] = useStatus(snap.revision)
      const [adding, setAdding] = React.useState(false)
      if (view === 'summary') return t('s.summary')
      if (snap.status === 'loading') return h('p', { className: 'opfh-note', role: 'status' }, t('s.loading'))
      if (snap.status !== 'ready') return h('p', { className: 'opfh-note', role: 'status' }, t('s.unavailable'))

      const disabled = !snap.writable
      const config = snap.value ?? {}
      const instances = Array.isArray(config.instances) ? config.instances : []
      const views = new Map((status?.instances ?? []).map((i) => [i.name, i]))
      const hub = status?.hub === true
      const write = async (ops) => {
        const ok = await form.mutate(ops, form.getSnapshot().revision)
        setTimeout(reload, 400)
        return ok
      }
      const writeInstances = (next, extra = []) => write([{ op: 'set', path: ['instances'], value: next }, ...extra])
      const act = async (instance, action) => {
        const result = await postJson(ACTION_ROUTE, { instance, action })
        reload()
        return result
      }

      return h(
        'div',
        { className: 'opfh-page', 'data-opfield-settings': true },
        disabled ? h('p', { className: 'opfh-note', role: 'status' }, snap.mode === 'memory' ? t('s.memory') : t('s.readOnly')) : null,
        status && status.ok !== false && !hub ? h('p', { className: 'opfh-note', 'data-tone': 'error', role: 'alert' }, t('s.noHub')) : null,
        status?.ok === false ? h('p', { className: 'opfh-note', 'data-tone': 'error', role: 'status' }, t('s.hostMissing')) : null,
        h(
          Section,
          {
            id: 'instances',
            title: t('inst.title'),
            desc: t('inst.desc'),
            action: h(Button, { tone: adding ? 'quiet' : undefined, disabled, onClick: () => setAdding((v) => !v) }, adding ? t('cancel') : t('inst.add')),
          },
          adding
            ? h(
                'div',
                { className: 'opfh-card' },
                h(InstanceForm, {
                  t,
                  taken: instances.map((i) => i.name),
                  disabled,
                  onCancel: () => setAdding(false),
                  onSave: async (instance) => {
                    const first = instances.length === 0
                    // The first instance also serves models unless the user picks otherwise.
                    const ok = await writeInstances([...instances, instance], first && !config.inference ? [{ op: 'set', path: ['inference'], value: instance.name }] : [])
                    if (ok) setAdding(false)
                    return ok
                  },
                }),
              )
            : null,
          instances.length === 0 && !adding ? h('p', { className: 'opfh-note' }, t('inst.empty')) : null,
          h(
            'ul',
            { className: 'opfh-list' },
            instances.map((instance) =>
              h(InstanceCard, {
                key: instance.name,
                t,
                instance,
                view: views.get(instance.name),
                hub,
                disabled,
                act,
                onUpdate: (next) => writeInstances(instances.map((i) => (i.name === instance.name ? next : i))),
                onRemove: (gone) => writeInstances(instances.filter((i) => i.name !== gone.name), config.inference === gone.name ? [{ op: 'set', path: ['inference'], value: '' }] : []),
              }),
            ),
          ),
        ),
        h(InferenceSection, { t, config, status, disabled, write, act, remote, store }),
        h(ComponentSettings, { t, config, status, disabled, write }),
        h(AdvancedSection, { t, snap, form, disabled }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const store = createStore()
        const UsagePill = makeUsagePill(store)
        const CachePill = makeCachePill(store)

        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'opfield-usage: dictionaries')

        ctx.effect(() => {
          document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)?.remove()
          const tag = document.createElement('style')
          tag.dataset.plugin = '@opfield/dsh-opfield'
          tag.dataset.pluginCss = CSS_ID
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'opfield-usage: styles')

        ctx.effect(() => {
          store.refresh(true)
          // Re-planned after every tick so a new `display.pollSeconds` applies without a reload.
          let timer = null
          const pollMs = () => Math.max(15, Number(displayOf(store.getSnapshot().value).pollSeconds) || POLL_MS / 1000) * 1000
          const tick = () => {
            if (store.size > 0 && document.visibilityState === 'visible') store.refresh(true)
            timer = setTimeout(tick, pollMs())
          }
          timer = setTimeout(tick, pollMs())
          const onVisible = () => {
            if (document.visibilityState === 'visible') store.refresh(false)
          }
          document.addEventListener('visibilitychange', onVisible)
          return () => {
            clearTimeout(timer)
            document.removeEventListener('visibilitychange', onVisible)
          }
        }, 'opfield-usage: polling')

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'opfield-usage', order: 1, locale: NS }, UsagePill),
        )
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'prompt-cache-warm', order: 2, locale: NS }, CachePill),
        )
        // Settings page on the bundle's Plugins page. Optional: a Harness without the
        // settings forms or the credentials remote simply shows no page.
        ctx.inject(['configForms', 'remote', 'remote.credentials'], (scope) => {
          if (scope.configForms === undefined || scope.remote?.credentials === undefined) return
          // The shared form is a class instance whose methods use `this`; hand React
          // bound functions, never the bare methods.
          const shared = scope.configForms.get(ENTRY_ID)
          const form = {
            getSnapshot: () => shared.getSnapshot(),
            subscribe: (listener) => shared.subscribe(listener),
            mutate: (ops, revision) => shared.mutate(ops, revision),
          }
          scope.slots.inject('plugins.bundle.config', () =>
            scope.slots.register(
              { name: 'plugins.bundle.config', key: BUNDLE, locale: NS, inject: () => ({ form, remote: scope.remote, store }) },
              SettingsPage,
            ),
          )
        })

        // Optional: without the command remote there is no way to compact, so no offer.
        ctx.inject(['remote', 'remote.commands'], (scope) => {
          const CompactBar = makeCompactBar(store)
          scope.slots.inject('conversation.input.dock', () =>
            scope.slots.register(
              {
                name: 'conversation.input.dock',
                id: 'opfield-compact-offer',
                order: 5,
                locale: NS,
                inject: (sessionId) => ({
                  sessionId,
                  // Same call the host plan chip uses for "/plan off"; null = accepted.
                  compact: async () => {
                    const result = await scope.remote.commands.execute(sessionId, '/compact', [])
                    if (!result.ok) return `${result.error.message} (${result.error.code})`
                    if (result.value === undefined) return en['compact.unknown']
                    return null
                  },
                }),
              },
              CompactBar,
            ),
          )
        })
      },
    }
  },
})
