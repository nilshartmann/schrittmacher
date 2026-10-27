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
}

/** Ein Tab der Tableiste: eine Ansicht mit den Namen für ihre Beschriftung. */
export interface Tab {
  worktree: string;
  branch: string;
  repo: string;
  worktreeName: string;
}

/** Eine gespeicherte Sammlung von Tabs, etwa die für einen Vortrag. */
export interface Project {
  name: string;
  /** Die Tabs des Projekts in der Reihenfolge, in der sie sich öffnen. */
  tabs: Tab[];
}

/** Ein Gist, in den sich Dateien kopieren lassen, mit seiner Beschreibung bei GitHub. */
export interface SavedGist {
  id: string;
  description: string;
}

/** Die Konfiguration in `config.json`, von Hand gepflegt. */
interface Config {
  /** Die Verzeichnisse, in denen nach Repos gesucht wird; `~` steht für das Home-Verzeichnis. */
  roots: string[];
}

/** Der Zustand in `state.json`, vom Server geschrieben. */
export interface State {
  /** Die Repos, die über das Textfeld geöffnet wurden und außerhalb der Wurzeln liegen. */
  opened: string[];
  /** Die Tabs der Tableiste, von links nach rechts. */
  tabs: Tab[];
  /** Die Ansichten, die zuletzt geöffnete zuerst. */
  views: SavedView[];
  /** Die Einstellungen der Oberfläche, für alle Ansichten gleich; ihr Schema kennt nur sie. */
  settings: Record<string, JsonValue>;
  /** Die ausgeblendeten Branches je Repo, siehe `Hidden`. */
  hidden: Record<string, string[]>;
  /** Die Pfade, deren Repos das Menü der Repos nicht zeigt, auch die Repos darunter. */
  excluded: string[];
  /** Die Projekte, das zuletzt geöffnete zuerst. */
  projects: Project[];
  /** Der Name des aktiven Projekts, also des zuletzt geöffneten, solange seine Tableiste offen ist. */
  active: string | null;
  /** Die Gists je Repo, der zuletzt angelegte oder eingetragene zuerst. */
  gists: Record<string, SavedGist[]>;
}

/** Die Projekte mit dem Namen des aktiven, wie sie die Oberfläche bekommt und ändert. */
export interface Projects {
  projects: Project[];
  active: string | null;
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
      tabs: Array.isArray(record.tabs) ? record.tabs.filter(isTab) : [],
      views: Array.isArray(record.views) ? record.views.filter(isSavedView) : [],
      settings: isRecord(record.settings) ? (record.settings as Record<string, JsonValue>) : {},
      hidden: isRecord(record.hidden)
        ? Object.fromEntries(
            Object.entries(record.hidden).map(([repo, list]) => [repo, Array.isArray(list) ? list.filter(isString) : []]),
          )
        : {},
      excluded: Array.isArray(record.excluded) ? record.excluded.filter(isString) : [],
      projects: Array.isArray(record.projects) ? record.projects.filter(isProject) : [],
      active: isString(record.active) ? record.active : null,
      gists: isRecord(record.gists)
        ? Object.fromEntries(
            Object.entries(record.gists).map(([repo, list]) => [repo, Array.isArray(list) ? list.filter(isSavedGist) : []]),
          )
        : {},
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
    /** Ob es noch keinen Zustand gibt, also beim allerersten Start. */
    isFresh: async () => (await readJson(stateFile)) === undefined,
    /** Merkt sich die Ansicht als die zuletzt geöffnete. */
    saveView: (view: SavedView) =>
      update((current) => ({
        ...current,
        views: [view, ...current.views.filter((other) => !sameView(other, view))].slice(0, KEPT_VIEWS),
      })),
    saveTabs: (tabs: Tab[]) => update((current) => ({ ...current, tabs })),
    saveSettings: (settings: Record<string, JsonValue>) => update((current) => ({ ...current, settings })),
    saveExcluded: (excluded: string[]) => update((current) => ({ ...current, excluded })),
    /** Ändert die Projekte; scheitert `change`, bleibt der Zustand, wie er ist. */
    changeProjects: (change: (current: Projects) => Projects) =>
      update((current) => ({ ...current, ...change({ projects: current.projects, active: current.active }) })),
    saveHidden: (repoPath: string, hidden: string[]) =>
      update((current) => ({ ...current, hidden: { ...current.hidden, [repoPath]: hidden } })),
    /** Nimmt den Gist als ersten in die Liste des Repos auf, auch wenn er schon darin steht. */
    addGist: (repoPath: string, gist: SavedGist) =>
      update((current) => ({
        ...current,
        gists: {
          ...current.gists,
          [repoPath]: [gist, ...(current.gists[repoPath] ?? []).filter((other) => other.id !== gist.id)],
        },
      })),
    /** Ändert die Beschreibung eines Gists in der Liste des Repos, ohne ihn nach vorn zu holen. */
    describeGist: (repoPath: string, gist: SavedGist) =>
      update((current) => ({
        ...current,
        gists: {
          ...current.gists,
          [repoPath]: (current.gists[repoPath] ?? []).map((other) => (other.id === gist.id ? gist : other)),
        },
      })),
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

function isTab(value: unknown): value is Tab {
  return (
    isRecord(value) &&
    isString(value.worktree) &&
    isString(value.branch) &&
    isString(value.repo) &&
    isString(value.worktreeName)
  );
}

function isSavedGist(value: unknown): value is SavedGist {
  return isRecord(value) && isString(value.id) && isString(value.description);
}

function isProject(value: unknown): value is Project {
  return isRecord(value) && isString(value.name) && Array.isArray(value.tabs) && value.tabs.every(isTab);
}
