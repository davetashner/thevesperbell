// mw-e31.8: colour is never the only cue. The component gallery's indicator bars, in the production
// build, under each colour-blind palette preset: adjacent bars differ by at least 3:1 under the
// simulated deficiency, and every bar kind wears its own pattern.
import { expect, test } from '@playwright/test';
import { openUiPage } from './helpers/ui';

const SETTINGS_KEY = 'vesper-bell.settings';

// Machado, Oliveira and Fernandes (2009), severity 1.0, on linear light.
const MATRICES: Record<string, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function luminance(rgb: number[], deficiency: string): number {
  const l = rgb.map(lin);
  const m = MATRICES[deficiency] ?? [];
  const [r = 0, g = 0, b = 0] = m.map((row) =>
    Math.min(
      1,
      Math.max(
        0,
        row.reduce((sum, k, i) => sum + k * (l[i] ?? 0), 0),
      ),
    ),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number[], b: number[], deficiency: string): number {
  const la = luminance(a, deficiency);
  const lb = luminance(b, deficiency);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

async function barFills(page: import('@playwright/test').Page): Promise<Record<string, number[]>> {
  return page.evaluate(() => {
    const out: Record<string, number[]> = {};
    for (const meter of document.querySelectorAll<HTMLElement>(
      '[data-testid="indicator-bars"] .vb-meter',
    )) {
      const colour = getComputedStyle(
        meter.querySelector('.vb-meter-fill') ?? meter,
      ).backgroundColor;
      const numbers = colour.match(/\d+(\.\d+)?/g) ?? [];
      out[meter.dataset['kind'] ?? ''] = numbers.slice(0, 3).map(Number);
    }
    return out;
  });
}

for (const preset of ['deuteranopia', 'protanopia', 'tritanopia']) {
  test(`AC-2: under ${preset}, adjacent bar colours of the ${preset} palette differ by 3:1 or more`, async ({
    page,
  }) => {
    await page.addInitScript(
      ([key, id]) => {
        window.localStorage.setItem(
          String(key),
          JSON.stringify({ version: 3, settings: { accessibility: { indicatorPalette: id } } }),
        );
      },
      [SETTINGS_KEY, preset],
    );
    await openUiPage(page);

    await expect(page.locator('.vb-ui[data-palette]')).toHaveAttribute('data-palette', preset);
    const fills = await barFills(page);
    for (const [a, b] of [
      ['health', 'stamina'],
      ['stamina', 'mana'],
    ] as const) {
      const ratio = contrast(fills[a] ?? [], fills[b] ?? [], preset);
      expect(ratio, `${a} | ${b} as ${preset}`).toBeGreaterThanOrEqual(3);
    }
  });
}

test('AC-1: every bar kind wears its own pattern in the browser', async ({ page }) => {
  await openUiPage(page);
  const patterns = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="indicator-bars"] .vb-meter')].map(
      (meter) => getComputedStyle(meter, '::after').backgroundImage,
    ),
  );
  expect(patterns).toHaveLength(5);
  // Health is solid; the other four are all different.
  expect(patterns[0]).toBe('none');
  expect(new Set(patterns.slice(1)).size).toBe(4);
});
