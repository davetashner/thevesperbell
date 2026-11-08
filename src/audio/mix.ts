// Mix controller (mw-e28.9): snapshots (bus gains and filters for a situation) and ducks (brief
// attenuation so an important sound cuts through), driven as stages layered over the player's volumes
// (see MixStage in buses.ts): player slider × snapshot × duck. Pure logic over a structural engine
// so Node tests cover it; the time source is the caller's presentation clock (`update(nowMs)`).
import { dbToGain, MIX_BUS_IDS, type MixBusId } from './buses.ts';
import {
  DUCK_ATTACK_MS,
  DUCKS,
  SNAPSHOTS,
  type DuckName,
  type SnapshotName,
} from './mix-snapshots.ts';

export interface MixEngine {
  setSnapshot(bus: MixBusId, gain: number, lowpassHz: number | null, rampSeconds?: number): void;
  setDuck(bus: MixBusId, gain: number, rampSeconds?: number): void;
}

interface ActiveDuck {
  readonly until: number;
  readonly releaseMs: number;
  readonly buses: Readonly<Partial<Record<MixBusId, number>>>;
}

export class MixController {
  readonly #engine: MixEngine;
  #snapshot: SnapshotName = 'explore';
  #ducks: ActiveDuck[] = [];
  /** Duck depth last sent to the engine per bus, dB (0 = none). */
  readonly #sentDb = new Map<MixBusId, number>();

  constructor(engine: MixEngine) {
    this.#engine = engine;
    this.#applySnapshot(0);
  }

  get snapshot(): SnapshotName {
    return this.#snapshot;
  }

  /** Moves to a snapshot, ramping every bus over that snapshot's configured duration. */
  setSnapshot(name: SnapshotName): void {
    if (name === this.#snapshot) return;
    this.#snapshot = name;
    this.#applySnapshot(SNAPSHOTS[name].rampMs / 1000);
  }

  /** Starts a duck at `nowMs`. Overlapping ducks take the deepest attenuation per bus, not the sum. */
  duck(name: DuckName, nowMs: number): void {
    this.update(nowMs); // ducks already over must not count against the new one
    const duck = DUCKS[name];
    this.#ducks.push({ until: nowMs + duck.holdMs, releaseMs: duck.releaseMs, buses: duck.buses });
    this.#sync(DUCK_ATTACK_MS);
  }

  /** Once per frame: releases ducks whose hold has run out. */
  update(nowMs: number): void {
    const expired = this.#ducks.filter((d) => d.until <= nowMs);
    if (expired.length === 0) return;
    this.#ducks = this.#ducks.filter((d) => d.until > nowMs);
    this.#sync(Math.max(...expired.map((d) => d.releaseMs)));
  }

  /** The deepest duck currently held on a bus, dB (0 when none). */
  duckDb(bus: MixBusId): number {
    let deepest = 0;
    for (const d of this.#ducks) deepest = Math.min(deepest, d.buses[bus] ?? 0);
    return deepest;
  }

  #applySnapshot(rampSeconds: number): void {
    const snapshot = SNAPSHOTS[this.#snapshot];
    for (const bus of MIX_BUS_IDS) {
      const mix = snapshot.buses[bus];
      this.#engine.setSnapshot(
        bus,
        dbToGain(mix?.gainDb ?? 0),
        mix?.lowpassHz ?? null,
        rampSeconds,
      );
    }
  }

  /** Sends any bus whose deepest duck changed; `rampMs` is the attack or the release. */
  #sync(rampMs: number): void {
    for (const bus of MIX_BUS_IDS) {
      const db = this.duckDb(bus);
      const sent = this.#sentDb.get(bus) ?? 0;
      if (db === sent) continue;
      this.#sentDb.set(bus, db);
      this.#engine.setDuck(bus, dbToGain(db), rampMs / 1000);
    }
  }
}
