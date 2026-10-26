import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseDiff } from './diffParser';
import type { ParsedFile } from './diffParser';
import { markParts } from './lineParts';
import { GitError, runGit, runGitBytes } from './process';
import { refPath } from './hidden';
import { scopeRefs, shownRef } from './scope';
import { LOCAL } from './repo';
import type { Comparison, LoadOptions, RepoData, RepoSource } from './repo';
import type { ChangeStats, Commit, CommitDetails, DiffFile, DiffLine, RangeCommit, Ref, SyncAction, SyncPlan, Worktree } from './types';

/** Der Baum ohne Dateien; gegen ihn vergleicht Git den ersten Commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Trennt die Felder einer Zeile, die Git ausgibt; im Titel eines Commits kommt es nicht vor. */
const FIELD = '\x1f';

/** Die Felder eines Commits für `commitOf`, als Format für `git log`. */
const COMMIT_FORMAT = `--format=%H${FIELD}%P${FIELD}%an${FIELD}%aI${FIELD}%cI${FIELD}%s`;

/** Steht vor jedem Commit in `between`, damit die Zeile mit der Statistik darunter zuzuordnen ist. */
const RECORD = '\x1e';

/** Ein Titel mit Schritt, etwa `25e: Mit @TransactionalEventListener …`. */
const STEP = /^(\d+[a-z]?):\s*(.*)$/;

const DATE = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/** So viele Vergleiche hält der Server vor; ein Workshop hat selten mehr Schritte. */
const CACHED_COMPARISONS = 100;

/**
 * So viele Commits zeigt die Liste höchstens, die neuesten. Ein Workshop hat weit weniger; die
 * Grenze schützt vor einem großen Repo, das versehentlich geöffnet wird.
 */
const MAX_COMMITS = 1000;

/**
 * So viele Commits je Seite liefert die Vorschau von Merge und Reset höchstens, die neuesten. Die
 * Grenze schützt vor Branches, die weit voneinander abweichen.
 */
const SYNC_LISTED = 500;

/** So viele Bytes vom Anfang einer Datei prüft Git auf ein Nullbyte, um eine Binärdatei zu erkennen. */
const BINARY_PROBE = 8000;

/**
 * Die Optionen für `git diff`. Mit dem größten Umfang an Kontext steht jede Datei ganz im Diff. Die
 * festen Präfixe und Optionen setzen eine abweichende Konfiguration des Benutzers außer Kraft, die
 * Ausgabe sonst anders formen würde.
 */
const DIFF = [
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
];

/**
 * Ein echtes Repo als Quelle, gelesen über Git im Verzeichnis eines Worktrees. Git ändert dabei
 * nichts am Repo, außer bei `commit`, `push`, `fetch` und `sync`; `write` schreibt eine Datei in
 * den Worktree.
 */
export function gitSource(worktree: string): RepoSource {
  const git = (...args: string[]) => runGit(worktree, args);
  // Zwei Commits ändern sich nie, deshalb bleibt ihr Vergleich gültig, auch nach einem Rebase.
  const cache = new Map<string, Promise<DiffFile[]>>();
  return {
    load: (branch, options) => load(git, worktree, branch, options),
    compare: async (comparison) => {
      // Die lokalen Änderungen ändern sich laufend und werden deshalb nie vorgehalten.
      if (comparison.to === LOCAL) {
        return localChanges(git, worktree);
      }
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
    details: (sha) => details(git, sha),
    between: async (comparison) => {
      if (comparison.from === null) {
        return between(git, `${comparison.to}^!`);
      }
      const [older, newer] = await sides(git, comparison);
      return between(git, `${older}..${newer}`);
    },
    state: async (local) => (await stateOf(git, worktree, local)).state,
    worktrees: () => worktreesOf(git),
    branches: () => refsOf(git),
    commit: async (branch, message, paths) => {
      await checkedOutIs(worktree, branch);
      if (message.trim() === '') {
        throw new Error('Der Commit hat keine Nachricht.');
      }
      if (paths.length === 0) {
        throw new Error('Für den Commit ist keine Datei ausgewählt.');
      }
      // Ein Pfad gilt wörtlich, auch mit `*` oder `:` darin. `add` nimmt neue und gelöschte Dateien
      // auf, `--only` committet dann nur diese Pfade und lässt den übrigen Index stehen.
      await plain(git('--literal-pathspecs', 'add', '--all', '--', ...paths));
      await plain(git('--literal-pathspecs', 'commit', '--quiet', '--only', `--message=${message}`, '--', ...paths));
      return (await git('rev-parse', 'HEAD')).trim();
    },
    push: async (branch, force) => {
      await checkedOutIs(worktree, branch);
      const config = async (key: string) => (await git('config', '--get', key).catch(() => '')).trim();
      const [remote, merge] = await Promise.all([config(`branch.${branch}.remote`), config(`branch.${branch}.merge`)]);
      const lease = force ? ['--force-with-lease'] : [];
      const target =
        remote === '' || merge === ''
          ? ['--set-upstream', 'origin', `refs/heads/${branch}`]
          : [remote, `refs/heads/${branch}:${merge}`];
      // Ohne Terminal kann Git nicht nach einem Passwort fragen und bricht sonst nicht ab.
      await plain(runGit(worktree, ['push', '--quiet', ...lease, ...target], { GIT_TERMINAL_PROMPT: '0' }));
    },
    fetch: async (remote) => {
      // Ein Name mit `-` vorn wäre für Git eine Option.
      if (remote?.startsWith('-') === true) {
        throw new Error(`Einen Remote '${remote}' gibt es nicht.`);
      }
      const which = remote === null ? ['--all'] : [remote];
      await plain(runGit(worktree, ['fetch', '--quiet', '--prune', ...which], { GIT_TERMINAL_PROMPT: '0' }));
    },
    fetched: () => fetchedAt(git),
    syncPlan: (branch) => syncPlanOf(git, branch),
    sync: (branch, action, expected) => sync(git, branch, action, expected),
    content: async (revision, path) =>
      revision === LOCAL
        ? readFile(inWorktree(worktree, path))
        : plain(runGitBytes(worktree, ['cat-file', 'blob', `${revision}:${path}`])),
    write: async (branch, path, content) => {
      await checkedOutIs(worktree, branch);
      const target = inWorktree(worktree, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    },
  };
}

/** Der Pfad einer Datei im Worktree; ein Pfad, der aus dem Worktree hinausführt, bricht ab. */
function inWorktree(worktree: string, path: string): string {
  const target = resolve(worktree, path);
  const inside = relative(worktree, target);
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error(`Der Pfad '${path}' liegt nicht im Worktree.`);
  }
  return target;
}

/**
 * Ein Befehl, dessen Fehler die Oberfläche zeigt: nur mit dem, was Git dazu sagt, ohne Befehl und
 * Pfad.
 */
async function plain<T>(command: Promise<T>): Promise<T> {
  try {
    return await command;
  } catch (failure) {
    throw failure instanceof GitError ? new Error(failure.output) : failure;
  }
}

/** Bricht ab, wenn im Worktree nicht `branch` ausgecheckt ist, etwa nach einem Wechsel in Fork. */
async function checkedOutIs(worktree: string, branch: string): Promise<void> {
  const { checkedOut } = await locate(worktree);
  if (checkedOut !== branch) {
    throw new Error(`Im Worktree ist nicht ${branch} ausgecheckt, sondern ${checkedOut ?? 'kein Branch'}.`);
  }
}

type Git = (...args: string[]) => Promise<string>;

/** Wo der Worktree liegt, zu welchem Repo er gehört und welcher Branch darin ausgecheckt ist. */
export async function locate(
  worktree: string,
): Promise<{ repoPath: string; worktreePath: string; checkedOut: string | null }> {
  const git = (...args: string[]) => runGit(worktree, args);
  const [commonDir, topLevel, branch] = await Promise.all([
    git('rev-parse', '--path-format=absolute', '--git-common-dir'),
    git('rev-parse', '--show-toplevel'),
    git('branch', '--show-current'),
  ]);
  return {
    repoPath: dirname(commonDir.trim()),
    worktreePath: topLevel.trim(),
    checkedOut: branch.trim() === '' ? null : branch.trim(),
  };
}

/**
 * Die Commits eines Branches, lokal oder auf einem Remote, unabhängig vom ausgecheckten. Ohne
 * Branch oder mit einem, den es nicht gibt, gelten die Commits von `HEAD`; dann nennt
 * `info.branch` den ausgecheckten Branch. Die Commits der Branches aus `options.scope` kommen
 * dazu, nach Datum sortiert wie im Graphen von Fork.
 */
async function load(git: Git, worktree: string, wanted: string | null, options: LoadOptions): Promise<RepoData> {
  const where = await locate(worktree);
  // Der Stand wird vor Commits und Branches gelesen. Kommt danach ein Commit hinzu, fällt er deshalb
  // bei der nächsten Abfrage auf. Ohne einen Branch, den es gibt, gilt der ausgecheckte.
  const local = where.checkedOut !== null && (wanted === null || wanted === where.checkedOut);
  const { state, changes } = await stateOf(git, worktree, local);
  const allRefs = await refsOf(git);
  const found = shownRef(allRefs, wanted);
  const branch = found?.name ?? where.checkedOut;
  const revision =
    found === undefined ? 'HEAD' : `refs/${found.kind === 'local' ? 'heads' : 'remotes'}/${found.name}`;
  const others = scopeRefs(options.scope, allRefs, shownRef(allRefs, branch), options.hidden).map(refPath);
  const all = options.scope !== 'branch';
  const [log, tip] = await Promise.all([
    git(
      'log',
      `--max-count=${String(MAX_COMMITS)}`,
      '--reverse',
      ...(all ? ['--date-order'] : []),
      COMMIT_FORMAT,
      revision,
      ...others,
      '--',
    ),
    git('rev-parse', '--verify', '--quiet', `${revision}^{commit}`).catch(() => ''),
  ]);
  const commits = lines(log).map(commitOf);
  const start = tip.trim();
  if (start === '' || commits.length === 0) {
    throw new Error('Der Branch hat noch keinen Commit.');
  }
  return {
    info: {
      repo: basename(where.repoPath),
      repoPath: where.repoPath,
      worktree: basename(where.worktreePath),
      worktreePath: where.worktreePath,
      branch,
      checkedOut: where.checkedOut,
    },
    commits,
    refs: allRefs,
    scope: options.scope,
    all,
    start,
    changes,
    state,
  };
}

/** Die Worktrees des Repos aus `git worktree list --porcelain`, ohne ein Repo ohne Worktree. */
async function worktreesOf(git: Git): Promise<Worktree[]> {
  const output = await git('worktree', 'list', '--porcelain');
  return output
    .split('\n\n')
    .map((block) => block.split('\n'))
    .flatMap((fields) => {
      const path = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length);
      if (path === undefined || fields.includes('bare')) {
        return [];
      }
      const branch = fields.find((field) => field.startsWith('branch refs/heads/'));
      return [{ path, name: basename(path), branch: branch?.slice('branch refs/heads/'.length) ?? null }];
    });
}

/**
 * Der ausgecheckte Commit und Branch und alle Branches mit ihrem Commit. Mit `local` kommen die
 * lokalen Änderungen dazu, und `changes` sagt, ob es welche gibt.
 */
async function stateOf(git: Git, worktree: string, local: boolean): Promise<{ state: string; changes: boolean }> {
  const outputs = await Promise.all([
    git('rev-parse', 'HEAD'),
    git('branch', '--show-current'),
    git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'),
    local ? localState(git, worktree) : '',
  ]);
  return { state: outputs.join(''), changes: outputs[3] !== '' };
}

/**
 * Die geänderten Dateien laut `git status`, je mit Größe und Zeitpunkt der letzten Änderung. Git
 * nennt eine Datei, die schon geändert ist, nach jeder weiteren Änderung gleich; erst der Zeitpunkt
 * zeigt, dass sich ihr Diff geändert hat. Ohne Änderungen ist der Text leer.
 */
async function localState(git: Git, worktree: string): Promise<string> {
  const status = await git('status', '--porcelain=v1', '-z', '--untracked-files=all');
  const paths: string[] = [];
  // Bei einer Umbenennung folgt auf den neuen Pfad der alte als eigener Eintrag.
  let skip = false;
  for (const entry of status.split('\0')) {
    if (skip || entry === '') {
      skip = false;
      continue;
    }
    paths.push(entry.slice(3));
    skip = entry.startsWith('R') || entry.startsWith('C');
  }
  const stats = await Promise.all(
    paths.map((path) =>
      stat(join(worktree, path)).then(
        (found) => `${String(found.size)} ${String(found.mtimeMs)}`,
        () => '-',
      ),
    ),
  );
  return status === '' ? '' : `${status}\n${stats.join('\n')}`;
}

function lines(output: string): string[] {
  return output.split('\n').filter((line) => line !== '');
}

function commitOf(line: string): Commit {
  const [sha = '', parents = '', author = '', date = '', committed = '', subject = ''] = line.split(FIELD);
  const step = STEP.exec(subject);
  return {
    sha,
    step: step?.[1] ?? null,
    title: step?.[2] ?? subject,
    author,
    date: DATE.format(new Date(date)),
    committed: DATE.format(new Date(committed)),
    parents: parents === '' ? [] : parents.split(' '),
  };
}

/**
 * Die lokalen Branches und die der Remotes. Ein lokaler Branch mit Upstream kennt den Abstand dazu.
 * Ohne Upstream gilt der gleichnamige Branch von `origin`, falls es ihn gibt.
 */
async function refsOf(git: Git): Promise<Ref[]> {
  const output = await git(
    'for-each-ref',
    `--format=%(refname)${FIELD}%(objectname)${FIELD}%(upstream:short)${FIELD}%(upstream:track,nobracket)`,
    'refs/heads',
    'refs/remotes',
  );
  const refs = lines(output).flatMap(refOf);
  const remotes = new Set(refs.filter((ref) => ref.kind === 'remote').map((ref) => ref.name));
  return Promise.all(
    refs.map(async (ref) => {
      const remote = `origin/${ref.name}`;
      if (ref.kind === 'remote' || ref.tracking !== undefined || !remotes.has(remote)) {
        return ref;
      }
      const counts = await git('rev-list', '--left-right', '--count', `refs/heads/${ref.name}...refs/remotes/${remote}`);
      const [ahead = 0, behind = 0] = counts.trim().split(/\s+/).map(Number);
      return { ...ref, tracking: { remote, assumed: true, ahead, behind } };
    }),
  );
}

/**
 * Ein Branch aus `for-each-ref`; der Zeiger `HEAD` eines Remotes ist keiner. Ein Upstream, den es
 * auf dem Remote nicht mehr gibt, zählt wie keiner.
 */
function refOf(line: string): Ref[] {
  const [name = '', sha = '', upstream = '', track = ''] = line.split(FIELD);
  if (name.endsWith('/HEAD')) {
    return [];
  }
  if (name.startsWith('refs/remotes/')) {
    return [{ name: name.slice('refs/remotes/'.length), kind: 'remote', sha }];
  }
  const ref: Ref = { name: name.slice('refs/heads/'.length), kind: 'local', sha };
  if (upstream === '' || track === 'gone') {
    return [ref];
  }
  // Git nennt den Abstand als `ahead 2, behind 1`, ohne Abstand gar nicht.
  const count = (word: string) => Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0);
  return [{ ...ref, tracking: { remote: upstream, assumed: false, ahead: count('ahead'), behind: count('behind') } }];
}

/**
 * Personen und ganze Nachricht eines Commits. Die Trailer stehen im letzten Absatz der Nachricht;
 * nennt Git welche, fehlt dieser Absatz im Text.
 */
async function details(git: Git, sha: string): Promise<CommitDetails> {
  const output = await git(
    'show',
    '--no-patch',
    '--no-show-signature',
    `--format=%H${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%cn${FIELD}%ce${FIELD}%cI${FIELD}%(trailers:only,unfold)${FIELD}%b`,
    `${sha}^{commit}`,
    '--',
  );
  const [found = '', author = '', authorEmail = '', authored = '', committer = '', committerEmail = '', committed = '', trailerText = '', ...rest] =
    output.split(FIELD);
  const trailers = lines(trailerText).map((line) => {
    const colon = line.indexOf(':');
    return colon < 0
      ? { key: line.trim(), value: '' }
      : { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
  });
  const paragraphs = rest.join(FIELD).trim().split(/\n\s*\n/);
  if (trailers.length > 0) {
    paragraphs.pop();
  }
  return {
    sha: found,
    author: { name: author, email: authorEmail, date: DATE.format(new Date(authored)) },
    committer: { name: committer, email: committerEmail, date: DATE.format(new Date(committed)) },
    body: paragraphs.join('\n\n').trim(),
    trailers,
  };
}

/** Die Commits eines Bereichs wie `a..b` mit ihrer Statistik, der neueste zuerst. */
async function between(git: Git, range: string): Promise<RangeCommit[]> {
  const log = await git(
    'log',
    `--max-count=${String(MAX_COMMITS)}`,
    '--shortstat',
    COMMIT_FORMAT.replace('--format=', `--format=${RECORD}`),
    range,
    '--',
  );
  return log
    .split(RECORD)
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [line = '', ...stat] = lines(record);
      return { commit: commitOf(line), stats: statsOf(stat.join(' ')) };
    });
}

/** Die Statistik aus `--shortstat`, etwa ` 3 files changed, 24 insertions(+), 7 deletions(-)`. */
function statsOf(line: string): ChangeStats {
  const count = (pattern: RegExp) => Number(pattern.exec(line)?.[1] ?? 0);
  return { files: count(/(\d+) files? changed/), added: count(/(\d+) insertions?/), removed: count(/(\d+) deletions?/) };
}

/** Die Commits einer Revision oder eines Bereichs wie `a..b`, der neueste zuerst. */
async function commitsOf(git: Git, range: string, count: number): Promise<Commit[]> {
  const log = await git('log', `--max-count=${String(count)}`, COMMIT_FORMAT, range, '--');
  return lines(log).map(commitOf);
}

/**
 * Was Merge und Reset bewirken würden. Gefragt wird nach den Branches, wie sie jetzt sind; die
 * Oberfläche schickt ihre SHAs bei der Ausführung zur Prüfung mit.
 */
async function syncPlanOf(git: Git, branch: string): Promise<SyncPlan> {
  const [refs, worktrees] = await Promise.all([refsOf(git), worktreesOf(git)]);
  const tracking = refs.find((ref) => ref.kind === 'local' && ref.name === branch)?.tracking;
  if (tracking === undefined || !refs.some((ref) => ref.kind === 'remote' && ref.name === tracking.remote)) {
    throw new Error(`Zu ${branch} gibt es keinen Branch auf einem Remote.`);
  }
  const local = `refs/heads/${branch}`;
  const upstream = `refs/remotes/${tracking.remote}`;
  const worktree = worktrees.find((candidate) => candidate.branch === branch) ?? null;
  const [[localTip], [upstreamTip], ahead, behind, status] = await Promise.all([
    commitsOf(git, local, 1),
    commitsOf(git, upstream, 1),
    commitsOf(git, `${upstream}..${local}`, SYNC_LISTED),
    commitsOf(git, `${local}..${upstream}`, SYNC_LISTED),
    worktree === null ? Promise.resolve('') : runGit(worktree.path, ['status', '--porcelain']),
  ]);
  if (localTip === undefined || upstreamTip === undefined) {
    throw new Error(`Zu ${branch} fehlt ein Commit.`);
  }
  const entries = lines(status);
  return {
    branch,
    remote: tracking.remote,
    local: localTip,
    upstream: upstreamTip,
    ahead,
    behind,
    tracking,
    worktree,
    changes: entries.some((entry) => !entry.startsWith('??')),
    untracked: entries.some((entry) => entry.startsWith('??')),
  };
}

/**
 * Merge oder harter Reset, siehe `RepoSource.sync`. Ohne Worktree verschiebt `update-ref` den
 * Branch nur, wenn er noch auf dem erwarteten Commit steht.
 */
async function sync(
  git: Git,
  branch: string,
  action: SyncAction,
  expected: { local: string; upstream: string },
): Promise<void> {
  const plan = await syncPlanOf(git, branch);
  if (plan.local.sha !== expected.local || plan.upstream.sha !== expected.upstream) {
    throw new Error(`${branch} oder ${plan.remote} hat sich inzwischen geändert. Bitte noch einmal ansehen.`);
  }
  if (action === 'merge' && plan.tracking.behind === 0) {
    throw new Error(`${plan.remote} hat keine Commits, die ${branch} fehlen.`);
  }
  const target = plan.upstream.sha;
  if (plan.worktree === null) {
    if (action === 'merge' && plan.tracking.ahead > 0) {
      throw new Error(`${branch} ist nirgends ausgecheckt; ohne Worktree geht nur ein Fast-Forward.`);
    }
    await plain(git('update-ref', '-m', `schrittmacher: ${action} ${plan.remote}`, `refs/heads/${branch}`, target, plan.local.sha));
    return;
  }
  const path = plan.worktree.path;
  const there = (...args: string[]) => runGit(path, args);
  if (action === 'reset') {
    await plain(there('reset', '--hard', '--quiet', target));
    return;
  }
  try {
    // Die Nachricht lautet wie bei `git merge origin/…`, der volle Name ist aber eindeutig.
    const message = `Merge remote-tracking branch '${plan.remote}' into ${branch}`;
    await there('merge', '--quiet', `--message=${message}`, `refs/remotes/${plan.remote}`);
  } catch (failure) {
    // Ein Merge mit Konflikten lässt Git halb fertig stehen; er wird ganz zurückgenommen.
    const merging = await there('rev-parse', '--verify', '--quiet', 'MERGE_HEAD').then(
      () => true,
      () => false,
    );
    if (merging) {
      await plain(there('merge', '--abort'));
      throw new Error(`Der Merge hat Konflikte und wurde abgebrochen; ${branch} ist unverändert.`);
    }
    throw failure instanceof GitError ? new Error(failure.output) : failure;
  }
}

/**
 * Der Zeitpunkt des letzten Fetch in Millisekunden, abgelesen an `FETCH_HEAD`; `null`, wenn noch
 * keiner lief. Ein Worktree hat ein eigenes `FETCH_HEAD`, deshalb zählt auch das des Repos, in das
 * etwa Fork holt.
 */
async function fetchedAt(git: Git): Promise<number | null> {
  const [own, common] = await Promise.all([
    git('rev-parse', '--path-format=absolute', '--git-path', 'FETCH_HEAD'),
    git('rev-parse', '--path-format=absolute', '--git-common-dir'),
  ]);
  const times = await Promise.all(
    [own.trim(), join(common.trim(), 'FETCH_HEAD')].map((path) =>
      stat(path).then(
        (found) => found.mtimeMs,
        () => null,
      ),
    ),
  );
  const found = times.filter((time) => time !== null);
  return found.length === 0 ? null : Math.max(...found);
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

/** Die Dateien, die sich zwischen beiden Commits unterscheiden, nach Pfad sortiert. */
async function compare(git: Git, older: string, newer: string): Promise<DiffFile[]> {
  return sorted(parseDiff(await git(...DIFF, older, newer)));
}

/**
 * Die lokalen Änderungen gegen `HEAD`, nach Pfad sortiert. `git diff HEAD` kennt nur Dateien, die
 * Git schon kennt; die übrigen kommen als neue Dateien dazu, außer denen aus `.gitignore`. Git
 * schreibt dabei nichts, auch nicht in den Index.
 */
async function localChanges(git: Git, worktree: string): Promise<DiffFile[]> {
  const [tracked, untracked] = await Promise.all([
    git(...DIFF, 'HEAD'),
    git('ls-files', '--others', '--exclude-standard', '-z'),
  ]);
  const added = await Promise.all(
    untracked
      .split('\0')
      .filter((path) => path !== '')
      .map((path) => untrackedFile(worktree, path)),
  );
  return sorted([...parseDiff(tracked), ...added]);
}

/** Eine Datei, die Git noch nicht kennt, als neue Datei; eine mit Nullbyte gilt wie bei Git als binär. */
async function untrackedFile(worktree: string, path: string): Promise<ParsedFile> {
  const content = await readFile(join(worktree, path));
  const binary = content.subarray(0, BINARY_PROBE).includes(0);
  const text = binary ? '' : content.toString('utf8');
  const texts = text === '' ? [] : (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
  return {
    oldPath: path,
    newPath: path,
    kind: 'added',
    binary,
    lines: texts.map((line, index) => ({ kind: 'added', oldNumber: null, newNumber: index + 1, text: line, parts: [] })),
    hunks: texts.length === 0 ? 0 : 1,
  };
}

function sorted(parsed: ParsedFile[]): DiffFile[] {
  return parsed.map(fileOf).sort((a, b) => a.path.localeCompare(b.path));
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
