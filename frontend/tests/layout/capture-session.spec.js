import { expect, test } from '@playwright/test';

const RECORDING_NAME = 'iq_20261031-103000_437550000Hz_2400000sps.cu8';

const status = (mode) => ({
  type: 'status',
  mode,
  center_freq: 438_150_000,
  sample_rate: 2_400_000,
  gain: 'auto',
  gains: [0, 10, 20],
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

function storedSession(payload) {
  const id = payload.recording_name.replace(/\.cu8$/, '');
  return {
    ...payload,
    schema_version: 1,
    id,
    recording_size_bytes: 1_024,
    image_name: payload.image_data_url ? `${id}.sstv.png` : null,
    request_sha256: 'a'.repeat(64),
    image_data_url: undefined,
  };
}

async function openDeck(page, { initialSessions = [], recordings = [], failFirstSessionPost = false } = {}) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const commands = [];
  const posts = [];
  let sessions = [...initialSessions];
  let shouldFailPost = failFirstSessionPost;
  let recording = false;
  const sockets = [];

  await page.route('**/api/recordings', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ recordings, recording }),
  }));
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      posts.push(payload);
      if (shouldFailPost) {
        shouldFailPost = false;
        await route.fulfill({ status: 500, json: { detail: 'temporary write failure' } });
        return;
      }
      const session = storedSession(payload);
      sessions = [session, ...sessions.filter((item) => item.id !== session.id)];
      await route.fulfill({ status: 200, json: { session } });
      return;
    }
    await route.fulfill({ status: 200, json: { sessions } });
  });
  await page.route('**/recordings/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64',
    ),
  }));
  await page.routeWebSocket('**/ws', (socket) => {
    sockets.push(socket);
    socket.onMessage((payload) => {
      const command = JSON.parse(String(payload));
      commands.push(command);
      if (command.cmd === 'set_mode') {
        socket.send(JSON.stringify(status(command.mode)));
        if (command.mode === 'sstv' || command.mode === 'radio') {
          socket.send(JSON.stringify({
            type: 'radio_config',
            tuned_freq: 437_550_000,
            bandwidth: 36_000,
            demod: 'nfm',
            squelch: -80,
          }));
        }
      } else if (command.cmd === 'record' && command.action === 'start') {
        recording = true;
        socket.send(JSON.stringify({ type: 'rec_status', recording: true }));
      } else if (command.cmd === 'record' && command.action === 'stop') {
        recording = false;
        socket.send(JSON.stringify({
          type: 'rec_status',
          recording: false,
          stopped: RECORDING_NAME,
          dropped: 0,
          lost_pct: 0,
        }));
      }
    });
    socket.send(JSON.stringify(status('idle')));
  });

  await page.goto('/?profile=steam-deck-iss');
  await expect(page.locator('#sstv-view')).toBeVisible();
  return { commands, posts, sockets };
}

test('Deck SSTV controls tune, capture the measured offset, save a review, and replay it', async ({ page }) => {
  const state = await openDeck(page);
  await expect(page.locator('#cb-freq')).toBeVisible();
  await expect(page.locator('#sstv-freq')).toBeVisible();
  await expect(page.locator('#cb-step')).toBeVisible();
  await expect(page.locator('#cb-gain')).toBeVisible();
  await expect(page.locator('#cb-session')).toBeVisible();

  const touchSizes = await page.evaluate(() => ({
    frequency: document.getElementById('freq').getBoundingClientRect().height,
    capture: document.getElementById('capture-review').getBoundingClientRect().height,
    replay: document.getElementById('replay-latest').getBoundingClientRect().height,
  }));
  expect(touchSizes.frequency).toBeGreaterThanOrEqual(48);
  expect(touchSizes.capture).toBeGreaterThanOrEqual(48);
  expect(touchSizes.replay).toBeGreaterThanOrEqual(48);

  await page.locator('#gain-auto').uncheck();
  await page.locator('#gain').focus();
  await page.locator('#gain').press('End');
  await expect.poll(() => state.commands.some((message) =>
    message.cmd === 'tune' && message.gain === 20,
  )).toBe(true);

  await page.locator('#freq').fill('437.560');
  await page.locator('#freq').press('Enter');
  await expect.poll(() => state.commands.some((message) =>
    message.cmd === 'tune' && message.center_freq === 438_160_000,
  )).toBe(true);
  await expect.poll(() => state.commands.some((message) =>
    message.cmd === 'config' && message.params?.tuned_freq === 437_560_000,
  )).toBe(true);

  await page.locator('#capture-review').click();
  await expect.poll(() => state.commands.some((message) =>
    message.cmd === 'record' && message.action === 'start',
  )).toBe(true);
  await expect(page.locator('#rec-iq')).toBeDisabled();
  const socket = state.sockets[0];
  socket.send(JSON.stringify({ type: 'radio_level', afc: { hz: -250, lock: true }, db: -50, open: false }));
  await page.waitForTimeout(1_050);
  socket.send(JSON.stringify({ type: 'radio_level', afc: { hz: 100, lock: true }, db: -48, open: false }));
  await page.locator('#capture-review').click();

  await expect.poll(() => state.posts.length).toBe(1);
  await expect(page.locator('#capture-review-status')).toContainText('Review saved');
  expect(state.posts[0]).toMatchObject({
    recording_name: RECORDING_NAME,
    center_freq_hz: 438_160_000,
    tuned_freq_hz: 437_560_000,
    sample_rate_sps: 2_400_000,
    bandwidth_hz: 36_000,
    demod: 'nfm',
    gain_db: 20,
    dropped_blocks: 0,
    image_data_url: null,
  });
  expect(state.posts[0].doppler_samples.map((sample) => sample.offset_hz)).toEqual([-250, 100]);
  expect(state.posts[0].doppler_samples[1].elapsed_s).toBeGreaterThanOrEqual(1);

  await page.locator('#replay-latest').click();
  await expect.poll(() => state.commands.some((message) =>
    message.cmd === 'config' && message.params?.file === RECORDING_NAME && message.params?.sstv === true,
  )).toBe(true);
});

test('failed review saves keep the payload available for retry', async ({ page }) => {
  const state = await openDeck(page, { failFirstSessionPost: true });
  await page.locator('#capture-review').click();
  await expect.poll(() => state.commands.some((message) =>
    message.cmd === 'record' && message.action === 'start',
  )).toBe(true);
  await page.locator('#capture-review').click();
  await expect(page.locator('#capture-review-status')).toContainText('Review save failed. IQ is saved.');
  await expect(page.locator('#capture-review')).toHaveText('Retry review save');
  await page.locator('#mode-tabs button[data-mode="radio"]').click();
  await expect(page.locator('#capture-review')).toBeVisible();

  await page.locator('#capture-review').click();
  await expect.poll(() => state.posts.length).toBe(2);
  await expect(page.locator('#capture-review-status')).toContainText('Review saved');
  expect(state.posts[1]).toEqual(state.posts[0]);
});

test('replay review shows metadata, carrier trace, image, and a replay action', async ({ page }) => {
  const session = {
    schema_version: 1,
    id: RECORDING_NAME.replace(/\.cu8$/, ''),
    recording_name: RECORDING_NAME,
    recording_size_bytes: 1_024,
    started_at: '2026-10-31T01:30:00Z',
    ended_at: '2026-10-31T01:32:00Z',
    center_freq_hz: 438_150_000,
    tuned_freq_hz: 437_550_000,
    sample_rate_sps: 2_400_000,
    bandwidth_hz: 36_000,
    demod: 'nfm',
    gain_db: 'auto',
    sstv_mode: 'Robot 36',
    dropped_blocks: 0,
    lost_pct: 0,
    doppler_samples: [
      { elapsed_s: 0, offset_hz: -300, locked: true },
      { elapsed_s: 1, offset_hz: -100, locked: true },
    ],
    image_name: `${RECORDING_NAME.replace(/\.cu8$/, '')}.sstv.png`,
    request_sha256: 'b'.repeat(64),
  };
  const state = await openDeck(page, { initialSessions: [session] });
  await page.locator('#mode-tabs button[data-mode="replay"]').click();
  const reviews = page.locator('#session-review-list');
  await expect(reviews).toContainText('437.5500 MHz · Robot 36');
  await expect(reviews).toContainText('measured carrier offset -300 to -100 Hz');
  await expect(reviews.locator('svg.session-trace')).toHaveCount(1);
  const tracePoints = reviews.locator('svg.session-trace circle');
  await expect(tracePoints).toHaveCount(2);
  expect(Number(await tracePoints.nth(1).getAttribute('cx'))).toBeLessThan(10);
  await expect(reviews.locator('img.session-image')).toHaveAttribute('alt', 'Decoded Robot 36 image');
  await expect(reviews.getByText('Download metadata')).toBeVisible();

  await reviews.getByRole('button', { name: 'Replay IQ' }).click();
  await expect.poll(() => state.commands.some((message) =>
    message.cmd === 'config' && message.params?.file === RECORDING_NAME && message.params?.sstv === true,
  )).toBe(true);
});

test('radio SSTV decode is a Deck toolbar toggle that enables review capture', async ({ page }) => {
  await openDeck(page);
  await page.locator('#mode-tabs button[data-mode="radio"]').click();
  await expect(page.locator('#cb-decode')).toBeVisible();
  await expect(page.locator('#capture-review')).toBeHidden();
  await page.locator('#sstv-decode').check();
  await expect(page.locator('#capture-review')).toBeVisible();
});

test('capture keeps reception settings fixed until review is saved', async ({ page }) => {
  const state = await openDeck(page);
  await page.locator('#capture-review').click();
  await expect(page.locator('#capture-review-status')).toContainText('Stop & save');
  const before = state.commands.length;
  await page.locator('#mode-tabs button[data-mode="radio"]').click();
  await page.locator('#replay-latest').click();
  await page.locator('#sstv-freq').click();
  await page.locator('#gain-auto').click();
  await expect(page.locator('#gain-auto')).toBeChecked();
  expect(state.commands.slice(before)).toEqual([]);
  await expect(page.locator('#capture-review-status')).toContainText('before changing reception settings or mode');
  await page.locator('#capture-review').click();
  await expect(page.locator('#capture-review-status')).toContainText('Review saved');
  await page.locator('#mode-tabs button[data-mode="radio"]').click();
  await expect.poll(() => state.commands.some((message) => message.cmd === 'set_mode' && message.mode === 'radio')).toBe(true);
});

test('review saves only image rows received during capture and their mode', async ({ page }) => {
  const state = await openDeck(page);
  const socket = state.sockets[0];
  const start = (mode) => socket.send(JSON.stringify({ type: 'sstv_start', mode, width: 1, height: 2 }));
  const row = () => socket.send(Buffer.from([4, 0, 0, 0, 255, 0, 0]));
  start('Old picture');
  row();
  await expect(page.locator('#sstv-status')).toContainText('Old picture');
  await page.locator('#capture-review').click();
  await page.locator('#capture-review').click();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0].image_data_url).toBeNull();
  expect(state.posts[0].sstv_mode).toBeNull();
  await page.locator('#capture-review').click();
  start('Robot 36');
  row();
  await expect(page.locator('#sstv-status')).toContainText('Robot 36');
  await page.locator('#capture-review').click();
  await expect.poll(() => state.posts.length).toBe(2);
  expect(state.posts[1].sstv_mode).toBe('Robot 36');
  expect(state.posts[1].image_data_url).toMatch(/^data:image\/png;base64,/);
});


test('ordinary IQ recording blocks mode and hardware tuning until stopped', async ({ page }) => {
  const state = await openDeck(page);
  await page.locator('#rec-iq').click();
  await expect(page.locator('#rec-iq')).toHaveText('■ Stop IQ recording');
  const before = state.commands.length;
  await page.locator('#mode-tabs button[data-mode="radio"]').click();
  await page.locator('#sstv-freq').click();
  expect(state.commands.slice(before)).toEqual([]);
  await expect(page.locator('#rec-iq-status')).toContainText('Stop IQ recording');
  await page.locator('#rec-iq').click();
  await expect(page.locator('#rec-iq')).toHaveText('● Record IQ');
  await page.locator('#mode-tabs button[data-mode="radio"]').click();
  await expect.poll(() => state.commands.some((message) => message.cmd === 'set_mode' && message.mode === 'radio')).toBe(true);
});
