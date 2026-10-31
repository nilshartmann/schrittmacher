import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { runGit } from '../git/process';
import { GH_FALLBACKS, NOT_LOGGED_IN } from './gist';

/** Die Branches, die an die Teilnehmer gehen, siehe `docs/veroeffentlichen.md`. */
export const PUBLISHED_BRANCHES = ['main', 'live_coding', 'schritte'] as const;
export type PublishedBranch = (typeof PUBLISHED_BRANCHES)[number];

/** Der Platzhalter für die Adresse des Teilnehmer-Repos, bis es existiert. */
export const PLACEHOLDER = 'https://github.com/ORG/TEILNEHMER-REPO';

/** Ein Branch im Werkstatt-Repo und im Teilnehmer-Repo. */
export interface BranchState {
  /** Der Commit des lokalen Branches; `null`, wenn es ihn nicht gibt. */
  local: string | null;
  /** Der Commit im Teilnehmer-Repo nach dem letzten Fetch; `null`, wenn er dort fehlt. */
  remote: string | null;
}

/** Der Stand des Veröffentlichens, wie ihn der Dialog zeigt. */
export interface PublishStatus {
  /** Das Remote des Teilnehmer-Repos: `teilnehmer`, bei älteren Repos `workshop`; `null` ohne. */
  remote: string | null;
  /** Das Teilnehmer-Repo als `org/name`, wenn das Remote auf GitHub zeigt. */
  repo: string | null;
  visibility: 'public' | 'private' | null;
  /** Der Vorschlag für ein neues Teilnehmer-Repo. */
  suggestion: string;
  /** Die Dateien auf `main`, in denen noch der Platzhalter steht. */
  placeholder: string[];
  branches: Record<PublishedBranch, BranchState>;
  /** Der Worktree, in dem `live_coding` ausgecheckt ist. */
  liveWorktree: string | null;
  /** Was sich nicht lesen ließ, etwa die Sichtbarkeit ohne `gh`. */
  problems: string[];
}

/** Was ein Push bewirken würde: neue Commits und solche, die im Teilnehmer-Repo verschwänden. */
export interface PushPlan {
  added: string[];
  lost: string[];
  /** Der Stand im Teilnehmer-Repo, gegen den mit `--force-with-lease` gepusht wird. */
  expected: string | null;
}

/** Ruft `gh` auf und liefert die Ausgabe; ohne `gh` oder ohne Anmeldung mit Hinweis. */
async function gh(args: string[]): Promise<string> {
  for (const program of ['gh', ...GH_FALLBACKS]) {
    try {
      return await new Promise<string>((resolve, reject) => {
        execFile(program, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
          if (error === null) {
            resolve(stdout);
          } else if ('code' in error && error.code === 'ENOENT') {
            reject(error);
          } else {
            const hint = error.code === NOT_LOGGED_IN ? ' Melde dich mit „gh auth login“ an.' : '';
            reject(new Error(`GitHub meldet einen Fehler: ${stderr.trim() || error.message}${hint}`));
          }
        });
      });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }
  throw new Error('Das Programm gh fehlt. Installiere es mit „brew install gh“ und melde dich mit „gh auth login“ an.');
}

/** Wie `runGit`, liefert bei einem Fehler aber `null`, etwa für einen Branch, den es nicht gibt. */
async function maybe(repoPath: string, args: string[]): Promise<string | null> {
  try {
    return (await runGit(repoPath, args)).trim();
  } catch {
    return null;
  }
}

/** `org/name` aus der Adresse eines Remotes auf GitHub, sonst `null`. */
export function githubRepoOf(url: string): string | null {
  return /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null;
}

/** Das Remote des Teilnehmer-Repos: `teilnehmer`, sonst bei älteren Repos `workshop`. */
async function participantRemote(repoPath: string): Promise<string | null> {
  const remotes = (await runGit(repoPath, ['remote'])).split('\n').map((name) => name.trim());
  return remotes.includes('teilnehmer') ? 'teilnehmer' : remotes.includes('workshop') ? 'workshop' : null;
}

/** Der Vorschlag `org/slug` aus `origin`: der Name ohne `-werkstatt` oder `-prepare`. */
async function suggestionOf(repoPath: string): Promise<string> {
  const origin = githubRepoOf((await maybe(repoPath, ['remote', 'get-url', 'origin'])) ?? '');
  return origin === null ? '' : origin.replace(/-(werkstatt|prepare)$/, '');
}

/** Die Worktrees mit ihrem Branch, wie `git worktree list --porcelain` sie nennt. */
async function worktreesOf(repoPath: string): Promise<{ path: string; branch: string | null }[]> {
  return (await runGit(repoPath, ['worktree', 'list', '--porcelain']))
    .split('\n\n')
    .map((block) => ({
      path: /^worktree (.+)$/m.exec(block)?.[1] ?? '',
      branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null,
    }))
    .filter((worktree) => worktree.path !== '');
}

/**
 * Holt den Stand des Teilnehmer-Repos und liefert, wie weit das Veröffentlichen ist. Der Fetch ist
 * auf das Remote der Teilnehmer beschränkt.
 */
export async function publishStatus(repoPath: string): Promise<PublishStatus> {
  const problems: string[] = [];
  const remote = await participantRemote(repoPath);
  let repo: string | null = null;
  let visibility: PublishStatus['visibility'] = null;
  if (remote !== null) {
    repo = githubRepoOf((await maybe(repoPath, ['remote', 'get-url', remote])) ?? '');
    await runGit(repoPath, ['fetch', '--quiet', '--prune', remote]).catch((error: unknown) => {
      problems.push(`Das Teilnehmer-Repo ließ sich nicht holen: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (repo !== null) {
      try {
        const raw = (await gh(['repo', 'view', repo, '--json', 'visibility', '--jq', '.visibility'])).trim().toLowerCase();
        visibility = raw === 'public' ? 'public' : 'private';
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  const state = async (branch: PublishedBranch): Promise<BranchState> => ({
    local: await maybe(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]),
    remote: remote === null ? null : await maybe(repoPath, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`]),
  });
  const [main, live, schritte, suggestion, worktrees] = await Promise.all([
    state('main'),
    state('live_coding'),
    state('schritte'),
    suggestionOf(repoPath),
    worktreesOf(repoPath),
  ]);
  const placeholder =
    main.local === null
      ? []
      : ((await maybe(repoPath, ['grep', '-l', '-F', PLACEHOLDER, 'refs/heads/main', '--'])) ?? '')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => line.replace(/^refs\/heads\/main:/, ''));
  return {
    remote,
    repo,
    visibility,
    suggestion,
    placeholder,
    branches: { main, live_coding: live, schritte },
    liveWorktree: worktrees.find((worktree) => worktree.branch === 'live_coding')?.path ?? null,
    problems,
  };
}

/** Legt das Teilnehmer-Repo privat an und setzt das Remote `teilnehmer`. */
export async function createParticipants(repoPath: string, name: string, description: string): Promise<void> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(`Erwartet wird org/name, nicht „${name}“.`);
  }
  if ((await participantRemote(repoPath)) !== null) {
    throw new Error('Das Werkstatt-Repo hat schon ein Remote für die Teilnehmer.');
  }
  await gh(['repo', 'create', name, '--private', ...(description === '' ? [] : ['--description', description])]);
  await runGit(repoPath, ['remote', 'add', 'teilnehmer', `git@github.com:${name}.git`]);
}

/** Die erste Überschrift aus `WORKSHOP.md` auf `werkstatt`, als Beschreibung des Teilnehmer-Repos. */
export async function titleOf(repoPath: string): Promise<string> {
  const text = (await maybe(repoPath, ['show', 'refs/heads/werkstatt:WORKSHOP.md'])) ?? '';
  return /^# (.+)$/m.exec(text)?.[1]?.trim() ?? '';
}

/** Schaltet die Sichtbarkeit des Teilnehmer-Repos um. */
export async function setVisibility(repo: string, visibility: 'public' | 'private'): Promise<void> {
  await gh(['repo', 'edit', repo, '--visibility', visibility, '--accept-visibility-change-consequences']);
}

async function remoteOrFail(repoPath: string): Promise<string> {
  const remote = await participantRemote(repoPath);
  if (remote === null) {
    throw new Error('Das Werkstatt-Repo hat noch kein Remote für die Teilnehmer.');
  }
  return remote;
}

/** Die Betreffs der Commits in `range`, der neueste zuerst. */
async function subjects(repoPath: string, range: string): Promise<string[]> {
  return ((await maybe(repoPath, ['log', '--format=%h %s', range])) ?? '').split('\n').filter((line) => line !== '');
}

/** Was der Push des Branches an die Teilnehmer bewirken würde. */
export async function pushPlan(repoPath: string, branch: PublishedBranch): Promise<PushPlan> {
  const remote = await remoteOrFail(repoPath);
  await runGit(repoPath, ['fetch', '--quiet', '--prune', remote]);
  const local = `refs/heads/${branch}`;
  const upstream = `refs/remotes/${remote}/${branch}`;
  const expected = await maybe(repoPath, ['rev-parse', '--verify', '--quiet', upstream]);
  if (expected === null) {
    return { added: await subjects(repoPath, local), lost: [], expected: null };
  }
  return {
    added: await subjects(repoPath, `${upstream}..${local}`),
    lost: await subjects(repoPath, `${local}..${upstream}`),
    expected,
  };
}

/**
 * Pusht genau diesen Branch an die Teilnehmer. `main` geht nicht, solange der Platzhalter darauf
 * steht. Mit `force` ersetzt der Push den Stand `expected`, und nur ihn.
 */
export async function publishBranch(
  repoPath: string,
  branch: PublishedBranch,
  force: boolean,
  expected: string | null,
): Promise<void> {
  const remote = await remoteOrFail(repoPath);
  if (branch === 'main' && (await publishStatus(repoPath)).placeholder.length > 0) {
    throw new Error(`Auf main steht noch der Platzhalter ${PLACEHOLDER}.`);
  }
  const lease = force ? [`--force-with-lease=refs/heads/${branch}:${expected ?? ''}`] : [];
  await runGit(repoPath, ['push', '--quiet', ...lease, remote, `refs/heads/${branch}:refs/heads/${branch}`], {
    GIT_TERMINAL_PROMPT: '0',
  });
}

/**
 * Legt `live_coding` aus `main` an, pusht den Branch an die Teilnehmer und setzt das Ziel dorthin.
 * Der Worktree entsteht neben den anderen, siehe `docs/veroeffentlichen.md`. Liefert seinen Pfad.
 */
export async function createLiveCoding(repoPath: string): Promise<string> {
  const remote = await remoteOrFail(repoPath);
  const worktrees = await worktreesOf(repoPath);
  const existing = worktrees.find((worktree) => worktree.branch === 'live_coding');
  if (existing !== undefined) {
    return existing.path;
  }
  const [first] = worktrees;
  const others = worktrees.slice(1);
  const nested =
    first?.branch === 'werkstatt' && others.length > 0 && others.every((worktree) => worktree.path.startsWith(`${first.path}/`));
  const sibling = worktrees.find((worktree) => worktree.branch === 'main' || worktree.branch === 'schritte');
  const base = nested && first !== undefined ? first.path : sibling === undefined ? null : dirname(sibling.path);
  if (base === null) {
    throw new Error('Kein Ort für den Worktree: Es gibt weder main noch schritte als Worktree.');
  }
  const path = join(base, 'live_coding');
  const hasBranch = (await maybe(repoPath, ['rev-parse', '--verify', '--quiet', 'refs/heads/live_coding'])) !== null;
  await runGit(repoPath, hasBranch ? ['worktree', 'add', path, 'live_coding'] : ['worktree', 'add', '-b', 'live_coding', path, 'main']);
  await runGit(path, ['push', '--quiet', '--set-upstream', remote, 'refs/heads/live_coding:refs/heads/live_coding'], {
    GIT_TERMINAL_PROMPT: '0',
  });
  return path;
}
