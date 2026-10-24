// The UI layer (mw-e00.23): DOM HUD and menus over the canvas. API tour and rules:
// docs/design/ui.md. Nothing in here reads or writes sim state: HUD widgets take
// view models, screens report `pausesSim` / `capturesInput`, and src/game wires both to the loop.
export const layer = 'ui' as const;

export * from './class-select';
export * from './combat-hud';
export * from './comfort';
export * from './components/controls';
export * from './components/list';
export * from './components/overlays';
export * from './components/tabs';
export * from './container-window';
export * from './death-fade';
export * from './death-screen';
export * from './focus';
export * from './frame-data';
export * from './gallery';
export * from './hud';
export * from './input';
export * from './interact-prompt';
export * from './inventory';
export * from './item-icons';
export * from './kit-panel';
export * from './pause-menu';
export * from './lock-marker';
export * from './target-hud';
export * from './pickup-toasts';
export * from './quick-slots';
export * from './reticle';
export * from './save-menus';
export * from './screens';
export * from './shop-window';
export * from './slice-complete';
export * from './testing/overflow';
export * from './tokens';
export * from './water-hud';
