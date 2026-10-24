// UI design tokens and the kit's stylesheet (mw-e00.23). Every colour, size and duration the UI kit
// uses is a CSS custom property defined here, following the style bible's UI section (§9: parchment
// panels, ink text, hearth accent, ember warnings; §2.1 hex values). Components never hard-code a
// colour: a later art pass (mw-e37) or an accessibility setting (mw-e31) restyles the whole UI by
// overriding tokens on the UI root, e.g. `root.style.setProperty('--ui-color-accent', …)`.
//
// Two tokens are hooks for comfort settings (see comfort.ts): `--ui-text-scale` (0.8–2.0, every font
// size is multiplied by it) and `--ui-motion-scale` (0 under reduced motion, so every transition
// duration collapses to zero).

/** Style bible §2.1 core palette entries the UI uses. */
export const PALETTE = Object.freeze({
  ink: '#1E1B2E',
  dusk: '#3B3A5A',
  leaf: '#6B8F4E',
  sky: '#8FA8C8',
  parchment: '#EFE2C4',
  cream: '#FFF4DC',
  hearth: '#E8A24A',
  ember: '#C8553D',
  brass: '#C9A042',
  wayfinder: '#F2C94C',
});

/** Token name (without the leading `--`) → default value. */
export const UI_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  // Colour (style bible §9: parchment panels, ink text, hearth hover, ember warnings).
  'ui-color-panel': PALETTE.parchment,
  'ui-color-panel-raised': PALETTE.cream,
  'ui-color-text': PALETTE.ink,
  'ui-color-text-muted': PALETTE.dusk,
  'ui-color-accent': PALETTE.hearth,
  'ui-color-warning': PALETTE.ember,
  'ui-color-border': PALETTE.brass,
  'ui-color-focus': PALETTE.ink,
  'ui-color-backdrop': 'rgb(30 27 46 / 72%)',
  'ui-color-hud-text': PALETTE.parchment,
  'ui-color-hud-shadow': PALETTE.ink,
  'ui-color-bar-track': 'rgb(30 27 46 / 70%)',
  'ui-color-health': PALETTE.ember,
  'ui-color-stamina': PALETTE.leaf,
  'ui-color-breath': PALETTE.sky,
  'ui-color-bar-trail': PALETTE.hearth,
  'ui-color-lock': PALETTE.wayfinder,
  'ui-color-flash': PALETTE.cream,
  'ui-color-damage': PALETTE.ember,
  'ui-color-discovery': PALETTE.wayfinder,
  // Type (style bible §9.1; the fonts are self-hosted by mw-e37, system fallbacks until then).
  'ui-font-body': "'Alegreya Sans', 'Atkinson Hyperlegible', system-ui, sans-serif",
  'ui-font-heading': "'Cinzel', Georgia, serif",
  'ui-font-size': '16px',
  'ui-text-scale': '1',
  // Space, shape, motion.
  'ui-space-1': '0.25rem',
  'ui-space-2': '0.5rem',
  'ui-space-3': '1rem',
  'ui-space-4': '1.5rem',
  'ui-radius': '4px',
  'ui-focus-width': '3px',
  'ui-focus-offset': '2px',
  'ui-motion-scale': '1',
  'ui-motion-duration': '160ms',
});

/** Font size `n` × the base size × the text scale. */
const size = (n: number): string =>
  `calc(${String(n)} * var(--ui-font-size) * var(--ui-text-scale))`;

const MOTION = 'calc(var(--ui-motion-duration) * var(--ui-motion-scale))';

/** The kit's stylesheet: tokens on `.vb-ui` and every component's rules. */
export function uiStyleSheet(): string {
  const tokens = Object.entries(UI_TOKENS)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join('\n');
  return `
.vb-ui {
${tokens}
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: var(--ui-font-body);
  font-size: ${size(1)};
  line-height: 1.4;
  color: var(--ui-color-text);
}
.vb-ui[data-motion='reduce'] { --ui-motion-scale: 0; }
@media (prefers-reduced-motion: reduce) {
  .vb-ui:not([data-motion='full']) { --ui-motion-scale: 0; }
}
.vb-ui *, .vb-ui *::before, .vb-ui *::after { box-sizing: border-box; }
.vb-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: var(--ui-color-hud-text);
  text-shadow: 0 1px 2px var(--ui-color-hud-shadow);
}
.vb-menus { position: absolute; inset: 0; pointer-events: none; }
.vb-screen {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
.vb-screen[data-modal] { background: var(--ui-color-backdrop); }
.vb-screen[inert] { pointer-events: none; }
.vb-panel {
  max-width: min(60rem, 100%);
  max-height: 100%;
  overflow: auto;
  padding: var(--ui-space-4);
  background: var(--ui-color-panel);
  color: var(--ui-color-text);
  border: 2px solid var(--ui-color-border);
  border-radius: var(--ui-radius);
}
.vb-panel h1, .vb-panel h2, .vb-panel h3 {
  font-family: var(--ui-font-heading);
  margin: 0 0 var(--ui-space-2);
}
.vb-panel h1 { font-size: ${size(1.75)}; }
.vb-panel h2 { font-size: ${size(1.25)}; }
.vb-panel h3 { font-size: ${size(1.05)}; }
.vb-ui :focus { outline: none; }
.vb-ui :focus-visible,
.vb-ui[data-modality='nav'] :focus {
  outline: var(--ui-focus-width) solid var(--ui-color-focus);
  outline-offset: var(--ui-focus-offset);
}
.vb-button {
  font: inherit;
  color: var(--ui-color-text);
  background: var(--ui-color-panel-raised);
  border: 2px solid var(--ui-color-text);
  border-radius: var(--ui-radius);
  padding: var(--ui-space-1) var(--ui-space-3);
  cursor: pointer;
  transition: background-color ${MOTION};
}
.vb-button:hover, .vb-button:focus { background: var(--ui-color-accent); }
.vb-button[data-variant='warning'] { border-color: var(--ui-color-warning); }
.vb-button:disabled { opacity: 0.55; cursor: not-allowed; }
.vb-panel.vb-gallery { width: min(64rem, 100%); }
.vb-gallery-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18em, 1fr));
  gap: var(--ui-space-4);
  align-items: start;
}
.vb-row { display: flex; flex-wrap: wrap; gap: var(--ui-space-2); align-items: center; }
.vb-stack { display: flex; flex-direction: column; gap: var(--ui-space-3); }
.vb-list {
  position: relative;
  overflow-y: auto;
  border: 1px solid var(--ui-color-text-muted);
  border-radius: var(--ui-radius);
  background: var(--ui-color-panel-raised);
}
.vb-list-spacer { position: relative; }
.vb-list-item {
  position: absolute;
  left: 0;
  padding: var(--ui-space-1) var(--ui-space-2);
  cursor: pointer;
  white-space: nowrap;
}
.vb-list-item[aria-selected='true'] { background: var(--ui-color-accent); }
.vb-tabs [role='tablist'] { display: flex; gap: var(--ui-space-1); }
.vb-tab {
  font: inherit;
  color: var(--ui-color-text);
  background: transparent;
  border: 0;
  border-bottom: 3px solid transparent;
  padding: var(--ui-space-1) var(--ui-space-2);
  cursor: pointer;
}
.vb-tab[aria-selected='true'] { border-bottom-color: var(--ui-color-text); font-weight: 700; }
.vb-tabpanel { padding: var(--ui-space-2) 0; }
.vb-toggle {
  font: inherit;
  color: var(--ui-color-text);
  background: transparent;
  border: 0;
}
.vb-toggle, .vb-slider, .vb-select {
  display: inline-flex;
  align-items: center;
  gap: var(--ui-space-2);
  padding: var(--ui-space-1) var(--ui-space-2);
  border-radius: var(--ui-radius);
  cursor: pointer;
}
.vb-toggle-track {
  width: 2.5em;
  height: 1.3em;
  border-radius: 1em;
  background: var(--ui-color-text-muted);
  position: relative;
  transition: background-color ${MOTION};
}
.vb-toggle-track::after {
  content: '';
  position: absolute;
  top: 0.15em;
  left: 0.15em;
  width: 1em;
  height: 1em;
  border-radius: 50%;
  background: var(--ui-color-panel-raised);
  transition: transform ${MOTION};
}
.vb-toggle[aria-checked='true'] .vb-toggle-track { background: var(--ui-color-text); }
.vb-toggle[aria-checked='true'] .vb-toggle-track::after { transform: translateX(1.2em); }
.vb-slider-track {
  width: 10em;
  height: 0.5em;
  border-radius: 0.25em;
  background: var(--ui-color-text-muted);
  position: relative;
}
.vb-slider-fill { position: absolute; inset: 0 auto 0 0; background: var(--ui-color-text); border-radius: inherit; }
.vb-select-value { min-width: 6em; text-align: center; font-weight: 700; }
.vb-meter {
  position: relative;
  width: 14em;
  height: 0.75em;
  background: var(--ui-color-bar-track);
  border-radius: 0.4em;
  overflow: hidden;
}
.vb-meter-trail, .vb-meter-fill {
  position: absolute;
  inset: 0;
  transform-origin: left center;
}
.vb-meter-trail { background: var(--ui-color-bar-trail); }
.vb-meter-fill { background: var(--ui-color-health); }
.vb-meter[data-kind='stamina'] .vb-meter-fill { background: var(--ui-color-stamina); }
.vb-meter[data-kind='breath'] .vb-meter-fill { background: var(--ui-color-breath); }
.vb-water-hud {
  position: absolute;
  left: 50%;
  bottom: 22%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ui-space-2);
  pointer-events: none;
}
.vb-water-hud[hidden] { display: none; }
.vb-water-hud .vb-meter {
  width: 14em;
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--ui-color-hud-shadow);
}
.vb-water-hud .vb-meter-trail, .vb-water-hud .vb-meter-fill { border-radius: inherit; }
.vb-water-notice {
  color: var(--ui-color-hud-text);
  background: var(--ui-color-backdrop);
  padding: var(--ui-space-1) var(--ui-space-3);
  border-radius: var(--ui-radius);
  font-family: var(--ui-font-body);
}
.vb-water-notice:empty { display: none; }
.vb-combat-hud { position: absolute; inset: 0; pointer-events: none; }
.vb-combat-bars { position: absolute; display: flex; flex-direction: column; }
.vb-combat-bars .vb-meter {
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--ui-color-hud-shadow);
  overflow: visible;
}
.vb-combat-bars .vb-meter-trail, .vb-combat-bars .vb-meter-fill { border-radius: inherit; }
.vb-meter[data-flash] {
  box-shadow: 0 0 0 2px var(--ui-color-flash), 0 0 6px 2px var(--ui-color-warning);
}
.vb-meter[data-flash] .vb-meter-fill { background: var(--ui-color-flash); }
.vb-meter[data-low] {
  box-shadow: 0 0 0 2px var(--ui-color-warning);
  animation: vb-low-pulse calc(1000ms * var(--ui-motion-scale)) ease-in-out infinite alternate;
}
.vb-ui[data-motion='reduce'] .vb-meter[data-low] { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .vb-ui:not([data-motion='full']) .vb-meter[data-low] { animation: none; }
}
@keyframes vb-low-pulse {
  from { box-shadow: 0 0 0 2px var(--ui-color-warning); }
  to { box-shadow: 0 0 0 2px var(--ui-color-warning), 0 0 10px 4px var(--ui-color-warning); }
}
.vb-damage-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
.vb-damage-arc {
  position: absolute;
  inset: 0;
  border-radius: 50%;
}
.vb-damage-arc::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 6px solid transparent;
  border-top-color: var(--ui-color-damage);
  filter: drop-shadow(0 0 2px var(--ui-color-hud-shadow));
}
.vb-damage-arc[hidden] { display: none; }
.vb-target-bar {
  position: absolute;
  top: 1em;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25em;
  pointer-events: none;
}
.vb-target-bar[hidden] { display: none; }
.vb-target-name {
  color: var(--ui-color-hud-text);
  font-family: var(--ui-font-heading);
  font-size: 0.9em;
  text-shadow: 0 0 3px var(--ui-color-hud-shadow), 0 1px 2px var(--ui-color-hud-shadow);
}
.vb-target-bar .vb-meter {
  width: 18em;
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--ui-color-hud-shadow);
  overflow: visible;
}
.vb-target-bar .vb-meter-trail, .vb-target-bar .vb-meter-fill { border-radius: inherit; }
.vb-damage-numbers { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.vb-damage-number {
  position: absolute;
  left: 0;
  top: 0;
  margin: -0.6em 0 0 -1em;
  font-family: var(--ui-font-heading);
  font-size: 1.25em;
  font-weight: 700;
  color: var(--ui-color-hud-text);
  text-shadow: 0 0 3px var(--ui-color-hud-shadow), 0 1px 2px var(--ui-color-hud-shadow);
  white-space: nowrap;
}
.vb-damage-number[data-kind='taken'] { color: var(--ui-color-damage); }
.vb-damage-number[hidden] { display: none; }
.vb-lock-marker {
  position: absolute;
  left: 0;
  top: 0;
  width: 1.75em;
  height: 1.75em;
  margin: -0.875em 0 0 -0.875em;
  border: 3px solid var(--ui-color-lock);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--ui-color-hud-shadow), inset 0 0 0 1px var(--ui-color-hud-shadow);
  transition: opacity ${MOTION};
}
.vb-lock-marker::after {
  content: '';
  position: absolute;
  inset: 40%;
  border-radius: 50%;
  background: var(--ui-color-lock);
}
.vb-lock-marker[hidden] { display: none; }
.vb-slot {
  position: relative;
  width: 3em;
  height: 3em;
  border-radius: 50%;
  border: 2px solid var(--ui-color-border);
  background: var(--ui-color-bar-track);
  color: var(--ui-color-hud-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.vb-slot-cooldown {
  position: absolute;
  inset: 0;
  background: var(--ui-color-backdrop);
  transform-origin: bottom center;
}
.vb-slot-count {
  position: absolute;
  right: 0.2em;
  bottom: 0;
  font-size: ${size(0.75)};
  font-variant-numeric: tabular-nums;
}
.vb-icon { width: 1em; height: 1em; flex: none; vertical-align: -0.125em; }
.vb-panel.vb-inventory { width: min(60em, 100%); max-width: 100%; }
.vb-inventory-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--ui-space-2); }
.vb-inventory-head h1 { margin: 0; }
.vb-inventory-gold, .vb-inventory-hint, .vb-inventory-status { margin: 0; }
.vb-inventory-gold { font-weight: 700; font-variant-numeric: tabular-nums; }
.vb-inventory-hint { color: var(--ui-color-text-muted); font-size: ${size(0.875)}; }
.vb-inventory-status:empty { display: none; }
.vb-inventory [role='tablist'] { flex-wrap: wrap; }
.vb-inventory-body {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ui-space-3);
  align-items: flex-start;
}
.vb-inventory-items { position: relative; flex: 3 1 20em; min-width: 0; }
.vb-inventory-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10em, 1fr));
  gap: var(--ui-space-2);
  max-height: 24em;
  overflow-y: auto;
  padding: var(--ui-space-1);
}
.vb-inventory-grid[hidden], .vb-inventory-empty[hidden], .vb-item-details[hidden] { display: none; }
.vb-item-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--ui-space-1) var(--ui-space-2);
  padding: var(--ui-space-2);
  background: var(--ui-color-panel-raised);
  border: 2px solid var(--ui-color-text-muted);
  border-radius: var(--ui-radius);
  cursor: pointer;
}
.vb-item-card[aria-selected='true'] { border-color: var(--ui-color-text); background: var(--ui-color-accent); }
.vb-item-icon { width: 1.75em; height: 1.75em; grid-row: span 2; }
.vb-item-name { overflow-wrap: anywhere; line-height: 1.2; }
.vb-item-count { font-variant-numeric: tabular-nums; font-weight: 700; }
/* Badge and count glyphs are drawn from data-glyph, not DOM text: the card's aria-label already names
   them ("equipped", "3"), and axe's label-content-name-mismatch requires visible text to appear in it. */
.vb-item-count::before, .vb-item-badge[data-glyph]::before { content: attr(data-glyph); }
.vb-item-badges { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: var(--ui-space-1); }
.vb-item-badges:empty { display: none; }
.vb-item-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.4em;
  padding: 0 0.2em;
  border: 1px solid currentColor;
  border-radius: var(--ui-radius);
  font-size: ${size(0.75)};
  font-weight: 700;
}
.vb-item-badge[data-part='stolen'] { color: var(--ui-color-warning); border-color: var(--ui-color-warning); }
.vb-item-card[aria-selected='true'] .vb-item-badge[data-part='stolen'] { color: var(--ui-color-text); border-color: var(--ui-color-text); }
.vb-inventory-empty { margin: 0; padding: var(--ui-space-3); font-style: italic; }
.vb-item-details {
  flex: 2 1 14em;
  min-width: 0;
  gap: var(--ui-space-2);
  padding: var(--ui-space-3);
  background: var(--ui-color-panel-raised);
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius);
  overflow-wrap: anywhere;
}
.vb-item-details p, .vb-item-details ul, .vb-item-details h2, .vb-item-details h3 { margin: 0; }
.vb-item-details ul { padding-left: 1.2em; }
.vb-item-details-head { display: flex; align-items: center; gap: var(--ui-space-2); }
.vb-icon-large { width: 2.5em; height: 2.5em; }
.vb-item-meta { color: var(--ui-color-text-muted); }
.vb-item-stolen { font-weight: 700; }
.vb-item-stolen .vb-icon { color: var(--ui-color-warning); }
.vb-item-description { font-style: italic; }
.vb-item-note { font-size: ${size(0.875)}; }
.vb-panel.vb-item-menu { width: min(22em, 100%); }
.vb-item-menu h2 { overflow-wrap: anywhere; }
.vb-item-menu-actions .vb-button { width: 100%; text-align: left; }
.vb-quick-slots {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  pointer-events: none;
}
.vb-quick-slot {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 2px solid var(--ui-color-border);
  background: var(--ui-color-bar-track);
  color: var(--ui-color-hud-text);
}
.vb-quick-slot[data-state='empty'] { opacity: 0.6; }
.vb-quick-slot[data-state='depleted'] .vb-quick-slot-icon { opacity: 0.4; }
.vb-quick-slot-icon { width: 55%; height: 55%; }
.vb-quick-slot-key, .vb-quick-slot-count {
  position: absolute;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.vb-quick-slot-key { left: -0.15em; top: -0.15em; }
.vb-quick-slot-count { right: -0.15em; bottom: -0.15em; }
.vb-tooltip {
  position: absolute;
  z-index: 10;
  max-width: 20em;
  padding: var(--ui-space-1) var(--ui-space-2);
  background: var(--ui-color-text);
  color: var(--ui-color-panel);
  border-radius: var(--ui-radius);
  font-size: ${size(0.875)};
  pointer-events: none;
}
.vb-tooltip[hidden] { display: none; }
.vb-toasts {
  position: absolute;
  top: var(--ui-space-3);
  right: var(--ui-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
  pointer-events: none;
}
.vb-toast {
  max-width: 24em;
  padding: var(--ui-space-2) var(--ui-space-3);
  background: var(--ui-color-panel);
  color: var(--ui-color-text);
  border-left: 4px solid var(--ui-color-accent);
  border-radius: var(--ui-radius);
}
.vb-toast[data-tone='warning'] { border-left-color: var(--ui-color-warning); }
.vb-panel.vb-container { width: min(26em, 100%); }
.vb-container h1 { overflow-wrap: anywhere; }
.vb-container-rows[hidden], .vb-container-empty[hidden] { display: none; }
.vb-container-rows { gap: var(--ui-space-1); }
.vb-button.vb-container-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--ui-space-2);
  width: 100%;
  text-align: left;
}
.vb-container-icon { width: 1.5em; height: 1.5em; }
.vb-container-name { overflow-wrap: anywhere; line-height: 1.2; }
.vb-container-count { font-variant-numeric: tabular-nums; font-weight: 700; }
.vb-container-empty { margin: 0; padding: var(--ui-space-2) 0; font-style: italic; }
.vb-container-status, .vb-container-hint { margin: 0; }
.vb-container-status:empty { display: none; }
.vb-container-hint { color: var(--ui-color-text-muted); font-size: ${size(0.875)}; }
.vb-container-actions { flex-wrap: wrap; }
.vb-panel.vb-shop { width: min(40em, 100%); }
.vb-shop h1 { overflow-wrap: anywhere; margin: 0; }
.vb-shop-header { display: flex; align-items: center; gap: var(--ui-space-3); }
.vb-shop-portrait {
  flex: none;
  display: grid;
  place-items: center;
  width: 4.5em;
  height: 5.5em;
  border: 3px double var(--ui-color-border);
  border-radius: var(--ui-radius);
  background: var(--ui-color-panel-raised);
  font-family: var(--ui-font-heading);
  font-size: ${size(1.75)};
  color: var(--ui-color-text-muted);
}
.vb-shop-who { min-width: 0; }
.vb-shop-greeting { margin: 0; font-style: italic; overflow-wrap: anywhere; }
.vb-shop-crowns { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
.vb-shop-panel[hidden] { display: none; }
.vb-shop-rows { gap: var(--ui-space-1); max-height: 40vh; overflow-y: auto; padding: var(--ui-space-1); }
.vb-shop-item {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 7em;
  align-items: center;
  gap: var(--ui-space-2);
}
.vb-button.vb-shop-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 6em;
  align-items: center;
  gap: var(--ui-space-2);
  width: 100%;
  text-align: left;
}
.vb-shop-icon { width: 1.5em; height: 1.5em; }
.vb-shop-text { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--ui-space-2); min-width: 0; }
.vb-shop-item-name { overflow-wrap: anywhere; line-height: 1.2; font-weight: 700; }
.vb-shop-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  padding: 0 0.4em;
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius);
  font-size: ${size(0.8125)};
}
.vb-shop-badge-icon { width: 1em; height: 1em; }
.vb-shop-comparison, .vb-shop-reason { flex-basis: 100%; font-size: ${size(0.875)}; overflow-wrap: anywhere; }
.vb-shop-comparison { color: var(--ui-color-text-muted); }
.vb-shop-reason { color: var(--ui-color-warning); font-weight: 700; }
.vb-shop-price { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; overflow-wrap: anywhere; }
.vb-shop-stepper { display: inline-flex; align-items: center; justify-content: flex-end; gap: var(--ui-space-1); min-height: 1.5em; }
.vb-shop-qty { min-width: 2em; text-align: center; font-variant-numeric: tabular-nums; }
.vb-shop-step { min-width: 1.75em; padding-left: 0.25em; padding-right: 0.25em; }
.vb-shop-tooltip { white-space: pre-line; max-width: 22em; }
.vb-shop-empty { margin: 0; padding: var(--ui-space-2) 0; font-style: italic; }
.vb-shop-status, .vb-shop-hint { margin: 0; }
.vb-shop-status:empty { display: none; }
.vb-shop-hint { color: var(--ui-color-text-muted); font-size: ${size(0.875)}; }
.vb-pickups {
  position: absolute;
  right: var(--ui-space-3);
  bottom: var(--ui-space-4);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--ui-space-2);
  max-width: min(22em, 45%);
  pointer-events: none;
}
.vb-pickup {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  padding: var(--ui-space-1) var(--ui-space-3);
  background: var(--ui-color-panel);
  color: var(--ui-color-text);
  text-shadow: none;
  border-left: 4px solid var(--ui-color-accent);
  border-radius: var(--ui-radius);
}
.vb-pickup-icon { flex: none; width: 1.5em; height: 1.5em; }
.vb-pickup-text { display: flex; flex-direction: column; min-width: 0; }
.vb-pickup-name { font-weight: 700; overflow-wrap: anywhere; }
.vb-pickup[data-kind='discovery'] {
  padding: var(--ui-space-2) var(--ui-space-3);
  background: var(--ui-color-panel-raised);
  border: 2px solid var(--ui-color-discovery);
  border-left-width: 6px;
}
.vb-pickup[data-kind='discovery'] .vb-pickup-icon { width: 2.25em; height: 2.25em; }
.vb-pickup-heading {
  font-family: var(--ui-font-heading);
  font-size: ${size(0.75)};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-color-text-muted);
}
.vb-pickup-flavour { font-style: italic; overflow-wrap: anywhere; }
.vb-glyph-prompt { display: inline-flex; align-items: center; gap: var(--ui-space-1); }
.vb-glyph-prompt kbd {
  font: inherit;
  font-weight: 700;
  min-width: 1.6em;
  padding: 0 0.35em;
  text-align: center;
  border: 2px solid currentColor;
  border-radius: var(--ui-radius);
}
.vb-interact {
  position: absolute;
  left: 50%;
  top: 62%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ui-space-1);
  font-size: ${size(1.125)};
}
.vb-interact[hidden], .vb-interact [hidden] { display: none; }
.vb-interact[data-available='false'] .vb-glyph-prompt { opacity: 0.6; }
.vb-interact-reason { font-size: ${size(0.875)}; font-style: italic; }
.vb-interact-bar {
  width: 8em;
  height: 0.3em;
  border-radius: var(--ui-radius);
  background: var(--ui-color-bar-track);
  overflow: hidden;
}
.vb-interact-fill {
  display: block;
  height: 100%;
  background: var(--ui-color-hud-text);
  transform-origin: left center;
  transform: scaleX(0);
}
.vb-panel.vb-class-select { width: min(64rem, 100%); max-width: 100%; }
.vb-class-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13em, 1fr));
  gap: var(--ui-space-3);
}
.vb-class-card {
  gap: var(--ui-space-1);
  padding: var(--ui-space-3);
  background: var(--ui-color-panel-raised);
  border: 2px solid var(--ui-color-text-muted);
  border-radius: var(--ui-radius);
  cursor: pointer;
}
.vb-class-card p, .vb-class-card ul { margin: 0; }
.vb-class-card ul { padding-left: 1.2em; }
.vb-class-card[aria-checked='true'] { border-color: var(--ui-color-text); background: var(--ui-color-accent); }
.vb-class-card[data-locked] { border-style: dashed; background: var(--ui-color-panel); cursor: not-allowed; }
.vb-class-lock {
  align-self: flex-start;
  padding: 0 var(--ui-space-1);
  border: 1px solid currentColor;
  border-radius: var(--ui-radius);
  font-size: 0.85em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.vb-kit {
  position: absolute;
  right: var(--ui-space-3);
  top: var(--ui-space-3);
  max-width: 18em;
  font-size: ${size(0.875)};
}
.vb-kit[hidden] { display: none; }
.vb-kit p, .vb-kit ul { margin: 0; }
.vb-kit ul { padding-left: 1.2em; }
.vb-kit-title { font-weight: 700; }
.vb-panel.vb-title { min-width: min(22rem, 100%); text-align: center; }
.vb-title-menu {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--ui-space-2);
}
.vb-title-menu .vb-button { font-size: ${size(1.25)}; }
.vb-title-last { margin: 0; color: var(--ui-color-text-muted); font-size: ${size(0.875)}; }
.vb-title-build { margin: 0; color: var(--ui-color-text-muted); font-size: ${size(0.75)}; }
.vb-button[aria-disabled='true'] { opacity: 0.55; cursor: not-allowed; }
.vb-panel.vb-slots { width: min(48rem, 100%); }
.vb-slot-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
}
.vb-slot { display: flex; gap: var(--ui-space-2); align-items: stretch; }
.vb-slot-choose {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
  text-align: left;
  padding: var(--ui-space-2);
}
.vb-slot-thumb {
  flex: none;
  width: 8em;
  height: 4.5em;
  object-fit: cover;
  border: 1px solid var(--ui-color-text-muted);
  border-radius: var(--ui-radius);
  background: var(--ui-color-backdrop);
}
.vb-slot-text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.vb-slot-title { font-weight: 700; }
.vb-slot-detail, .vb-slot-reason { font-size: ${size(0.875)}; }
.vb-slot-reason { font-style: italic; }
.vb-slot-verb { flex: none; font-weight: 700; }
.vb-slot-empty { padding: var(--ui-space-3); font-style: italic; }
.vb-slot-warning, .vb-slot-error {
  margin: 0;
  padding: var(--ui-space-2) var(--ui-space-3);
  border-left: 4px solid var(--ui-color-warning);
  background: var(--ui-color-panel-raised);
}
.vb-slot-error[hidden] { display: none; }
.vb-slot-hint { margin: 0; color: var(--ui-color-text-muted); font-size: ${size(0.875)}; }
`;
}

export const UI_STYLE_ID = 'vb-ui-styles';

/** Adds the kit's stylesheet to `doc` once (later calls are no-ops). */
export function installUiStyles(doc: Document): void {
  if (doc.getElementById(UI_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = UI_STYLE_ID;
  style.textContent = uiStyleSheet();
  doc.head.append(style);
}

/** WCAG relative luminance of an `#rrggbb` colour. */
export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new RangeError(`not an #rrggbb colour: ${hex}`);
  const [r, g, b] = match.slice(1).map((part) => {
    const c = parseInt(part, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
