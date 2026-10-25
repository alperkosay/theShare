import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/**
 * Zero-connection mode, end to end: the sender's real QR canvas is copied,
 * frame by frame, into a canvas that stands in for the receiver's camera
 * (getUserMedia → canvas.captureStream()). The receiver scans it with the
 * real detector (zxing-wasm in headless Chromium) and decodes the stream.
 * The copying samples the sender at its own pace, so frames get skipped and
 * repeated, much like a real camera.
 *
 * Both pages also count WebSocket and RTCPeerConnection constructions to
 * prove the mode opens no connection of any kind.
 */

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

async function fakeCameraAndCountConnections(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__connections = 0;
    for (const name of ['WebSocket', 'RTCPeerConnection'] as const) {
      const Original = window[name] as unknown as new (...args: unknown[]) => object;
      const Counted = function (this: unknown, ...args: unknown[]) {
        (w.__connections as number)++;
        return new Original(...args);
      };
      Counted.prototype = Original.prototype;
      Object.assign(Counted, Original);
      (window as unknown as Record<string, unknown>)[name] = Counted;
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 720;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, 720, 720);
    w.__showFrame = async (url: string) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.fillStyle = '#888';
      ctx.fillRect(0, 0, 720, 720);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 60, 60, 600, 600);
    };
    const stream = canvas.captureStream(30);
    navigator.mediaDevices.getUserMedia = async () => stream;
  });
}

const connections = (page: Page) => page.evaluate(() => (window as unknown as { __connections: number }).__connections);

/** Copies the sender's current code to the receiver's "camera" until the receiver has the data. */
async function relay(sender: Page, receiver: Page) {
  const canvas = sender.getByTestId('qr-stream');
  const result = receiver.getByTestId('air-result');
  const deadline = Date.now() + 90_000;
  while (!(await result.isVisible())) {
    expect(Date.now()).toBeLessThan(deadline);
    const url = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
    await receiver.evaluate((u) => (window as unknown as { __showFrame: (u: string) => Promise<void> }).__showFrame(u), url);
    await receiver.waitForTimeout(40);
  }
}

async function openAir(browserPage: Page, mode: 'send' | 'receive') {
  await browserPage.goto('/');
  await browserPage.getByTestId(`air-${mode}`).click();
  return connections(browserPage);
}

test('a file goes over the QR stream, with no connection opened', async ({ browser }) => {
  const sender = await (await browser.newContext()).newPage();
  const receiver = await (await browser.newContext()).newPage();
  for (const page of [sender, receiver]) await fakeCameraAndCountConnections(page);

  const before = { sender: await openAir(sender, 'send'), receiver: await openAir(receiver, 'receive') };

  const data = randomBytes(24_000); // incompressible: ~60 frames at the normal speed
  await sender.getByTestId('air-file-input').setInputFiles({ name: 'anahtar.bin', mimeType: 'application/octet-stream', buffer: data });
  await expect(sender.getByTestId('qr-stream')).toBeVisible();

  await relay(sender, receiver);

  const result = receiver.getByTestId('air-result');
  await expect(result).toHaveAttribute('data-kind', 'file');
  await expect(result).toContainText('anahtar.bin');
  const [download] = await Promise.all([receiver.waitForEvent('download'), receiver.getByTestId('air-download').click()]);
  expect(download.suggestedFilename()).toBe('anahtar.bin');
  expect(sha256(await readFile((await download.path())!))).toBe(sha256(data));

  expect(await connections(sender)).toBe(before.sender);
  expect(await connections(receiver)).toBe(before.receiver);
});

test('a text goes over the QR stream, and the receiver can join late', async ({ browser }) => {
  const sender = await (await browser.newContext()).newPage();
  const receiver = await (await browser.newContext()).newPage();
  for (const page of [sender, receiver]) await fakeCameraAndCountConnections(page);
  await openAir(sender, 'send');

  const text = 'Wi-Fi şifresi: <b>güçlü-parola-42</b> 🔑\n' + 'satır '.repeat(400);
  await sender.getByTestId('air-text-input').fill(text);
  await sender.getByTestId('air-text-send').click();
  // Let the plain blocks go by first: the receiver only ever sees mixed frames.
  await expect(sender.getByTestId('air-frame')).toContainText('eksiklerini', { timeout: 20_000 });

  await openAir(receiver, 'receive');
  await relay(sender, receiver);

  const result = receiver.getByTestId('air-result');
  await expect(result).toHaveAttribute('data-kind', 'text');
  // Shown as text, never as HTML.
  await expect(result.locator('.bubble-text')).toHaveText(text, { useInnerText: false });
  await expect(result.locator('b')).toHaveCount(0);
});
