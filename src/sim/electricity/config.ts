// Tuning of electrical conduction (mw-e03.8): plain data, game values.

/** Tuning of conduction (see `conductionRules`). */
export interface ConductionConfig {
  /**
   * The falloff per hop, in (0, 1]: charge delivered across one contact is this fraction of what the
   * sending entity holds, so an entity `n` hops from the strike holds `charge × falloffPerHop^n`.
   * A hop is one contact or overlap between two conducting things, nothing to do with distance.
   */
  readonly falloffPerHop: number;
  /** Most entities one flood reaches (≥ 1); the rest of a larger network is not charged this tick. */
  readonly maxNodes: number;
  /** Gap, m (≥ 0), up to which two things still touch (resting contacts are never exact). */
  readonly contactGap: number;
  /** Charge below which an entity is neutral again, and below which a flood stops (> 0). */
  readonly minCharge: number;
  /** Seconds in which held charge halves while it drains away (> 0): a strike is brief. */
  readonly halfLifeSeconds: number;
  /** Charge at or above which an entity is shocked (> 0). */
  readonly shockCharge: number;
  /** Charge at or above which an entity that can burn is heated to its ignition point (> 0). */
  readonly ignitionCharge: number;
}

/** The default tuning: 80% crosses each hop, 256-node floods, a strike drains in about a second. */
export const DEFAULT_CONDUCTION_CONFIG: ConductionConfig = Object.freeze({
  falloffPerHop: 0.8,
  maxNodes: 256,
  contactGap: 0.05,
  minCharge: 0.01,
  halfLifeSeconds: 0.15,
  shockCharge: 10,
  ignitionCharge: 500,
});

/** The full, validated config for `input` over the defaults. Throws a RangeError. */
export function resolveConductionConfig(input: Partial<ConductionConfig> = {}): ConductionConfig {
  const config = { ...DEFAULT_CONDUCTION_CONFIG, ...input };
  const positive = (key: keyof ConductionConfig): void => {
    if (!(config[key] > 0) || !Number.isFinite(config[key])) {
      throw new RangeError(`conduction config ${key} must be a finite number > 0`);
    }
  };
  if (!(config.falloffPerHop > 0 && config.falloffPerHop <= 1)) {
    throw new RangeError('conduction config falloffPerHop must be in (0, 1]');
  }
  if (!Number.isInteger(config.maxNodes) || config.maxNodes < 1) {
    throw new RangeError('conduction config maxNodes must be an integer ≥ 1');
  }
  if (!(config.contactGap >= 0) || !Number.isFinite(config.contactGap)) {
    throw new RangeError('conduction config contactGap must be a finite number ≥ 0');
  }
  positive('minCharge');
  positive('halfLifeSeconds');
  positive('shockCharge');
  positive('ignitionCharge');
  return config;
}
