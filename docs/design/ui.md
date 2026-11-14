# UI layer: HUD, menus, focus and test harness

Bead `mw-e00.23` (anchor for every HUD and menu bead). Code: `src/ui`, glue in `src/game/ui`, gallery
page `testbed/ui.html`. Visual rules come from the style bible §9. This page is the API tour.

## Rules

1. **The UI never mutates sim state.** HUD widgets take immutable view models. Screens only report
   what is open (`pausesSim`, `capturesInput`). Player intent reaches the sim as action frames, never
   through the UI.
2. **One UI root, DOM over the canvas.** `new UiRoot(container)` mounts `.vb-ui` with two layers:
   - `ui.hud`: HUD widgets. Not focusable, and pointer events pass through to the game.
   - `ui.menus`: the screen stack.
3. **Colour, size and motion come only from tokens.** Tokens are CSS custom properties on `.vb-ui`
   (`src/ui/tokens.ts`). To restyle, override a token on the root. Never hard-code a colour in a
   component.
4. **Menu navigation does not depend on gameplay bindings.** The UI input adapter uses fixed keys and
   pad buttons, so remapping gameplay can never lock a player out of the menus.

## Screen stack

```ts
const screen = ui.push({
  id: 'inventory',          // data-screen, used by tests
  label: 'Inventory',       // accessible name (role=dialog)
  content: panelElement,
  pausesSim: true,          // loop stops stepping while open
  capturesInput: true,      // default; gameplay frames withheld, intents come here
  modal: false,             // true: backdrop + aria-modal
  onBack: () => false,      // return true to keep the screen open on back
  onIntent: (intent) => false,
  onClose: () => {},
});
screen.close(); ui.pop(); ui.clear();
ui.subscribe(({ capturesInput, pausesSim }) => { /* … */ });
```

- **Push:** remembers what had focus, makes every screen below `inert` (the focus trap), and focuses
  the new screen's `[data-autofocus]` element, or else its first focusable element.
- **Pop:** restores focus to the remembered element. Listeners are notified synchronously, so
  capture is released on the same frame.

## Intents

| Intent | Keyboard | Gamepad (standard mapping) | Default action |
|---|---|---|---|
| `up/down/left/right` | arrows (repeat) | D-pad, left stick (repeat 400 ms / 120 ms) | spatial focus move |
| `confirm` | Enter, Space | A | `click()` the focused element |
| `back` | Esc | B | `onBack`, else close the screen |
| `tabPrev/tabNext` | Q/E, PageUp/PageDown | LB/RB | first tab strip on the screen |
| `secondary` | R | X | none: the screen's own second action (the container window's Take All) |
| `next/prev` | Tab / Shift+Tab | — | Tab order, wrapping inside the screen |

An intent is routed in this order:

1. The focused element receives it first, as a cancelable, bubbling `ui-intent` DOM event. Use
   `onIntent(el, handler)`; a handler returns true to consume the intent. For example, a slider
   consumes left/right and a list consumes up/down.
2. If nothing consumed it, the screen's `onIntent` gets it.
3. If the screen doesn't consume it either, the default action from the table runs.

With no capturing screen open, `ui.intent()` returns false and the key's browser default is left
alone. Attach input with `ui.attachInput({ window, navigator, now })`, then call `poll()` once per
animation frame to read the pad. A pad that disconnects reads as no pad: nothing throws, and focus
stays where it is.

**Spatial navigation** (`src/ui/focus.ts`) only considers candidates that lie wholly beyond the
focused element's edge in the pressed direction. It scores each one as the gap along the direction
plus twice the sideways gap. When nothing lies beyond, focus stays put. Lay screens out so every
control has a neighbour in some direction: the gallery e2e test proves reachability with a BFS.

## Components (`src/ui/components`)

| Factory | Role | Notes |
|---|---|---|
| `button({label, onPress, variant, autofocus})` | button | `variant: 'warning'` for destructive actions |
| `toggle({label, checked, onChange})` | switch | |
| `slider({label, min, max, step, value, format, onChange})` | slider | left/right step it |
| `select({label, options, value, onChange})` | spinbutton | game-style picker; left/right/confirm cycle |
| `tabs({label, tabs, selected, onChange})` | tablist | roving tabindex; LB/RB from anywhere |
| `new VirtualList({label, items, text, columns, visibleRows, onSelect})` | listbox | virtualised list or grid; rows sized in `em` |
| `attachTooltip(target, text)` | tooltip | shown on focus or hover; `aria-describedby` |
| `new ToastHost()` → `show(text, {tone, durationMs})` | status | polite live region; put it in `ui.hud` |
| `confirmDialog(ui, {title, body, …})` → `Promise<boolean>` | modal dialog | focus starts on Cancel |
| `glyphPrompt(glyph, action)` | — | glyph text comes from `UI_INTENT_GLYPHS` or the e02 `inputGlyph` |

## HUD binding (`src/ui/hud.ts`)

```ts
const vitals = new VitalsHud({ slots: 4 });
ui.hud.append(vitals.element);
const binding = new HudBinding((snapshot) => deriveVitals(snapshot), [vitals]);
// in the loop's draw callback:
binding.frame(latestSnapshot, frame.timeMs);
```

- `select` must be pure. It runs again only when the snapshot object changes.
- Each widget writes the DOM only when a shown value changed (`WriteCache`). An idle HUD therefore
  costs zero DOM writes.
- `Meter` draws the delayed-damage trail, which snaps under reduced motion.
- `Meter` options: `trailDrainMs` drains the trail over a fixed time whatever its size, `flash(nowMs)`
  sets `data-flash` for `flashMs`, and `lowBelow` sets `data-low` below that fraction of max. Every
  timer runs on the `nowMs` passed to `update`, so tests step it without wall time.
- `CombatHud` (`src/ui/combat-hud.ts`, mw-e04.10) is the player's health and stamina bars, top-right.
  Health has a chip that holds 500 ms and drains over the next 500 ms, and it pulses below 25 %.
  Stamina flashes for 300 ms on `staminaRejected(nowMs)`. `damageFrom(bearing, nowMs)` shows an arc
  on a ring around the screen centre (0° ahead, clockwise) that fades over 1.5 s. Bar sizes are inline
  pixels from `combatHudLayout(scale)`, where scale is the `accessibility.hudScale` setting (75–200 %).
  The glue is `attachCombatHud` in `src/game/combat/combat-hud.ts`. It reads the player's health and
  stamina each frame and turns `ActionRejected{reason:"stamina"}` and `DamageApplied` into feedback.
  Only hits from outside the camera's horizontal field of view get an arc.
- `InteractPrompt` (`src/ui/interact-prompt.ts`) is the contextual Interact prompt (`[E] Pull lever`,
  greyed with a reason when unavailable, a bar for holds); see [interaction](interaction.md).
- `LockMarker` (`src/ui/lock-marker.ts`, mw-e02.16) is the lock-on ring. Its model is the locked entity
  and a HUD-pixel position; `lockMarkerModel` in `src/game/player` projects the target's lock point
  through the drawn camera each frame. It hides when nothing is locked or the point is behind the
  camera, and its colour is the `--ui-color-lock` token (wayfinder gold).

## Game glue (`src/game/ui`)

`createUiGameBridge({ ui, sampleCommands, drain })` returns three things:

- `sampleCommands` hands the loop the gameplay frames, or none while a screen captures input.
- `simPaused` goes to `createGameLoop({ simPaused })`. While it returns true, the loop renders but
  doesn't step, and paused time is discarded.
- `frame()` drains gameplay input while paused, so keys pressed in a menu never leak into the game.

`src/main.ts` also releases pointer lock whenever a screen starts capturing input.

## Comfort hooks (`src/ui/comfort.ts`)

- **Text size:** `setTextScale(ui.element, 0.8…2.0)` sets `--ui-text-scale`. Every font size and
  every `em`-sized row follows it.
- **Motion:** `setMotionPreference(ui.element, 'system' | 'reduce' | 'full')` sets the motion
  preference. `reducedMotion(root, matchMedia)` reports the effective state for scripted motion.
- The settings UI that calls these belongs to mw-e31.

## Settings and the options menu (`src/game/settings`, mw-e31.1)

```ts
const settings = createSettingsStore({ storage: () => globalThis.localStorage });
settings.on('audio.master', (volume) => mixer.setMaster(volume)); // once per actual change
settings.set('camera.invertY', true);   // applies at once, then persists
settings.reset('camera');               // only this category returns to defaults
openOptionsMenu(ui, settings, { category: 'audio' });
```

- **Schema** (`schema.ts`): categories `controls`, `camera`, `display`, `audio`, `accessibility`,
  `gameplay`. Each setting has a kind (`toggle`, `slider`, `select`, `keybind` placeholder), a default,
  a label and help text, and a range or choices. Types and a strict zod schema are derived from it, and
  the options menu builds its controls from the same metadata.
- **Loading is lenient**: unknown keys and categories are dropped, an out-of-range number is clamped,
  any other bad value falls back to its default, and every repair logs a warning.
- **Versioning**: stored as `{ version, settings }` under `vesper-bell.settings`. Renaming, moving or
  re-scaling a setting bumps `SETTINGS_VERSION` and adds a step to `SETTINGS_MIGRATIONS` (one step per
  version, as with save sections). Adding a setting needs no migration.
- **Storage refused** (blocked site data, private mode, quota): the store runs in memory for the
  session (`persistent` is false, one warning) and never throws. `#app[data-settings-store]` reports
  `local` or `memory`.
- Settings are per-browser, not per-save. The sim never reads the store: difficulty assists reach it
  as injected config.

## Inventory screen and quick slots (`src/ui/inventory.ts`, `src/game/items/inventory-screen.ts`, mw-e17.10)

```ts
const inventory = openInventory(ui, {
  model,                       // InventoryViews.model(world, player): stacks newest first
  onAction: (request) => submit(inventoryActionCommand(player, requestAction(request))),
});
inventory.update(nextModel);   // after a sim step that changed the pack
inventory.say('You can’t let go of that: someone is counting on it.');
quickSlots.update(views.quickSlots(world, player)); // QuickSlotHud, bottom centre
```

- **Tabs:** All, Weapons & Armor, Tools, Consumables, Books, Keys, Quest & Artifacts. The model says
  which tabs list an item (its category's; quest items also go in Quest & Artifacts). Q/E,
  PageUp/PageDown or LB/RB switch tabs from anywhere on the screen.
- **Grid:** a listbox of item cards with a roving tabindex, so it is one Tab stop. Directions move
  between cards spatially (`FocusManager.rect` gives the component the same geometry as screen
  navigation), and at the grid's edge the intent goes back to the screen. A card shows a placeholder
  category icon (`src/ui/item-icons.ts`, until the e37 icon beads land), the name, the count, and
  badges for stolen (a red hand), equipped (E) and quick slot (its number). The accessible name lists
  them. A stolen card's tooltip, shown on focus or hover and linked as its description, names the
  owner ("Stolen from the Warden", or just "Stolen").
- **Inspect card:** the focused item's name, category, value, flavour text (item data's `description`)
  and "Lets you": its verbs, written from its data as verbs ("Restore health (30)", "Throw (flammable,
  liquid)", "Pick Locks while carried", "Wear (8 kg while worn)"). Only worn armor has a weight; the
  pack itself is weightless.
- **Actions:** confirm or a click opens the card's context menu, a modal screen
  (`inventory-actions`): Use, Assign to quick slot, Remove from quick slot, Equip or Unequip, Drop,
  Throw, as the item's rules allow. Assign opens a slot picker (`inventory-assign`). The choice goes to
  the sim as an `item.inventoryAction` command (`src/sim/items/inventory-actions.ts`), routed through
  the consumables, world items and equipment rules. Assigning moves an item out of any other slot.
  A refusal comes back as `item.inventoryAction` with a reason, and the screen shows it on its status
  line.
- **Pausing:** the screen pauses the sim. A command it queues still runs: the frame loop's
  `stepWhilePaused` runs exactly one step on a paused frame while commands are waiting, so the screen
  updates with the result while it stays open.
- **Empty:** an empty pack shows "Your pack is empty…" instead of the grid; an empty tab says so too.
- **Opening:** the Inventory action (I, View) toggles the screen. While the screen is open, keyboard
  gameplay input isn't sampled, because the menu releases pointer lock, so the glue closes the screen
  on the action's own keys (`InventoryUi.keydown`). Back (Esc, B) closes the top menu, then the screen.
- **Text size:** every size is in `em`, and names wrap (`overflow-wrap: anywhere`), so the screen
  reflows at any text scale. The game applies `accessibility.textScale` to the UI root.
- **Quick slots HUD** (`QuickSlotHud`): four brass-rimmed circles at the bottom centre, each with the
  item's icon, the slot number and the units left. A depleted slot dims at 0 and refills when more of
  its item arrive. Sizes are inline pixels from `quickSlotLayout(hudScale)`, like the combat HUD.
  Until the controls bind the slots (mw-e17.17), the debug console's `quickslot <1–4>` uses one.
- **Readouts:** `#app[data-inventory]` is `open` or `closed`, and `#app[data-quick-slots]` holds
  each slot's `{label, count}` or null. The UI testbed opens the screen over a demo pack with
  `openScreen('inventory')`.

## Container window and pickup toasts (`src/ui/container-window.ts`, `src/ui/pickup-toasts.ts`, `src/game/items/container-window.ts`, mw-e18.4)

```ts
const window = openContainerWindow(ui, {
  model,                        // LootViews.windowModel(world, chest): title, gold, stacks in pack order
  onTake: (id) => submit(containerActionCommand(player, chest, { op: 'take', instanceId: id })),
  onTakeGold: () => submit(containerActionCommand(player, chest, { op: 'take-gold' })),
  onTakeAll: () => submit(containerActionCommand(player, chest, { op: 'take-all' })),
});
toasts.push(views.pickup(defId, count), nowMs); // PickupToasts in ui.hud, bottom-right
toasts.frame(nowMs);                             // every drawn frame: expires toasts
```

- **Opening:** Interact's Search on an unlocked container opens it in the sim and fires
  `container.searched`; `ContainerWindowController` opens the window after that step (never over
  another screen). The window pauses the sim and captures input; Back (Esc, B) or Close shuts it.
- **Rows:** one button per stack (icon, name, count) and one for the gold. Confirm or a click takes
  that stack; the window stays open and refreshes after the paused step that ran the command
  (`stepWhilePaused`), keeping focus on the same row or its neighbour. A refused take (a second
  unique) is said on its status line.
- **Take All:** focused when the window opens, so Interact then confirm loots a chest. R or X (the
  UI's `secondary` intent, a fixed menu key like Q/E) presses it from anywhere in the window. It
  closes the window at once, in the same frame, and the next step carries out the command.
- **Empty:** a container with nothing in it says "Empty"; Take All is disabled and focus starts on
  Close. (An opened, empty container's Search is greyed, so this is reached by taking the last
  stack.)
- **Sim:** every action is a `loot.containerAction` command (`src/sim/loot/containers.ts`), so
  looting is in the replay. A take that moved something fires `container.taken`; every command fires
  `container.action` with whether it worked and why not.
- **Toasts:** the player's pickups (world items, `item.pickedUp`; container takes, `container.taken`)
  become toasts: at most four, merged by definition with a count (a merge restarts its 3 s), the one
  due to go first making way when full. A unique artifact gets a gold-edged "Discovery" toast with
  its flavour line (item data's `description`) for 6 s; discoveries never make way, and a pickup with
  no room waits. The corner is a polite live region, sized in em times the HUD scale.
- **Readouts:** `#app[data-container-window]` is `open` or `closed`; `#app[data-pickups]` lists the
  visible toasts (`{text, count, discovery}`). The UI testbed has `openScreen('container')`,
  `openScreen('container-empty')` and `__ui.pickups()`.

## Class selection and the kit panel (`src/ui/class-select.ts`, `src/game/classes.ts`, mw-e19.5)

```ts
openClassSelect(ui, {
  // knight, archer, sorcerer, thief: pitch, 3 verbs, kit preview; locked unless playable
  cards: classCards(content, playableClasses(content, location.search, __DEBUG_CONSOLE__)),
  onConfirm: (id) => applyClass(world, player, id, createClassRules(content, capabilities)),
});
kitPanel.update(kitModel(world, player, content)); // HUD: class, gold, carried items
```

- **Cards** are a radio group (`role="radio"`, `aria-checked`). Directions move focus spatially;
  confirm or a click highlights the focused card and moves focus to Confirm, so a gamepad picks a
  class with A, A. Confirm is disabled, and so never a focus target, until a class is highlighted.
  The screen pauses the sim and captures input; Back does not close it.
- **Card text** comes from class data: `name`, `pitch` and the three `verbs`, plus the starting kit.
  Items have no localised names yet, so `itemLabel` shows `mana-draught` as "Mana draught".
- **Locked cards** (mw-e01.15): `game.playableClasses` (`src/content/data/game/game.json`; m1 ships
  `["knight"]`) lists the classes Confirm accepts. The others keep their text, greyed with a dashed
  border, a "Locked" badge and the reason "Not playable in this build yet" as the card's
  `aria-describedby`. They stay focusable (`aria-disabled="true"`), but confirm or a click never
  highlights one, and while one holds focus Confirm is disabled with the same reason (`title`,
  `aria-describedby`) and the status line says "<Class>: Not playable in this build yet". The first
  playable card takes focus on open. A build with the debug console unlocks every class with
  `?allclasses` (mw-e19.5's per-class tests use it); `?class=<locked id>` is refused with a warning.
- **In the game**: the title screen's New Game opens the screen over the start scene (mw-e01.2,
  below). `?newgame` opens it once the player has spawned in the `?scene=` scene; `?class=<id>`
  applies a class at boot without it. A `?scene=` URL with neither boots with no class, as before.
  `#app[data-player-class]` publishes the sim's `player.class`. The card art is mw-e37.125.

## Title menu and save screens (`src/ui/save-menus.ts`, `src/game/save/menus`, mw-e30.11)

```ts
const menus = new SaveMenus({ ui, world, store, registry, build, now, describe, warning,
  captureThumbnail, load: (pending) => deathReload.reload(pending), newGame });
await menus.openTitle();  // Continue (most recent save), New Game, Load
await menus.openSave();   // the ten manual slots
await menus.openLoad();   // every save, most recent first
```

- **Title menu.** With a save, Continue takes focus and is described by "Last save: …". With none,
  it stays in place, greyed and `aria-disabled`, and the tooltip "No saves yet" is its
  `aria-describedby`. New Game takes focus instead. A save list that cannot be read disables
  Continue with "Saves could not be read". Back never closes the title menu.
- **Slot lists.** One row per slot: a thumbnail (or a placeholder), the title and details, and the
  verb (Load or Save here) on the row's main button, with Delete to its right. Up and down move
  between rows, right reaches Delete, Enter presses and Esc closes the list. An empty Load list says
  so and focuses Back. A slot with no readable copy stays listed, disabled with its reason, so it
  can still be deleted.
- **Confirmations.** Saving over an occupied slot and deleting a save open `confirmDialog`, with
  focus on Cancel. Results show in the list's status line ("Saved to …", "Overwrote …",
  "Deleted …"), and storage failures show as an alert. After a redraw, focus stays on the same slot
  and action.
- **Memory fallback.** When saves live only in memory (`OpenedSaveStore.warning`), every slot screen
  shows that warning as an alert.
- **In the game.** `?menu=title|load|save` opens a menu at boot over the freshly built area, with
  the sim paused. Continue and Load reload into the save's area through the death screen's hand-off
  (`DeathReload.reload`). New Game closes the title and opens class selection over the same scene,
  with no reload (a scene without a player reloads with `?newgame` instead). The title shows the
  build SHA ("Build abc1234") under the menu. The thumbnail is read from the canvas straight after the
  next render. The e2e reads `#app[data-save-menu-saved]` (tick and hash) and
  `#app[data-save-menu-title|list|deleted]`. The pause menu (below) opens Save and Load too.
- **The front door (mw-e01.2).** A page that names no `?scene=`, `?newgame`, `?class=` or `?menu=`
  boots the game's start scene, `game.startScene` (`src/content/data/game/game.json`; the slice in
  m1, the mountain road from m3), with the title menu over it (`bootMenuRequest`,
  `src/game/save/menus/request.ts`). New Game → class select → Confirm leaves the player at the start
  scene's `player-start` with the class kit. Any of those parameters skips the title, so dev and e2e
  URLs (`?scene=testbed`, `?scene=slice&debug=1`, `?scene=testbed&newgame`) boot straight into a
  scene as before. **Owner decision (2026-10-03):** the default boot changed from the testbed to the
  title; the testbed stays one parameter away at `?scene=testbed`. Restarting the area after a death
  reloads with the area's `?scene=`, so it restarts the scene rather than showing the title. The e2e
  reads `#app[data-front-door]`: page-relative milliseconds when the title showed (`titleMs`), New Game
  was pressed (`newGameMs`) and the class was applied (`playableMs`).

## Slice-complete card (`src/ui/slice-complete.ts`, `src/game/ui/slice-complete.ts`, mw-e01.18)

When the fact `slice.complete` turns true, the next rendered frame opens a modal card: "Slice complete", the
run time (world ticks / tick rate, as `m:ss`), the class, and the completion autosave's state, with
"Return to title" focused. It captures input (the knight stops) but does not pause the sim, because the
sim loop writes the autosave. The save line reads "Progress saved." only once the write landed; a vetoed or
twice-failed write reads "This run was not saved." (and flips if a save lands later). Return to title waits
for a write in flight and then reloads into the front door. Loading a completed save restores the fact
without an event, so Continue does not show the card again. `#app[data-slice-complete]` is `shown`.

## Pause menu (`src/ui/pause-menu.ts`, `src/game/ui/pause.ts`, mw-e01.3)

```ts
const pause = new PauseController({ ui, canPause, saveBlocked, unsavedProgress, pauseKeys,
  openSettings, openSave, openLoad, quitToTitle, publish });
window.addEventListener('keydown', (e) => { if (pause.keydown(e)) e.preventDefault(); });
pause.pausePressed();          // the Pause action in a sampled gameplay frame (pad Menu, disconnect)
pause.drained(frame.pause.pressed); // each frame drained while the sim is paused
pause.pointerUnlocked();       // the player's pointer lock ended (Esc, alt-tab)
```

- **Opening.** Esc or P (the Pause binding), the pad's Menu, a pad disconnecting, or losing pointer
  lock while playing opens the menu, but only with no other screen open and a living player in play
  (not during the death beat or with the debug fly camera). The keydown listener runs after the UI's
  own, so an Esc that closed another screen (it is that screen's Back) never also pauses: screens
  stack, and Esc and B close the top one first.
- **Options.** Resume (focused on open), Settings (the options menu), Save (the Save screen), Load
  (the Load screen) and Quit to Title, one column: up and down reach each one and Enter or A
  presses it. Settings, Save and Load open over the menu, and Back returns to it with focus on the
  option that opened them. Resume, Back (Esc, B) and Pause again (P, Menu) resume. A Pause press
  recorded before the menu opened (the key that opened it, under pointer lock) is dropped.
- **Pausing.** The screen pauses the sim: the loop runs no steps while it is open, so the world
  clock stops and replays never see how long the game sat paused.
- **Save disabled.** While a safety veto objects (the autosave's, mw-e01.7: a creature in Combat),
  Save stays in place but is `aria-disabled`, with the reason ("Can't save during combat") shown
  under it as its `aria-describedby`. It is still focusable, so the d-pad reaches it, and pressing it
  does nothing. The vetoes are the autosave's own `SafetyVetoes`.
- **Quit to Title.** With progress since the last save or load (`SaveProgress`: the sim tick moved
  on since then; a new game counts from its start), a `confirmDialog` asks "Quit to title?" ("Progress
  since your last save will be lost.") with focus on Cancel. Confirming reloads into the front door
  (`titleSearch` drops `?scene=`, `?newgame`, `?class=` and `?menu=`), which tears the world down; the
  title's Continue then loads the latest save. The menu stays open, the sim paused, while the page
  leaves.
- **Readout.** `#app[data-pause]` is `open` or `closed`.

## Testing

- **Unit tests:** put `// @vitest-environment happy-dom` at the top of the file. happy-dom has no
  layout, so give elements fake boxes with `place(el, left, top, w, h)` and build the root with
  `new UiRoot(container, { focus: { rectOf: rectFromData } })`. `find(selector)` queries without
  null assertions. The helpers live in `src/ui/testing/layout.ts`.
- **Playwright** (`e2e/helpers/ui.ts`):

  | Helper | What it does |
  |---|---|
  | `openUiPage` | loads the UI test page |
  | `openScreen(page, id)` | opens a screen |
  | `navigate(page, steps, 'keyboard' \| 'gamepad')` | drives input; pair with `installVirtualPad` for the pad |
  | `focused` | reports the focused element |
  | `clippedText` | the overflow helper (`src/ui/testing/overflow.ts`) |
  | `seriousAxeViolations` | axe-core scan |
  | `focusRing` | reports the focus ring's contrast |

- **Component gallery:** `testbed/ui.html` exposes `window.__ui`. Add every new kit component to
  `src/ui/gallery.ts`, and the e2e suite then checks it for reachability, focus ring, axe and 2×
  text automatically. `?scale=2` sets the text scale; `?hudbench=N` runs the HUD perf probe
  (`e2e/ui-perf.spec.ts`).

## Dialogue screen (mw-e22.10)

`DialogueBox` (`src/ui/dialogue-box.ts`) is a HUD widget over a view model that the `Conversations`
controller (`src/game/conversation`) builds from the dialogue runtime; the controller owns the cursor,
the history and the keys, the widget owns the typing-out of a line.

- **Keys**: Enter or E continues (first it shows the rest of a line being typed), 1 to 9 picks, Up and
  Down move the cursor (or scroll the history), Enter takes the option under the cursor (a locked one
  does nothing), H toggles the history, Esc closes it. The pad: D-pad or stick, A, X for the history,
  B to close it. The mouse clicks an option, the line or the History button.
- **Text**: locked reasons, tags, odds and breakdowns are English from the UI string table
  (`src/content/strings.ts`, `logic.condition.*`, `dialogue.*`), formatted in `src/game/conversation/text.ts`.
  Tags are placeholder glyphs until the icons land (mw-e37.137).
- **Settings**: `accessibility.revealSpeed` (instant, slow, normal, fast), `accessibility.highContrast`
  (white on black, `data-contrast` on the UI root), `accessibility.textBackground` (the plate is at least
  90%), `accessibility.textScale`. The box scrolls instead of clipping at any size.
- **History** keeps every line said and option chosen for the session (200 entries), across
  conversations; it is not saved.
