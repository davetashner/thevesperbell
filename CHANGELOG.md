# Changelog

All notable changes that players and site visitors can see are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Playtest builds will be versioned when the
first one ships; until then everything sits under Unreleased.

Engine, tooling, test and infrastructure work with no visible effect is not listed. A PR that touches
`src/{game,ui,render,audio,sim,content}/`, `src/main.ts`, `index.html` or `site/` adds a one-line note
under Unreleased, or carries the `no-changelog` label if nothing visible changes (CI's `changelog`
check enforces this).

## [Unreleased]

### Added

- The Forgotten now look their parts: the brute is a bigger, armoured skeleton with a two-handed maul, the archer holds a bow and the shield-bearer carries a battered iron shield (the miner is unchanged). Stand-in models for now; they still move with the miner's animations.
- Ottilie, Dot the innkeeper and the Bridge Watch guards (one look for day and night) now have bodies instead of grey capsules. Placeholder models, standing still in one pose, until you approve their art; Hollis, Juniper and Oswin are still capsules.
- The Bridge Watch post at the town end of the Miners' Bridge: pillars, banner, lamp and brazier, with two day guards and one night guard standing watch (they greet nobody and fight nobody yet; the Watch is declared hostile to monsters, who do not cross anyway).

- The valley's skeletons return after you sleep: kill the 20 ordinary Forgotten, rest at the Sleeping Ox, walk back and they stand at their posts again with fresh loot, while the brute at the bridge stays dead and what you left on the ground stays put.
- The River Wend can now be waded and swum: water 0.5 to 1.2 m deep slows you to 60% of your run speed (and splashes your footsteps), deeper water is swum (crouch to dive) only with no or light armor, and any medium, heavy or overloaded armor load (the knight's mail and shield included) drags you under to walk the river bed at 40% speed instead; you have 20 seconds of breath underwater before you start to drown, and a breath meter appears while you are short of it. Water leaves you wet. The cliff overlook's river now has a ramp up each bank to climb out by. Not yet: ice and sliding, swimming animations, climbing out onto a bank, and the real drowning damage (placeholder numbers).
- Skeletons now roam the valley path: 21 Forgotten across the mountain path, the forest and the cliff overlook (6, 8 and 7), in miner, archer, shield-bearer and brute varieties, each standing at its habit until it sees you, then chasing only so far from its post. Never more than two fight you at once in the first two areas, three at the overlook; a shield-bearer stands by the iron-bound chest in the glade (optional fight), and a single brute bars the way to the bridge (skeletons never cross it). A full clear pays about 400 crowns with the chests, close to half of it from coins and gear you can sell to Brand. Skeletons do not come back after you rest yet. Dev builds only for now: walk the chain from `?scene=valley-01`.
- Selling gear and loot gets clearer: the Sell tab lists what a merchant will buy with the best price first, a Sell all button sells a whole stack, the merchant's remaining crowns are shown and a sale they cannot pay for says so, and worn gear cannot be sold until you take it off ("Unequip that first."). Stolen goods and quest items stay listed with the reason they are refused.
- Shops restock overnight: when you sleep (or a new day otherwise begins) shopkeepers' tills refill toward their reserve, restockable goods such as arrows, potions and bread come back on the shelf at their own pace, things you sold return to the shelf, and one-of-a-kind pieces never come back once bought. Loot-table shelves and quest-gated wares are supported in the engine; no shop uses them yet.
- Walking between areas: the valley path, the forest, the cliff overlook and the bridge into Briar Glen are now joined (valley-01, 02, 03, then the lane and Marsh's General Store through its front door), each by a gate or doorway you walk through, both ways. You arrive at a set spot facing into the area; crowns, pack, health, quest facts, shop stock and the time of day come with you, chests and doors you changed stay changed, and the game autosaves on arrival. The page reloads for each crossing (a loading screen with the area's name shows only if it takes over half a second), creatures never follow, including the Sleeping Ox's front door on the shop lane (an inn front with a stand-in hanging sign and a lantern, further up the west side than Marsh's).
- Treasure chests in the open valley: a plain wooden chest in a corner of the mountain path, another in the forest glade with a padlock key inside, an iron-bound chest across the glade that opens with that key, and a hidden chest in a corner of the cliff overlook behind two wooden barricades you must break. They hold crowns (8 to 25 in the wooden ones, 25 to 70 in the iron-bound, 70 to 180 in the hidden one) plus arrows, food, potions, ingredients, scrolls and gear. (Previewable in development builds only for now, with `?scene=valley-01`, `valley-02` or `valley-03`; the valley is not reachable in play until area transitions ship.)
- Three new Forgotten skeletons to fight beside the miner, each worth crowns and sometimes gear to sell: the archer keeps its distance, draws and looses arrows, and backs off or shoves when you close in; the shield-bearer holds a rotten board up against your frontal blows (a shield bash breaks it), then bashes and counter-swings slowly; the brute is big and slow, with long two-handed overhead and sweep swings and long recoveries. Every skeleton now drops crowns by strength (miner 1-4, archer and shield-bearer 3-8, brute 8-20) and the miner sometimes leaves scrap. Their animations are the miner's, retimed, and they share the miner's look for now. In development builds, load `?scene=skeleton-pen` to fight them.
- The Briar Glen shop lane: a cobbled street from the town end of the Miners' Bridge, past Marsh's General Store's door, to three open-fronted shops side by side, each with its keeper behind a counter that opens their shop: Oswin Brand's Forge (swords, knives, armour, helmets, gauntlets, boots, shields), Juniper Fenn's Fletchery & Simples (bows, arrows, staves, potions, ingredients, jars, spell scrolls) and Hollis Pell's Bakery (bread, pies, cheese, sausage). Marsh's General Store now also sells clothes, gloves, boots, bread, apples, rations and empty jars, and every shop window is headed by the keeper's name (Ottilie Marsh, not "Npc ottilie"). The doors and the bridge are only markers for now (no area transitions yet); in development builds, load `?scene=briar-glen-lane`.
- Village-shop stock: food (bread, cheese, sausage, apple, rations, hot pie), stronger healing and mana draughts, a stamina tonic, potion ingredients, glass jars that break when thrown or dropped hard, and three spell scrolls. Nothing sells them yet, and the scrolls do nothing until spells can be cast from them.
- A catalogue of gear for village shops: short and long swords, knives, staves, hunting bows, special arrows, helmets, gloves, boots, clothes, gambesons, brigandine and shields, each in a common and a fine grade with a price in crowns. Nothing stocks them yet, so none are for sale.
- A shop screen: a merchant's name and greeting, Buy, Sell and Buyback tabs with prices in crowns, why a price is what it is (hover or focus an item), quantities for stacks, a prompt before spending more than a quarter of your crowns, and a reason on anything a merchant refuses (stolen goods, quest items). No village has a shop yet; in development builds, load `?scene=shop-room` and talk to a counter to try it. Nothing to buy in the shipped game yet, and the Services tab is empty.
- Marsh's General Store, the first building in town, is built as a test interior: a two-floor timber shop with a long counter, shelves and barrels, the shopkeeper Ottilie Marsh waiting behind it, and her home up a wooden stair with a bed, table, desk and wardrobe. Talk to the counter and Ottilie's shop opens, so you can buy and sell there. (Previewable in development builds only for now, with `?scene=marsh-store`.)
- The Sleeping Ox, Briar Glen's inn, is built as a test interior with its keeper Dot Farrow, and you can pay 12 crowns for a room for the night on the shop's Services tab: you sleep until morning (6:00), wake with health, stamina and mana full, and the game autosaves. You cannot sleep while enemies are hunting you. It is the game's first clock: time of day moves only when you sleep, and nothing else changes with it yet. (Previewable in development builds only for now, with `?scene=sleeping-ox`.)
- Groundwork for village shops: buying, selling and buying back with a merchant whose stock and gold run out and are remembered across saves. No shop is open yet, so nothing changes in play.
- Groundwork for village shops: the economy design (what skeletons and chests pay, what wares cost), merchant data with price limits, and the price rules for buying and selling. No shop is open yet; two test merchants appear in development builds only.
- Three new outdoor test areas — a tight mountain path, a forest path and a fenced cliff overlook with a stone bridge — show painted mountain and forest vistas behind the walls, with distance fog. (Previewable in development builds only for now.)
- Sword swings now wind up behind the shoulder and cut down instead of sweeping up from the ground, with their own motions for the heavy attack, the second and third light attacks, the riposte and the skeleton's chops; the run no longer leans back, and footsteps sound once per drawn step instead of about twice as often.
- Hits now burst with an effect that matches what they hit — bone chips and dust off the skeleton, splinters off wood, grit off stone — wooden shields throw chips, a broken guard shatters in a ring, and a critical hit adds a bright burst. Struck creatures also flash white for a moment.
- The Forgotten skeleton now dies properly: it stops fighting the moment its health runs out, falls onto its back and stays there.
- Your knight now turns see-through while he stands between the camera and a nearby creature, so you can see what you are fighting.
- The Forgotten skeleton now moves: it idles, walks and swings its pick instead of sliding about as a statue.
- A health bar for the fighter you are locked onto (or last hit) now sits at the top of the screen with its name, and damage numbers show what you deal and take. Turn the numbers off under Settings → Gameplay → Damage numbers.
- Dying before any save exists and choosing "Restart area" now puts you back at the start of the slice as the class
  you chose, with its kit equipped and the world's facts reset; with no class chosen it returns to the title.
- You can now walk while swinging (at 60% speed; jump and sprint stay locked until the swing ends).
- Walking through the exit now ends the slice with a "Slice complete" card showing your run time and class and the
  state of the completion save, with Return to title focused (keyboard or controller) and the knight no longer
  moving.
- A Forgotten miner stands guard in the slice's arena by the second pillar. It wakes when it sees you or
  hears a clatter, fights you, and drops the rusted gallery key that opens the exit when it falls.
- The controller's combat layout moves to the shoulder buttons: RB attacks, RT is the strong attack, LB is
  your left hand (parry), LT holds your shield and Y locks on. Pressing the right stick toggles crouch;
  jumping or sprinting stands you back up.
- The slice's walls, floors and ledges are weathered glenstone blocks instead of flat grey, lit warmly by the
  torches and the brazier. It is a placeholder style probe until approved.
- The slice's chest, crate, pillars and ivy ledge look the part too: an iron-banded wooden chest in the
  alcove, a braced and bracketed crate, weathered stone block pillars in the arena, and ivy over the climbable
  ledge. They are placeholders until approved.
- The slice's torches, brazier and doors look the part: iron-and-wood torches on the walls, an iron brazier
  full of coals (its flame now burns in the bowl), a painted plank door with iron hinges in the first room,
  and a heavy riveted iron door at the exit. They are placeholders until approved.
- The slice has sound under it. A quiet dripping ambience loops through the mine gallery, a slow
  explore theme plays once as you start, and when the skeleton turns on you the combat music fades in
  and fades back out a few seconds after the fight ends. The Master, Music and Effects volume sliders now
  change the volume. The music and ambience are placeholders until the adaptive score lands.
- The skeleton in the arena has a model: a bony miner in a leather cap with a pick, with eyes that glow
  cold blue. There are four different looks, and each game picks one at random for each miner. They do not
  walk or swing yet (animation is still to come) and are placeholders until approved.
- The knight has a model. Your character now walks, crouches and fights as the armoured knight
  from the concept art instead of a grey box, with a separate sword in the right hand and the shield
  on the left arm. It is a placeholder until the final model is approved.
- You can pause. Esc, P or the controller's Menu button stops the game and opens the pause menu:
  Resume, Settings, Save, Load and Quit to Title. Save is greyed out with "Can't save during combat"
  while a fight is on. Quit to Title asks first if you have played on since your last save, then
  takes you back to the title, where Continue picks up from that save. The menu works with the
  keyboard, the mouse or a controller's d-pad.
- The vertical slice saves itself. Walking through the first door and reaching the end of the
  corridor each make an autosave, and so does finishing the slice. An autosave never happens
  mid-fight: it waits until the skeleton's fight is over. Close the game, press Continue on the
  title and you are back where you saved within moments, with a dead skeleton still dead and an
  emptied chest still empty. Save slots now show your class (a thief's save says Thief).
- The knight can bash with its shield: hold block and press attack (right click then left click, or
  LT then RT). The bash cuts a spellcaster's windup short and makes them flinch, knocks aside a foe
  guarding with only a blade so they reel for a second, shoves barrels and other light things across
  the floor (anything too heavy just thuds and stays put) and batters flimsy barricades. Without a
  shield the same buttons throw a kick.
- The knight has a heavy attack you can charge (ability 1: 1, Y or D-pad Up). Tap it for a slow,
  heavy overhead; hold it and the knight holds the blade high, building a charge that hits up to
  1.8 times as hard and breaks far more poise, full after a second and swung on its own if you keep
  holding. While it winds up and charges the knight shrugs off light blows, but a hard enough hit
  staggers it and the charge is lost. A full charge costs a little more stamina than a plain heavy.
- Creatures guarding a post chase you only so far. Run far enough from a leashed creature's post in
  the middle of a fight and it gives up at the edge of its ground, looks around for a moment, then
  lurches back to its post and stands guard again, still carrying every wound you gave it. Step
  back into its ground and the fight picks up where you left it.
- Loot in the vertical slice. The Rusted gallery key lies by the far pillar in the arena: take it
  and the iron exit door unlocks and opens with one press of Interact, straight from your keyring,
  so you can walk through and finish the slice. The key is a quest item and can't be dropped or
  lost. Up in the raised alcove, a chest holds a healing draught, a few coins and a miner's tally
  stick with a story of its own; once you have emptied it, it stays empty after a save and reload.
- Enemies fight like a team instead of a mob. In a fight, at most two take a swing at you at a time
  while the rest circle at their own striking distance, waiting their turn. Each picks a blow that
  can actually reach you from where it stands, a bold one favouring its heavy swings, and calls out
  where you are so the others keep up. Stagger one and it loses its swing and rethinks once it
  recovers. Climb somewhere it cannot follow and it waits below, then jeers at you instead of
  pacing back and forth.
- The game now opens on its title screen. New Game takes you to class selection and, once you
  confirm the Knight, straight into the vertical slice's spawn room with the knight's kit, no reload
  in between. Continue loads your most recent save (it stays greyed out with "No saves yet" until
  you have one) and Load lists every save. The build number shows under the menu, so playtest
  reports can say which build they came from.
- Creatures come alive in the grey-box levels. They now watch, listen and think while you play:
  a guard sees you by the light you stand in and the walls in the way, hears noises muffled by
  shut doors and stone, and walks its patrol through doorways and around pillars on the level's
  real paths instead of straight through walls. A guard that spots you shouts, and other guards
  nearby hear it.
- A perf stress room, `?scene=perf-baseline`: 64 crates kept tumbling by bursts of force under eight
  lamps, the scene every build's frame rate is measured in.
- Saves keep each creature's state of mind: how alert it is, how long it has been searching, where
  it last saw you, what it just heard, its morale and whether it is knocked out. A reload picks up
  exactly where you left off, so a guard hunting for you is still hunting the same spot with the
  same time left.
- A container window. Searching a chest, barrel or corpse now opens a small window listing what is
  inside, with icons. Take one thing, or press R (X on a controller) to Take All and close it in one
  go; Take All also has focus when the window opens, so Interact then confirm loots a chest. An empty
  container just says "Empty". Everything you pick up now shows a short note in the bottom-right
  corner: up to four at a time, with repeats of the same item merged into one note with a count.
  A unique artifact gets its own gold-edged "Discovery" note with its flavour line, which stays for
  six seconds. The notes follow the HUD scale and Text size settings.
- An inventory screen. Press I (View on a controller) to see everything you carry, sorted newest
  first, with tabs for Weapons & Armor, Tools, Consumables, Books, Keys and Quest & Artifacts. Each
  item has a card with its name, a line or two of flavour text, what it lets you do and what it's
  worth; stolen goods carry a red hand, and hovering or focusing them says whose they were. Pick an
  item to Use, Equip, Drop or Throw it, or put a potion in one of four quick slots, which now sit at
  the bottom of the screen showing what is in them and how many are left. The screen pauses the
  game, works fully with mouse, keyboard or controller, and follows the Text size setting, which
  now applies to the game's menus and HUD text.
- Guards no longer know where you are once they lose sight of you. A guard hunts where it last saw
  you, carried on a little way in the direction you were running, and not a step further, so
  ducking round a corner, doubling back or climbing out of view really does shake it off. Given
  long enough, it forgets you.
- Guards keep routines you can watch and time. A guard can walk a loop, pace back and forth, wander
  between spots at random, or stand at a post sweeping its gaze across an arc. It pauses at each
  stop for a set time, faces a set way, and may lean on a wall or warm its hands while it waits.
  After a search, it heads for whichever stop it can reach soonest, not the next one in line. When a
  locked door cuts off a stop, it skips that stop and carries on.
- A title menu with Continue, New Game and Load, plus Save and Load screens (for now reached with
  `?menu=title`, `?menu=save` or `?menu=load`). Continue picks up your most recent save. With no
  saves yet it is greyed out and says "No saves yet". Each slot shows a picture of where you saved,
  your area, playtime and how long ago you saved. Saving over a slot or deleting a save asks you to
  confirm first. Everything works with the keyboard or a gamepad alone, and if your browser is
  blocking storage the screens warn you that saves will not last.
- An AI debug overlay for debug builds (`ai.debug on` in the console). Each creature shows its sight
  cone tinted by alert state, its hearing range, the route it walks and where it thinks its target
  is, with a label giving its state and how long it has been in it, what it is doing and how aware
  it is of each thing it noticed. Noises ring where they were made. `ai.freeze` holds the game and
  `ai.step` advances it one tick; click a creature or type `ai.debug select` to see everything about
  it. Release builds do not include it.
- Health and stamina bars in the bottom-left corner. When you take a hit, the health you lost stays
  visible in a lighter colour for half a second before it drains away. The health bar pulses when
  you are below a quarter of your health, and the stamina bar flashes when you try something you
  don't have the stamina for. A hit from off screen shows a red arc pointing towards where it came
  from. A new HUD size option under Accessibility scales the bars from 75 % to 200 %.
- Dying now plays a short death beat before the death screen. Your controls stop responding, the
  camera pulls back over your body and the screen fades to dark for a second and a half. Then the
  death screen offers Load last save. Dying in the slice takes you back to your last save.
- The vertical slice has a level to play through, in grey box (`?scene=slice`). Open the wooden door
  out of the spawn room and walk a dim corridor, where ivy in a side alcove climbs to a torchlit
  ledge. The corridor opens into a pillared arena lit by torches and a brazier, with a loot alcove
  raised off one side. The way out is an iron door, and without its key it stays locked ("Locked.").
  Two checkpoints mark your progress on the way in, and stepping through the exit door finishes the
  slice. The skeleton, the key and the loot arrive next.
- Guards react in readable stages. Something catches a guard's eye and it stops to look, then goes
  to check the spot, then searches the area once it has lost you, and fights only when it can
  actually see you. If nothing new turns up for a few seconds, a wary guard relaxes again, so you
  can recover from a slip. A guard that loses you mid-fight searches where it last saw you instead
  of forgetting you. Afterwards it calms down but stays on edge for a while and spots you faster.
  Shoot a guard from the shadows and it raises the alarm and heads toward where the shot came from,
  not straight at you. The Forgotten skeleton follows the same rules.
- Creatures notice you gradually instead of all at once. A glimpse of you at the edge of a guard's
  vision builds its suspicion slowly, while standing in torchlight right in front of it gives you
  away fast, so you have time to back off into the dark. A loud noise puts a guard on edge at once.
  Once nothing more catches its attention, a guard stays wary for a couple of seconds and then slowly
  calms down. Bumping into a guard gives you away instantly, even in pitch darkness. Each creature
  remembers what caught its eye or ear, ready for future on-screen hints about why you were spotted.
- Chests can be looted. Search one to open it and take everything inside. What a chest holds is
  decided the first time anyone opens it and never changes after that, so reloading a save will not
  reroll it, and a looted chest stays empty. A locked chest needs its key or your lockpicks first,
  like a locked door. The testbed has a supply chest to try.
- The class select screen still shows all four classes, but in this build only the Knight can be
  chosen. Archer, Sorcerer and Thief are marked locked with "Not playable in this build yet", so you
  can see what's coming; they unlock in a later build. The Knight is selected first when the screen
  opens.
- Creatures now only know what their senses tell them. A guard sees you only inside its field of
  view, sees you better straight ahead than out of the corner of its eye, and struggles to make you
  out far away, crouched or in shadow. A wall between you hides you completely. Guards hear noises
  from the doorway the sound came through, not from where you really are behind the wall. Some
  creatures have stranger senses: the undead can feel the living through stone. Creatures in the
  game will start using this once their alertness and the game loop are wired up.
- Saves now keep the whole world, not just you: doors you opened, things you picked up and the
  story's facts come back exactly as you left them, and the changes to places you have already left
  are kept for when you return. A save made before a fact was renamed still loads with its value,
  and if part of a save is damaged, only that place starts over as built while the rest of your
  progress loads.
- Choose your class when you start a new game: Knight, Archer, Sorcerer or Thief, each card showing a
  short pitch, three signature verbs and the starting kit. Highlight a class and confirm, by mouse,
  keyboard or gamepad; you start with that class's abilities, gear (worn where it belongs) and gold,
  and a panel in the corner shows what you carry. For now the screen opens in the testbed with
  `?newgame`; the title screen leads to it later.
- Creatures can now find their way around a level. They go through doorways, up ramps and stairs,
  and down ledges. Climbers go up ivy and ladders, but a walker has to take the long way round. A
  locked door keeps them out until it is unlocked and opened, and a wolf cannot open a door at all.
  If you are somewhere a creature cannot reach, it comes as close as it can and stops there. Guards
  will use this once their patrols and searches move them.
- An options menu: settings for controls, camera, display, audio, accessibility and gameplay, one
  tab each, all reachable by keyboard or gamepad. Changes apply at once and are remembered by your
  browser; each tab can be reset to its defaults without touching the others. If your browser blocks
  storage the game still starts, and your settings last for that session. The menu opens from the
  pause menu once that arrives; the individual options take effect as their features land.
- Loot is now checked before the game ships: a chest that names an item or table that doesn't exist,
  tables that roll each other in a loop, or a one-of-a-kind artifact promised in two places fails the
  build instead of leaving you an empty chest or a second copy of a unique treasure.
- Sound now travels like it does in a building. Noise fades with distance, a shut door muffles it,
  an iron door more than a wooden one, and stone walls and floors swallow most of it. Someone in the
  next room hears where it came through the doorway, not where you are. Guards don't listen for it
  yet; their hearing comes next.
- The world can now remember what you did to it: smashed walls, charred crates, boxes you moved,
  doors and levers you left open, looted chests, dead creatures and items you dropped stay that way
  when a level is left and loaded again. Only the changes are kept, not the whole level. You will
  see it once area transitions and saves use it.
- How visible you are now depends on the light on your body, your stance, how fast you move and
  how far away a watcher is. Shadows hide you, sprinting through torchlight gives you away, and a
  dark figure against a bright window stands out.
- Saves keep your pack, gold, equipped gear and quick slots exactly as you left them, stolen goods
  still marked as stolen. If an update removes an item, a save holding it still loads; only that item
  is gone.
- Loot tables: chests and creatures can now be given handcrafted loot, with items that always
  drop plus weighted random finds, finds only some classes get, and unique treasures that never
  turn up twice. Nothing in the world uses them yet; containers and creature drops come next.
- Consumables and four quick slots: drink a draught or throw an oil flask without opening a menu.
  A slot refills from your next stack of the same item and shows as empty when you run out. A
  thrown oil flask lands as flammable oil that a flame sets alight, and the fire spreads from it
  through heat like any other. The slots have no keys yet (1–4 are your abilities).
- Keys work by themselves: walk up to a locked door holding its key and press Interact to unlock and
  open it, with no menu. Without the key the prompt is greyed and says why ("Locked. The key can't be
  far."). Some keys snap when used once; most stay on your keyring. The testbed's east wall now has a
  locked closet whose key lies on the floor nearby.
- Doors, locks, levers, buttons, cranks and wheels. Doors swing, slide, rise or drop open and stop
  against whatever is in their way; a dropping portcullis crushes what is weak and wedges on what is
  not. Wooden doors burn and break, iron ones do not. Locked doors open with the right key from your
  keyring or with lockpicks, and a frozen lever will not budge until it thaws. Try them in the new
  grey-box mechanism room (`?scene=mechanism-room`).
- Items lie in the world as physical objects: walk up to one and press Interact ("Take <name>") to
  put it in your pack, press G to drop the last item you picked up in front of you, or T to throw one
  along your look. Dropped and thrown items fall, bounce and make a noise when they land, louder the
  heavier they are. Quest items, such as keys you need, cannot be dropped or thrown. The testbed has
  a healing draught on the floor to try it with.
- A slow walk for sneaking: hold X to creep at 1.2 m/s, or push the left stick only lightly. It is
  the quietest way to move, standing or crouched. Sprinting while crouched now stands you up and
  sprints, unless a low ceiling keeps you down.
- The first creature: the Forgotten miner, a shambling skeleton with an overhead chop and a two-hit
  slash you can parry and riposte, and a lunging thrust you can only block. Clubs and maces hurt it
  more, arrows and thrusts less, and poison does nothing. It stands in as a grey-box capsule with
  bones until its model arrives.
- Hits, parries, impacts, breaks and fires now show visual effects, driven by the same events as
  their sounds: a clean hit puffs dust and metal on metal or stone throws sparks (both spraying back
  out of the struck surface, bigger for harder hits), a blocked blow sparks, a parry flashes a bright
  ring, a knocked prop or an arrow striking a wall kicks up dust, a breaking crate or wall throws
  shards and dust, and something that catches fire burns with flickering flames until it is put out
  or burns away. Effects use placeholder textures (soft glows, smoke, rings, shards and an animated
  flame) until the final VFX art lands under the same names.
- Creatures now attack by the knight's own rules: their swings can be parried (leaving them stunned
  and open to a riposte, just like the training dummy), blocked and staggered, and every attack
  winds up for at least 0.3 s with a readable telegraph, a sound and a glow on the creature (ember
  for a parryable swing, pale for one only a shield stops, red for one that cannot be blocked).
  The grey-box skeleton's three attacks are in: an overhead chop, a two-hit slash and a slower
  lunging thrust that cannot be parried.
- Movement feel can be tuned live: the debug console's `ctl.get`, `ctl.set runSpeed 6` and `ctl.dump`
  read and change the player's speeds, jump, gravity, ledge and climbing values from the next tick
  and print the edited controller file, and in `pnpm dev` saving that file retunes the player
  without a page reload. Controller data now holds per-class differences too: the thief crouches
  faster (2.6 m/s) once classes can be chosen.
- Dying now opens a death screen. "Load last save" (focused) takes you back to your most recent
  save of any kind, manual, autosave or quicksave, and "Load…" lets you pick an older one. Either
  rebuilds the area and puts you back in play within a few seconds. With no save yet, "Restart area"
  starts the area again from the beginning. A damaged save loads its backup and tells you so. In
  debug builds the console's `save [slot]` command saves the game (`manual-1` by default).
- Things can break: a new `?scene=weak-wall-room` has a cracked old wall the knight smashes with a
  heavy attack (debug console: `act sword-heavy`) to open a passage into the back room, leaving
  stone rubble that clears after a few seconds, and a crate that breaks open and spills a plank.
  Walls, crates and pots break by the kind of hit (blunt, slash, pierce, a blast), so arrows, thrown
  props and falls break fragile things too, and frozen things shatter more easily.
- The knight can shoot a bow in the testbed: press 4 to take the shortbow out, hold the left mouse
  button (RT) to draw and let go to loose an arrow, which flies, drops and sticks in what it hits
  (or glances off stone). The view narrows while you aim. Press 2 (RB) to switch between plain,
  broadhead and blunt arrows; `?frames` shows the selected type and how many are left. The testbed
  room has a wooden target board on its back wall to shoot at.
- You can climb: walk into a ladder, a rope or ivy to grab it and climb (1.2 m/s on a ladder, slower on
  ivy), hold forward at the top to pull yourself up onto the ledge, jump to push off or crouch to let
  go. Ivy that burns away drops you, frozen or burning holds slip after a second, and climbing
  drains stamina, so an empty bar makes you fall. The testbed room has an ivy-covered wall to try it.
- Your hands stay on the wall: dodging, attacking, blocking and drawing the bow do nothing while you
  are mantling, hanging from a ledge or climbing.
- Torches and fires now light the grey-box scenes the way the game's stealth light model sees
  them, with moonlight and ambient light from the scene: the new lighting room
  (`?scene=lighting-room`) shows wall torches, a burning crate and moonlight through a doorway, and
  the debug console's `prop` command changes an object's properties (`prop 12 burning false` puts a
  torch out).
- Debug builds can put creatures into the grey-box scenes from data: the new creature pen
  (`?scene=creature-pen`) places two test hounds, a patrolling guard and a sentinel as placeholder
  capsules, and the debug console spawns any creature by id (`spawn fixture-hound 3`, or
  `at-cursor` to drop them where the view centre looks) and clears them with `despawn all`.
  Creatures can be struck and locked on to; they have no AI yet and stand where they spawn.
- The world can hurt you: falls from more than about 4 m cost health (a 14 m drop is fatal), being
  thrown into a wall hurts the same way, and heavy objects falling on you crush. Blasts now throw the
  knight back and up. In the testbed, `?frames` shows your health and the latest fall or blow the
  world dealt you; with the debug console, `blast` sets one off in front of you.
- You can lock on to the training dummy in the testbed room and to the combat sandbox's dummies
  (including ones the debug console spawns), and the knight's sword swings now turn toward the
  locked target as they wind up. Defeating the room dummy releases the lock.
- The knight can parry: press 3 (LB on a pad) just before a blow lands and a well-timed parry
  (a 10-tick window, about 1/6 s) deflects it with a ringing clang, costs you nothing and leaves
  the attacker reeling for 1.5 s; attack while it reels within 2 m in front of you for a riposte
  that deals triple damage. Mistime it and blows land harder (×1.25) while you recover. The combat
  sandbox's frame-data overlay shows the parry window, the stun and when a riposte is ready.
- Hits have weight: when a blade connects, the attacker and the one struck freeze for a few frames
  (a light hit 3, a heavy 5, a charged heavy 6) while everything else keeps moving. The combat
  sandbox's frame-data overlay shows the freeze counting down in a new Hit-stop column.
- Combat and footsteps sound richer in the testbed: sword, club and point hits sound different on
  flesh, bone, metal, wood and stone; a hit on your raised shield plays a block instead of a hit, a
  guard break clangs, every swing whooshes, a dodged swing whiffs past you, and your footsteps change
  with the ground (stone, wood, earth, shallow water), quieter crouching and louder sprinting, with
  landings that thud harder the further you fall. All still placeholder sounds.
- Climb onto things: walk into a crate up to 1 m high and you pull yourself onto it; jump at a ledge
  up to 1.6 m and you mantle up. In the testbed you can also grab ledges up to 2.2 m, hang, shimmy
  sideways (across small gaps), pull up with jump, jump back off the wall or drop with crouch, and
  crouch-walk off an edge to lower yourself into a hang. A ledge that freezes or catches fire makes
  you let go after a second. Timings are placeholders to tune.
- The testbed has sound: after your first click or key press, sword hits on the training dummy,
  staggers, deaths, running out of stamina and props thudding into things play placeholder sounds
  that come from where they happen and follow the camera. They are simple synthesised stand-ins
  until the real sound effects arrive.
- A combat sandbox for tuning fights: open `?scene=combat-sandbox` for an arena with a training dummy
  and an attacker dummy that swings every 2 s. F3 shows live frame data (move, phase, tick, i-frames,
  hyperarmor, reactions, health, poise, DPS) with hitboxes; F4 plays in 0.25× slow motion; the debug
  console spawns and retunes dummies. The knight can now be hit: blocked hits never flinch you, and a
  guard break plays a one-second stagger.
- The knight can fight in the testbed: left click (RT) swings a three-hit sword chain, and holding
  right click (LT) raises a wooden shield that blocks frontal hits at half walking speed. Running out
  of stamina behind the shield breaks your guard and staggers you. A training dummy stands in front of
  the start to practise on.
- The game page now opens onto a 3D view (a placeholder scene) and loads physics in the background,
  with a "Loading physics…" notice while it downloads. Browsers without WebGL 2 or WebAssembly get a
  readable "this browser cannot run The Vesper Bell" screen instead of a blank page.
- The game now runs its simulation at a fixed 60 steps per second under the 3D view, with smooth
  motion at any display refresh rate. It pauses while the tab is hidden and resumes without a
  fast-forward burst when you come back.
- The game now opens onto a greybox testbed (a room, a corridor and an arena) built from a colour-coded
  level kit, instead of the placeholder scene. Add `?scene=<name>` to the URL to open another scene;
  an unknown name shows the list of scenes to pick from. The scene name and build are shown in the
  corner, and F2 toggles a free-fly debug camera (WASD, Q/E, Shift, drag to look).
- Scenes are now solid: level geometry is loaded into the game's physics simulation, which runs in
  lockstep with the rest of the game rules. The scene appears once physics has loaded, and if physics
  fails to load the page says so instead of breaking.
- You can now walk around the testbed: click the view to take control of a placeholder capsule and
  move it with WASD, turn with the mouse, jump with Space, sprint with Shift and crouch with C (Esc
  lets go). Walls stop you, and a simple camera follows from behind. F2's fly camera still works and
  hands control back when you turn it off.
- The testbed camera is now a proper third-person orbit camera: move the mouse to look around and up
  or down (−70° to +60°), and use the wheel to zoom between 2 and 6 m. It sits over the right
  shoulder, pulls in instantly instead of clipping into walls and pillars, and eases back out once the
  way is clear. The testbed's corridor now has pillars to squeeze past.
- You can now play with a controller (Xbox layout; PlayStation pads work too). The left stick moves
  and the right stick looks around. A jumps, B crouches and a left-stick click toggles sprint, and no
  click is needed to start. Keyboard and mouse still work alongside it, and the on-screen controls
  hint switches to controller buttons when you pick the pad up. Pulling the controller out lets go of
  everything it was holding.
- Add `?hitboxes` to the URL to draw the combat hit volumes as wireframes: each swing's sweep from
  its last pose to its current one, and every body's hit zones coloured by region (weak point, head,
  torso, limb; armored ones in grey). Nothing swings in the testbed yet; knight attacks bring it to life.
- The testbed arena now has two animated grey-box characters: a humanoid with a sword and a
  four-legged beast. Each one loops through standing, walking a circle, attacking and flinching from
  a hit. The game simulation drives their timing, so each attack's swing lands on the move's
  active frame.
- Particle effects are in: sparks, flames, smoke and glowing motes, kept within a particle budget so a
  busy fight can't tank the frame rate. Add `?vfx=demo` to the testbed URL to see twenty test effects
  and a stats overlay (`?vfx` shows the overlay alone).
- The testbed's loose crate and the arena plank are now real physics objects: they rest on the floor
  and fall, tumble and stack like wood, and the player bumps into them instead of walking through.
- Look at an object and press Interact (E, or X on a controller) to use it: a prompt under the view
  names what you can do and shows the key to press. Things you can't use yet stay listed, greyed, with
  the reason ("Locked — needs Iron Key"). The testbed room has a lever to try it on.
- A developer console: press the backtick key (`` ` ``) in a dev build, or add `?debug=1` to the URL
  of a playtest build, to type commands such as `spawn testprop-crate 3`, `god`, `noclip`,
  `tp player-start`, `timescale 0.5`, `scene kit-gallery` and `help`. Tab completes, Up/Down recall
  earlier commands, and Esc closes it. Without the flag nothing loads.
- Crates and other movable props spawned from the developer console are now physics objects like the
  scene's own: `spawn testprop-crate 3` drops three wooden crates that fall, stack and tumble.
- Lock-on: press Q (middle click, or the right-stick click) to lock on to the target nearest the
  centre of the view, shown by a gold ring. While locked you face it and circle it with A/D, and the
  camera frames you both. Tab, a quick mouse swipe or a right-stick flick switches to the next target
  left or right; the lock breaks beyond 25 m or after a second out of sight. The testbed arena has
  three training dummies to practise on.

- The landing page at [thevesperbell.com](https://thevesperbell.com) with the title key art and the
  rest-lamp icon.
- An opt-in main theme player on the landing page: off by default, and nothing downloads until the
  visitor presses play.
- The public backlog at [thevesperbell.com/backlog.html](https://thevesperbell.com/backlog.html),
  rebuilt on every merge, showing each bead's status and the pull requests that close it.
- Dodge: press R (B on a controller) to roll 3 m in the direction you are holding, relative to the
  camera, or to backstep with no direction held. A roll costs 20 stamina and a backstep 12; both
  have short invulnerability windows that attacks pass straight through. On a controller, crouch
  moves to D-pad Down.
- The player in the testbed is now an animated grey-box figure instead of a capsule: it stands
  idle, walks, runs and sprints with its speed, crouches, jumps, falls, lands and rolls, following
  exactly what the game's movement is doing.

### Fixed

- The knight's body no longer stretches into red ribbons and spikes when the sword arm swings up for a strong attack, and the sword now sits in the knight's hand.
- If you fall out of the level, you are put back at the start instead of falling forever.
- A hinged door you open while standing right up against it now swings open away from you,
  instead of stopping as if something were in its way. A door still stops against anyone standing
  where it swings.
- A wall or other level piece that burns away (an ivy-covered wall, say) no longer leaves an
  invisible wall behind: you can walk and see through where it stood. The debug console's `tp` now
  moves physics props (crates) too, instead of leaving them where they were.
