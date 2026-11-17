import { mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runGit } from '../git/process';
import { shared } from '../server/shared';
import { writeAtomically } from '../server/notes';

/**
 * Workspaces, Entwürfe und die Liste „Zuletzt geöffnet“ des Editors (`docs/editor.md`). Das Modul
 * kennt nichts aus Schrittmacher außer Git und dem Speicher, damit der Editor später ein eigenes
 * Kommando werden kann.
 */

/** So viele Workspaces und Dateien merkt sich die Liste „Zuletzt geöffnet“, je für sich. */
const KEPT_RECENT = 20;

/** So viele Dateien zeigt der Baum eines Ordners außerhalb eines Repos höchstens. */
const MAX_WALKED = 5000;

/** Die Ordner, die der Baum außerhalb eines Repos überspringt, dazu jeder versteckte. */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['node_modules']);

/** Die Endungen einer Markdown-Datei. Sie lässt sich wie bisher überall öffnen. */
const MARKDOWN_ENDINGS: ReadonlySet<string> = new Set(['.md', '.markdown']);

/** So viele Bytes am Anfang einer Datei prüft der Editor auf ein Null-Byte, wie Git. */
const TEXT_PROBE = 8000;

/** Die größte Textdatei, die der Editor öffnet, in Bytes. */
export const MAX_TEXT_SIZE = 2 * 1024 * 1024;

/** Der Speicher: der Ordner aus `SCHRITTMACHER_CONFIG`, sonst `~/.config/schrittmacher`. */
export function configFolder(): string {
  return process.env.SCHRITTMACHER_CONFIG ?? join(homedir(), '.config', 'schrittmacher');
}

/** Die Wurzel des Workspace „Entwürfe“. */
export function draftsRoot(): string {
  return join(configFolder(), 'entwuerfe');
}

/** Die Datei mit der Liste „Zuletzt geöffnet“. */
function recentFile(): string {
  return join(configFolder(), 'editor.json');
}

/** Die Liste „Zuletzt geöffnet“, wie sie in `editor.json` steht, das zuletzt geöffnete zuerst. */
interface Recent {
  workspaces: string[];
  files: string[];
}

/** Ob eine Datei eine Markdown-Datei ist, nach ihrer Endung. */
export function isMarkdown(path: string): boolean {
  return MARKDOWN_ENDINGS.has(extname(path).toLowerCase());
}

/** Ob `path` in `folder` liegt oder `folder` selbst ist. */
function inside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

async function readRecent(): Promise<Recent> {
  try {
    const raw = JSON.parse(await readFile(recentFile(), 'utf8')) as { workspaces?: unknown; files?: unknown };
    return { workspaces: strings(raw.workspaces), files: strings(raw.files) };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { workspaces: [], files: [] };
    }
    throw new Error(`Die Datei ${recentFile()} lässt sich nicht lesen: ${String(error)}`);
  }
}

/** Die Schreibzugriffe auf `editor.json`, nacheinander, damit keiner den anderen überschreibt. */
const queue = shared('editor-recent', () => ({ writing: Promise.resolve() as Promise<unknown> }));

function changeRecent(change: (current: Recent) => Recent): Promise<void> {
  const next = queue.writing.then(async () => {
    const changed = change(await readRecent());
    await writeAtomically(recentFile(), `${JSON.stringify(changed, null, 2)}\n`);
  });
  queue.writing = next.catch(() => undefined);
  return next;
}

/** Setzt einen Eintrag an den Anfang einer Liste, ohne Doppel und mit der gemerkten Länge. */
function first(list: string[], entry: string): string[] {
  return [entry, ...list.filter((other) => other !== entry)].slice(0, KEPT_RECENT);
}

/** Merkt sich einen Workspace, eine Datei oder beide als zuletzt geöffnet. Entwürfe zählen nicht als Workspace. */
export function addRecent(entry: { workspace?: string | null; file?: string | null }): Promise<void> {
  return changeRecent((current) => ({
    workspaces:
      entry.workspace === undefined || entry.workspace === null || entry.workspace === draftsRoot()
        ? current.workspaces
        : first(current.workspaces, entry.workspace),
    files: entry.file === undefined || entry.file === null ? current.files : first(current.files, entry.file),
  }));
}

/** Nimmt einen Workspace oder eine Datei aus der Liste „Zuletzt geöffnet“. */
export function removeRecent(path: string): Promise<void> {
  return changeRecent((current) => ({
    workspaces: current.workspaces.filter((other) => other !== path),
    files: current.files.filter((other) => other !== path),
  }));
}

/** Ersetzt in der Liste „Zuletzt geöffnet“ eine umbenannte Datei durch ihren neuen Pfad, an derselben Stelle. */
export function renameRecent(from: string, to: string): Promise<void> {
  return changeRecent((current) => ({
    workspaces: current.workspaces,
    files: current.files.filter((other) => other !== to).map((other) => (other === from ? to : other)),
  }));
}

/** Die bekannten Workspaces: „Entwürfe“ und die zuletzt geöffneten. */
async function knownWorkspaces(): Promise<string[]> {
  return [draftsRoot(), ...(await readRecent()).workspaces];
}

/** Der Workspace, in dem eine Datei liegt, unter mehreren der innerste; ohne `null`. */
export async function workspaceOf(path: string): Promise<string | null> {
  const containing = (await knownWorkspaces()).filter((root) => inside(path, root) && path !== root);
  return containing.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Ein absoluter Pfad aus einer Anfrage, oder ein Fehler, wenn er fehlt. */
function absolute(value: unknown, what: string): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`Der Pfad ${what} fehlt oder ist nicht absolut.`);
  }
  return resolve(value);
}

/**
 * Der Pfad einer Datei, die der Editor lesen und schreiben darf. Jede Seite im Browser kann die
 * Funktionen des Servers aufrufen. Deshalb gilt das nur für Markdown-Dateien, für Dateien in einem
 * bekannten Workspace und für zuletzt geöffnete Dateien. Die Datei muss es noch nicht geben.
 */
export async function editorPath(value: unknown): Promise<string> {
  const path = absolute(value, 'der Datei');
  if (isMarkdown(path)) {
    return path;
  }
  if ((await workspaceOf(path)) !== null || (await readRecent()).files.includes(path)) {
    return path;
  }
  throw new Error(`'${path}' liegt in keinem bekannten Workspace. Öffne die Datei mit 'schrittmacher edit'.`);
}

/** Der Pfad eines bekannten Workspace, den es als Ordner gibt. */
export async function workspacePath(value: unknown): Promise<string> {
  const root = absolute(value, 'des Workspace');
  if (!(await knownWorkspaces()).includes(root)) {
    throw new Error(`'${root}' ist kein bekannter Workspace. Öffne ihn mit 'schrittmacher edit <ordner>'.`);
  }
  if (root === draftsRoot()) {
    // Den Ordner der Entwürfe gibt es erst nach dem ersten Entwurf; bis dahin ist er leer.
    await mkdir(root, { recursive: true });
  }
  const found = await stat(root).catch(() => null);
  if (found === null || !found.isDirectory()) {
    throw new Error(`Den Ordner '${root}' gibt es nicht.`);
  }
  return root;
}

/**
 * Was eine Datei für den Editor ist: Text, ein Bild, das er als Ansicht zeigt, oder etwas anderes.
 * Als Text gilt eine Datei ohne Null-Byte am Anfang, die nicht zu groß ist. Eine Datei, die es noch
 * nicht gibt, ist leerer Text.
 */
export async function kindOf(path: string, imageType: string | undefined): Promise<'text' | 'image' | 'binary' | 'large'> {
  if (imageType !== undefined) {
    return 'image';
  }
  const found = await stat(path).catch(() => null);
  if (found === null) {
    return 'text';
  }
  if (found.size > MAX_TEXT_SIZE) {
    return 'large';
  }
  const handle = await open(path, 'r');
  try {
    const probe = Buffer.alloc(Math.min(TEXT_PROBE, found.size));
    await handle.read(probe, 0, probe.length, 0);
    return probe.includes(0) ? 'binary' : 'text';
  } finally {
    await handle.close();
  }
}

/** Ein Entwurf im Baum: sein Pfad, seine erste Zeile und wann er sich zuletzt geändert hat. */
export interface Draft {
  path: string;
  title: string;
  changed: number;
}

/** Der Inhalt eines Workspace für den Baum. */
export interface WorkspaceListing {
  root: string;
  name: string;
  /** Ob es der Workspace „Entwürfe“ ist; dann stehen seine Dateien in `drafts`. */
  drafts: Draft[] | null;
  /** Die Dateien relativ zur Wurzel, mit `/` getrennt. */
  files: string[];
  /** Ob der Baum außerhalb eines Repos abgeschnitten wurde, weil der Ordner zu viele Dateien hat. */
  truncated: boolean;
}

/** Die erste Überschrift oder Zeile eines Entwurfs, ohne `#` davor; leer ohne Text. */
function titleOf(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  return line.replace(/^\s*#+\s*/, '').trim();
}

async function listDrafts(root: string): Promise<Draft[]> {
  const names = (await readdir(root).catch(() => [] as string[])).filter((name) => isMarkdown(name));
  const drafts = await Promise.all(
    names.map(async (name) => {
      const path = join(root, name);
      const [text, found] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
      return { path: name, title: titleOf(text), changed: found.mtimeMs };
    }),
  );
  return drafts.sort((a, b) => b.changed - a.changed);
}

/** Die Dateien unter `root` in einem Repo, ohne was Git ignoriert und ohne gelöschte. */
async function listRepo(root: string): Promise<string[]> {
  const output = await runGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const paths = [...new Set(output.split('\0').filter((path) => path !== ''))];
  const present = await Promise.all(
    paths.map(async (path) => ((await stat(join(root, path)).catch(() => null))?.isFile() === true ? path : null)),
  );
  return present.filter((path): path is string => path !== null);
}

/** Die Dateien unter `root` außerhalb eines Repos, ohne versteckte Ordner und `node_modules`. */
async function walk(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const folders = [''];
  while (folders.length > 0) {
    const folder = folders.shift() ?? '';
    const entries = await readdir(join(root, folder), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = folder === '' ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIPPED_FOLDERS.has(entry.name)) {
          folders.push(path);
        }
      } else if (entry.isFile() && entry.name !== '.DS_Store') {
        files.push(path);
        if (files.length >= MAX_WALKED) {
          return { files, truncated: true };
        }
      }
    }
  }
  return { files, truncated: false };
}

/** Ob `root` in einem Repo liegt. */
async function inRepo(root: string): Promise<boolean> {
  return (await runGit(root, ['rev-parse', '--is-inside-work-tree']).catch(() => '')).trim() === 'true';
}

/** Der Inhalt eines Workspace für den Baum. */
export async function listWorkspace(root: string): Promise<WorkspaceListing> {
  if (root === draftsRoot()) {
    return { root, name: 'Entwürfe', drafts: await listDrafts(root), files: [], truncated: false };
  }
  if (await inRepo(root)) {
    return { root, name: basename(root), drafts: null, files: await listRepo(root), truncated: false };
  }
  return { root, name: basename(root), drafts: null, ...(await walk(root)) };
}

/** Ein Zeitpunkt als Name eines Entwurfs: `2026-11-16-1432`, in der Zeit des Macs. */
function draftName(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}`;
}

/** Schreibt eine leere Datei, die es noch nicht gibt; gibt es sie schon, scheitert es. */
async function createEmpty(path: string): Promise<void> {
  await writeFile(path, '', { encoding: 'utf8', flag: 'wx' });
}

/** Legt einen leeren Entwurf an, benannt nach dem Zeitpunkt; zurück kommt sein Pfad. */
export async function createDraft(): Promise<string> {
  const root = draftsRoot();
  await mkdir(root, { recursive: true });
  const name = draftName(new Date());
  for (let attempt = 1; ; attempt++) {
    const path = join(root, attempt === 1 ? `${name}.md` : `${name}-${String(attempt)}.md`);
    try {
      await createEmpty(path);
      return path;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
    }
  }
}

/**
 * Legt eine leere Datei im Workspace an, `relativePath` relativ zur Wurzel. Fehlende Ordner
 * entstehen mit. Zurück kommt der absolute Pfad.
 */
export async function createWorkspaceFile(root: string, relativePath: string): Promise<string> {
  const cleaned = relativePath.trim().replace(/^\/+/, '');
  const path = resolve(root, cleaned);
  if (cleaned === '' || cleaned.endsWith('/') || !inside(path, root) || path === root) {
    throw new Error(`'${relativePath}' ist kein Pfad einer Datei im Workspace.`);
  }
  await mkdir(dirname(path), { recursive: true });
  try {
    await createEmpty(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`Die Datei '${relative(root, path)}' gibt es schon.`);
    }
    throw error;
  }
  return path;
}

/**
 * Benennt eine Datei im Workspace um, ohne sie in einen anderen Ordner zu verschieben. Der neue Name
 * darf keinen Ordner enthalten, und eine andere Datei mit dem Namen bleibt unberührt. Eine Änderung
 * nur der Groß- und Kleinschreibung geht trotzdem. Zurück kommt der neue absolute Pfad.
 */
export async function renameWorkspaceFile(root: string, from: string, name: string): Promise<string> {
  const path = resolve(from);
  if (!inside(path, root) || path === root) {
    throw new Error(`'${from}' liegt nicht im Workspace.`);
  }
  const cleaned = name.trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..' || cleaned.includes('/')) {
    throw new Error(`'${name}' ist kein gültiger Dateiname.`);
  }
  const target = join(dirname(path), cleaned);
  if (target === path) {
    return path;
  }
  const source = await stat(path).catch(() => null);
  if (source === null || !source.isFile()) {
    throw new Error(`Die Datei '${relative(root, path)}' gibt es nicht.`);
  }
  const existing = await stat(target).catch(() => null);
  // Auf dem Mac findet `stat` bei anderer Groß- und Kleinschreibung dieselbe Datei.
  if (existing !== null && existing.ino !== source.ino) {
    throw new Error(`Die Datei '${relative(root, target)}' gibt es schon.`);
  }
  await rename(path, target);
  return target;
}

/** Ein Eintrag der Liste „Zuletzt geöffnet“, wie sie das Menü zeigt. */
export interface RecentEntry {
  path: string;
  name: string;
  /** Der Ordner darüber, als zweite Zeile im Menü. */
  dir: string;
  /** Ob es den Workspace oder die Datei noch gibt. */
  exists: boolean;
  /** Bei einer Datei der Workspace, in dem sie sich öffnet; sonst `null`. */
  root: string | null;
}

/** Die Liste „Zuletzt geöffnet“ für das Menü: oben „Entwürfe“ und die Workspaces, darunter die Dateien. */
export async function recentEntries(): Promise<{ workspaces: RecentEntry[]; files: RecentEntry[] }> {
  const recent = await readRecent();
  const exists = async (path: string, folder: boolean) => {
    const found = await stat(path).catch(() => null);
    return found !== null && (folder ? found.isDirectory() : found.isFile());
  };
  const home = homedir();
  const shown = (path: string) => (inside(path, home) ? `~${path.slice(home.length)}` : path);
  const workspaces = await Promise.all(
    recent.workspaces.map(async (path) => ({
      path,
      name: basename(path),
      dir: shown(dirname(path)),
      exists: await exists(path, true),
      root: null,
    })),
  );
  const files = await Promise.all(
    recent.files.map(async (path) => {
      const root = await workspaceOf(path);
      const isDraft = root === draftsRoot();
      // In einem Workspace steht der Ordner ab seinem Namen da, etwa `buch/kapitel`.
      const dir = root === null ? shown(dirname(path)) : join(basename(root), relative(root, dirname(path)));
      return {
        path,
        name: isDraft ? titleOf(await readFile(path, 'utf8').catch(() => '')) || basename(path) : basename(path),
        dir: isDraft ? 'Entwürfe' : dir,
        exists: await exists(path, false),
        root,
      };
    }),
  );
  const drafts = { path: draftsRoot(), name: 'Entwürfe', dir: 'Schnelle Notizen', exists: true, root: null };
  return { workspaces: [drafts, ...workspaces], files };
}

/** Der Name einer Abbildung: `abb-` und ihre Nummer am Anfang, danach beliebiger Suffix. */
const FIGURE_NAME = /^abb-(\d+)/i;

/** So viele Stellen hat die Nummer einer neuen Abbildung mindestens. */
const FIGURE_DIGITS = 3;

/**
 * Der Name für eine neue Abbildung ohne Endung, etwa `abb-013`. Gezählt wird über alle Dateien
 * `abb-<nr>…` im Workspace, ohne Workspace im Ordner der Datei; vorgeschlagen wird die höchste
 * Nummer plus eins.
 */
export async function nextFigureName(file: string, root: string | null): Promise<string> {
  const names =
    root === null
      ? await readdir(dirname(file)).catch(() => [] as string[])
      : (await listWorkspace(root)).files.map((path) => basename(path));
  const highest = Math.max(0, ...names.map((name) => Number(FIGURE_NAME.exec(name)?.[1] ?? 0)));
  return `abb-${String(highest + 1).padStart(FIGURE_DIGITS, '0')}`;
}

/** Die Endungen, unter denen ein Bild aus der Zwischenablage gespeichert wird, nach seinem Typ. */
const IMAGE_ENDINGS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

/** Die Endung zu einem Bildtyp; `null` für einen Typ, den der Editor nicht speichert. */
export function imageEnding(type: string): string | null {
  return IMAGE_ENDINGS[type] ?? null;
}

/** Das größte Bild, das der Editor aus der Zwischenablage speichert, in Bytes. */
const MAX_IMAGE_SIZE = 25 * 1024 * 1024;

/**
 * Speichert ein Bild neben einer Datei unter `name` mit der Endung zu seinem Typ. Der Name darf
 * keinen Ordner enthalten; eine Datei, die es schon gibt, bleibt unberührt. Zurück kommt der Name
 * mit Endung.
 */
export async function saveImageBeside(file: string, name: string, type: string, bytes: Buffer): Promise<string> {
  const ending = imageEnding(type);
  if (ending === null) {
    throw new Error(`Bilder vom Typ ${type} speichert der Editor nicht.`);
  }
  const cleaned = name.trim();
  if (cleaned === '' || cleaned.includes('/') || cleaned.startsWith('.')) {
    throw new Error(`'${name}' ist kein gültiger Dateiname.`);
  }
  if (bytes.length > MAX_IMAGE_SIZE) {
    throw new Error('Das Bild ist zu groß.');
  }
  const fileName = cleaned.toLowerCase().endsWith(ending) ? cleaned : cleaned + ending;
  try {
    await writeFile(join(dirname(file), fileName), bytes, { flag: 'wx' });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`Die Datei ${fileName} gibt es schon.`);
    }
    throw error;
  }
  return fileName;
}
