/**
 * Slot role of a token application (ADR 0015): what a CSS declaration does with the token, as a dsi:property value.
 * Deterministic from the CSS property, the part and the token's DTCG type. Undefined when no role fits (z-index,
 * transition target, outline-offset); those rows stay in the applications table but get no slot.
 */
export function roleOf(cssProperty: string, part: string, tokenType: string | undefined): string | undefined {
  const p = cssProperty.replace(/^-webkit-/, '');
  const color = tokenType === 'color';
  if (/^padding/.test(p)) return 'padding';
  if (/^(gap|row-gap|column-gap)$/.test(p)) return 'gap';
  if (/^margin/.test(p)) return 'margin';
  if (/radius$/.test(p)) return 'corner-radius';
  if (/^(min-|max-)?(height|block-size)$/.test(p)) return 'height';
  if (/^(min-|max-)?(width|inline-size)$/.test(p)) return 'width';
  if (/^background(-color)?$/.test(p)) return color ? 'background' : undefined;
  if (/^(color|caret-color|text-fill-color)$/.test(p)) return part === 'icon' ? 'icon' : 'text';
  if (p === 'fill') return 'icon';
  if (/^(border|outline)/.test(p) && p !== 'outline-offset') return color ? 'border' : tokenType === 'dimension' ? 'border-width' : undefined;
  if (p === 'box-shadow') return tokenType === 'shadow' || !tokenType ? 'shadow' : color ? 'border' : undefined;
  if (p === '--md-elevation-level') return 'elevation-level';
  if (/^(font-size|font-weight|font-family|line-height|letter-spacing)$/.test(p)) return p;
  if (p === 'opacity') return 'opacity';
  return undefined;
}

/** Concept of a slot: dsi:concept/<domain>/component-<c>/part-<p>/property-<role>[/state-<s>]. */
export function slotConcept(component: string, part: string, role: string, state: string | undefined, domainOf: (role: string) => string | undefined): string | undefined {
  const domain = ['background', 'text', 'icon', 'border'].includes(role) ? 'color' : domainOf(role);
  if (!domain) return undefined;
  return `dsi:concept/${domain}/component-${component}/part-${part}/property-${role}${state ? `/state-${state}` : ''}`;
}
