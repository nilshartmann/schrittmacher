// Screenshots in der Fenstergröße unter Sidecar. Erwartet den laufenden Dev-Server mit den
// Testdaten (`pnpm dev`) und legt die Bilder unter screenshots/ ab. Ein anderer Server wird mit
// URL=… angegeben. Vor jedem Bild wird der Zustand des Servers mit den Testdaten gelöscht, damit
// jedes Bild mit derselben Ansicht und denselben Einstellungen beginnt.
//
// Sidecar zeigt auf dem iPad Pro 11" (bis 2022) einen Bildschirm von 1194 × 834 pt. Davon gehen
// die Menüleiste und die Titelleiste der Web-App aus Safari ab, zusammen 70 pt, gemessen an einem
// Screenshot am 24.10.2026. Mit FULLSCREEN=1 gilt die ganze Fläche.
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webkit } from 'playwright';

/** Der Zustand des Servers mit den Testdaten, wie ihn `src/server/repo.functions.ts` anlegt. */
const STATE = join(tmpdir(), 'schrittmacher-testdaten', 'speicher', 'state.json');

/** So lange darf eine Anfrage zum Speichern nach dem Schließen der Seite noch unterwegs sein. */
const SETTLE = 800;

const URL = process.env.URL ?? 'http://127.0.0.1:5310/';
const SCREEN = { width: 1194, height: 834 };
const MENU_AND_TITLE_BAR = 70;
const viewport =
  process.env.FULLSCREEN === '1'
    ? SCREEN
    : { width: SCREEN.width, height: SCREEN.height - MENU_AND_TITLE_BAR };

/** Öffnet das Menü für Worktree und Branch. */
const whereMenu = (page) => page.getByRole('button', { name: 'Worktree und Branch', exact: true }).click();
/** Ein Worktree im Menü, gefunden über seinen Branch. */
const worktreeItem = (page, branch) => page.locator('.menu-worktree .menu-item', { hasText: branch });
/** Ein Branch im Menü, ohne die Worktrees, deren Zeile den Branch ebenfalls nennt. */
const branchItem = (page, name) =>
  page.locator('.menu-item').filter({ has: page.locator('.menu-main', { hasText: new RegExp(`^${name}$`) }) });
const button = (page, title) => page.locator(`button[data-tip="${title}"]`);
const commit = (page, step) =>
  page.locator('.commit', { has: page.locator('.commit-step', { hasText: new RegExp(`^${step}$`) }) });

/** Zieht ein Element um dx/dy Pixel, wie mit der Maus. */
async function dragBy(page, selector, dx, dy) {
  const box = await page.locator(selector).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

/** Wechselt in den Worktree mit live_coding und wählt dort die lokalen Änderungen. */
async function openLocal(page) {
  await whereMenu(page);
  await worktreeItem(page, 'live_coding').click();
  await page.locator('.commit-local').click();
  await page.locator('.file', { hasText: 'NOTIZEN.md' }).waitFor();
}

/** Öffnet live_coding in einem zweiten Tab, damit es mehr als einen gibt. */
async function secondTab(page) {
  await whereMenu(page);
  await branchItem(page, 'live_coding').first().hover();
  await page.getByRole('button', { name: 'live_coding in neuem Tab öffnen' }).click();
  await page.locator('.tab[aria-selected="true"]', { hasText: 'live_coding' }).waitFor();
}

/** Legt aus den offenen Tabs das Projekt „W-JAX“ an, ohne `alone` vorher mit einem zweiten Tab. */
async function createProject(page, alone = false) {
  if (!alone) {
    await secondTab(page);
  }
  await projectsMenu(page);
  await page.locator('.menu-sub-panel .menu-item', { hasText: 'Als neues Projekt speichern' }).click();
  await page.getByRole('textbox', { name: 'Name des Projekts' }).fill('W-JAX');
  await page.locator('.menu-sub-panel').getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.locator('.tabs-project').waitFor();
}

/** Öffnet das Untermenü „Projekte“ im Menü der Repos. */
async function projectsMenu(page) {
  await page.getByRole('button', { name: 'Repo', exact: true }).click();
  await page.locator('.menu-projects .menu-row').hover();
  await page.locator('.menu-sub-panel').waitFor();
}

/** Eine zuletzt geöffnete Ansicht im Menü der Repos, gefunden über den Chip ihres Branches. */
const viewItem = (page, branch) =>
  page
    .locator('.menu-panel-repos .menu-item')
    .filter({ has: page.locator('.menu-chip', { hasText: new RegExp(`^${branch}$`) }) })
    .first();

/** Zeigt die Ansicht mit einem anderen Worktree oder Branch als die geöffnete. */
async function gotoChanged(page, change) {
  const url = new globalThis.URL(page.url());
  change(url.searchParams);
  url.searchParams.delete('to');
  await page.goto(url.toString());
  await page.locator('.missing').waitFor();
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
      await commit(page, '07').click({ modifiers: ['Meta'] });
    },
  ],
  [
    '09-schrift-gross',
    async (page) => {
      await shrinkCommits(page);
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name: 'Schrift größer' }).click();
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
  ['14-menue-repo', async (page) => page.getByRole('button', { name: 'Repo', exact: true }).click()],
  ['15-menue-worktree', whereMenu],
  [
    '16-menue-branch',
    async (page) => {
      await whereMenu(page);
      await page.locator('.menu-toggle', { hasText: 'Remotes' }).click();
      // Der Ordner backup von origin, unter dem lokalen gleichen Namens
      await page.locator('.menu-toggle', { hasText: 'backup' }).last().click();
    },
  ],
  [
    '17-fremder-branch',
    async (page) => {
      await whereMenu(page);
      await branchItem(page, 'live_coding').click();
      await page.locator('.bar-tool-foreign').waitFor();
    },
  ],
  [
    '18-zuletzt',
    async (page) => {
      // Eine Ansicht wird erst gemerkt, wenn die Wahl eine Weile steht.
      await page.waitForTimeout(600);
      await whereMenu(page);
      await worktreeItem(page, 'live_coding').click();
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: 'Repo', exact: true }).click();
      await page.locator('.menu-divider', { hasText: 'Dieses Repo' }).waitFor();
    },
  ],
  [
    '19-branches-ausgeblendet',
    async (page) => {
      await whereMenu(page);
      await page.locator('.menu-toggle', { hasText: 'Remotes' }).click();
      await page.getByRole('button', { name: 'alle Branches von origin ausblenden' }).click();
      await page.getByRole('button', { name: 'main ausblenden' }).first().click();
      await page.mouse.move(0, 0);
    },
  ],
  [
    '20-menue-commit-liste',
    async (page) => page.getByRole('button', { name: 'Branches der Commit-Liste' }).click(),
  ],
  [
    '20a-mit-remote',
    async (page) => {
      await page.getByRole('button', { name: 'Branches der Commit-Liste' }).click();
      await page.getByRole('menuitem', { name: /mit Remote/ }).click();
      await page.locator('.commit-graph').first().waitFor();
    },
  ],
  [
    '20-alle-branches',
    async (page) => {
      await page.getByRole('button', { name: 'Branches der Commit-Liste' }).click();
      await page.getByRole('menuitem', { name: /^Alle Branches/ }).click();
      await page.locator('.commit-graph').first().waitFor();
      // Die Liste wird höher gezogen, damit die Abzweigung von live_coding zu sehen ist.
      const splitter = await page.locator('.height-splitter').boundingBox();
      if (splitter !== null) {
        await page.mouse.move(400, splitter.y + splitter.height / 2);
        await page.mouse.down();
        await page.mouse.move(400, 400, { steps: 5 });
        await page.mouse.up();
      }
      await page.mouse.move(0, 0);
    },
  ],
  [
    '20b-neuer-tab',
    async (page) => {
      await whereMenu(page);
      // Die Knöpfe einer Zeile erscheinen erst beim Überfahren.
      await branchItem(page, 'live_coding').first().hover();
      await page.getByRole('button', { name: 'live_coding in neuem Tab öffnen' }).click();
      await page.locator('.tab[aria-selected="true"]', { hasText: 'live_coding' }).waitFor();
      await whereMenu(page);
      await page.locator('.menu-toggle', { hasText: 'backup' }).first().click();
      await branchItem(page, 'schritte').first().hover();
      await page.getByRole('button', { name: 'Tab von schritte schließen' }).first().hover();
      await page.waitForTimeout(700);
    },
  ],
  ['23-lokale-aenderungen', openLocal],
  [
    '24-lokal-neue-datei',
    async (page) => {
      await openLocal(page);
      await page.locator('.file', { hasText: 'NOTIZEN.md' }).click();
    },
  ],
  [
    '25-tab-pfad-kopieren',
    async (page) => {
      await page.locator('.tab').first().hover();
      await page.locator('.hover-tool').first().hover();
      await page.waitForTimeout(700);
    },
  ],
  [
    '26-commit-auswahl',
    async (page) => {
      await openLocal(page);
      await page.getByRole('checkbox', { name: 'NOTIZEN.md committen' }).click();
      await page.getByLabel('Commit-Nachricht').fill('04a: Wann ist ein Buch überfällig?');
    },
  ],
  // Der Commit ändert das Repo der Testdaten und steht deshalb am Ende; danach braucht es einen
  // Neustart des Servers.
  [
    '27-commit-gepusht',
    async (page) => {
      await openLocal(page);
      await page.getByRole('checkbox', { name: 'NOTIZEN.md committen' }).click();
      await page.getByLabel('Commit-Nachricht').fill('04a: Wann ist ein Buch überfällig?');
      await page.getByRole('button', { name: 'Commit', exact: true }).click();
      await page.locator('.push-note-done').waitFor();
      // Den Badge des neuen Branches auf dem Remote zeigt die Liste erst mit der Wahl „mit Remote“.
      await page.getByRole('button', { name: 'Branches der Commit-Liste' }).click();
      await page.getByRole('menuitem', { name: /mit Remote/ }).click();
      await page.locator('.ref', { hasText: 'origin/live_coding' }).waitFor();
    },
  ],
  // Das Kopieren schreibt in den Worktree mit live_coding und steht deshalb ebenfalls am Ende.
  [
    '28-kopieren-nach',
    async (page) => {
      await whereMenu(page);
      // Die Knöpfe einer Zeile erscheinen erst beim Überfahren.
      await branchItem(page, 'live_coding').first().hover();
      await page.getByRole('button', { name: 'live_coding in neuem Tab öffnen' }).click();
      await page.locator('.tab[aria-selected="true"]', { hasText: 'live_coding' }).waitFor();
      await page.locator('.tab-label', { hasText: 'schritte' }).click();
      await commit(page, '07').click();
      const row = page.locator('.file-list li', { hasText: 'LoanService' });
      await row.click({ button: 'right' });
      await page.locator('.menu-context .menu-row', { hasText: 'Kopieren nach' }).hover();
      await page.locator('.menu-sub-panel .menu-item').first().hover();
    },
  ],
  [
    '29-kopiert',
    async (page) => {
      await whereMenu(page);
      // Die Knöpfe einer Zeile erscheinen erst beim Überfahren.
      await branchItem(page, 'live_coding').first().hover();
      await page.getByRole('button', { name: 'live_coding in neuem Tab öffnen' }).click();
      await page.locator('.tab[aria-selected="true"]', { hasText: 'live_coding' }).waitFor();
      await page.locator('.tab-label', { hasText: 'schritte' }).click();
      await commit(page, '07').click();
      const row = page.locator('.file-list li', { hasText: 'LoanService' });
      await row.click({ button: 'right' });
      await page.locator('.menu-context .menu-row', { hasText: 'Kopieren nach' }).hover();
      await page.locator('.menu-sub-panel .menu-item').first().click();
      await page.locator('.menu-sub-panel').waitFor({ state: 'detached' });
      await page.locator('.tab-label', { hasText: 'live_coding' }).click();
      await page.locator('.commit-local').click();
      await page.locator('.file', { hasText: 'LoanService' }).click();
    },
  ],
  ['30-info', async (page) => page.getByRole('button', { name: 'Angaben zum Commit' }).click()],
  [
    '31-info-aufgeklappt',
    async (page) => {
      await page.getByRole('button', { name: 'Angaben zum Commit' }).click();
      await page.locator('.info-more').click();
    },
  ],
  [
    '32-info-zwei-commits',
    async (page) => {
      await page.getByRole('button', { name: 'Angaben zum Commit' }).click();
      await commit(page, '04b').click();
      await commit(page, '07').click({ modifiers: ['Meta'] });
    },
  ],
  [
    '33-info-lokal',
    async (page) => {
      await page.getByRole('button', { name: 'Angaben zum Commit' }).click();
      await openLocal(page);
    },
  ],
  [
    '34-autor-datum',
    async (page) => {
      await page.getByRole('button', { name: 'Branches der Commit-Liste' }).click();
      await page.locator('.menu-item', { hasText: 'Datum des Autors' }).click();
    },
  ],
  [
    '35-projekt-neu',
    async (page) => {
      await secondTab(page);
      await projectsMenu(page);
      await page.locator('.menu-sub-panel .menu-item', { hasText: 'Als neues Projekt speichern' }).click();
      await page.getByRole('textbox', { name: 'Name des Projekts' }).fill('W-JAX');
    },
  ],
  [
    '36-projekt-geaendert',
    async (page) => {
      await createProject(page);
      // Verschoben weicht die Tableiste vom Projekt ab.
      const first = page.locator('.tab').first();
      const second = page.locator('.tab').nth(1);
      const box = await second.boundingBox();
      await first.dragTo(second, { targetPosition: { x: box.width - 20, y: box.height / 2 } });
      await page.locator('.tabs-project-changed').waitFor();
      await page.locator('.tabs-project').click();
    },
  ],
  [
    '37-projekte-menue',
    async (page) => {
      await createProject(page);
      await projectsMenu(page);
      await page.locator('.menu-sub-panel .menu-row', { hasText: 'W-JAX' }).hover();
      await page.waitForTimeout(700);
    },
  ],
  [
    '38-projekt-geoeffnet',
    async (page) => {
      await createProject(page);
      await page.getByRole('button', { name: 'Tab schließen' }).first().click();
      await page.locator('.tabs-project-changed').waitFor();
      await projectsMenu(page);
      await page.locator('.menu-sub-panel .menu-item', { hasText: 'W-JAX' }).click();
      await page.locator('.tab').nth(1).waitFor();
      await page.locator('.tabs-project-changed').waitFor({ state: 'detached' });
    },
  ],
  [
    '39-projekt-loeschen',
    async (page) => {
      await createProject(page);
      await projectsMenu(page);
      await page.locator('.menu-sub-panel .menu-row', { hasText: 'W-JAX' }).hover();
      await page.getByRole('button', { name: 'W-JAX löschen' }).click();
    },
  ],
  [
    '40-branch-fehlt',
    async (page) => {
      await gotoChanged(page, (search) => search.set('branch', 'gibt-es-nicht'));
      await createProject(page, true);
      await page.getByRole('button', { name: 'Aus „W-JAX“ entfernen' }).waitFor();
    },
  ],
  [
    '41-repo-fehlt',
    async (page) => {
      await gotoChanged(page, (search) => search.set('worktree', `${search.get('worktree')}-weg`));
      await page.locator('.tab-missing').hover();
      await page.waitForTimeout(700);
    },
  ],
  [
    '42-repo-neuer-tab-links',
    async (page) => {
      // Der Tab wechselt auf main; schritte bleibt als zuletzt geöffnete Ansicht im Menü der Repos.
      await whereMenu(page);
      await branchItem(page, 'main').first().click();
      await page.locator('.tab[aria-selected="true"]', { hasText: 'main' }).waitFor();
      await page.waitForTimeout(SETTLE);
      await page.getByRole('button', { name: 'Repo', exact: true }).click();
      await viewItem(page, 'schritte').click();
      await page.locator('.tab').nth(1).waitFor();
      // Eine Wahl, deren Tab schon offen ist, macht ihn nur aktiv.
      await page.getByRole('button', { name: 'Repo', exact: true }).click();
      await viewItem(page, 'main').click();
      await page.locator('.tab[aria-selected="true"]', { hasText: 'main' }).waitFor();
    },
  ],
  [
    '43-tabs-schliessen',
    async (page) => {
      await secondTab(page);
      await page.locator('.tab[aria-selected="true"]').click({ button: 'right' });
      await page.locator('.menu-context .menu-row', { hasText: 'Andere Tabs' }).hover();
    },
  ],
  [
    '44-alle-geschlossen',
    async (page) => {
      await secondTab(page);
      await page.locator('.tab[aria-selected="true"]').click({ button: 'right' });
      await page.locator('.menu-context .menu-item', { hasText: 'Alle Tabs schließen' }).click();
      await page.locator('.empty').waitFor();
      // Nach dem Neuladen bleibt die Seite ohne Tab.
      await page.reload();
      await page.locator('.empty').waitFor();
    },
  ],
  [
    '45-tab-verschoben',
    async (page) => {
      await secondTab(page);
      // schritte steht links; nach dem Ziehen hinter live_coding steht es rechts.
      const first = page.locator('.tab').first();
      const second = page.locator('.tab').nth(1);
      const box = await second.boundingBox();
      await first.dragTo(second, { targetPosition: { x: box.width - 20, y: box.height / 2 } });
      await page.locator('.tab').nth(1).filter({ hasText: 'schritte' }).waitFor();
    },
  ],
  [
    '46-projekt-ohne-tab',
    async (page) => {
      await createProject(page);
      await page.locator('.tab[aria-selected="true"]').click({ button: 'right' });
      await page.locator('.menu-context .menu-item', { hasText: 'Alle Tabs schließen' }).click();
      await page.locator('.empty').waitFor();
      await page.locator('.menu-projects .menu-row').hover();
      await page.locator('.menu-sub-panel .menu-item', { hasText: 'W-JAX' }).click();
      await page.locator('.tab').nth(1).waitFor();
      await page.locator('.tabs-project').waitFor();
    },
  ],
  // Der Abschnitt „Gists“ kommt ohne GitHub aus, solange kein Gist eingetragen ist.
  [
    '47-gists',
    async (page) => {
      await commit(page, '07').click();
      await page.locator('.file-list li', { hasText: 'LoanService' }).click({ button: 'right' });
      await page.locator('.menu-context .menu-row', { hasText: 'Kopieren nach' }).hover();
      await page.locator('.menu-sub-panel .menu-item', { hasText: 'Neuer Gist' }).hover();
    },
  ],
  [
    '48-neuer-gist',
    async (page) => {
      await commit(page, '07').click();
      await page.locator('.file-list li', { hasText: 'LoanService' }).click({ button: 'right' });
      await page.locator('.menu-context .menu-row', { hasText: 'Kopieren nach' }).hover();
      await page.locator('.menu-sub-panel .menu-item', { hasText: 'Neuer Gist' }).click();
      await page.getByRole('textbox', { name: 'Beschreibung des Gists' }).fill('Workshop, Probe');
    },
  ],
  [
    '49-gist-eintragen',
    async (page) => {
      await commit(page, '07').click();
      await page.locator('.file-list li', { hasText: 'LoanService' }).click({ button: 'right' });
      await page.locator('.menu-context .menu-row', { hasText: 'Kopieren nach' }).hover();
      await page.locator('.menu-sub-panel .menu-item', { hasText: 'Gist eintragen' }).click();
      await page.getByRole('textbox', { name: 'URL oder Kennung des Gists' }).fill('https://gist.github.com/');
    },
  ],
];

await mkdir('screenshots', { recursive: true });
const browser = await webkit.launch();
const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
// Mit ONLY=… entstehen nur die Bilder, deren Name so beginnt.
const only = process.env.ONLY ?? '';
for (const [name, act] of SHOTS.filter(([name]) => name.startsWith(only))) {
  await new Promise((resolve) => setTimeout(resolve, SETTLE));
  await rm(STATE, { force: true });
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
