import { join, relative, sep } from 'node:path';
import { runGit } from '../git/process';
import { maybe, worktreeBase, worktreesOf } from './publish';

/** Die Branches einer Werkstatt in der Reihenfolge des Menüs, siehe `docs/werkstatt.md`. */
export const WERKSTATT_BRANCHES = ['werkstatt', 'main', 'schritte', 'live_coding', 'probe'] as const;
export type WerkstattBranch = (typeof WERKSTATT_BRANCHES)[number];

/** Die Branches, deren Worktree sich im Menü anlegen lässt. */
export const ADDABLE_BRANCHES = ['main', 'schritte'] as const;
export type AddableBranch = (typeof ADDABLE_BRANCHES)[number];

/** Ein Branch der Werkstatt mit seinem Stand. */
export interface WerkstattRow {
  branch: WerkstattBranch;
  /** Ob es den Branch lokal gibt. */
  local: boolean;
  /** Ob es den Branch auf `origin` gibt. */
  remote: boolean;
  /** Der Worktree, in dem er ausgecheckt ist. */
  worktree: string | null;
  /** Der Ort des Worktrees vom Haupt-Checkout aus, leer für den Haupt-Checkout selbst. */
  place: string | null;
}

/** Ein Commit als Kürzel und Betreff. */
export interface ShortCommit {
  sha: string;
  subject: string;
}

export interface WerkstattStatus {
  rows: WerkstattRow[];
  /** Der Commit, auf dem die Probe angelegt oder zuletzt neu aufgesetzt wurde. */
  probeStart: ShortCommit | null;
}

/** Was das Neuaufsetzen oder Verwerfen der Probe verwirft. */
export interface ProbePlan {
  /** Der Commit von `probe` jetzt; `null`, wenn es die Probe nicht gibt. */
  current: string | null;
  /** Die Commits, die nur auf `probe` liegen und danach nicht mehr erreichbar sind, der neueste zuerst. */
  lost: string[];
  /** Die lokalen Änderungen im Worktree der Probe, wie `git status --short` sie nennt. */
  changes: string[];
}

async function hasRef(repoPath: string, ref: string): Promise<boolean> {
  return (await maybe(repoPath, ['rev-parse', '--verify', '--quiet', ref])) !== null;
}

/** Ob das Repo eine Werkstatt ist: Es hat einen Branch `werkstatt`, lokal oder auf `origin`. */
export async function isWerkstatt(repoPath: string): Promise<boolean> {
  return (await hasRef(repoPath, 'refs/heads/werkstatt')) || hasRef(repoPath, 'refs/remotes/origin/werkstatt');
}

/** Der Name einer Werkstatt im Tab: ohne Datum vorn und ohne `-werkstatt` oder `-prepare` hinten. */
export function shortName(repo: string): string {
  return repo.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-(werkstatt|prepare)$/, '') || repo;
}

/** Der Stand der Branches einer Werkstatt; `null`, wenn das Repo keine ist. */
export async function werkstattStatus(repoPath: string): Promise<WerkstattStatus | null> {
  if (!(await isWerkstatt(repoPath))) {
    return null;
  }
  const worktrees = await worktreesOf(repoPath);
  const rows = await Promise.all(
    WERKSTATT_BRANCHES.map(async (branch) => ({
      branch,
      local: await hasRef(repoPath, `refs/heads/${branch}`),
      remote: branch !== 'probe' && (await hasRef(repoPath, `refs/remotes/origin/${branch}`)),
      worktree: worktrees.find((worktree) => worktree.branch === branch)?.path ?? null,
    })),
  );
  const main = worktrees[0]?.path ?? repoPath;
  return {
    rows: rows.map((row) => ({ ...row, place: row.worktree === null ? null : relative(main, row.worktree) })),
    probeStart: await probeStart(repoPath),
  };
}

/**
 * Der Commit, auf dem die Probe beginnt: der jüngste Eintrag im Reflog von `probe`, der den Branch
 * angelegt oder per Reset gesetzt hat.
 */
async function probeStart(repoPath: string): Promise<ShortCommit | null> {
  const reflog = await maybe(repoPath, ['reflog', 'show', '--format=%H %gs', 'refs/heads/probe']);
  const sha = (reflog ?? '')
    .split('\n')
    .find((line) => / (branch: Created from|reset: moving to) /.test(line))
    ?.split(' ')[0];
  if (sha === undefined) {
    return null;
  }
  const line = await maybe(repoPath, ['log', '-1', '--format=%h%x00%s', sha]);
  const [short, subject] = (line ?? '').split('\0');
  return short === undefined || subject === undefined ? null : { sha: short, subject };
}

/** Der volle SHA eines Commits, oder ein Fehler, wenn es ihn nicht gibt. */
async function commitOf(repoPath: string, revision: string): Promise<string> {
  const sha = await maybe(repoPath, ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]);
  if (sha === null) {
    throw new Error(`Den Commit ${revision} gibt es nicht.`);
  }
  return sha;
}

/**
 * Legt den Worktree für `main` oder `schritte` an, neben den anderen. Gibt es den Branch nur auf
 * `origin`, entsteht er lokal und folgt `origin`. Liefert den Pfad des Worktrees.
 */
export async function addWorktree(repoPath: string, branch: AddableBranch): Promise<string> {
  const worktrees = await worktreesOf(repoPath);
  const existing = worktrees.find((worktree) => worktree.branch === branch);
  if (existing !== undefined) {
    return existing.path;
  }
  const path = join(worktreeBase(worktrees), branch);
  if (await hasRef(repoPath, `refs/heads/${branch}`)) {
    await runGit(repoPath, ['worktree', 'add', path, branch]);
  } else if (await hasRef(repoPath, `refs/remotes/origin/${branch}`)) {
    await runGit(repoPath, ['worktree', 'add', '--track', '-b', branch, path, `origin/${branch}`]);
  } else {
    throw new Error(`Den Branch ${branch} gibt es weder lokal noch auf origin.`);
  }
  return path;
}

async function probeWorktree(repoPath: string): Promise<string | null> {
  return (await worktreesOf(repoPath)).find((worktree) => worktree.branch === 'probe')?.path ?? null;
}

/** Was verloren geht, wenn die Probe auf `target` gesetzt oder ohne `target` verworfen wird. */
export async function probePlan(repoPath: string, target: string | null): Promise<ProbePlan> {
  const current = await maybe(repoPath, ['rev-parse', '--verify', '--quiet', 'refs/heads/probe']);
  if (current === null) {
    return { current: null, lost: [], changes: [] };
  }
  // Verloren ist nur, was allein auf der Probe liegt, nicht auf einem anderen Branch oder dem Ziel.
  const others = ['--exclude=probe', '--branches', '--remotes'];
  const range = ['refs/heads/probe', '--not', ...(target === null ? [] : [await commitOf(repoPath, target)]), ...others];
  const lost = ((await maybe(repoPath, ['log', '--format=%h %s', ...range])) ?? '').split('\n').filter((line) => line !== '');
  const worktree = await probeWorktree(repoPath);
  const status = worktree === null ? '' : await runGit(worktree, ['status', '--short']);
  return { current, lost, changes: status.split('\n').filter((line) => line !== '') };
}

/** Bricht ab, wenn `probe` nicht mehr auf dem Commit steht, den die Bestätigung gezeigt hat. */
async function checkProbe(repoPath: string, expected: string | null): Promise<void> {
  const current = await maybe(repoPath, ['rev-parse', '--verify', '--quiet', 'refs/heads/probe']);
  if (current !== expected) {
    throw new Error('Die Probe hat sich inzwischen geändert. Öffne das Menü noch einmal.');
  }
}

/**
 * Setzt die Probe auf den Commit: Ohne `probe` entstehen Branch und Worktree, sonst wird der Worktree
 * hart zurückgesetzt, und neue Dateien, die Git nicht ignoriert, werden gelöscht. `expected` ist der
 * Stand, den die Bestätigung gezeigt hat. Liefert den Pfad des Worktrees.
 */
export async function setProbe(repoPath: string, target: string, expected: string | null): Promise<string> {
  await checkProbe(repoPath, expected);
  const sha = await commitOf(repoPath, target);
  const existing = await probeWorktree(repoPath);
  if (existing !== null) {
    await runGit(existing, ['reset', '--quiet', '--hard', sha]);
    await runGit(existing, ['clean', '--quiet', '-d', '--force']);
    return existing;
  }
  const path = join(worktreeBase(await worktreesOf(repoPath)), 'probe');
  if (expected === null) {
    await runGit(repoPath, ['worktree', 'add', '-b', 'probe', path, sha]);
  } else {
    await runGit(repoPath, ['branch', '--force', 'probe', sha]);
    await runGit(repoPath, ['worktree', 'add', path, 'probe']);
  }
  return path;
}

/** Entfernt Worktree und Branch der Probe, mit allen lokalen Änderungen darin. */
export async function discardProbe(repoPath: string, expected: string): Promise<void> {
  await checkProbe(repoPath, expected);
  const worktree = await probeWorktree(repoPath);
  if (worktree !== null) {
    await runGit(repoPath, ['worktree', 'remove', '--force', worktree]);
  }
  await runGit(repoPath, ['branch', '--delete', '--force', 'probe']);
}

/**
 * Die Namen eines Tabs in einer Werkstatt: der Name ohne Datum und Endung und für den Worktree, in dem
 * `werkstatt` ausgecheckt ist, `werkstatt`. `null` außerhalb einer Werkstatt.
 */
export async function werkstattLabel(
  repoPath: string,
  worktreePath: string,
): Promise<{ repo: string; worktreeName: string } | null> {
  if (!(await isWerkstatt(repoPath))) {
    return null;
  }
  const checkedOut = (await worktreesOf(repoPath)).find((worktree) => worktree.path === worktreePath)?.branch;
  const repo = shortName(repoPath.slice(repoPath.lastIndexOf(sep) + 1));
  // Der Haupt-Checkout heißt wie das Repo, damit der Tab ihn nicht eigens nennt.
  const worktreeName =
    checkedOut === 'werkstatt' ? 'werkstatt' : worktreePath === repoPath ? repo : worktreePath.slice(worktreePath.lastIndexOf(sep) + 1);
  return { repo, worktreeName };
}
