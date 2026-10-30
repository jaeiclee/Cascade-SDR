import { expect, test } from '@playwright/test';

const status = (mode) => ({
  type: 'status',
  mode,
  center_freq: 437_550_000,
  sample_rate: 2_400_000,
  gain: 'auto',
  gains: [],
  device_present: false,
  running: false,
  ppm: 0,
  bias_tee: false,
  converter_on: false,
  converter_hz: 125_000_000,
  direct_sampling: false,
  tuner_bw: 0,
  rtl_agc: false,
  drops: {},
});

async function openPictureMode(page, mode, height) {
  await page.setViewportSize({ width: 1280, height });
  await page.route('**/api/recordings', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }));
  await page.routeWebSocket('**/ws', (socket) => {
    socket.onMessage((payload) => {
      const command = JSON.parse(String(payload));
      if (command.cmd === 'set_mode') socket.send(JSON.stringify(status(command.mode)));
    });
    socket.send(JSON.stringify(status('idle')));
  });

  await page.goto('/?profile=steam-deck-iss');
  if (mode === 'apt') {
    await expect(page.locator('#sstv-view')).toBeVisible();
    await page.locator('#mode-tabs button[data-mode="apt"]').click();
  }
  await expect(page.locator(`#${mode}-view`)).toBeVisible();
}

async function measure(page, mode) {
  return page.evaluate((viewMode) => {
    const box = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      steamDeckProfile: document.body.classList.contains('steam-deck'),
      pictureMode: document.querySelector('.display').classList.contains('picture-mode'),
      display: getComputedStyle(document.querySelector('.display')).display,
      graph: box('#fft-view'),
      image: box(`#${viewMode}-view`),
      scope: box('#scope'),
      waterfall: box('#waterfall'),
      zoom: box('#zoom-out'),
    };
  }, mode);
}

for (const mode of ['sstv', 'apt']) {
  for (const height of [800, 720, 600, 500]) {
    test(`${mode.toUpperCase()} graphs and picture stay readable at 1280x${height}`, async ({ page }) => {
      await openPictureMode(page, mode, height);
      const layout = await measure(page, mode);

      expect(layout.steamDeckProfile).toBe(true);
      expect(layout.scope.height).toBeGreaterThanOrEqual(height <= 640 ? 120 : 90);
      expect(layout.waterfall.height).toBeGreaterThanOrEqual(160);
      expect(layout.image.height).toBeGreaterThanOrEqual(height <= 640 ? 250 : 280);
      expect(layout.zoom.y).toBeGreaterThanOrEqual(layout.scope.bottom - 1);
      expect(layout.pictureMode).toBe(true);

      if (height <= 640) {
        expect(layout.display).toBe('grid');
        expect(layout.graph.right).toBeLessThanOrEqual(layout.image.x);
      } else {
        expect(layout.graph.bottom).toBeLessThanOrEqual(layout.image.y);
      }
    });
  }
}

test('leaving SSTV clears the picture-specific layout state', async ({ page }) => {
  await openPictureMode(page, 'sstv', 500);
  await page.locator('#mode-tabs button[data-mode="idle"]').click();
  await expect(page.locator('#sstv-view')).toBeHidden();
  const state = await page.evaluate(() => ({
    pictureMode: document.querySelector('.display').classList.contains('picture-mode'),
    compact: document.getElementById('fft-view').classList.contains('compact'),
    display: getComputedStyle(document.querySelector('.display')).display,
  }));
  expect(state).toEqual({ pictureMode: false, compact: false, display: 'flex' });
});
