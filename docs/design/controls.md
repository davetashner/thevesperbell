# Controls

Keyboard + mouse and gamepad are equal first-class inputs (CONSTITUTION §10). Both feed the same
per-tick `ActionFrame` (`src/sim/input/action-frame.ts`) through the `ActionSampler`
(`src/game/input/sampler.ts`), are live at the same time, and are remapped with the same functions and
conflict rules (`src/game/input/bindings.ts`). Prompts show the glyphs of the device used last.

## Default layout

The gamepad layout is the W3C "standard" mapping, labelled for an Xbox controller (the owner's test
device; Xbox glyphs are the default). The same positions work on a PlayStation pad (A = Cross,
B = Circle, X = Square, Y = Triangle, RB = R1, RT = R2, LB = L1, LT = L2, RS = R3).
Defaults: `DEFAULT_BINDINGS` and `DEFAULT_PAD_BINDINGS`.

| Action           | Xbox controller                    | Keyboard + mouse         |
| ---------------- | ---------------------------------- | ------------------------ |
| Move             | Left stick                         | W A S D (or arrows)      |
| Look             | Right stick                        | Mouse                    |
| Jump             | A                                  | Space                    |
| Crouch           | RS click (R3; toggle)              | C (hold)                 |
| Slow walk        | Light left-stick push              | X (hold)                 |
| Dodge            | B                                  | R                        |
| Interact         | X                                  | E                        |
| Sprint           | LS click (toggle)                  | Left Shift (hold)        |
| Lock on          | Y (Triangle)                       | Q, middle click          |
| Cycle target     | RS flick left/right (while locked) | Tab (right); fast mouse swipe left/right |
| Right-hand attack | RB (R1)                           | Left click               |
| Strong attack (knight) | RT (R2)                      | 1                        |
| Left-hand action / parry (knight) | LB (L1)           | 3                        |
| Hold shield / block | LT (L2)                         | Right click              |
| Shield bash (knight) | Hold LT/L2, press RB/R1        | Hold right click, left click |
| Ability 2        | D-pad Right                        | 2                        |
| Ability 4        | D-pad Left                         | 4                        |
| Cast spell       | D-pad Up                           | V                        |
| Cancel cast      | D-pad Down                         | B                        |
| Spell slots 1-8  | (wheel)                            | Numpad 1-8; also 5-8 on the number row |
| Previous / next spell | (wheel)                       | [ and ]                  |
| Spell wheel (hold) | Guide (Xbox) / PS button         | Z (hold)                 |
| Inventory        | View                               | I                        |
| Drop item        | (inventory screen)                 | G                        |
| Throw item       | (inventory screen)                 | T                        |
| Pause            | Menu                               | Esc, P                   |

B is the souls-like dodge button (mw-e04.8). The shoulder controls form the combat cluster selected
in mw-e04.39: RB/R1 attacks with the right hand, RT/R2 performs the strong attack, LB/L1 uses the
left hand, and holding LT/L2 raises the equipped shield. RS/R3 toggles crouch; jump, sprint or a
second R3 click returns to standing when headroom permits. Lock-on therefore moved to Y/Triangle.
On the keyboard, R dodges: F stays free (it is the remapping example) and Ctrl or Alt
would trip browser shortcuts (Ctrl+W closes the tab).

**Dodge.** A dodge with a direction held rolls that way (relative to the camera; while locked on
the view faces the target, so relative to it); with no direction held it backsteps. Timing and i-frames:
`src/content/data/move/dodge-roll.json` and `backstep.json`; the rules: `src/sim/combat/dodge`. Cycle target has no pad button: flicking the right stick sideways
while locked on cycles instead (see Lock-on below), the usual convention.

**Left hand / parry.** L1/LB is the left-hand action. With the knight's current shield it parries
(ability 3; `DEFAULT_PARRY_BUTTON`, mw-e04.12); holding L2/LT blocks. Attack while a parried foe
reels within 2 m in front of you and the light attack becomes a riposte. Timing and numbers:
`src/content/data/move/shield-parry.json` and `sword-riposte.json`; the rules: `src/sim/combat/parry`.

**Strong attack.** The knight's strong/heavy attack is on R2/RT (ability 1; 1 on keyboard,
`DEFAULT_HEAVY_BUTTON`, mw-e04.13). Tap it for a heavy; hold it to charge: the
windup holds, the charge is full after 1 s (ChargeReady) and swings itself at 1.5 s. Let go before
12 ticks (0.2 s) and it is a plain heavy. While it winds up and charges the knight has hyperarmor (it
shrugs off up to 40 poise; a harder hit staggers it and the charge is lost). Timing and numbers:
`src/content/data/move/sword-heavy.json` and `sword-heavy-charged.json`; the rules:
`src/sim/combat/timeline/charge.ts`.

**Shield bash.** Attack while blocking bashes with the shield (mw-e04.14): hold block (L2/LT, right
click) and press attack (R1/RB, left click). It is a chord on the knight's existing buttons, not a
button of its own, so it costs no slot (the chord is
`meleeChords` in `src/sim/player/player.ts`). The bash interrupts a foe's interruptible move (spell
windups), breaks a shieldless guard outright, shoves things up to 60 kg and knocks breakables. With
no shield equipped the same chord kicks instead. With the testbed bow out the attack button draws,
so there is no bash. Timing and numbers: `src/content/data/move/shield-bash.json`; the rules:
`src/sim/combat/melee/bash.ts`.

**Bow (testbed).** Until class kits bind the archer's buttons (mw-e02.3), the testbed knight also
carries the shortbow (mw-e05.21): ability 4 (4, D-pad Left) takes it out or puts it away; while it is
out the attack button (left click, R1/RB) draws instead of swinging (hold to draw, let go to loose)
and ability 2 (2, D-pad Right) cycles the arrow type. Cycle stays off ability 3, the knight's parry
(`TESTBED_BOW_BUTTONS`, src/game/combat/testbed-combat.ts). While drawn the camera narrows from 70° to
the bow's aim field of view; `?frames` shows the selected arrow type and how many are left.

**Casting.** Spells are aimed with a reticle (mw-e06.15): a cross at the centre of the view while the
player has a learned spell, labelled with its name. The cast button (V, D-pad Up) casts the selected
spell along the camera's centre ray, which starts where it passes the caster's head so a wall behind
you never takes the shot; the cast command carries that aim point, in the very tick the button is
sampled. Held, a channelled spell keeps channelling and stops on the tick the button comes up; the
cancel button (B, D-pad Down) calls off a wind-up or channel. How a spell is aimed follows its
delivery (`src/game/magic/aim.ts`): projectiles and beams go to what the reticle meets within range
(a wall or a creature) or the point at max range; area and summon-point spells show a ground marker
on the floor under the reticle, brought back to max range, and the cross turns red with the reason
(no floor there, blocked, not enough mana) when the cast would be refused; touch spells take the
locked target, else the creature under the reticle; self spells need no aim. The first learned spell
is selected; the hotbar below chooses others. `spell learn <id>` teaches one for testing, `spell select <id>`
chooses a learned one and `spell slot <1-8> <id|none>` fills a slot. A mana bar sits under stamina for
anyone with a pool.

**Spell hotbar and wheel.** (mw-e06.16; `src/sim/magic/hotbar.ts`, `src/game/magic/hotbar.ts`,
`src/ui/spell-hotbar.ts`, `src/ui/spell-wheel.ts`.) Eight slots sit in a row above the quick slots,
shown once a spell is learned. A newly learned spell takes the first empty slot (and is selected when
nothing is). Each slot shows a placeholder icon (the spell's initial; real art is mw-e37.31), its key,
its mana cost, a cooldown sweep with the seconds left in tenths, a dimmed icon and red cost when the
mana is short (unless the spell may be over-cast), a brass rim when selected and a blue one while that
spell channels. Pressing a slot's key selects it; an empty slot does nothing. Selection is sim state
(`magic.hotbar`, saved with the world, command `select-spell-slot`, event `SpellSelected`), and a cast
pressed in the same frame uses the slot just chosen.

*Decision: spell slots do not share the number row with the class abilities.* Keys 1-4 are the
class abilities (the knight's strong attack, parry and the testbed bow), and the same keys cannot mean
two things at once, so slots 1-4 sit on the numpad and slots 5-8 on both the numpad and the number
row; `[` / `]` step to the previous / next filled slot and the wheel reaches every slot without a
numpad. When the class kits (mw-e02.3) free the number row for casters the defaults can move; all
the actions (`spellSlot1`-`spellSlot8`, `spellPrev`, `spellNext`, `spellWheel`) are remappable. The
quick slots (consumables) stay a separate strip below the hotbar: spells and consumables never share
a slot, and assigning the quick slots' own keys remains mw-e17.17.

*Quick-select wheel.* Hold Z (the Guide button on the pad: every other pad button is taken). While it
is held, mouse look (or the right stick) moves a pointer instead of turning the view, the slot it
points at is lit with the spell's name, and letting go selects it; releasing near the centre selects
nothing. The sim runs at 25% speed while it is open (`accessibility.wheelSlowsTime`, default on, in
Options); opening a menu closes it. Slots go clockwise from the top.

*Saves.* The bar rides in the world section (the component is registered on first use and listed in
`ON_DEMAND_COMPONENTS`, so it loads into a world that has not learned anything yet).

*Not yet:* dragging a spell from the grimoire onto a slot (the grimoire is mw-e07.10; until then the
console's `spell slot` and the sim's `assign-spell-slot` command place spells).

**Items.** Interact takes an item lying in reach ("Take <name>"; mw-e17.7). G drops the most
recently picked-up item that may be dropped (a whole stack, in front of you) and T throws one of it
along your look; quest items cannot be dropped or thrown. To drop or throw a particular item, open
the inventory (I, View; mw-e17.10), pick the item and choose Drop or Throw. That is also how the pad
drops and throws, so those actions have no pad button. The inventory screen pauses the game; I or
View closes it again, as do Esc and B.

**Pause.** Esc or P (Menu on the pad) opens the pause menu while you play (mw-e01.3): Resume,
Settings, Save, Load and Quit to Title, with the game stopped behind it. The browser also ends
pointer lock on Esc, and losing the lock while playing pauses too (alt-tab does the same). Menus
stack: with another screen open (the inventory, a chest, the options) Esc and B close that screen
first, and only with nothing open does Esc pause. In the menu, P or Menu resumes, as do Esc, B and
Resume. Up and down (arrows, d-pad, left stick) move between the options and Enter or A picks one.
After resuming, click the game to take the mouse again; the pad plays at once.

**Quick slots.** Four quick slots use consumables without a menu (mw-e17.6): drink a draught, throw
an oil flask. They have no default buttons yet; assigning controls for them remains mw-e17.17. The inventory screen
assigns items to them (pick an item, Assign to quick slot), and the strip at the bottom of the screen
shows them. Until the bindings land, the sim's `useQuickSlotCommand` uses a slot, and so does the
debug console's `quickslot <1–4>`.

**Slow walk.** The quietest way to move (mw-e02.10): hold X to walk at 1.2 m/s, or push the left
stick 30% or less. It works standing or crouched. Sprint while crouched stands you up (not under a
low ceiling, where the sprint is ignored). How loud and visible each stance and gait is lives in the
controller profile's `stealth` block (`src/content/data/controller/player.json`).

**Sprint toggle.** On the pad, clicking the left stick latches sprint on; it stays on until the stick
comes back to centre or is clicked again (`GamepadSettings.sprintToggle`, default on). Off, sprint is
held like the Shift key.

## Water

Wading (feet in 0.5 to 1.2 m of water) is walking at 60% of the run speed, with no sprint. Deeper than
that, a light armor load (no armor, or a jerkin-level kit) swims: the move stick paddles, holding crouch dives (the breath
meter appears; 20 s of air, then drowning damage every second), letting go floats back up. Attack,
block and bow are unavailable while swimming (hands busy, as when climbing). A medium, heavy or overloaded
load (the starting knight's mail and shield, plate) sinks to the bottom and walks it at 40% of the run speed; jump does nothing against the armor.
Unequipping the armor floats it up. Source: `mw-e02.14`, `src/sim/character/water.ts`.

## Lock-on

Lock on (Y/Triangle, Q or middle click) picks the target nearest the centre of the view, weighted by
distance, and presses again to release (mw-e02.16; rules in `src/sim/targeting/lock-on.ts`, numbers in
`src/content/data/lock-on/player.json`). While locked:

- the player faces the target and moves relative to it: left/right circle it at the same distance,
  forward/back close in or back off;
- look input no longer turns the view; the camera frames the player and the target together;
- **cycling** moves the lock to the next target to the right (clockwise around the player, wrapping):
  Tab on the keyboard. Flicking the right stick past 70% sideways, or swiping the mouse 40 counts
  sideways within one tick, cycles in that direction; the stick (below 30%) or mouse (5 counts or less)
  must come back to rest before the next flick counts. The pad's cycle-target binding stays empty;
- the lock breaks beyond 25 m or after 1 s out of sight, and passes to the next target within 10 m
  when the locked one dies.

## Sticks

- **Move (left stick):** rescaled radial deadzone, 0.15 by default (`GamepadSettings.moveDeadzone`).
  Deflection at or below the deadzone is no movement; the live range maps linearly onto 0–1 in the
  same direction, so 0.575 moves at half speed and full deflection at full speed.
- **Look (right stick):** rate-based. The frame carries the raw deflection as `lookStick`; the sim's
  `lookTurn` applies the look deadzone (0.15), a squared response curve and the turn rates (240°/s yaw,
  160°/s pitch at full deflection) from `src/content/data/camera/player.json`.
- **Triggers** count as pressed past 30% pull (`GamepadSettings.triggerThreshold`).

**Keyboard + pad in the same tick:** the longer move vector wins whole (never a sum, so the length
stays ≤ 1); buttons on the same action OR together; mouse look and stick look add up.

## Replays and quantisation

Every stick value in an `ActionFrame` (the left stick's `move` after the deadzone, and `lookStick`) is
quantised by `stickVector` to **thousandths of full deflection**: each axis becomes `k / 1000` for an
integer `k`, computed as `Math.round(v * 1000) / 1000`. IEEE-754 makes that the double nearest
`k / 1000` on every engine, so the value is short in JSON (`0.575`) and parses back to exactly the same
double: a recorded replay steps the sim with bit-identical input. Input longer than 1 is scaled back to
the unit circle first, and if rounding to the nearest step would push the length past 1, both axes
round towards zero instead. A thousandth is finer than pad hardware reports, so it is not felt.
Keyboard movement is not quantised (its values are the exact constants 0, ±1 and ±√½).

## Hot-plug and focus

The pad is polled once per sim tick (`src/game/input/gamepad-dom.ts`); the first connected pad with the
standard mapping is used. It needs no click or pointer lock, only page focus; without focus it reads
idle. When the pad being read disconnects, the next frame releases every action the pad held and, per
`GamepadSettings.pauseOnDisconnect` (default on), taps the `pause` action, which opens the pause
menu (mw-e01.3) while the player is in play; the controls hint also says "Controller disconnected".

## Persisting bindings

`serializeBindings(keyboard, gamepad)` writes version 2 data with both sets; `deserializeBindings`
reads version 2 and version 1 (keyboard only, with the default pad layout). Each set is validated on
its own: keyboard sets take no pad codes, pad sets only pad codes (`PadA`…`PadGuide`), and a set with
a conflict falls back to its defaults. Unknown keyboard codes (anything that is not a standard
`KeyboardEvent.code` or `Mouse0`…`Mouse4`) count as invalid like unknown actions: that action's entry is
dropped and its default fills the gap.

`saveBindings(store, keyboard, gamepad)` and `loadBindings(store)` (`src/game/settings/bindings.ts`,
mw-e02.22) keep the data in the settings store's document, under `bindings` beside `settings` (same
localStorage key, same in-memory fallback). It keeps its own version, so `SETTINGS_VERSION` is
unaffected. `main.ts` loads it before building the sampler, so saved bindings apply at startup. Repairs
are logged with `console.warn`. The rebind UI that calls `saveBindings` is mw-e31.2.
