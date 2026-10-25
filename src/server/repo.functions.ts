import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { buildDemoRepo, DEMO_BASE } from '../git/demoGit';
import { DEMO_REPO } from '../git/demoRepo';
import { gitSource, locate } from '../git/gitRepo';
import type { Comparison, RepoSource } from '../git/repo';
import { findRepos } from '../git/repos';
import type { RepoEntry } from '../git/repos';
import { isHidden } from '../git/hidden';
import { shared } from './shared';
import { activeProject, allViews, createStore, defaultStoreDir, expandHome, sameView } from './store';
import type { JsonValue, SavedView, Store, Tab, ViewSearch } from './store';

/** Was der Server einmal beim Start einrichtet. */
interface Setup {
  store: Store;
  /** Die Ansicht für den ersten Start, ohne eine gemerkte. */
  first: ViewSearch | null;
  /** Repos, die immer erlaubt sind, auch außerhalb der Wurzeln. */
  allowed: string[];
}

/** Die Einrichtung, einmal für alle Instanzen dieses Moduls, siehe `shared`. */
const once = shared('setup', () => ({ setup: undefined as Promise<Setup> | undefined }));

/**
 * Mit `SCHRITTMACHER_DEMO=1` die Testdaten als Repo unter `tmpdir()`, mit eigenem Speicher daneben
 * und nur diesem Verzeichnis als Wurzel. Sonst der Speicher in `~/.config/schrittmacher` und als
 * erste Ansicht der Worktree aus `SCHRITTMACHER_REPO`, wenn die Variable gesetzt ist.
 */
function server(): Promise<Setup> {
  if (once.setup === undefined) {
    const setup = (async () => {
      if (process.env.SCHRITTMACHER_DEMO === '1') {
        const worktree = await buildDemoRepo(DEMO_REPO);
        return {
          store: createStore({ dir: join(DEMO_BASE, 'speicher'), roots: [DEMO_BASE] }),
          first: { worktree, branch: DEMO_REPO.info.branch, to: '06b' },
          allowed: [],
        };
      }
      const worktree = process.env.SCHRITTMACHER_REPO;
      const first = worktree === undefined || worktree === '' ? null : { worktree };
      return {
        store: createStore({ dir: defaultStoreDir(), roots: ['~/develop'] }),
        first,
        allowed: first === null ? [] : [(await locate(first.worktree)).repoPath],
      };
    })();
    // Scheitert der Aufbau, versucht es die nächste Anfrage noch einmal.
    setup.catch(() => {
      once.setup = undefined;
    });
    once.setup = setup;
  }
  return once.setup;
}

/** Ein erlaubter Worktree mit seiner Quelle; die Quelle hält ihre Vergleiche vor. */
interface Access {
  source: RepoSource;
  repoPath: string;
  worktreePath: string;
}

const accesses = new Map<string, Promise<Access>>();

function inside(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
}

/**
 * Ob das Repo in einer Wurzel oder im Ordner eines Projekts liegt oder ausdrücklich geöffnet wurde.
 * Mit `folder` zählt auch dieser Ordner, etwa der eines Projekts, das gerade angelegt wird.
 */
async function isAllowed(repoPath: string, worktreePath: string, folder?: string): Promise<boolean> {
  const { store, allowed } = await server();
  const state = await store.state();
  const folders = [
    ...(await store.roots()),
    ...state.projects.flatMap((project) => (project.folder === undefined ? [] : [project.folder])),
  ];
  const roots = [
    ...(await Promise.all(folders.map((root) => realpath(root).catch(() => root)))),
    ...(folder === undefined ? [] : [folder]),
  ];
  const opened = state.opened;
  return (
    allowed.includes(repoPath) ||
    opened.includes(repoPath) ||
    roots.some((root) => inside(repoPath, root) || inside(worktreePath, root))
  );
}

/**
 * Der Worktree zu einem Pfad aus der Oberfläche, nur wenn sein Repo erlaubt ist. Der Server liest
 * kein Verzeichnis, nur weil es in einer URL steht.
 */
function access(path: string, folder?: string): Promise<Access> {
  const cached = accesses.get(path);
  if (cached !== undefined) {
    return cached;
  }
  const created = (async () => {
    if (!isAbsolute(path)) {
      throw new Error(`Der Pfad '${path}' ist nicht absolut.`);
    }
    const real = await realpath(path).catch(() => {
      throw new Error(`Den Ordner '${path}' gibt es nicht.`);
    });
    const where = await locate(real).catch(() => {
      throw new Error(`Der Ordner '${path}' gehört zu keinem Git-Repo.`);
    });
    if (!(await isAllowed(where.repoPath, where.worktreePath, folder))) {
      throw new Error(`Das Repo '${where.repoPath}' liegt in keinem Wurzelverzeichnis.`);
    }
    return { source: gitSource(where.worktreePath), repoPath: where.repoPath, worktreePath: where.worktreePath };
  })();
  accesses.set(path, created);
  created.catch(() => accesses.delete(path));
  return created;
}

function hasPosition(search: ViewSearch): boolean {
  return search.to !== undefined || search.from !== undefined || search.file !== undefined;
}

/**
 * Die vollständige Ansicht zu einer Wahl, ohne Branch mit dem ausgecheckten. Ohne Vergleich und
 * Datei gilt, was sich die Ansicht gemerkt hat. Ohne Worktree gilt im aktiven Projekt die zuletzt
 * geöffnete Ansicht, die noch einen Tab hat, dann der erste Tab und dann die zuletzt geöffnete.
 * Hat das Projekt nichts davon, gilt die Ansicht für den ersten Start.
 */
async function complete(search: ViewSearch): Promise<ViewSearch | null> {
  const { store, first } = await server();
  if (search.worktree === undefined) {
    const { tabs, views } = activeProject(await store.state());
    const candidates = [views.find((view) => tabs.some((tab) => sameView(tab, view))), tabs[0], views[0]];
    for (const candidate of candidates) {
      if (candidate !== undefined) {
        const resolved = await complete({ worktree: candidate.worktree, branch: candidate.branch }).catch(() => null);
        if (resolved !== null) {
          return resolved;
        }
      }
    }
    return first === null ? null : complete(first);
  }
  const { worktreePath } = await access(search.worktree);
  const branch = search.branch ?? (await locate(worktreePath)).checkedOut ?? '';
  const view = { worktree: worktreePath, branch };
  if (hasPosition(search)) {
    return { ...view, to: search.to, from: search.from, file: search.file };
  }
  const memory = allViews(await store.state()).find((saved) => sameView(saved, view));
  return { ...view, to: memory?.to, from: memory?.from, file: memory?.file };
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`'${name}' fehlt oder ist kein Text.`);
  }
  return value;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function viewSearchOf(data: unknown): ViewSearch {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  return {
    worktree: optionalText(record.worktree),
    branch: optionalText(record.branch),
    to: optionalText(record.to),
    from: optionalText(record.from),
    file: optionalText(record.file),
  };
}

/** Die vollständige Ansicht zu einer Wahl; `null`, wenn es noch keine gibt. */
export const resolveView = createServerFn({ method: 'GET' })
  .validator(viewSearchOf)
  .handler(({ data }) => complete(data));

/** Der Name am Ende eines Pfads. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf(sep) + 1);
}

/** Der Tab zu Worktree und Branch, mit den Namen von Repo und Worktree. */
async function tabFor(worktree: string, branch: string, folder?: string): Promise<Tab> {
  const { repoPath, worktreePath } = await access(worktree, folder);
  return { worktree: worktreePath, branch, repo: nameOf(repoPath), worktreeName: nameOf(worktreePath) };
}

/** Der Tab zu einer Wahl, mit den Namen von Repo und Worktree; `null`, wenn es keine Ansicht gibt. */
export const tabOf = createServerFn({ method: 'GET' })
  .validator(viewSearchOf)
  .handler(async ({ data }): Promise<Tab | null> => {
    const view = await complete(data);
    return view?.worktree === undefined ? null : tabFor(view.worktree, view.branch ?? '');
  });

/** Repo und Commits einer Ansicht, die Worktrees des Repos, die Einstellungen und das Projekt. */
export const loadView = createServerFn({ method: 'GET' })
  .validator((data: { worktree: string; branch: string }) => ({
    worktree: text(data.worktree, 'worktree'),
    branch: text(data.branch, 'branch'),
  }))
  .handler(async ({ data }) => {
    const { source, repoPath } = await access(data.worktree);
    const state = await (await server()).store.state();
    const hidden = state.hidden[repoPath] ?? [];
    const [repo, worktrees] = await Promise.all([
      source.load(data.branch === '' ? null : data.branch, { all: state.settings.allBranches === true, hidden }),
      source.worktrees(),
    ]);
    const project = activeProject(state);
    return { repo, worktrees, settings: state.settings, hidden, project: project.name, tabs: project.tabs };
  });

export const compareCommits = createServerFn({ method: 'GET' })
  .validator((data: { worktree: string; comparison: Comparison }) => data)
  .handler(async ({ data }) => (await access(data.worktree)).source.compare(data.comparison));

/** Der Stand des Repos; mit `local` auch der lokalen Änderungen, siehe `RepoSource.state`. */
export const repoState = createServerFn({ method: 'GET' })
  .validator((data: { worktree: string; local: boolean }) => ({
    worktree: text(data.worktree, 'worktree'),
    local: data.local === true,
  }))
  .handler(async ({ data }) => (await access(data.worktree)).source.state(data.local));

/** Committet die gewählten Dateien im Worktree und liefert den SHA des neuen Commits. */
export const commitChanges = createServerFn({ method: 'POST' })
  .validator((data: { worktree: string; branch: string; message: string; paths: string[] }) => {
    if (!Array.isArray(data.paths) || !data.paths.every((path) => typeof path === 'string')) {
      throw new Error('Die Dateien sind keine Liste von Pfaden.');
    }
    return {
      worktree: text(data.worktree, 'worktree'),
      branch: text(data.branch, 'branch'),
      message: text(data.message, 'message'),
      paths: data.paths,
    };
  })
  .handler(async ({ data }) => (await access(data.worktree)).source.commit(data.branch, data.message, data.paths));

/** Pusht den ausgecheckten Branch des Worktrees. */
export const pushBranch = createServerFn({ method: 'POST' })
  .validator((data: { worktree: string; branch: string; force: boolean }) => ({
    worktree: text(data.worktree, 'worktree'),
    branch: text(data.branch, 'branch'),
    force: data.force === true,
  }))
  .handler(async ({ data }) => {
    await (await access(data.worktree)).source.push(data.branch, data.force);
  });

/** Ein Repo in der Auswahl, mit der Ansicht, die ein Klick darauf öffnet. */
export interface RepoChoice extends RepoEntry {
  view: ViewSearch;
}

/** Die Teile einer gemerkten Ansicht, die in die URL gehören; ohne leere. */
function searchOf(view: SavedView): ViewSearch {
  const search: ViewSearch = { worktree: view.worktree, branch: view.branch };
  for (const key of ['to', 'from', 'file'] as const) {
    if (view[key] !== undefined) {
      search[key] = view[key];
    }
  }
  return search;
}

/**
 * Die im aktiven Projekt zuletzt geöffneten Repos, die im Ordner des Projekts und alle gefundenen,
 * dazu die Wurzeln und das Home-Verzeichnis, damit die Oberfläche Pfade mit `~` kürzen kann. Jedes
 * Repo nennt die Ansicht, die ein Klick öffnet: seine zuletzt geöffnete, sonst sein erster
 * Worktree. So kann die Oberfläche jedes Repo als Link zeigen, der sich auch in einem neuen Tab
 * öffnen lässt.
 */
export const listRepos = createServerFn({ method: 'GET' }).handler(async () => {
  const { store } = await server();
  const state = await store.state();
  const project = activeProject(state);
  const lastViews = new Map<string, SavedView>();
  for (const view of allViews(state)) {
    if (!lastViews.has(view.repoPath)) {
      lastViews.set(view.repoPath, view);
    }
  }
  const choiceOf = (entry: RepoEntry): RepoChoice => {
    const last = lastViews.get(entry.path);
    return { ...entry, view: last === undefined ? { worktree: entry.path } : searchOf(last) };
  };
  const roots = await store.roots();
  // Git nennt Pfade ohne symbolische Links, etwa `/private/var` statt `/var`; die Suche ebenso.
  const realRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => root)));
  const folder = project.folder === undefined ? null : await realpath(project.folder).catch(() => null);
  // Ein Repo steht nur im ersten Abschnitt, in dem es vorkommt.
  const shown = new Set<string>();
  const unshown = (entries: RepoEntry[]) => {
    const rest = entries.filter((entry) => !shown.has(entry.path));
    rest.forEach((entry) => shown.add(entry.path));
    return rest.map(choiceOf);
  };
  const inFolder = folder === null ? [] : unshown(await findRepos([folder]));
  const found = unshown(await findRepos(realRoots));
  // Über das Pfadfeld geöffnete Repos außerhalb der Wurzeln findet die Suche nicht.
  const opened = unshown(
    state.opened.map((path) => ({ name: nameOf(path), path })).sort((a, b) => a.name.localeCompare(b.name)),
  );
  return {
    folder: project.folder ?? null,
    inFolder,
    found,
    opened,
    roots,
    home: homedir(),
  };
});

/**
 * Öffnet ein Repo über seinen Pfad oder den eines seiner Worktrees, aus der Liste oder aus dem
 * Textfeld. Ein Repo außerhalb der Wurzeln wird danach als geöffnet gemerkt. Das Ergebnis ist die
 * zuletzt geöffnete Ansicht des Repos oder seines Worktrees, sonst die des Worktrees selbst.
 */
export const openRepo = createServerFn({ method: 'POST' })
  .validator((data: { path: string }) => ({ path: text(data.path, 'path').trim() }))
  .handler(async ({ data }) => {
    const { store } = await server();
    const where = await locatePath(data.path);
    const views = allViews(await store.state());
    const last =
      where.worktreePath === where.repoPath
        ? views.find((view) => view.repoPath === where.repoPath)
        : views.find((view) => view.worktree === where.worktreePath);
    return complete(last ?? { worktree: where.worktreePath });
  });

/**
 * Repo und Worktree zu einem Pfad, auch zu einem Ordner darin. Ein Repo außerhalb der Wurzeln wird
 * als geöffnet gemerkt.
 */
async function locatePath(given: string): Promise<{ repoPath: string; worktreePath: string }> {
  const { store } = await server();
  const path = expandHome(given);
  if (!isAbsolute(path)) {
    throw new Error('Der Pfad muss absolut sein oder mit ~ beginnen.');
  }
  const real = await realpath(path).catch(() => {
    throw new Error(`Den Ordner '${path}' gibt es nicht.`);
  });
  const where = await locate(real).catch(() => {
    throw new Error(`Der Ordner '${path}' gehört zu keinem Git-Repo.`);
  });
  if (!(await isAllowed(where.repoPath, where.worktreePath))) {
    await store.addOpened(where.repoPath);
  }
  return where;
}

/** Der Tab, den das Kommando `schrittmacher <pfad>` zuletzt angefordert hat, bis die Seite ihn abholt. */
const requested = shared('requested', () => ({ tab: null as ViewSearch | null }));

/**
 * Merkt sich die Ansicht zu einem Pfad als neuen Tab, siehe `bin/schrittmacher`. Anders als
 * `openRepo` gilt immer der Worktree des Pfads, mit seiner zuletzt geöffneten Ansicht. Sie läuft
 * nur im Server, damit ihre Importe nicht in den Code für den Browser geraten.
 */
export const requestTab = createServerOnlyFn(async (path: string): Promise<void> => {
  const { store } = await server();
  const { worktreePath } = await locatePath(path);
  const last = allViews(await store.state()).find((view) => view.worktree === worktreePath);
  const view = await complete(last ?? { worktree: worktreePath });
  if (view === null) {
    throw new Error(`Für '${path}' gibt es keine Ansicht.`);
  }
  requested.tab = view;
});

/** Liefert den angeforderten Tab einmal und vergisst ihn dann; ohne Anforderung `null`. */
export const takeTabRequest = createServerFn({ method: 'POST' }).handler(() => {
  const view = requested.tab;
  requested.tab = null;
  return view;
});

/** Die im aktiven Projekt zuletzt geöffneten Ansichten, die neueste zuerst, mit ihren Teilen für die URL. */
export const listViews = createServerFn({ method: 'GET' }).handler(async () =>
  activeProject(await (await server()).store.state())
    .views.slice(0, 10)
    .map((view) => ({ ...view, search: searchOf(view) })),
);

/** Merkt sich die Ansicht im Projekt als die zuletzt geöffnete, mit Vergleich und Datei. */
export const saveView = createServerFn({ method: 'POST' })
  .validator((data: ViewSearch & { project: string; title?: string }) => ({
    ...viewSearchOf(data),
    project: text(data.project, 'project'),
    worktree: text(data.worktree, 'worktree'),
    branch: text(data.branch, 'branch'),
    title: optionalText(data.title),
  }))
  .handler(async ({ data }) => {
    const { repoPath, worktreePath } = await access(data.worktree);
    const view: SavedView = {
      worktree: worktreePath,
      branch: data.branch,
      to: data.to,
      from: data.from,
      file: data.file,
      repoPath,
      repo: nameOf(repoPath),
      worktreeName: nameOf(worktreePath),
      title: data.title,
    };
    await (await server()).store.saveView(data.project, view);
  });

export const saveSettings = createServerFn({ method: 'POST' })
  .validator((data: Record<string, JsonValue>) => {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('Die Einstellungen sind kein Objekt.');
    }
    return data;
  })
  .handler(async ({ data }) => {
    await (await server()).store.saveSettings(data);
  });

/** Merkt sich die Tabs der Tableiste eines Projekts. */
export const saveTabs = createServerFn({ method: 'POST' })
  .validator((data: { project: string; tabs: Tab[] }) => {
    if (
      !Array.isArray(data.tabs) ||
      !data.tabs.every((tab) =>
        [tab.worktree, tab.branch, tab.repo, tab.worktreeName].every((part) => typeof part === 'string'),
      )
    ) {
      throw new Error('Die Tabs sind keine Liste von Ansichten.');
    }
    return {
      project: text(data.project, 'project'),
      tabs: data.tabs.map(({ worktree, branch, repo, worktreeName }) => ({ worktree, branch, repo, worktreeName })),
    };
  })
  .handler(async ({ data }) => {
    await (await server()).store.saveTabs(data.project, data.tabs);
  });

/** Merkt sich die ausgeblendeten Branches des Repos, zu dem der Worktree gehört. */
export const saveHidden = createServerFn({ method: 'POST' })
  .validator((data: { worktree: string; hidden: string[] }) => {
    if (!Array.isArray(data.hidden) || !data.hidden.every((entry) => typeof entry === 'string' && entry.startsWith('refs/'))) {
      throw new Error('Die ausgeblendeten Branches sind keine Liste von Namen aus refs/.');
    }
    return { worktree: text(data.worktree, 'worktree'), hidden: data.hidden };
  })
  .handler(async ({ data }) => {
    const { repoPath } = await access(data.worktree);
    await (await server()).store.saveHidden(repoPath, data.hidden);
  });

/** Die Projekte mit ihrem Ordner, dazu das aktive und das Home-Verzeichnis zum Kürzen der Pfade. */
export const listProjects = createServerFn({ method: 'GET' }).handler(async () => {
  const state = await (await server()).store.state();
  return {
    projects: state.projects.map((project) => ({ name: project.name, folder: project.folder ?? null })),
    active: activeProject(state).name,
    home: homedir(),
  };
});

/** Eine Ansicht, die die Auswahl für ein Projekt anbietet. */
export interface ViewChoice {
  worktree: string;
  worktreeName: string;
  /** Leer bei einem `HEAD` ohne Branch. */
  branch: string;
  /** Ob der Branch im Worktree ausgecheckt ist. */
  checkedOut: boolean;
}

/** Ein Repo mit den Ansichten, die die Auswahl anbietet. */
export interface RepoViews {
  name: string;
  path: string;
  views: ViewChoice[];
}

/**
 * Die Ansichten eines Repos: je Worktree die mit seinem ausgecheckten Branch, dazu unter dem ersten
 * Worktree die übrigen lokalen Branches. Ausgeblendete Branches und die der Remotes fehlen.
 */
async function viewsOf(repoPath: string, hidden: readonly string[]): Promise<ViewChoice[]> {
  const source = gitSource(repoPath);
  const [worktrees, branches] = await Promise.all([source.worktrees(), source.branches()]);
  const main = worktrees[0];
  if (main === undefined) {
    return [];
  }
  const checkedOut = new Set(worktrees.map((worktree) => worktree.branch));
  return [
    ...worktrees.map((worktree) => ({
      worktree: worktree.path,
      worktreeName: worktree.name,
      branch: worktree.branch ?? '',
      checkedOut: true,
    })),
    ...branches
      .filter((ref) => ref.kind === 'local' && !checkedOut.has(ref.name) && !isHidden(hidden, ref))
      .map((ref) => ({ worktree: main.path, worktreeName: main.name, branch: ref.name, checkedOut: false })),
  ];
}

/** Ein Ordner aus der Oberfläche, als absoluter Pfad ohne symbolische Links. */
async function folderOf(path: string): Promise<string> {
  const expanded = expandHome(path.trim());
  if (!isAbsolute(expanded)) {
    throw new Error('Der Pfad muss absolut sein oder mit ~ beginnen.');
  }
  return realpath(expanded).catch(() => {
    throw new Error(`Den Ordner '${path}' gibt es nicht.`);
  });
}

/**
 * Die Repos in einem Ordner und darunter, je mit seinen Ansichten. Ist der Ordner selbst ein
 * Worktree, gilt sein Repo. Der Ordner muss in keiner Wurzel liegen, weil er von Hand angegeben
 * wird, wie ein Pfad im Repo-Menü.
 */
export const scanFolder = createServerFn({ method: 'GET' })
  .validator((data: { folder: string }) => ({ folder: text(data.folder, 'folder') }))
  .handler(async ({ data }) => {
    const folder = await folderOf(data.folder);
    let repos = await findRepos([folder]);
    if (repos.length === 0) {
      const where = await locate(folder).catch(() => null);
      repos = where === null ? [] : [{ name: nameOf(where.repoPath), path: where.repoPath }];
    }
    const { hidden } = await (await server()).store.state();
    return {
      folder,
      repos: await Promise.all(
        repos.map(async (repo): Promise<RepoViews> => ({ ...repo, views: await viewsOf(repo.path, hidden[repo.path] ?? []) })),
      ),
    };
  });

/** Ordner und gewählte Ansichten aus der Auswahl für ein Projekt. */
interface Chosen {
  name: string;
  folder: string;
  views: { worktree: string; branch: string }[];
}

function chosenOf(data: unknown): Chosen {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const views = Array.isArray(record.views) ? (record.views as unknown[]) : null;
  if (views === null || views.length === 0) {
    throw new Error('Es ist keine Ansicht gewählt.');
  }
  const name = text(record.name, 'name').trim();
  if (name === '') {
    throw new Error('Das Projekt hat keinen Namen.');
  }
  return {
    name,
    folder: text(record.folder, 'folder'),
    views: views.map((view) => {
      const entry = typeof view === 'object' && view !== null ? (view as Record<string, unknown>) : {};
      return { worktree: text(entry.worktree, 'worktree'), branch: text(entry.branch, 'branch') };
    }),
  };
}

/** Die Tabs zu den gewählten Ansichten; Repos im Ordner sind dabei erlaubt. */
async function tabsOf(chosen: Chosen): Promise<{ folder: string; tabs: Tab[] }> {
  const folder = await folderOf(chosen.folder);
  const tabs = await Promise.all(chosen.views.map((view) => tabFor(view.worktree, view.branch, folder)));
  return { folder, tabs };
}

/** Legt ein Projekt mit den gewählten Ansichten als Tabs an, macht es aktiv und liefert seine Ansicht. */
export const createProject = createServerFn({ method: 'POST' })
  .validator(chosenOf)
  .handler(async ({ data }) => {
    const { folder, tabs } = await tabsOf(data);
    await (await server()).store.addProject({ name: data.name, folder, tabs, views: [] });
    return complete({});
  });

/** Setzt Ordner und Tabs eines bestehenden Projekts. */
export const chooseTabs = createServerFn({ method: 'POST' })
  .validator(chosenOf)
  .handler(async ({ data }) => {
    const { folder, tabs } = await tabsOf(data);
    await (await server()).store.chooseTabs(data.name, folder, tabs);
    return tabs;
  });

/** Macht ein Projekt zum aktiven und liefert seine Ansicht; `null`, wenn es noch keine hat. */
export const activateProject = createServerFn({ method: 'POST' })
  .validator((data: { name: string }) => ({ name: text(data.name, 'name') }))
  .handler(async ({ data }) => {
    await (await server()).store.activateProject(data.name);
    return complete({});
  });

export const renameProject = createServerFn({ method: 'POST' })
  .validator((data: { from: string; to: string }) => {
    const to = text(data.to, 'to').trim();
    if (to === '') {
      throw new Error('Das Projekt braucht einen Namen.');
    }
    return { from: text(data.from, 'from'), to };
  })
  .handler(async ({ data }) => {
    await (await server()).store.renameProject(data.from, data.to);
  });

/** Löscht ein Projekt und liefert die Ansicht des danach aktiven. */
export const deleteProject = createServerFn({ method: 'POST' })
  .validator((data: { name: string }) => ({ name: text(data.name, 'name') }))
  .handler(async ({ data }) => {
    await (await server()).store.deleteProject(data.name);
    return complete({});
  });
