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
import { shared } from './shared';
import { createStore, defaultStoreDir, expandHome, sameView } from './store';
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

/** Ob das Repo in einer Wurzel liegt oder ausdrücklich geöffnet wurde. */
async function isAllowed(repoPath: string, worktreePath: string): Promise<boolean> {
  const { store, allowed } = await server();
  const roots = await Promise.all((await store.roots()).map((root) => realpath(root).catch(() => root)));
  const { opened } = await store.state();
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
function access(path: string): Promise<Access> {
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
    if (!(await isAllowed(where.repoPath, where.worktreePath))) {
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
 * Datei gilt, was sich die Ansicht gemerkt hat. Ohne Worktree gilt die zuletzt geöffnete Ansicht,
 * die noch einen Tab hat, dann der erste Tab und dann die zuletzt geöffnete. Gibt es nichts davon,
 * gilt die Ansicht für den ersten Start.
 */
async function complete(search: ViewSearch): Promise<ViewSearch | null> {
  const { store, first } = await server();
  if (search.worktree === undefined) {
    const { tabs, views } = await store.state();
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
  const memory = (await store.state()).views.find((saved) => sameView(saved, view));
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
async function tabFor(worktree: string, branch: string): Promise<Tab> {
  const { repoPath, worktreePath } = await access(worktree);
  return { worktree: worktreePath, branch, repo: nameOf(repoPath), worktreeName: nameOf(worktreePath) };
}

/** Der Tab zu einer Wahl, mit den Namen von Repo und Worktree; `null`, wenn es keine Ansicht gibt. */
export const tabOf = createServerFn({ method: 'GET' })
  .validator(viewSearchOf)
  .handler(async ({ data }): Promise<Tab | null> => {
    const view = await complete(data);
    return view?.worktree === undefined ? null : tabFor(view.worktree, view.branch ?? '');
  });

/** Repo und Commits einer Ansicht, die Worktrees des Repos, die Einstellungen und die Tabs. */
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
    return { repo, worktrees, settings: state.settings, hidden, tabs: state.tabs };
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
 * Die gefundenen und die über den Pfad geöffneten Repos, dazu die Wurzeln und das Home-Verzeichnis, damit die Oberfläche Pfade mit `~` kürzen kann. Jedes
 * Repo nennt die Ansicht, die ein Klick öffnet: seine zuletzt geöffnete, sonst sein erster
 * Worktree. So kann die Oberfläche jedes Repo als Link zeigen, der sich auch in einem neuen Tab
 * öffnen lässt.
 */
export const listRepos = createServerFn({ method: 'GET' }).handler(async () => {
  const { store } = await server();
  const state = await store.state();
  const lastViews = new Map<string, SavedView>();
  for (const view of state.views) {
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
  // Ein Repo steht nur im ersten Abschnitt, in dem es vorkommt.
  const shown = new Set<string>();
  const unshown = (entries: RepoEntry[]) => {
    const rest = entries.filter((entry) => !shown.has(entry.path));
    rest.forEach((entry) => shown.add(entry.path));
    return rest.map(choiceOf);
  };
  const found = unshown(await findRepos(realRoots));
  // Über das Pfadfeld geöffnete Repos außerhalb der Wurzeln findet die Suche nicht.
  const opened = unshown(
    state.opened.map((path) => ({ name: nameOf(path), path })).sort((a, b) => a.name.localeCompare(b.name)),
  );
  return {
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
    const { views } = await store.state();
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
  const last = (await store.state()).views.find((view) => view.worktree === worktreePath);
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

/** Die zuletzt geöffneten Ansichten, die neueste zuerst, mit ihren Teilen für die URL. */
export const listViews = createServerFn({ method: 'GET' }).handler(async () =>
  (await (await server()).store.state()).views
    .slice(0, 10)
    .map((view) => ({ ...view, search: searchOf(view) })),
);

/** Merkt sich die Ansicht als die zuletzt geöffnete, mit Vergleich und Datei. */
export const saveView = createServerFn({ method: 'POST' })
  .validator((data: ViewSearch & { title?: string }) => ({
    ...viewSearchOf(data),
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
    await (await server()).store.saveView(view);
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

/** Merkt sich die Tabs der Tableiste. */
export const saveTabs = createServerFn({ method: 'POST' })
  .validator((data: { tabs: Tab[] }) => {
    if (
      !Array.isArray(data.tabs) ||
      !data.tabs.every((tab) =>
        [tab.worktree, tab.branch, tab.repo, tab.worktreeName].every((part) => typeof part === 'string'),
      )
    ) {
      throw new Error('Die Tabs sind keine Liste von Ansichten.');
    }
    return {
      tabs: data.tabs.map(({ worktree, branch, repo, worktreeName }) => ({ worktree, branch, repo, worktreeName })),
    };
  })
  .handler(async ({ data }) => {
    await (await server()).store.saveTabs(data.tabs);
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
