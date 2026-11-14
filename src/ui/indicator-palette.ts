// Colour-blind palette presets for the UI's indicator colours (mw-e31.8). The rule behind them is the
// style bible's colour-blind safety line (§8, §9.3): colour never carries a cue alone, so every
// indicator also has a shape, a pattern, a sign or a label (see tokens.ts). These presets are the
// second line: they re-pick the indicator colours so that adjacent ones also differ in lightness, which
// every kind of colour vision shares. A preset is plain data (CSS token overrides plus the awareness
// indicator colours); `setIndicatorPalette` writes it onto the UI root, as the other comfort
// settings do, and the stylesheet needs no change. `default` is the art palette and overrides nothing.
//
// The simulation matrices are Machado, Oliveira and Fernandes (2009) at severity 1.0, applied to linear
// light; the contrast ratio is WCAG's.

export const INDICATOR_PALETTE_IDS = [
  'default',
  'deuteranopia',
  'protanopia',
  'tritanopia',
] as const;

export type IndicatorPaletteId = (typeof INDICATOR_PALETTE_IDS)[number];

/** The kinds of colour blindness the presets are built for. */
export type Deficiency = Exclude<IndicatorPaletteId, 'default'>;

/** The alert states that show an indicator, by name (src/render/stealth/indicator-shapes.ts). */
export type AwarenessColours = Readonly<Record<string, number>>;

export interface IndicatorPalette {
  /** UI token name (without `--`) → CSS colour. */
  readonly tokens: Readonly<Record<string, string>>;
  /** The awareness indicator fill per alert state, 0xRRGGBB; empty = the art palette's own. */
  readonly awareness: AwarenessColours;
}

const hex = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

/** A preset's three bar colours: health and mana are mid-dark, stamina between them is pale. */
function preset(
  health: number,
  stamina: number,
  mana: number,
  awareness: AwarenessColours,
): IndicatorPalette {
  return {
    tokens: {
      'ui-color-health': hex(health),
      'ui-color-stamina': hex(stamina),
      'ui-color-mana': hex(mana),
      'ui-color-breath': hex(mana),
      'ui-color-damage': hex(health),
    },
    awareness,
  };
}

/** Light enough on the awareness backdrop under every deficiency, and told apart as well as five can be. */
const AWARENESS: AwarenessColours = Object.freeze({
  suspicious: 0xefe2c4,
  investigating: 0xe8a24a,
  searching: 0x4fa3a5,
  alerted: 0xe6794f,
  combat: 0xff6a45,
});

export const INDICATOR_PALETTES: Readonly<Record<IndicatorPaletteId, IndicatorPalette>> =
  Object.freeze({
    default: Object.freeze({ tokens: Object.freeze({}), awareness: Object.freeze({}) }),
    deuteranopia: preset(0xca5431, 0xfff8c1, 0x3c70ba, AWARENESS),
    protanopia: preset(0xc1472c, 0xebe0af, 0x3b68a6, AWARENESS),
    tritanopia: preset(0xcc3d5f, 0xf4e8c8, 0x1d747a, AWARENESS),
  });

/** Whether `value` names a preset. */
export function isIndicatorPaletteId(value: unknown): value is IndicatorPaletteId {
  return INDICATOR_PALETTE_IDS.includes(value as IndicatorPaletteId);
}

/** The preset's awareness colour for a state, or undefined when the art palette's own applies. */
export function awarenessColour(id: IndicatorPaletteId, state: string): number | undefined {
  return INDICATOR_PALETTES[id].awareness[state];
}

/**
 * Applies a preset to the UI root: its tokens become inline custom properties and `data-palette`
 * names it. Switching back to `default` removes whatever any preset set.
 */
export function setIndicatorPalette(root: HTMLElement, id: IndicatorPaletteId): void {
  for (const preset of Object.values(INDICATOR_PALETTES)) {
    for (const token of Object.keys(preset.tokens)) root.style.removeProperty(`--${token}`);
  }
  for (const [token, value] of Object.entries(INDICATOR_PALETTES[id].tokens)) {
    root.style.setProperty(`--${token}`, value);
  }
  if (id === 'default') delete root.dataset['palette'];
  else root.dataset['palette'] = id;
}

type Triple = readonly [number, number, number];

const dot = (a: Triple, b: Triple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const MATRICES: Readonly<Record<Deficiency, readonly Triple[]>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** The relative luminance (0–1) of a 0xRRGGBB colour as seen with `deficiency`, or normally. */
export function seenLuminance(colour: number, deficiency?: Deficiency): number {
  const rgb: Triple = [
    toLinear((colour >> 16) & 0xff),
    toLinear((colour >> 8) & 0xff),
    toLinear(colour & 0xff),
  ];
  const [r, g, b] =
    deficiency === undefined
      ? rgb
      : (MATRICES[deficiency].map((row) =>
          Math.min(1, Math.max(0, dot(row, rgb))),
        ) as unknown as Triple);
  return dot([0.2126, 0.7152, 0.0722], [r, g, b]);
}

/** WCAG contrast ratio (1–21) between two 0xRRGGBB colours as seen with `deficiency`, or normally. */
export function seenContrast(a: number, b: number, deficiency?: Deficiency): number {
  const la = seenLuminance(a, deficiency);
  const lb = seenLuminance(b, deficiency);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The pairs of indicator colours that sit side by side in the HUD (the stacked bars). */
export const ADJACENT_INDICATORS: readonly (readonly [string, string])[] = Object.freeze([
  ['ui-color-health', 'ui-color-stamina'],
  ['ui-color-stamina', 'ui-color-mana'],
]);

/** Parses `#rrggbb` into 0xRRGGBB. */
export function parseHex(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}
