import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { runGit } from '../git/process';

/**
 * Die automatische Sicherung des Editors. In einem Repo landet der Stand als Commit auf dem Branch
 * `sicherung/<branch>`, ohne Worktree, Index oder HEAD anzufassen. Außerhalb eines Repos landet er
 * als Kopie in einem Ordner. Das Modul kennt nichts aus Schrittmacher, damit der Editor später ein
 * eigenes Kommando werden kann.
 */

/** So viele Kopien je Datei bleiben außerhalb eines Repos liegen; ältere werden gelöscht. */
const KEPT_COPIES = 50;

/** Der Präfix der Branches mit den Sicherungen. */
const BRANCH_PREFIX = 'sicherung/';

/** Wo eine Sicherung gelandet ist; `null`, wenn sich seit der letzten nichts geändert hat. */
export type Backup = { kind: 'git'; branch: string; commit: string } | { kind: 'file'; path: string } | null;

/** Die Ausgabe von Git ohne den Zeilenumbruch am Ende. */
async function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return (await runGit(cwd, args, env)).trim();
}

/** Wie `git`, aber `null` statt eines Fehlers, etwa für eine Referenz, die es nicht gibt. */
async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    const output = await git(cwd, args);
    return output === '' ? null : output;
  } catch {
    return null;
  }
}

/** Legt den Text als Blob ins Repo; zurück kommt seine ID. */
function hashText(cwd: string, text: string): Promise<string> {
  // `runGit` kennt keine Eingabe, deshalb hier direkt über `execFile` mit stdin.
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['--no-optional-locks', 'hash-object', '-w', '--stdin'],
      { cwd, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`git hash-object in ${cwd} scheiterte: ${stderr.trim() || error.message}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
    child.stdin?.end(text, 'utf8');
  });
}

/**
 * Sichert den Text als Commit auf `sicherung/<branch>`. Der Tree ist der von HEAD mit dem Text an
 * der Stelle der Datei, der Elternteil die vorige Sicherung oder, bei der ersten, HEAD. `'no-repo'`,
 * wenn die Datei in keinem Repo mit Commit liegt.
 */
async function backupToGit(path: string, text: string): Promise<Backup | 'no-repo'> {
  const dir = dirname(path);
  const top = await gitOrNull(dir, ['rev-parse', '--show-toplevel']);
  const head = top === null ? null : await gitOrNull(top, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  if (top === null || head === null) {
    return 'no-repo';
  }
  const file = relative(top, path).split(sep).join('/');
  const current = (await gitOrNull(top, ['symbolic-ref', '--short', '-q', 'HEAD'])) ?? 'detached';
  const branch = BRANCH_PREFIX + current;
  const ref = `refs/heads/${branch}`;
  const previous = await gitOrNull(top, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  const blob = await hashText(top, text);
  // Ohne Änderung seit der letzten Sicherung (oder, vor der ersten, seit HEAD) entsteht kein Commit.
  const last = await gitOrNull(top, ['rev-parse', '--verify', '-q', `${previous ?? head}:${file}`]);
  if (last === blob) {
    return null;
  }
  // Ein eigener Index im Temp-Ordner, damit der Index des Worktrees unberührt bleibt.
  const scratch = await mkdtemp(join(tmpdir(), 'schrittmacher-sicherung-'));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, 'index') };
    await git(top, ['read-tree', head], env);
    await git(top, ['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], env);
    const tree = await git(top, ['write-tree'], env);
    const message = `Sicherung: ${file}`;
    const commit = await git(top, ['commit-tree', tree, '-p', previous ?? head, '-m', message]);
    // Mit dem alten Stand als Bedingung, damit zwei Sicherungen sich nicht überschreiben.
    await git(top, ['update-ref', '-m', message, ref, commit, previous ?? '']);
    return { kind: 'git', branch, commit };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Ein Zeitpunkt als Teil eines Dateinamens, sortierbar: `2026-11-16T15-58-10`. */
function stamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/:/g, '-');
}

/**
 * Sichert den Text als Kopie in `<folder>/<Name>-<Hash des Pfads>/<Zeitpunkt>.<Endung>` und löscht
 * die ältesten über `KEPT_COPIES`. Die Endung ist die der Datei, ohne Endung `.txt`.
 */
async function backupToFile(path: string, text: string, folder: string): Promise<Backup> {
  const key = createHash('sha256').update(path).digest('hex').slice(0, 12);
  const target = join(folder, `${basename(path)}-${key}`);
  await mkdir(target, { recursive: true });
  const ending = extname(path) || '.txt';
  const copies = (await readdir(target)).filter((name) => name.endsWith(ending)).sort();
  const file = join(target, `${stamp(new Date())}${ending}`);
  await writeFile(file, text, 'utf8');
  for (const old of copies.slice(0, Math.max(0, copies.length + 1 - KEPT_COPIES))) {
    await rm(join(target, old), { force: true });
  }
  return { kind: 'file', path: file };
}

/**
 * Sichert den ungespeicherten Text einer Datei: in ihrem Repo auf `sicherung/<branch>`, sonst als
 * Kopie unter `folder`.
 */
export async function backup(path: string, text: string, folder: string): Promise<Backup> {
  const result = await backupToGit(path, text).catch(() => 'no-repo' as const);
  return result === 'no-repo' ? backupToFile(path, text, folder) : result;
}
