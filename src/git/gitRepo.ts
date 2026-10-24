import { basename, dirname } from 'node:path';
import { runGit } from './process';
import { fileDiff } from './repo';
import type { Comparison, RepoData, RepoSource } from './repo';
import type { Commit, DiffFile, Ref } from './types';

/** Der Baum ohne Dateien; gegen ihn vergleicht Git den ersten Commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Trennt die Felder einer Zeile, die Git ausgibt; im Titel eines Commits kommt es nicht vor. */
const FIELD = '\x1f';

/** Ein Titel mit Schritt, etwa `25e: Mit @TransactionalEventListener …`. */
const STEP = /^(\d+[a-z]?):\s*(.*)$/;

const DATE = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Ein echtes Repo als Quelle, gelesen über Git im Verzeichnis eines Worktrees. Die Commits sind die
 * des ausgecheckten Branches. Git ändert dabei nichts am Repo.
 */
export function gitSource(worktree: string): RepoSource {
  const git = (...args: string[]) => runGit(worktree, args);
  return {
    load: () => load(git),
    compare: (comparison) => compare(git, comparison),
  };
}

type Git = (...args: string[]) => Promise<string>;

async function load(git: Git): Promise<RepoData> {
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
    start: last.sha,
  };
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
 * Die Dateien, die sich zwischen beiden Commits unterscheiden. Ohne `from` gilt der Vorgänger, für
 * den ersten Commit der leere Baum. Den Diff selbst rechnet `fileDiff` aus dem Text beider Seiten,
 * wie beim Repo im Speicher; Umbenennungen erscheinen als gelöschte und neue Datei.
 */
async function compare(git: Git, comparison: Comparison): Promise<DiffFile[]> {
  const to = comparison.to;
  const from = comparison.from ?? (await parentOf(git, to));
  const [older, newer] = (await isAncestor(git, to, from)) ? [to, from] : [from, to];
  const changes = await git('diff', '--name-status', '--no-renames', '-z', older, newer);
  const fields = changes.split('\0').filter((field) => field !== '');
  const files: Promise<DiffFile>[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index] ?? '';
    const path = fields[index + 1] ?? '';
    files.push(
      Promise.all([
        status === 'A' ? null : textAt(git, older, path),
        status === 'D' ? null : textAt(git, newer, path),
      ]).then(([oldText, newText]) => fileDiff(path, oldText, newText)),
    );
  }
  return (await Promise.all(files)).sort((a, b) => a.path.localeCompare(b.path));
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

/** Der Text einer Datei in einem Commit. Eine Binärdatei zeigt nur einen Hinweis. */
async function textAt(git: Git, commit: string, path: string): Promise<string> {
  const text = await git('cat-file', 'blob', `${commit}:${path}`);
  return text.includes('\0') ? '(Binärdatei)\n' : text;
}
