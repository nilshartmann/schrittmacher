import { basename, dirname } from 'node:path';
import { parseDiff } from './diffParser';
import type { ParsedFile } from './diffParser';
import { markParts } from './lineParts';
import { runGit } from './process';
import type { Comparison, RepoData, RepoSource } from './repo';
import type { Commit, DiffFile, DiffLine, Ref } from './types';

/** Der Baum ohne Dateien; gegen ihn vergleicht Git den ersten Commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Trennt die Felder einer Zeile, die Git ausgibt; im Titel eines Commits kommt es nicht vor. */
const FIELD = '\x1f';

/** Ein Titel mit Schritt, etwa `25e: Mit @TransactionalEventListener …`. */
const STEP = /^(\d+[a-z]?):\s*(.*)$/;

const DATE = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/** So viele Vergleiche hält der Server vor; ein Workshop hat selten mehr Schritte. */
const CACHED_COMPARISONS = 100;

/**
 * Ein echtes Repo als Quelle, gelesen über Git im Verzeichnis eines Worktrees. Die Commits sind die
 * des ausgecheckten Branches. Git ändert dabei nichts am Repo. Zuerst gezeigt wird der neueste
 * Commit, mit `startStep` der neueste mit dieser Nummer des Schritts.
 */
export function gitSource(worktree: string, startStep?: string): RepoSource {
  const git = (...args: string[]) => runGit(worktree, args);
  // Zwei Commits ändern sich nie, deshalb bleibt ihr Vergleich gültig, auch nach einem Rebase.
  const cache = new Map<string, Promise<DiffFile[]>>();
  return {
    load: () => load(git, startStep),
    compare: async (comparison) => {
      const [older, newer] = await sides(git, comparison);
      const key = `${older}..${newer}`;
      const cached = cache.get(key) ?? compare(git, older, newer);
      cache.delete(key);
      cache.set(key, cached);
      for (const oldest of cache.keys()) {
        if (cache.size <= CACHED_COMPARISONS) {
          break;
        }
        cache.delete(oldest);
      }
      cached.catch(() => cache.delete(key));
      return cached;
    },
    state: () => stateOf(git),
  };
}

type Git = (...args: string[]) => Promise<string>;

async function load(git: Git, startStep: string | undefined): Promise<RepoData> {
  // Der Stand wird vor allem anderen gelesen. Kommt danach ein Commit hinzu, fällt er deshalb bei
  // der nächsten Abfrage auf.
  const state = await stateOf(git);
  const [commonDir, topLevel, branch, log, refs] = await Promise.all([
    git('rev-parse', '--path-format=absolute', '--git-common-dir'),
    git('rev-parse', '--show-toplevel'),
    git('branch', '--show-current'),
    git('log', '--reverse', `--format=%H${FIELD}%an${FIELD}%aI${FIELD}%s`, 'HEAD'),
    git('for-each-ref', `--format=%(refname)${FIELD}%(objectname)`, 'refs/heads', 'refs/remotes'),
  ]);
  const commits = lines(log).map(commitOf);
  const last = commits.at(-1);
  if (last === undefined) {
    throw new Error('Der Branch hat noch keinen Commit.');
  }
  return {
    info: {
      repo: basename(dirname(commonDir.trim())),
      worktree: basename(topLevel.trim()),
      branch: branch.trim(),
    },
    commits,
    refs: lines(refs).flatMap(refOf),
    start: commits.findLast((commit) => commit.step === startStep)?.sha ?? last.sha,
    state,
  };
}

/** Der ausgecheckte Commit und Branch und alle Branches mit ihrem Commit. */
async function stateOf(git: Git): Promise<string> {
  const outputs = await Promise.all([
    git('rev-parse', 'HEAD'),
    git('branch', '--show-current'),
    git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'),
  ]);
  return outputs.join('');
}

function lines(output: string): string[] {
  return output.split('\n').filter((line) => line !== '');
}

function commitOf(line: string): Commit {
  const [sha = '', author = '', date = '', subject = ''] = line.split(FIELD);
  const step = STEP.exec(subject);
  return {
    sha,
    step: step?.[1] ?? null,
    title: step?.[2] ?? subject,
    author,
    date: DATE.format(new Date(date)),
  };
}

/** Ein Branch aus `for-each-ref`; der Zeiger `HEAD` eines Remotes ist keiner. */
function refOf(line: string): Ref[] {
  const [name = '', sha = ''] = line.split(FIELD);
  if (name.endsWith('/HEAD')) {
    return [];
  }
  return name.startsWith('refs/heads/')
    ? [{ name: name.slice('refs/heads/'.length), kind: 'local', sha }]
    : [{ name: name.slice('refs/remotes/'.length), kind: 'remote', sha }];
}

/**
 * Beide Seiten eines Vergleichs, die ältere zuerst. Ohne `from` gilt der Vorgänger, für den ersten
 * Commit der leere Baum.
 */
async function sides(git: Git, comparison: Comparison): Promise<[string, string]> {
  const to = comparison.to;
  const from = comparison.from ?? (await parentOf(git, to));
  return (await isAncestor(git, to, from)) ? [to, from] : [from, to];
}

/**
 * Die Dateien, die sich zwischen beiden Commits unterscheiden, nach Pfad sortiert. Mit dem größten
 * Umfang an Kontext steht jede Datei ganz im Diff. Die festen Präfixe und Optionen setzen eine
 * abweichende Konfiguration des Benutzers außer Kraft, die Ausgabe sonst anders formen würde.
 */
async function compare(git: Git, older: string, newer: string): Promise<DiffFile[]> {
  const output = await git(
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-relative',
    '--find-renames',
    '--unified=2147483647',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    older,
    newer,
  );
  return parseDiff(output)
    .map(fileOf)
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Eine Datei für die Oberfläche, mit den Teilen jeder geänderten Zeile und beiden Fassungen. */
function fileOf(parsed: ParsedFile): DiffFile {
  if (parsed.hunks > 1) {
    throw new Error(`Der Diff von '${parsed.newPath}' enthält nicht die ganze Datei.`);
  }
  const whole = parsed.lines;
  markParts(whole);
  return {
    path: parsed.newPath,
    oldPath: parsed.oldPath,
    kind: parsed.kind,
    binary: parsed.binary,
    added: whole.filter((line) => line.kind === 'added').length,
    removed: whole.filter((line) => line.kind === 'removed').length,
    whole,
    oldText: textOf(whole.filter((line) => line.oldNumber !== null)),
    newText: textOf(whole.filter((line) => line.newNumber !== null)),
  };
}

function textOf(lines: DiffLine[]): string {
  return lines.map((line) => `${line.text}\n`).join('');
}

async function parentOf(git: Git, sha: string): Promise<string> {
  try {
    return (await git('rev-parse', '--verify', '--quiet', `${sha}^`)).trim();
  } catch {
    return EMPTY_TREE;
  }
}

/** Ob `older` ein Vorfahre von `newer` ist; der leere Baum ist keiner. */
async function isAncestor(git: Git, older: string, newer: string): Promise<boolean> {
  if (older === EMPTY_TREE || newer === EMPTY_TREE) {
    return false;
  }
  try {
    await git('merge-base', '--is-ancestor', older, newer);
    return true;
  } catch {
    return false;
  }
}
