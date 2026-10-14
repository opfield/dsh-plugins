/** Opfield component "Compact offer": switches its piece on while this entry is enabled in Plugins. */
export const name = 'opfield-compact-offer'
export const inject = ['opfield']

export function apply(ctx) {
  ctx.effect(() => ctx.opfield.component('compactSuggestion'), 'opfield: compact-offer')
}
