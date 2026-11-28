import { describe, expect, it } from 'vitest';
import { airFieldConfig, DEFAULT_FIELD_CONFIG } from './config';
import { stepField } from './diffusion';
import { ElementField } from './grid';

const CELL = { x: 3, y: 1, z: 3 };

describe('the field ambient follows the scene air (mw-e03.62)', () => {
  it('AC-1: with no air setting the field is the default 20 °C one', () => {
    expect(airFieldConfig()).toEqual({});
    const field = new ElementField(airFieldConfig());
    expect(field.config.temperature.ambient).toBe(DEFAULT_FIELD_CONFIG.temperature.ambient);
    expect(field.read('temperature', CELL)).toBe(20);
  });

  it('AC-6: the air temperature is the temperature channel ambient, and is range-checked', () => {
    const field = new ElementField(airFieldConfig(-5));
    expect(field.config.temperature.ambient).toBe(-5);
    expect(field.read('temperature', CELL)).toBe(-5);
    expect(field.read('moisture', CELL)).toBe(0);
    expect(() => new ElementField(airFieldConfig(-400))).toThrow(RangeError);
  });

  it('AC-4: a cold scene with no heat sources steps no chunks, and a disturbance settles back to its ambient', () => {
    const field = new ElementField(airFieldConfig(-5));
    expect(stepField(field).activeChunks).toBe(0);
    field.set('temperature', CELL, 15);
    let last = stepField(field);
    expect(last.activeChunks).toBeGreaterThan(0);
    for (let i = 0; i < 2000; i++) last = stepField(field);
    expect(last.activeChunks).toBe(0);
    expect(field.read('temperature', CELL)).toBe(-5);
  });
});
