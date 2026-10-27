import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { buildDemoRepo, DEMO_BASE } from '../git/demoGit';
import { DEMO_REPO } from '../git/demoRepo';
import { gitSource, locate } from '../git/gitRepo';
import type { Comparison, RepoSource } from '../git/repo';
import { changedAt, findRepos, foldersOf } from '../git/repos';
import { branchScopeOf } from '../git/scope';
import type { RepoEntry, RepoFolder } from '../git/repos';
import type { SyncAction } from '../git/types';
import { noteInputOf } from '../notes/notes';
import { isOpenApp, openIn } from './apps';
import type { OpenApp } from './apps';
import { createNotes } from './notes';
import { shared } from './shared';
import { createStore, defaultStoreDir, expandHome, sameView } from './store';
import type { JsonValue, Project, SavedView, Store, Tab, ViewSearch } from './store';

/** Was der Server einmal beim Start einrichtet. */
interface Setup {
  store: Store;
  /** Der Ordner des Speichers; darin liegen auch die Hinweise zur Überarbeitung. */
  dir: string;
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
        const dir = join(DEMO_BASE, 'speicher');
        return {
          store: createStore({ dir, roots: [DEMO_BASE] }),
          dir,
          first: { worktree, branch: DEMO_REPO.info.branch, to: '06b' },
          allowed: [],
        };
      }
      const worktree = process.env.SCHRITTMACHER_REPO;
      const first = worktree === undefined || worktree === '' ? null : { worktree };
      return {
        store: createStore({ dir: defaultStoreDir(), roots: ['~/develop'] }),
        dir: defaultStoreDir(),
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
      source.load(data.branch === '' ? null : data.branch, { scope: branchScopeOf(state.settings), hidden }),
      source.worktrees(),
    ]);
    return { repo, worktrees, settings: state.settings, hidden, tabs: state.tabs };
  });

export const compareCommits = createServerFn({ method: 'GET' })
  .validator((data: { worktree: string; comparison: Comparison }) => data)
  .handler(async ({ data }) => (await access(data.worktree)).source.compare(data.comparison));

/** Personen und ganze Nachricht eines Commits, siehe `RepoSource.details`. */
export const commitDetails = createServerFn({ method: 'GET' })
  .validator((data: { worktree: string; sha: string }) => ({
    worktree: text(data.worktree, 'worktree'),
    sha: text(data.sha, 'sha'),
  }))
  .handler(async ({ data }) => (await access(data.worktree)).source.details(data.sha));

/** Die Commits zwischen zwei verglichenen Commits, siehe `RepoSource.between`. */
export const commitsBetween = createServerFn({ method: 'GET' })
  .validator((data: { worktree: string; comparison: Comparison }) => data)
  .handler(async ({ data }) => (await access(data.worktree)).source.between(data.comparison));

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

/** Holt die Branches eines Remotes, ohne Remote die aller, siehe `RepoSource.fetch`. */
export const fetchRemote = createServerFn({ method: 'POST' })
  .validator((data: { worktree: string; remote: string | null }) => ({
    worktree: text(data.worktree, 'worktree'),
    remote: data.remote === null ? null : text(data.remote, 'remote'),
  }))
  .handler(async ({ data }) => {
    await (await access(data.worktree)).source.fetch(data.remote);
  });

/** Was Merge und Reset eines lokalen Branches bewirken würden, siehe `RepoSource.syncPlan`. */
export const syncPlan = createServerFn({ method: 'GET' })
  .validator((data: { worktree: string; branch: string }) => ({
    worktree: text(data.worktree, 'worktree'),
    branch: text(data.branch, 'branch'),
  }))
  .handler(async ({ data }) => (await access(data.worktree)).source.syncPlan(data.branch));

/** Merge oder harter Reset eines lokalen Branches, siehe `RepoSource.sync`. */
export const syncBranch = createServerFn({ method: 'POST' })
  .validator((data: { worktree: string; branch: string; action: SyncAction; local: string; upstream: string }) => {
    if (data.action !== 'merge' && data.action !== 'reset') {
      throw new Error('Die Aktion ist weder Merge noch Reset.');
    }
    return {
      worktree: text(data.worktree, 'worktree'),
      branch: text(data.branch, 'branch'),
      action: data.action,
      local: text(data.local, 'local'),
      upstream: text(data.upstream, 'upstream'),
    };
  })
  .handler(async ({ data }) => {
    await (await access(data.worktree)).source.sync(data.branch, data.action, {
      local: data.local,
      upstream: data.upstream,
    });
  });

/** Der Zeitpunkt des letzten Fetch im Repo des Worktrees. */
export const lastFetch = createServerFn({ method: 'GET' })
  .validator((data: { worktree: string }) => ({ worktree: text(data.worktree, 'worktree') }))
  .handler(async ({ data }) => (await access(data.worktree)).source.fetched());

/**
 * Kopiert eine Datei aus dem Vergleich in den Worktree eines anderen Tabs, an dieselbe Stelle.
 * Gelesen wird sie im Commit `revision`, mit `LOCAL` im Worktree. Im Ziel muss der Branch des Tabs
 * ausgecheckt sein.
 */
export const copyFile = createServerFn({ method: 'POST' })
  .validator((data: { worktree: string; revision: string; path: string; target: { worktree: string; branch: string } }) => ({
    worktree: text(data.worktree, 'worktree'),
    revision: text(data.revision, 'revision'),
    path: text(data.path, 'path'),
    target: { worktree: text(data.target.worktree, 'target.worktree'), branch: text(data.target.branch, 'target.branch') },
  }))
  .handler(async ({ data }) => {
    const [from, to] = await Promise.all([access(data.worktree), access(data.target.worktree)]);
    const content = await from.source.content(data.revision, data.path);
    await to.source.write(data.target.branch, data.path, content);
  });

/**
 * Öffnet den Worktree in einem Programm auf dem Mac, etwa im Terminal oder in Fork. Mit `path`
 * öffnen Terminal und ForkLift den Ordner dieser Datei im Worktree; Fork kennt nur ganze Repos.
 */
export const openWorktreeIn = createServerFn({ method: 'POST' })
  .validator((data: { worktree: string; app: OpenApp; path?: string }) => {
    if (!isOpenApp(data.app)) {
      throw new Error(`Das Programm '${String(data.app)}' ist unbekannt.`);
    }
    return { worktree: text(data.worktree, 'worktree'), app: data.app, path: optionalText(data.path) };
  })
  .handler(async ({ data }) => {
    const { worktreePath } = await access(data.worktree);
    const place =
      data.path === undefined || data.app === 'fork' ? worktreePath : await folderInWorktree(worktreePath, data.path);
    await openIn(data.app, place);
  });

/**
 * Der Ordner einer Datei im Worktree. Gibt es ihn dort nicht mehr, etwa weil der Commit älter ist,
 * gilt der nächste Ordner darüber, den es noch gibt, höchstens der Worktree selbst.
 */
async function folderInWorktree(worktreePath: string, path: string): Promise<string> {
  let folder = resolve(worktreePath, dirname(path));
  if (!inside(folder, worktreePath)) {
    throw new Error(`Der Pfad '${path}' liegt nicht im Worktree.`);
  }
  while (folder !== worktreePath && !(await isFolder(folder))) {
    folder = dirname(folder);
  }
  return folder;
}

function isFolder(path: string): Promise<boolean> {
  return stat(path).then(
    (found) => found.isDirectory(),
    () => false,
  );
}

/**
 * Die Hinweise im Ordner des Speichers. Sie entstehen bei jedem Aufruf neu und nicht einmal in
 * `server`, damit der Dev-Server nach einer Änderung an `src/notes/notes.ts` deren neue Fassung
 * nimmt; `server` überdauert das Neuladen der Module.
 */
async function notesStore() {
  const setup = await server();
  // Eine Einrichtung von vor dem Neuladen kennt `dir` noch nicht.
  return createNotes(setup.dir ?? defaultStoreDir());
}

/** Die Hinweise zur Überarbeitung des Repos, zu dem der Worktree gehört. */
export const loadNotes = createServerFn({ method: 'GET' })
  .validator((data: { worktree: string }) => ({ worktree: text(data.worktree, 'worktree') }))
  .handler(async ({ data }) => {
    const { repoPath } = await access(data.worktree);
    return (await notesStore()).load(repoPath);
  });

/** Legt einen Hinweis an oder ändert ihn und liefert danach alle Hinweise des Repos. */
export const saveNote = createServerFn({ method: 'POST' })
  .validator((data: { worktree: string; note: unknown }) => ({
    worktree: text(data.worktree, 'worktree'),
    note: noteInputOf(data.note),
  }))
  .handler(async ({ data }) => {
    const { repoPath } = await access(data.worktree);
    return (await notesStore()).save(repoPath, data.note);
  });

/** Löscht einen Hinweis, ohne `id` alle Hinweise des Repos, und liefert danach die übrigen. */
export const deleteNotes = createServerFn({ method: 'POST' })
  .validator((data: { worktree: string; id?: string }) => ({
    worktree: text(data.worktree, 'worktree'),
    id: optionalText(data.id),
  }))
  .handler(async ({ data }) => {
    const { repoPath } = await access(data.worktree);
    const notes = await notesStore();
    return data.id === undefined ? notes.clear(repoPath) : notes.remove(repoPath, data.id);
  });

/** Wo ein Ziel zum Kopieren liegt, vom Repo der Quelle aus gesehen. */
export type CopyPlace = 'repo' | 'sister' | 'other';

/**
 * Die Tabs, in die sich eine Datei aus `worktree` kopieren lässt: die, deren Branch in ihrem
 * Worktree ausgecheckt ist, ohne den Tab der Quelle. Zuerst stehen die Tabs desselben Repos, auch
 * aus seinen anderen Worktrees, dann die von Schwester-Repos im selben Ordner, dann alle übrigen;
 * innerhalb davon in der Reihenfolge der Tableiste. Ein Tab, dessen Worktree es nicht mehr gibt,
 * fehlt.
 */
export const copyTargets = createServerFn({ method: 'POST' })
  .validator((data: { worktree: string; branch: string; tabs: Tab[] }) => {
    if (!Array.isArray(data.tabs)) {
      throw new Error('Die Tabs sind keine Liste.');
    }
    return { worktree: text(data.worktree, 'worktree'), branch: text(data.branch, 'branch'), tabs: data.tabs };
  })
  .handler(async ({ data }): Promise<(Tab & { place: CopyPlace })[]> => {
    const { repoPath } = await access(data.worktree);
    const found = await Promise.all(
      data.tabs.map(async (tab) => {
        if (tab.worktree === data.worktree && tab.branch === data.branch) {
          return null;
        }
        const where = await access(tab.worktree)
          .then((target) => locate(target.worktreePath).then((located) => ({ ...located, repoPath: target.repoPath })))
          .catch(() => null);
        if (where === null || where.checkedOut !== tab.branch) {
          return null;
        }
        const place: CopyPlace =
          where.repoPath === repoPath ? 'repo' : dirname(where.repoPath) === dirname(repoPath) ? 'sister' : 'other';
        return { ...tab, place };
      }),
    );
    const order: CopyPlace[] = ['repo', 'sister', 'other'];
    return order.flatMap((place) => found.filter((tab) => tab?.place === place)).filter((tab) => tab !== null);
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

/** Ein Ordner in der Auswahl, mit den Ansichten, die ein Klick auf seine Repos öffnet. */
export interface FolderChoice {
  name: string;
  path: string;
  /** Die Wurzel, unter der der Ordner liegt, wie in `roots`. */
  root: string;
  repo: RepoChoice | null;
  children: RepoChoice[];
  /** Wann der Ordner zuletzt geändert wurde, siehe `changedAt`. */
  changed: number;
}

/**
 * Die gefundenen Repos in ihren Ordnern, mit dem Datum ihrer letzten Änderung, und die über den
 * Pfad geöffneten Repos, dazu die Wurzeln und das Home-Verzeichnis, damit die Oberfläche Pfade mit `~` kürzen kann. Jedes
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
    return rest;
  };
  const folderChoiceOf = async (folder: RepoFolder): Promise<FolderChoice> => ({
    ...folder,
    root: roots[realRoots.indexOf(folder.root)] ?? folder.root,
    repo: folder.repo === null ? null : choiceOf(folder.repo),
    children: folder.children.map(choiceOf),
    changed: await changedAt(folder),
  });
  const folders = await Promise.all(foldersOf(unshown(await findRepos(realRoots)), realRoots).map(folderChoiceOf));
  // Über das Pfadfeld geöffnete Repos außerhalb der Wurzeln findet die Suche nicht.
  const opened = unshown(
    state.opened.map((path) => ({ name: nameOf(path), path })).sort((a, b) => a.name.localeCompare(b.name)),
  );
  return {
    folders,
    opened: opened.map(choiceOf),
    excluded: state.excluded,
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

/** Die gemerkten Ansichten, die neueste zuerst, mit ihren Teilen für die URL. */
export const listViews = createServerFn({ method: 'GET' }).handler(async () =>
  (await (await server()).store.state()).views.map((view) => ({ ...view, search: searchOf(view) })),
);

/** Merkt sich die Ansicht als die zuletzt geöffnete, mit Vergleich und Datei. */
export const saveView = createServerFn({ method: 'POST' })
  .validator((data: ViewSearch) => ({
    ...viewSearchOf(data),
    worktree: text(data.worktree, 'worktree'),
    branch: text(data.branch, 'branch'),
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
  .validator((data: { tabs: Tab[] }) => ({ tabs: tabsOf(data.tabs) }))
  .handler(async ({ data }) => {
    await (await server()).store.saveTabs(data.tabs);
  });

/** Eine Liste von Tabs aus der Oberfläche, nur mit den Teilen eines Tabs. */
function tabsOf(value: unknown): Tab[] {
  const isTab = (tab: unknown): tab is Tab =>
    typeof tab === 'object' &&
    tab !== null &&
    ['worktree', 'branch', 'repo', 'worktreeName'].every(
      (key) => typeof (tab as Record<string, unknown>)[key] === 'string',
    );
  if (!Array.isArray(value) || !value.every(isTab)) {
    throw new Error('Die Tabs sind keine Liste von Ansichten.');
  }
  return value.map(({ worktree, branch, repo, worktreeName }) => ({ worktree, branch, repo, worktreeName }));
}

/** Merkt sich die Pfade, deren Repos das Menü der Repos nicht zeigt. */
export const saveExcluded = createServerFn({ method: 'POST' })
  .validator((data: { excluded: string[] }) => {
    if (!Array.isArray(data.excluded) || !data.excluded.every((entry) => typeof entry === 'string' && isAbsolute(entry))) {
      throw new Error('Die ausgeschlossenen Repos sind keine Liste von absoluten Pfaden.');
    }
    return { excluded: data.excluded };
  })
  .handler(async ({ data }) => {
    await (await server()).store.saveExcluded(data.excluded);
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

/** Was einer Ansicht fehlt: das Repo, der Worktree oder der Branch; `other` für jeden anderen Grund. */
export type MissingReason = 'repo' | 'worktree' | 'branch' | 'other';

/** Eine Ansicht, die sich nicht öffnen lässt, mit dem Grund in Worten. */
export interface Missing {
  reason: MissingReason;
  message: string;
}

function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/**
 * Was der Ansicht aus Worktree und Branch fehlt; `null`, wenn sich nichts findet. Fehlt der Ordner
 * des Worktrees, sagt eine gemerkte Ansicht, zu welchem Repo er gehörte. Gibt es das Repo noch,
 * fehlt nur der Worktree.
 */
async function missingOf(worktree: string, branch: string): Promise<Missing | null> {
  if (!(await exists(worktree))) {
    const { views } = await (await server()).store.state();
    const repoPath = views.find((view) => view.worktree === worktree)?.repoPath;
    if (repoPath !== undefined && repoPath !== worktree && (await exists(repoPath))) {
      return {
        reason: 'worktree',
        message: `Den Worktree ${worktree} gibt es nicht mehr. Das Repo ${repoPath} ist noch da.`,
      };
    }
    return {
      reason: 'repo',
      message: `Den Ordner ${worktree} gibt es nicht. Vielleicht wurde das Repo verschoben, oder die Platte, auf der es liegt, ist nicht eingehängt.`,
    };
  }
  try {
    const { source } = await access(worktree);
    if (branch === '' || (await source.branches()).some((ref) => ref.name === branch)) {
      return null;
    }
    return { reason: 'branch', message: `Den Branch ${branch} gibt es im Repo nicht mehr.` };
  } catch (error) {
    return { reason: 'other', message: error instanceof Error ? error.message : String(error) };
  }
}

/** Was den Ansichten der Tabs fehlt, in derselben Reihenfolge; `null` für eine, die sich öffnen lässt. */
export const checkTabs = createServerFn({ method: 'POST' })
  .validator((data: { tabs: Tab[] }) => ({ tabs: tabsOf(data.tabs) }))
  .handler(({ data }) => Promise.all(data.tabs.map((tab) => missingOf(tab.worktree, tab.branch))));

/**
 * Eine Ansicht, die sich nicht öffnen lässt, mit dem Grund, ihrem Tab und den gemerkten Tabs;
 * `null`, wenn ihr nichts fehlt. Die Namen des Tabs kommen zuerst aus einem gemerkten Tab oder
 * Projekt, weil sie sich ohne den Ordner nicht mehr ermitteln lassen.
 */
export const loadMissing = createServerFn({ method: 'GET' })
  .validator((data: { worktree: string; branch: string }) => ({
    worktree: text(data.worktree, 'worktree'),
    branch: text(data.branch, 'branch'),
  }))
  .handler(async ({ data }) => {
    const missing = await missingOf(data.worktree, data.branch);
    if (missing === null) {
      return null;
    }
    const state = await (await server()).store.state();
    const known = [...state.tabs, ...state.projects.flatMap((project) => project.tabs)].find((tab) =>
      sameView(tab, data),
    );
    // Ohne gemerkten Tab gilt der Name des Repos, solange es den Ordner gibt, sonst der einer gemerkten Ansicht.
    const repoPath = state.views.find((view) => view.worktree === data.worktree)?.repoPath;
    const tab: Tab = known ??
      (await tabFor(data.worktree, data.branch).catch(() => null)) ?? {
        worktree: data.worktree,
        branch: data.branch,
        repo: nameOf(repoPath ?? data.worktree),
        worktreeName: nameOf(data.worktree),
      };
    return { missing, tab, tabs: state.tabs };
  });

/** Die Projekte, das zuletzt geöffnete zuerst. */
export const listProjects = createServerFn({ method: 'GET' }).handler(
  async () => (await (await server()).store.state()).projects,
);

/** Eine Änderung an den Projekten aus der Oberfläche. */
export type ProjectChange =
  | { kind: 'create'; name: string; tabs: Tab[] }
  | { kind: 'toggle'; name: string; tab: Tab }
  | { kind: 'rename'; name: string; to: string }
  | { kind: 'delete'; name: string }
  | { kind: 'opened'; name: string };

function projectChangeOf(data: ProjectChange): ProjectChange {
  const name = text(data.name, 'name');
  switch (data.kind) {
    case 'create':
      return { kind: 'create', name: name.trim(), tabs: tabsOf(data.tabs) };
    case 'toggle': {
      const [tab] = tabsOf([data.tab]);
      if (tab === undefined) {
        throw new Error('Der Tab fehlt.');
      }
      return { kind: 'toggle', name, tab };
    }
    case 'rename':
      return { kind: 'rename', name, to: text(data.to, 'to').trim() };
    case 'delete':
    case 'opened':
      return { kind: data.kind, name };
    default:
      throw new Error('Diese Änderung an einem Projekt gibt es nicht.');
  }
}

/** Die Projekte nach der Änderung; ein neues und ein gerade geöffnetes stehen zuerst. */
function changedProjects(projects: Project[], change: ProjectChange): Project[] {
  const project = projects.find((candidate) => candidate.name === change.name);
  const others = projects.filter((candidate) => candidate !== project);
  const free = (name: string) => {
    if (name === '') {
      throw new Error('Das Projekt braucht einen Namen.');
    }
    if (others.some((candidate) => candidate.name === name)) {
      throw new Error(`Ein Projekt „${name}“ gibt es schon.`);
    }
  };
  if (change.kind === 'create') {
    free(change.name);
    if (project !== undefined) {
      throw new Error(`Ein Projekt „${change.name}“ gibt es schon.`);
    }
    const tabs = change.tabs.filter((tab, at) => change.tabs.findIndex((other) => sameView(other, tab)) === at);
    return [{ name: change.name, tabs }, ...projects];
  }
  if (project === undefined) {
    throw new Error(`Das Projekt „${change.name}“ gibt es nicht mehr.`);
  }
  switch (change.kind) {
    case 'toggle': {
      const tabs = project.tabs.some((tab) => sameView(tab, change.tab))
        ? project.tabs.filter((tab) => !sameView(tab, change.tab))
        : [...project.tabs, change.tab];
      return projects.map((candidate) => (candidate === project ? { ...project, tabs } : candidate));
    }
    case 'rename':
      free(change.to);
      return projects.map((candidate) => (candidate === project ? { ...project, name: change.to } : candidate));
    case 'delete':
      return others;
    case 'opened':
      return [project, ...others];
  }
}

/** Ändert die Projekte und liefert sie danach. */
export const changeProject = createServerFn({ method: 'POST' })
  .validator(projectChangeOf)
  .handler(async ({ data }) => {
    const { store } = await server();
    await store.changeProjects((projects) => changedProjects(projects, data));
    return (await store.state()).projects;
  });
