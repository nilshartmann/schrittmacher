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

/** Ein Tab der Tableiste: eine Ansicht mit den Namen für ihre Beschriftung. */
export interface Tab {
  worktree: string;
  branch: string;
  repo: string;
  worktreeName: string;
}

/**
 * Ein Projekt, etwa ein Workshop: seine Tabs und seine zuletzt geöffneten Ansichten. Die Repos im
 * Ordner bietet die Auswahl der Ansichten an; ohne Ordner gibt es diese Auswahl nicht.
 */
export interface Project {
  /** Der Name, zugleich die Kennung; zwei Projekte heißen nie gleich. */
  name: string;
  folder?: string;
  /** Die Tabs der Tableiste, von links nach rechts. */
  tabs: Tab[];
  /** Die Ansichten, die zuletzt geöffnete zuerst. */
  views: SavedView[];
}

/** Das Projekt für die Tabs und Ansichten aus der Zeit vor den Projekten. */
export const FIRST_PROJECT = 'Allgemein';

/** Die Konfiguration in `config.json`, von Hand gepflegt. */
interface Config {
  /** Die Verzeichnisse, in denen nach Repos gesucht wird; `~` steht für das Home-Verzeichnis. */
  roots: string[];
}

/** Der Zustand in `state.json`, vom Server geschrieben. */
export interface State {
  /** Die Repos, die über das Textfeld geöffnet wurden und außerhalb der Wurzeln liegen. */
  opened: string[];
  /** Die Projekte; es gibt immer mindestens eins. */
  projects: Project[];
  /** Der Name des aktiven Projekts. */
  project: string;
  /** Die Einstellungen der Oberfläche, für alle Ansichten gleich; ihr Schema kennt nur sie. */
  settings: Record<string, JsonValue>;
  /** Die ausgeblendeten Branches je Repo, siehe `Hidden`. */
  hidden: Record<string, string[]>;
}

/** So viele Ansichten merkt sich der Server je Projekt. */
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
    const projects = Array.isArray(record.projects) ? record.projects.flatMap(projectOf) : [];
    if (projects.length === 0) {
      // Tabs und Ansichten von vor den Projekten standen direkt im Zustand.
      projects.push({
        name: FIRST_PROJECT,
        tabs: Array.isArray(record.tabs) ? record.tabs.filter(isTab) : [],
        views: Array.isArray(record.views) ? record.views.filter(isSavedView) : [],
      });
    }
    const project = projects.find((candidate) => candidate.name === record.project) ?? projects[0];
    return {
      opened: Array.isArray(record.opened) ? record.opened.filter(isString) : [],
      projects,
      project: project?.name ?? FIRST_PROJECT,
      settings: isRecord(record.settings) ? (record.settings as Record<string, JsonValue>) : {},
      hidden: isRecord(record.hidden)
        ? Object.fromEntries(
            Object.entries(record.hidden).map(([repo, list]) => [repo, Array.isArray(list) ? list.filter(isString) : []]),
          )
        : {},
    };
  }

  function update(change: (current: State) => State): Promise<void> {
    const next = writing.then(async () => writeJson(stateFile, change(await state())));
    writing = next.catch(() => undefined);
    return next;
  }

  /** Ändert ein Projekt; ein Projekt, das es nicht mehr gibt, bleibt weg. */
  function updateProject(name: string, change: (project: Project) => Project): Promise<void> {
    return update((current) => ({
      ...current,
      projects: current.projects.map((project) => (project.name === name ? change(project) : project)),
    }));
  }

  return {
    /** Die Wurzeln mit aufgelöstem `~`. */
    roots: async () => (await config()).roots.map(expandHome),
    state,
    /** Merkt sich die Ansicht im Projekt als die zuletzt geöffnete. */
    saveView: (projectName: string, view: SavedView) =>
      updateProject(projectName, (project) => ({
        ...project,
        views: [view, ...project.views.filter((other) => !sameView(other, view))].slice(0, KEPT_VIEWS),
      })),
    saveTabs: (projectName: string, tabs: Tab[]) => updateProject(projectName, (project) => ({ ...project, tabs })),
    /** Legt ein Projekt an und macht es zum aktiven. */
    addProject: (project: Project) =>
      update((current) => {
        if (current.projects.some((other) => other.name === project.name)) {
          throw new Error(`Ein Projekt mit dem Namen '${project.name}' gibt es schon.`);
        }
        return { ...current, projects: [...current.projects, project], project: project.name };
      }),
    /** Setzt Ordner und Tabs eines Projekts, aus der Auswahl der Ansichten. */
    chooseTabs: (projectName: string, folder: string, tabs: Tab[]) =>
      updateProject(projectName, (project) => ({ ...project, folder, tabs })),
    activateProject: (projectName: string) =>
      update((current) => {
        if (!current.projects.some((project) => project.name === projectName)) {
          throw new Error(`Das Projekt '${projectName}' gibt es nicht.`);
        }
        return { ...current, project: projectName };
      }),
    renameProject: (from: string, to: string) =>
      update((current) => {
        if (current.projects.some((project) => project.name === to)) {
          throw new Error(`Ein Projekt mit dem Namen '${to}' gibt es schon.`);
        }
        return {
          ...current,
          projects: current.projects.map((project) => (project.name === from ? { ...project, name: to } : project)),
          project: current.project === from ? to : current.project,
        };
      }),
    /** Löscht ein Projekt; das letzte bleibt. War es das aktive, wird das erste aktiv. */
    deleteProject: (projectName: string) =>
      update((current) => {
        const projects = current.projects.filter((project) => project.name !== projectName);
        const first = projects[0];
        if (first === undefined) {
          throw new Error('Das letzte Projekt lässt sich nicht löschen.');
        }
        return { ...current, projects, project: current.project === projectName ? first.name : current.project };
      }),
    saveSettings: (settings: Record<string, JsonValue>) => update((current) => ({ ...current, settings })),
    saveHidden: (repoPath: string, hidden: string[]) =>
      update((current) => ({ ...current, hidden: { ...current.hidden, [repoPath]: hidden } })),
    addOpened: (repoPath: string) =>
      update((current) =>
        current.opened.includes(repoPath) ? current : { ...current, opened: [...current.opened, repoPath] },
      ),
  };
}

export type Store = ReturnType<typeof createStore>;

/** Das aktive Projekt; `state` liefert immer eins. */
export function activeProject(state: State): Project {
  const project = state.projects.find((candidate) => candidate.name === state.project) ?? state.projects[0];
  if (project === undefined) {
    throw new Error('Es gibt kein Projekt.');
  }
  return project;
}

/**
 * Die gemerkten Ansichten aller Projekte, die des aktiven zuerst. Darin findet sich zu einem Repo
 * oder einer Ansicht die zuletzt geöffnete, auch wenn sie in einem anderen Projekt offen war.
 */
export function allViews(state: State): SavedView[] {
  const active = activeProject(state);
  return [...active.views, ...state.projects.filter((project) => project !== active).flatMap((project) => project.views)];
}

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

function projectOf(value: unknown): Project[] {
  if (!isRecord(value) || !isString(value.name)) {
    return [];
  }
  return [
    {
      name: value.name,
      ...(isString(value.folder) ? { folder: value.folder } : {}),
      tabs: Array.isArray(value.tabs) ? value.tabs.filter(isTab) : [],
      views: Array.isArray(value.views) ? value.views.filter(isSavedView) : [],
    },
  ];
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
