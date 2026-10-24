// Screenshots in der Fenstergröße unter Sidecar. Erwartet den laufenden Dev-Server mit den
// Testdaten (`pnpm dev`, ohne SCHRITTMACHER_REPO) und legt die Bilder unter screenshots/ ab. Ein
// anderer Server wird mit URL=… angegeben.
//
// Sidecar zeigt auf dem iPad Pro 11" (bis 2022) einen Bildschirm von 1194 × 834 pt. Davon gehen
// die Menüleiste und die Titelleiste der Web-App aus Safari ab, zusammen 70 pt, gemessen an einem
// Screenshot am 24.10.2026. Mit FULLSCREEN=1 gilt die ganze Fläche.
import { mkdir } from 'node:fs/promises';
import { webkit } from 'playwright';

const URL = process.env.URL ?? 'http://127.0.0.1:5310/';
const SCREEN = { width: 1194, height: 834 };
const MENU_AND_TITLE_BAR = 70;
const viewport =
  process.env.FULLSCREEN === '1'
    ? SCREEN
    : { width: SCREEN.width, height: SCREEN.height - MENU_AND_TITLE_BAR };

const button = (page, title) => page.locator(`button[data-tip="${title}"]`);
const commit = (page, step) =>
  page.locator('.commit', { has: page.locator('.commit-step', { hasText: new RegExp(`^${step}$`) }) });

/** Zieht ein Element um dx/dy Pixel, wie mit Maus oder Pencil. */
async function dragBy(page, selector, dx, dy) {
  const box = await page.locator(selector).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

/** Schiebt die Commit-Liste bis auf ihre kleinste Höhe zusammen. */
const shrinkCommits = (page) => dragBy(page, '[aria-label="Höhe der Commit-Liste"]', 0, -400);

const SHOTS = [
  ['01-split-50', async () => {}],
  ['02-split-30', async (page) => page.getByRole('button', { name: '30/70' }).click()],
  ['03-untereinander', async (page) => button(page, 'Side-by-Side').click()],
  [
    '04-ohne-entfernte',
    async (page) => {
      await button(page, 'Side-by-Side').click();
      await page.locator('button[aria-label="Entfernte Zeilen zeigen"]').click();
    },
  ],
  ['05-drei-dateien', async (page) => commit(page, '05').click()],
  [
    '06-eingeklappt',
    async (page) => {
      await commit(page, '07').click();
      await button(page, 'Dateiliste einklappen').click();
      await shrinkCommits(page);
    },
  ],
  [
    '07-umbruch',
    async (page) => {
      await commit(page, '07').click();
      await shrinkCommits(page);
      await dragBy(page, '[aria-label="Breite der Dateiliste"]', 80, 0);
      await button(page, 'Zeilenumbruch').click();
    },
  ],
  [
    '08-zwei-commits',
    async (page) => {
      await commit(page, '04b').click();
      await commit(page, '07').click({ modifiers: ['Shift'] });
    },
  ],
  [
    '09-schrift-gross',
    async (page) => {
      await shrinkCommits(page);
      for (let i = 0; i < 3; i++) {
        await button(page, 'Schrift größer').click();
      }
    },
  ],
  ['10-ganze-datei', async (page) => button(page, 'Ganze Datei zeigen').click()],
  [
    '11-mehr-zeilen',
    async (page) => {
      await commit(page, '07').click();
      await page.locator('.file', { hasText: 'LoanService' }).click();
      await page.locator('button[data-tip^="Mehr Zeilen"]').click();
    },
  ],
  [
    '12-tooltip',
    async (page) => {
      await page.locator('.commit', { hasText: 'Ein REST-Endpunkt' }).hover();
      await page.waitForTimeout(700);
    },
  ],
  ['13-aufgeklappt', async (page) => page.locator('.pane-new .gap-toggle').first().click()],
];

await mkdir('screenshots', { recursive: true });
const browser = await webkit.launch();
const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
for (const [name, act] of SHOTS) {
  const page = await context.newPage();
  await page.goto(URL);
  await page.locator('.diff').waitFor();
  await act(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/${name}.png` });
  await page.close();
  console.log(`screenshots/${name}.png`);
}
await browser.close();
console.log(`Viewport ${String(viewport.width)} × ${String(viewport.height)}`);
