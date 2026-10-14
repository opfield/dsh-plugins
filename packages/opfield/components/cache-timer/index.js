/** Opfield component "Prompt cache timer": switches its piece on while this entry is enabled in Plugins. */
export const name = 'opfield-cache-timer'
export const inject = ['opfield']

export function apply(ctx) {
  ctx.effect(() => ctx.opfield.component('cachePill'), 'opfield: cache-timer')
}
