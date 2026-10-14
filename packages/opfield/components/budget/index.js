/** Opfield component "Opfield budget": switches its piece on while this entry is enabled in Plugins. */
export const name = 'opfield-budget'
export const inject = ['opfield']

export function apply(ctx) {
  ctx.effect(() => ctx.opfield.component('usagePill'), 'opfield: budget')
}
