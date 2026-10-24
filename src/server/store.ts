import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Eine Ansicht, wie sie in der URL steht: Worktree und Branch, dazu der Vergleich als Kennungen
 * der Commits (siehe `commitKey`) und die gewählte Datei. Ohne `to` gilt der neueste Commit.
 */
export interface ViewSearch {
  worktree?: string;
  /** Ein lokaler Branch oder einer eines Remotes; leer bei einem `HEAD` ohne Branch. */
  branch?: string;
  to?: string;
  from?: string;
  file?: string;
}

/** Ein Wert, wie er in einer JSON-Datei stehen kann. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Eine gemerkte Ansicht, mit den Namen für die Liste der zuletzt geöffneten. */
export interface SavedView {
  worktree: string;
  branch: string;
  to?: string;
  from?: string;
  file?: string;
  repoPath: string;
  repo: string;
  worktreeName: string;
  /** Der Titel des Commits `to`, als zweite Zeile in der Liste. */
  title?: string;
}

/** Die Konfiguration in `config.json`, von Hand gepflegt. */
interface Config {
  /** Die Verzeichnisse, in denen nach Repos gesucht wird; `~` steht für das Home-Verzeichnis. */
  roots: string[];
}

/** Der Zustand in `state.json`, vom Server geschrieben. */
interface State {
  /** Die Repos, die über das Textfeld geöffnet wurden und außerhalb der Wurzeln liegen. */
  opened: string[];
  /** Die Ansichten, die zuletzt geöffnete zuerst. */
  views: SavedView[];
  /** Die Einstellungen der Oberfläche, für alle Ansichten gleich; ihr Schema kennt nur sie. */
  settings: Record<string, JsonValue>;
}

/** So viele Ansichten merkt sich der Server. */
const KEPT_VIEWS = 30;

/** Der Ordner für Konfiguration und Zustand und die Wurzeln, falls die Konfiguration fehlt. */
export interface StoreOptions {
  dir: string;
  roots: string[];
}

/** Der Ordner aus `SCHRITTMACHER_CONFIG`, sonst `~/.config/schrittmacher`. */
export function defaultStoreDir(): string {
  return process.env.SCHRITTMACHER_CONFIG ?? join(homedir(), '.config', 'schrittmacher');
}

export function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}

/**
 * Konfiguration und Zustand als JSON-Dateien. Beide werden bei jedem Zugriff gelesen, damit eine
 * Änderung von Hand sofort gilt. Fehlt die Konfiguration, wird sie mit den Vorgaben angelegt.
 */
export function createStore(options: StoreOptions) {
  const configFile = join(options.dir, 'config.json');
  const stateFile = join(options.dir, 'state.json');
  // Schreibzugriffe laufen nacheinander, damit keiner den anderen überschreibt.
  let writing: Promise<unknown> = Promise.resolve();

  async function readJson(file: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }
      throw new Error(`Die Datei ${file} lässt sich nicht lesen: ${String(error)}`);
    }
  }

  async function writeJson(file: string, value: unknown): Promise<void> {
    await mkdir(options.dir, { recursive: true });
    const temporary = `${file}.${String(process.pid)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, file);
  }

  async function config(): Promise<Config> {
    const raw = await readJson(configFile);
    if (raw === undefined) {
      const created = { roots: options.roots };
      await writeJson(configFile, created);
      return created;
    }
    const roots = isRecord(raw) && Array.isArray(raw.roots) ? raw.roots.filter(isString) : [];
    return { roots };
  }

  async function state(): Promise<State> {
    const raw = await readJson(stateFile);
    const record = isRecord(raw) ? raw : {};
    return {
      opened: Array.isArray(record.opened) ? record.opened.filter(isString) : [],
      views: Array.isArray(record.views) ? record.views.filter(isSavedView) : [],
      settings: isRecord(record.settings) ? (record.settings as Record<string, JsonValue>) : {},
    };
  }

  function update(change: (current: State) => State): Promise<void> {
    const next = writing.then(async () => writeJson(stateFile, change(await state())));
    writing = next.catch(() => undefined);
    return next;
  }

  return {
    /** Die Wurzeln mit aufgelöstem `~`. */
    roots: async () => (await config()).roots.map(expandHome),
    state,
    /** Merkt sich die Ansicht als die zuletzt geöffnete. */
    saveView: (view: SavedView) =>
      update((current) => ({
        ...current,
        views: [view, ...current.views.filter((other) => !sameView(other, view))].slice(0, KEPT_VIEWS),
      })),
    saveSettings: (settings: Record<string, JsonValue>) => update((current) => ({ ...current, settings })),
    addOpened: (repoPath: string) =>
      update((current) =>
        current.opened.includes(repoPath) ? current : { ...current, opened: [...current.opened, repoPath] },
      ),
  };
}

export type Store = ReturnType<typeof createStore>;

export function sameView(a: { worktree: string; branch: string }, b: { worktree: string; branch: string }): boolean {
  return a.worktree === b.worktree && a.branch === b.branch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isSavedView(value: unknown): value is SavedView {
  return (
    isRecord(value) &&
    isString(value.worktree) &&
    isString(value.branch) &&
    isString(value.repoPath) &&
    isString(value.repo) &&
    isString(value.worktreeName)
  );
}
