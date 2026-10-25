import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';

/** Ein Repo, gefunden in einer Wurzel oder zuletzt geöffnet. */
export interface RepoEntry {
  name: string;
  /** Der Ordner, in dem `.git` liegt; zugleich der Pfad des ersten Worktrees. */
  path: string;
}

/** So tief wird unter einer Wurzel gesucht, etwa `~/develop/talk/2026-wjax/repo`. */
const DEPTH = 3;

/** Ordner, in denen kein Repo eines Workshops liegt und deren Inhalt groß sein kann. */
const SKIPPED = new Set(['node_modules', 'target', 'build', 'dist']);

/**
 * Die Repos unter den Wurzeln, nach Name sortiert. Ein Ordner mit dem Verzeichnis `.git` ist ein
 * Repo. Darunter wird weiter gesucht, weil ein Repo für einen Workshop die Repos der Teilnehmer
 * enthalten kann. Ein Ordner mit der Datei `.git` ist ein Worktree oder ein Submodul und gehört zu
 * einem anderen Repo. Versteckte Ordner bleiben außen vor.
 */
export async function findRepos(roots: string[]): Promise<RepoEntry[]> {
  const found: RepoEntry[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Ein Ordner ohne Leserecht oder eine Wurzel, die es nicht gibt, enthält kein Repo.
      return;
    }
    const git = entries.find((entry) => entry.name === '.git');
    if (git?.isDirectory() === true) {
      found.push({ name: basename(dir), path: dir });
    } else if (git !== undefined) {
      return;
    }
    if (depth === DEPTH) {
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED.has(entry.name))
        .map((entry) => visit(join(dir, entry.name), depth + 1)),
    );
  };
  await Promise.all(roots.map((root) => visit(root, 0)));
  const unique = new Map(found.map((entry) => [entry.path, entry]));
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Ein Ordner direkt unter einer Wurzel, etwa `~/develop/tanstack-ai-talk`, mit den Repos darin.
 * Der Ordner kann selbst ein Repo sein.
 */
export interface RepoProject {
  name: string;
  path: string;
  /** Die Wurzel, unter der das Projekt liegt. */
  root: string;
  /** Das Repo im Ordner des Projekts selbst, falls er eins ist. */
  repo: RepoEntry | null;
  /** Die Repos darunter, nach Name; ihr Name ist der Pfad relativ zum Projekt. */
  children: RepoEntry[];
}

/**
 * Ordnet die Repos ihren Projekten unter den Wurzeln zu, nach Name sortiert. Liegt eine Wurzel in
 * einer anderen, etwa `~/develop/javascript` in `~/develop`, gilt für ein Repo die tiefere.
 */
export function projectsOf(entries: RepoEntry[], roots: string[]): RepoProject[] {
  const deepestFirst = [...roots].sort((a, b) => b.length - a.length);
  const projects = new Map<string, RepoProject>();
  for (const entry of entries) {
    const root =
      deepestFirst.find((candidate) => entry.path === candidate || entry.path.startsWith(candidate + sep)) ??
      entry.path;
    const first = relative(root, entry.path).split(sep)[0] ?? '';
    const path = first === '' ? entry.path : join(root, first);
    const project = projects.get(path) ?? { name: basename(path), path, root, repo: null, children: [] };
    projects.set(path, project);
    if (entry.path === path) {
      project.repo = entry;
    } else {
      project.children.push({ name: relative(path, entry.path), path: entry.path });
    }
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return [...projects.values()]
    .map((project) => ({ ...project, children: project.children.sort(byName) }))
    .sort(byName);
}

/**
 * Wann ein Projekt zuletzt geändert wurde, in Millisekunden seit 1970. Als Änderung gilt das
 * Änderungsdatum eines Ordners wie im Finder: Es ändert sich, wenn darin eine Datei angelegt,
 * gelöscht oder umbenannt wird. Es zählt das jüngste Datum aus dem Ordner des Projekts und denen
 * seiner Repos. Ein Ordner, der sich nicht lesen lässt, zählt als der älteste.
 */
export async function changedAt(project: RepoProject): Promise<number> {
  const paths = [project.path, ...project.children.map((child) => child.path)];
  const times = await Promise.all(paths.map((path) => stat(path).then((info) => info.mtimeMs, () => 0)));
  return Math.max(...times);
}
