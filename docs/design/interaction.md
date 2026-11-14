# Interaction: focus, affordances and the Interact verb

Bead `mw-e02.5` (anchor `e02-interaction`). Code: `src/sim/interaction` (rules), `src/ui/interact-prompt.ts`
(the HUD prompt), `src/game/player` (wiring). Owning systems (doors, containers, carrying, hiding,
talking) build on this page.

## Affordances

An object says what Interact can do to it with an `Interactable` component: a list of affordances,
in priority order.

```jsonc
// A scene spawn (src/content/types/interaction.ts); the same shape for props and creatures later.
"interact": {
  "affordances": [
    { "verb": "unlock", "requires": [{ "item": "iron-key" }], "reason": "Locked — needs Iron Key" },
    { "verb": "pick-lock", "hold": 1.5, "requires": [{ "capability": "lockpicking" }] }
  ],
  "range": 2.5,            // metres, optional
  "anchor": [0, 1, 0],     // focus point relative to the entity, optional
  "radius": 0.5            // bounding radius of the focus point, optional
}
```

- `verb` is one of the closed list in `AFFORDANCE_VERBS` (`use`, `open`, `close`, `pull`, `press`,
  `pick-up`, `read`, `search`, `stash`, `hide`, `leave`, `climb`, `talk`, `push`, `release`, `rotate`, `unlock`, `pick-lock`, `light`,
  `extinguish`). Add a verb in the sim; the content schema then fails to compile until it lists it.
- `requires`: every requirement must hold. A capability comes from the actor's class or skills, an
  item from what it carries (`Interactor` component: `capabilities`, `items`).
- An affordance the actor can't use is still shown, greyed, with `reason` (or "Needs <requirement>").
- **World properties add affordances**, so new objects need no code: `liftable` → pick up,
  `container` → search, `hideable` → hide, `pushable` → push (grab; Interact again releases; `release` and `rotate` are declared on
  the object, see `src/sim/push`). A declared affordance with the same verb
  replaces the derived one (to gate or relabel it). `hidden` objects are never focused.

## Focus

Once per tick, after the character controller, `interactionSystem` picks one focus for each
interactor (`src/sim/interaction/focus.ts`):

`score = 1 × (1 − d / range) + 1 × cos(angle)`, with `d` from the reach point (feet + 1 m) to the
object's bounding sphere, `range` 2.5 m (or the object's), and the angle measured in the horizontal
plane from the look yaw, at most 45°. An object behind anything solid is not a candidate (a ray
against the physics world, ignoring the object's own colliders via `bodiesOf`). The best score wins,
ties to the lower entity id; the current focus keeps it until a challenger beats it by more than 10%.
Focus and any hold in progress live on the actor's `interaction.focus` component, so they are
snapshotted and replayed.

## Interact

The tick's `interact` action acts on the focus's primary affordance, the first one the actor can use.
If there is none, nothing happens. Otherwise:

- `hold` 0: fires on press.
- `hold` > 0: fires once Interact has been held `round(hold × hz)` ticks (the press tick counts).
  Releasing early, losing focus or losing the affordance cancels it and nothing fires.

Firing emits `interacted { actor, target, verb, affordance }`. **Owning systems subscribe to it** and
act through properties and the stimulus API, never by pairing object types: a door system opens the
door whose `unlock` fired, a container system opens the search screen, and so on.

## Prompt

`interactionPrompt(world, actor)` is the prompt's model: headline label, availability, reason, hold
seconds and progress, and every affordance. `interactPromptModel` (src/game/player) adds the glyph of
the Interact binding for the device last used, and `InteractPrompt` (src/ui) shows it in the HUD
(`data-testid="interact-prompt"`). The game publishes the player's completed interactions on
`#app[data-interactions]` for the e2e tests.
