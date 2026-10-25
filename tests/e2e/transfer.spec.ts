import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** The code a page shows as QR (also exposed as data-code), once it matches `pattern`. */
async function readCode(page: Page, pattern: RegExp): Promise<string> {
  const qr = page.getByTestId('qr-code');
  await expect(qr).toHaveAttribute('data-code', pattern, { timeout: 20_000 });
  return (await qr.getAttribute('data-code'))!;
}

async function pasteCode(page: Page, code: string): Promise<void> {
  await page.getByTestId('paste-toggle').click();
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-submit').click();
}

async function expectConnected(host: Page, joiner: Page): Promise<void> {
  for (const page of [host, joiner]) {
    await expect(page.getByTestId('link-status')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
  }
  await expect(host.getByTestId('pairing-code')).toHaveText(await joiner.getByTestId('pairing-code').innerText());
}

/**
 * Pairs two pages with the offline QR flow (codes pasted as text). No internet needed.
 * `reload: false` keeps the host page as it is (e.g. to keep its in-memory pending queue).
 */
async function pair(host: Page, joiner: Page, { reload = true } = {}): Promise<void> {
  if (reload) await host.goto('/');
  else await host.getByTestId('tab-devices').click();
  await host.getByTestId('qr-host').click();
  const offer = await readCode(host, /#s=TS[1Z]\./);

  await joiner.goto('/');
  await joiner.getByTestId('qr-join').click();
  await pasteCode(joiner, offer);
  const answer = await readCode(joiner, /^TS[1Z]\./);

  await pasteCode(host, answer);
  await expectConnected(host, joiner);
}

async function twoDevices(browserA: Browser, browserB: Browser = browserA) {
  const a = await (await browserA.newContext()).newPage();
  const b = await (await browserB.newContext()).newPage();
  return { a, b };
}

async function transferFiles(sender: Page, receiver: Page, files: Array<{ name: string; buffer: Buffer }>) {
  await sender.getByTestId('file-input').setInputFiles(files.map((f) => ({ ...f, mimeType: 'application/octet-stream' })));

  const incoming = receiver.locator('[data-testid=transfer][data-direction=in]').first();
  await expect(incoming).toHaveAttribute('data-status', 'pending');
  await incoming.getByTestId('accept').click();

  await expect(incoming).toHaveAttribute('data-status', 'done', { timeout: 90_000 });
  await expect(sender.locator('[data-testid=transfer][data-direction=out]').first()).toHaveAttribute('data-status', 'done');

  // Downloads appear newest-transfer-first; check every file's content.
  const buttons = incoming.getByTestId('download');
  await expect(buttons).toHaveCount(files.length);
  for (let i = 0; i < files.length; i++) {
    const [download] = await Promise.all([receiver.waitForEvent('download'), buttons.nth(i).click()]);
    expect(download.suggestedFilename()).toBe(files[i]!.name);
    expect(sha256(await readFile((await download.path())!))).toBe(sha256(files[i]!.buffer));
  }
}

test('Chromium ↔ Chromium: pair via text, send several files incl. empty and large', async ({ browser }) => {
  const { a: host, b: joiner } = await twoDevices(browser);
  await pair(host, joiner);

  await transferFiles(host, joiner, [
    { name: 'merhaba.txt', buffer: Buffer.from('Merhaba theShare! ğüşıöç') },
    { name: 'bos.bin', buffer: Buffer.alloc(0) },
    { name: 'buyuk.bin', buffer: randomBytes(48 * 1024 * 1024 + 123) },
  ]);

  // The channel is bidirectional: the joiner can send back.
  await transferFiles(joiner, host, [{ name: 'geri.txt', buffer: Buffer.from('cevap') }]);
});

test('text messages arrive as bubbles; peers show each other\'s name and OS', async ({ browser }) => {
  const host = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' })).newPage();
  const joiner = await (await browser.newContext()).newPage();
  await pair(host, joiner);

  // Each side shows the other's random name and device label (from the hello message).
  await expect(joiner.getByTestId('peer-label')).toHaveText(/iPhone/);
  await expect(joiner.getByTestId('peer-name')).toHaveText(/^\S+ \S+$/);
  await expect(host.getByTestId('peer-label')).toHaveText(/Windows bilgisayar/);

  // Texts live in the "Pano" tab; the receiver gets an unread badge until it opens it.
  await host.getByTestId('tab-clipboard').click();
  const note = 'Merhaba 👋\nikinci satır <b>html değil</b>';
  await host.getByTestId('text-input').fill(note);
  await host.getByTestId('text-send').click();
  await expect(joiner.getByTestId('tab-clipboard')).toContainText('1');
  await joiner.getByTestId('tab-clipboard').click();
  const incoming = joiner.locator('[data-testid=message][data-direction=in]').first();
  await expect(incoming).toContainText('ikinci satır <b>html değil</b>'); // rendered as text
  await expect(host.locator('[data-testid=message][data-direction=out]')).toHaveCount(1);

  // A bare link gets an "open" button.
  await joiner.getByTestId('text-input').fill('https://example.com/yol?a=1');
  await joiner.getByTestId('text-input').press('Control+Enter');
  await expect(host.locator('[data-testid=message][data-direction=in]').first().getByRole('link', { name: 'Aç' })).toHaveAttribute(
    'href',
    'https://example.com/yol?a=1',
  );
});

test('receiver can reject; sender sees it', async ({ browser }) => {
  const { a: host, b: joiner } = await twoDevices(browser);
  await pair(host, joiner);

  await host.getByTestId('file-input').setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await joiner.locator('[data-testid=transfer][data-direction=in]').getByTestId('reject').click();
  await expect(host.locator('[data-testid=transfer][data-direction=out]').first()).toHaveAttribute('data-status', 'rejected');
});

test('cancel mid-transfer and disconnect are reported on the other side', async ({ browser }, testInfo) => {
  const { a: host, b: joiner } = await twoDevices(browser);
  await pair(host, joiner);

  // Playwright only accepts in-memory buffers up to 50 MB; larger files go through disk.
  const bigFile = testInfo.outputPath('big.bin');
  await writeFile(bigFile, randomBytes(300 * 1024 * 1024));
  await host.getByTestId('file-input').setInputFiles(bigFile);
  const incoming = joiner.locator('[data-testid=transfer][data-direction=in]').first();
  await incoming.getByTestId('accept').click();
  await expect(incoming).toHaveAttribute('data-status', 'active');
  await incoming.getByTestId('cancel').click();
  await expect(host.locator('[data-testid=transfer][data-direction=out]').first()).toHaveAttribute('data-status', 'cancelled');

  // Closing one side shows a disconnect on the other.
  await joiner.close();
  await expect(host.getByTestId('link-status')).toHaveAttribute('data-state', 'failed', { timeout: 30_000 });
});

test('invalid and mismatched codes show a clear error', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('qr-join').click();
  await pasteCode(page, 'bu bir kod değil');
  await expect(page.getByRole('alert')).toContainText('theShare bağlantı kodu değil');

  await page.getByTestId('code-input').fill('TS1.AAAA');
  await page.getByTestId('code-submit').click();
  await expect(page.getByRole('alert')).toContainText(/bozuk|sürüm/);
});

test('opening the offer link directly starts joining', async ({ browser }) => {
  const { a: host, b: joiner } = await twoDevices(browser);
  await host.goto('/');
  await host.getByTestId('qr-host').click();
  const offer = await readCode(host, /#s=TS[1Z]\./);

  await joiner.goto(offer.replace(/^https?:\/\/[^/]+/, ''));
  await readCode(joiner, /^TS[1Z]\./);
  expect(new URL(joiner.url()).hash).toBe(''); // single-use code removed from the address bar
});

// These use the public WebTorrent trackers, so they need internet access.
test.describe('6-digit code pairing (public trackers)', () => {
  test.describe.configure({ retries: 1 });

  test('pair by typing the code, then transfer', async ({ browser }) => {
    const { a: host, b: joiner } = await twoDevices(browser);
    await host.goto('/');
    await host.getByTestId('start-host').click();
    const code = (await host.getByTestId('pair-code').getAttribute('data-code'))!;
    expect(code).toMatch(/^\d{6}$/);

    await joiner.goto('/');
    await joiner.getByTestId('start-join').click();
    await joiner.getByTestId('pair-code-input').fill(`${code.slice(0, 3)} ${code.slice(3)}`); // connects on the 6th digit
    await expectConnected(host, joiner);
    await transferFiles(joiner, host, [{ name: 'kodla.txt', buffer: Buffer.from('6 haneli kod çalışıyor') }]);
  });

  test('opening the code link (QR on the code screen) joins automatically', async ({ browser }) => {
    const { a: host, b: joiner } = await twoDevices(browser);
    await host.goto('/');
    await host.getByTestId('start-host').click();
    const link = await readCode(host, /#k=\d{6}$/);
    await joiner.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await expectConnected(host, joiner);
  });

  test('a wrong code fails with a clear message', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await page.getByTestId('start-join').click();
    await page.getByTestId('pair-code-input').fill('000000');
    await expect(page.getByRole('alert')).toContainText('bekleyen bir cihaz bulunamadı', { timeout: 40_000 });
  });
});

// Two contexts on this machine share a public IP, i.e. they are "nearby". Needs internet (STUN + trackers).
test('nearby devices see each other and connect after approval', async ({ browser }) => {
  test.setTimeout(90_000);
  const { a, b } = await twoDevices(browser);
  await Promise.all([a.goto('/'), b.goto('/')]);
  const nameA = (await a.getByTestId('self-name').getAttribute('data-name'))!;
  const nameB = (await b.getByTestId('self-name').getAttribute('data-name'))!;

  // A sees B in its list and asks to connect.
  await a.locator(`[data-testid=nearby-device][data-name="${nameB}"]`).click({ timeout: 30_000 });

  // B gets a request naming A and accepts it.
  const request = b.getByTestId('nearby-request');
  await expect(request).toContainText(nameA, { timeout: 30_000 });
  await b.getByTestId('nearby-accept').click();

  await expectConnected(a, b);
  await transferFiles(a, b, [{ name: 'yakin.txt', buffer: Buffer.from('yakındaki cihaz') }]);
});

test('multiple files can be sent as one ZIP', async ({ browser }, testInfo) => {
  const { a: host, b: joiner } = await twoDevices(browser);
  await pair(host, joiner);

  const files = [
    { name: 'a.txt', buffer: Buffer.from('birinci') },
    { name: 'şekil.bin', buffer: randomBytes(2 * 1024 * 1024) },
    { name: 'a.txt', buffer: Buffer.from('aynı isim') },
  ];
  await host.getByTestId('zip-toggle').check();
  await host.getByTestId('file-input').setInputFiles(files.map((f) => ({ ...f, mimeType: 'application/octet-stream' })));

  const incoming = joiner.locator('[data-testid=transfer][data-direction=in]').first();
  await incoming.getByTestId('accept').click();
  await expect(incoming).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
  const [download] = await Promise.all([joiner.waitForEvent('download'), incoming.getByTestId('download').click()]);
  expect(download.suggestedFilename()).toMatch(/^theShare_.*\.zip$/);

  // Extract with a real unzip tool: bsdtar on Windows/macOS, unzip on Linux (GNU tar can't read zip).
  const zipPath = testInfo.outputPath('received.zip');
  const outDir = testInfo.outputPath('unzipped');
  await download.saveAs(zipPath);
  await mkdir(outDir, { recursive: true });
  if (process.platform === 'linux') execFileSync('unzip', ['-q', zipPath, '-d', outDir]);
  else if (process.platform === 'win32') execFileSync(`${process.env.SystemRoot}\\System32\\tar.exe`, ['-xf', zipPath, '-C', outDir]);
  else execFileSync('tar', ['-xf', zipPath, '-C', outDir]);
  expect(sha256(await readFile(join(outDir, 'a.txt')))).toBe(sha256(files[0]!.buffer));
  expect(sha256(await readFile(join(outDir, 'şekil.bin')))).toBe(sha256(files[1]!.buffer));
  expect(sha256(await readFile(join(outDir, 'a (1).txt')))).toBe(sha256(files[2]!.buffer));
});

test('app opens offline after the first visit', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled by the service worker
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('start-host')).toBeVisible();
  await context.close();
});

// Playwright's patched Firefox build gathers no ICE candidates at all (no
// icecandidate events, even with host obfuscation and loopback enabled), so
// Firefox interop can't be verified here. Kept for environments where it works:
// THESHARE_E2E_FIREFOX=1 npm run test:e2e
test('Chromium ↔ Firefox interop', async ({ browser, playwright }) => {
  test.skip(!process.env.THESHARE_E2E_FIREFOX, 'Playwright Firefox has no working WebRTC ICE in this environment');
  const firefox = await playwright.firefox.launch({
    firefoxUserPrefs: { 'media.peerconnection.ice.obfuscate_host_addresses': false },
  });
  try {
    const { a: chrome, b: ff } = await twoDevices(browser, firefox);
    await pair(chrome, ff);
    await transferFiles(chrome, ff, [{ name: 'c2f.bin', buffer: randomBytes(3 * 1024 * 1024) }]);
    await transferFiles(ff, chrome, [{ name: 'f2c.bin', buffer: randomBytes(3 * 1024 * 1024) }]);
  } finally {
    await firefox.close();
  }
});

test('name, history, resend after reconnecting (via the pending queue) and reset', async ({ browser }) => {
  const { a: host, b: joiner } = await twoDevices(browser);

  // A random name until changed from the profile; the other side sees the new one.
  await host.goto('/');
  await host.getByTestId('profile-chip').click();
  await host.getByTestId('name-input').fill('Alper 👋');
  await host.getByTestId('name-save').click();
  await host.keyboard.press('Escape');
  await expect(host.getByTestId('profile-chip')).toContainText('Alper 👋');
  await pair(host, joiner); // reloads: the name is persisted
  await expect(joiner.getByTestId('peer-name')).toHaveText('Alper 👋');

  const file = { name: 'rapor.bin', buffer: randomBytes(300 * 1024) };
  await transferFiles(host, joiner, [file]);

  // Both sides have it in their history, with time and the other device's type.
  await host.getByTestId('tab-history').click();
  const sent = host.locator('[data-testid=history-row][data-direction=out]').first();
  await expect(sent).toContainText('rapor.bin');
  await expect(sent).toContainText(/\d{2}:\d{2}/);
  await expect(sent).toContainText('Windows bilgisayar');
  await joiner.getByTestId('tab-history').click();
  await expect(joiner.locator('[data-testid=history-row][data-direction=in]').first()).toContainText('Alper 👋');

  // It survives a reload.
  await host.reload();
  await host.getByTestId('tab-history').click();
  await expect(host.getByTestId('history-row')).toHaveCount(1);

  // Not connected: "resend" queues it; it goes out by itself on the next connection.
  await host.getByTestId('history-row').first().click();
  await expect(host.getByTestId('resend')).toHaveText(/Bağlanınca gönder/);
  await host.getByTestId('resend').click();
  await expect(host.getByTestId('pending')).toContainText('rapor.bin');
  await pair(host, joiner, { reload: false });
  const incoming = joiner.locator('[data-testid=transfer][data-direction=in]').first();
  await incoming.getByTestId('accept').click();
  await expect(incoming).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  const [download] = await Promise.all([joiner.waitForEvent('download'), incoming.getByTestId('download').click()]);
  expect(sha256(await readFile((await download.path())!))).toBe(sha256(file.buffer));
  await expect(host.getByTestId('pending')).toHaveCount(0);

  // "Reset everything" leaves nothing behind.
  await host.getByTestId('tab-history').click();
  await expect(host.getByTestId('history-row')).toHaveCount(2);
  await host.getByTestId('profile-chip').click();
  host.once('dialog', (d) => void d.accept());
  await host.getByTestId('reset-all').click();
  await expect(host.getByTestId('profile-chip')).not.toContainText('Alper');
  await host.keyboard.press('Escape');
  await expect(host.getByTestId('history-row')).toHaveCount(0);
  const stored = await host.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('theshare');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const count = (store: string) =>
      new Promise<number>((resolve) => {
        const req = db.transaction(store).objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
      });
    return { history: await count('history'), files: await count('files') };
  });
  expect(stored).toEqual({ history: 0, files: 0 });
});

test('received images get a thumbnail that opens a full-screen preview', async ({ browser }) => {
  const { a: host, b: joiner } = await twoDevices(browser);
  await pair(host, joiner);
  // 1×1 PNG, sent with a misleading name and type: previews go by content.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await host.getByTestId('file-input').setInputFiles([
    { name: 'foto.dat', mimeType: 'application/octet-stream', buffer: png },
    { name: 'not.txt', mimeType: 'text/plain', buffer: Buffer.from('metin') },
  ]);
  const incoming = joiner.locator('[data-testid=transfer][data-direction=in]').first();
  await incoming.getByTestId('accept').click();
  await expect(incoming).toHaveAttribute('data-status', 'done');

  await expect(incoming.getByTestId('thumb')).toHaveCount(1); // only the image
  await incoming.getByTestId('thumb').click();
  const viewer = joiner.getByTestId('viewer');
  await expect(viewer.locator('img')).toHaveJSProperty('naturalWidth', 1);
  await expect(viewer).toContainText('foto.dat');
  await joiner.getByTestId('viewer-close').click();
  await expect(viewer).toHaveCount(0);

  // The sender can preview what it sent, too.
  await expect(host.locator('[data-testid=transfer][data-direction=out]').first().getByTestId('thumb')).toHaveCount(1);
});

test('theme can be switched in the profile and is remembered', async ({ page }) => {
  await page.goto('/');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'soft'); // the default
  await page.getByTestId('profile-chip').click();
  await page.getByTestId('theme-pastel').click();
  await expect(root).toHaveAttribute('data-theme', 'pastel');
  await expect(page.getByTestId('theme-pastel')).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'pastel');
  await page.getByTestId('profile-chip').click();
  await page.getByTestId('theme-mono').click();
  await expect(root).toHaveAttribute('data-theme', 'mono');
});
