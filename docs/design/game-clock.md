# The game clock (mw-e27.12)

One deterministic in-game clock so restocks, deadlines, NPC schedules, study time and night-only
secrets agree on what time it is. Owner direction for the open design calls: "make good decisions".
Code: `src/sim/gametime/`. Data: the `clock` block of `src/content/data/game/game.json`.

## Decisions

| Call | Decision | Why |
| --- | --- | --- |
| Day length | 60 real minutes of sim time per game day (150 sim ticks per game minute at 60 Hz) | The bead's default. It is an exact integer at 60 Hz, so game time never drifts. A config that is not whole ticks per game minute is refused when the clock is installed. |
| Start | Day 1, 06:00 (dawn) | The bead's AC-1 example. Rest also wakes at 06:00, so the first morning and every morning look alike. The earlier thin-slice start of 08:00 is gone. |
| Phases | dawn 05:00, day 08:00, dusk 18:00, night 21:00 (night runs past midnight to 05:00) | Four phases, as the bead asks. 06:00 is dawn, so waking at an inn is a dawn scene. 8 h of sleep from 22:00 crosses night -> dawn once (AC-3). Boundaries are data and may be any minute, not only on the hour. |
| Time unit | Whole game minutes. Absolute time is minutes since day 1 00:00 | Integers hash exactly and compare without float care. `advanceTime` takes minutes; fractional durations are rejected like zero and negative ones. |
| State | World facts: `time.day`, `time.minute`, `time.minute-origin`, `time.held-at`, `time.phase` | Facts are in every snapshot, state hash and the world-facts save already, so AC-5's "hash equals" costs nothing and nothing can drift between a second store and the facts. `time.day` and `time.minute` keep their keys from the thin slice (shops, repopulation and saves read them). `time.phase` lets the condition DSL test `time.phase == night` with no new machinery. |
| Schedule storage | Held by the clock; saved by the `game-clock` save section | Payloads are flat string/number/boolean records so they are JSON-safe. The handlers are code and re-subscribe on load; only the pending entries are data. |
| Schedule data format | `schedule.at(absMinute, id, payload?, priority?)`, `schedule.every(periodMinutes, id, payload?, priority?)`, `cancel(id)`, `pending()` | `id` is unique per entry (a duplicate is refused) and is the event id subscribers match on, so ordering by (time, priority, id) is total and independent of registration order. `every` first fires one period from now and keeps its phase across jumps. Scheduling at or before now is `invalid-time`. |

## How time moves

The sub-minute remainder is `tick - time.minute-origin`, so the running clock writes a fact once per game minute
(every 150 ticks), not every tick; a fact write publishes `data-facts` and fires `factChanged`.
`time.held-at` records the tick a holding screen opened, so the held ticks can be taken out of the
minute on release (or on the first tick after a load, which has no screens open).

- The `game-clock` system counts sim ticks. A world that does not step does not move: menus that pause
  the sim pause the clock for free (AC-2).
- Screens that leave the sim running hold the clock with `clock.hold(screen)` / `release(screen)`. The
  data says which screens hold it (`pauseScreens`): dialogue, shop and inventory do, the map does not.
  An unlisted screen does not.
- `advanceTime(minutes, reason)` is the only jump (rest, study, jail, travel). The reason is passed to
  subscribers. Rest at an inn goes through it; `rest.completed` and the merchant restock are unchanged.
- The `time` console commands (`time set <day> <HH:MM>`, `time advance 8h`) are replayable debug
  commands. Setting the clock backward rewrites time without firing events.

## Events and delivery

Crossings of one advance are found, ordered by (game minute, kind, priority, id) with day start before
phase change before hour before scheduled events, then delivered after the new time is written (so a
handler reading the clock sees the end time, and may schedule against it). Each crossing is emitted on
the world bus (`time.dayStarted`, `time.phaseChanged`, `time.hourChanged`, `time.scheduled`) and sent
to clock subscribers (`clock.subscribe(topic, handler, { mode, id })`):

- `each`: a callback per crossing, in order.
- `latest`: one callback with the last crossing, `count` crossings and `elapsed` game minutes of the
  whole advance. For lazy consumers such as shop restock.

## Queries

`time()`, `total()`, `timeOfDay()`, `phase()`, `elapsedSince(total)` on the clock; the facts for the
condition DSL and light field. Sky and lighting visuals are not part of this bead (E37 subscribes to
`phaseChanged`).

## Not here

- NPC routines, restock and quest-deadline schedules belong to their consumers.
- Offscreen catch-up for unloaded levels is mw-e27.10; it can use `elapsedSince` and `latest` mode.
- The merchant restock still runs on `rest.completed` / "touched" catch-up; moving it onto a
  `latest`-mode subscriber is left to mw-e20.5's follow-up.
