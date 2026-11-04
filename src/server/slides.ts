import { execFile } from 'node:child_process';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { runGit } from '../git/process';
import { githubRepoOf, maybe } from './publish';
import type { SavedSlides } from './store';

/** Ein Folien-Repo aus `config.json`, wie es der Dialog zeigt; der Pfad bleibt beim Server. */
export interface SlideRepo {
  /** Der Name des Ordners, etwa `frontend-talk-2024`; er ist im Dialog die Kennung des Repos. */
  name: string;
  /** Das Repo auf GitHub als `org/name`, `null` ohne `origin` auf GitHub. */
  github: string | null;
}

/** Die hochgeladenen Folien zu einer PowerPoint-Datei der Werkstatt, für das Menü. */
export interface SlidesUpload {
  /** Die PowerPoint-Datei als Pfad im Worktree von `werkstatt`. */
  file: string;
  /** Der Name des Folien-Repos. */
  repo: string;
  /** Der Name der Dateien im Folien-Repo ohne Endung. */
  name: string;
  /** Der Link „Download raw“ zum PDF auf GitHub; `null`, wenn sich keiner bilden lässt. */
  url: string | null;
  /** Ob das PDF im Folien-Repo auf diesem Mac liegt und sich öffnen lässt. */
  pdf: boolean;
}

/** Was nach dem Hochladen passiert ist. */
export interface UploadResult {
  /** Ob ein Commit entstand; ohne, wenn die PowerPoint-Datei im Folien-Repo schon gleich war. */
  committed: boolean;
  url: string | null;
}

/**
 * Der Ordner, in den PowerPoint ohne Rückfrage speichert. PowerPoint läuft in der Sandbox von macOS
 * und fragt bei jedem anderen Ordner nach einer Freigabe.
 */
const POWERPOINT_TMP = join(homedir(), 'Library', 'Containers', 'com.microsoft.Powerpoint', 'Data', 'tmp');

/** So lange darf PowerPoint für das PDF brauchen. */
const EXPORT_TIMEOUT = 5 * 60 * 1000;

/** Prüft den Namen der Dateien im Folien-Repo; eine angehängte Endung fällt weg. */
export function checkSlidesName(name: string): string {
  const trimmed = name.trim().replace(/\.(pptx|pdf)$/i, '');
  if (trimmed === '' || !/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(`„${name}“ taugt nicht als Name, erlaubt sind Buchstaben, Ziffern, Punkt, Unter- und Bindestrich.`);
  }
  return trimmed;
}

/**
 * Der vorgeschlagene Name nach der Konvention der Folien-Repos: Event, Jahr, Thema. Aus
 * `2026-11-wjax-tanstack-ai-werkstatt` wird `wjax-2026-tanstack-ai`.
 */
export function suggestSlidesName(repo: string): string {
  const bare = repo.replace(/-(werkstatt|prepare)$/, '');
  const dated = /^(\d{4})-\d{2}(?:-\d{2})?-([^-]+)(?:-(.+))?$/.exec(bare);
  if (dated === null) {
    return bare;
  }
  const [, year = '', event = '', topic] = dated;
  return [event, year, topic].filter((part) => part !== undefined && part !== '').join('-');
}

/** Das Folien-Repo als Eintrag für den Dialog. */
export async function slideRepoOf(path: string): Promise<SlideRepo> {
  const origin = await maybe(path, ['remote', 'get-url', 'origin']);
  return { name: basename(path), github: origin === null ? null : githubRepoOf(origin) };
}

/** Der Branch, auf den ins Folien-Repo gepusht wird, etwa `main` aus `origin/main`. */
async function upstreamBranch(repoPath: string): Promise<string | null> {
  const upstream = await maybe(repoPath, ['rev-parse', '--abbrev-ref', '@{u}']);
  return upstream?.replace(/^origin\//, '') ?? null;
}

/** Der Link „Download raw“ auf GitHub zum PDF im Folien-Repo. */
export async function rawUrl(repoPath: string, name: string): Promise<string | null> {
  const [{ github }, branch] = await Promise.all([slideRepoOf(repoPath), upstreamBranch(repoPath)]);
  if (github === null || branch === null) {
    return null;
  }
  return `https://github.com/${github}/raw/${branch}/${encodeURIComponent(`${name}.pdf`)}`;
}

function exists(path: string): Promise<boolean> {
  return stat(path).then(
    (found) => found.isFile(),
    () => false,
  );
}

/** Der Eintrag für das Menü zu einer gemerkten Zuordnung. */
export async function uploadOf(saved: SavedSlides): Promise<SlidesUpload> {
  const [url, pdf] = await Promise.all([rawUrl(saved.repo, saved.name), exists(join(saved.repo, `${saved.name}.pdf`))]);
  return { file: saved.file, repo: basename(saved.repo), name: saved.name, url, pdf };
}

/**
 * Speichert die Präsentation über AppleScript als PDF. War sie in PowerPoint schon offen, nimmt
 * PowerPoint das offene Fenster und lässt es offen; sonst wird sie danach wieder geschlossen.
 */
export async function exportPdf(pptx: string, pdf: string): Promise<void> {
  await mkdir(POWERPOINT_TMP, { recursive: true });
  const temporary = join(POWERPOINT_TMP, `schrittmacher-${String(process.pid)}-${String(Date.now())}.pdf`);
  const script = [
    'on run argv',
    'tell application "Microsoft PowerPoint"',
    'set wasOpen to false',
    'repeat with candidate in presentations',
    'if full name of candidate is (item 1 of argv) then set wasOpen to true',
    'end repeat',
    'open POSIX file (item 1 of argv)',
    'set target to active presentation',
    'save target in (POSIX file (item 2 of argv)) as save as PDF',
    'if not wasOpen then close target saving no',
    'end tell',
    'end run',
  ];
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'osascript',
        [...script.flatMap((line) => ['-e', line]), pptx, temporary],
        { timeout: EXPORT_TIMEOUT },
        (error, _stdout, stderr) => {
          if (error !== null) {
            reject(new Error(`PowerPoint hat kein PDF gespeichert: ${stderr.trim() || error.message}`));
            return;
          }
          resolve();
        },
      );
    });
    if (!(await exists(temporary))) {
      throw new Error('PowerPoint hat kein PDF gespeichert.');
    }
    await copyFile(temporary, pdf);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Ob die Datei im Worktree denselben Inhalt hat wie im Commit `HEAD` des Repos. */
async function sameAsHead(repoPath: string, path: string, file: string): Promise<boolean> {
  const [committed, local] = await Promise.all([
    maybe(repoPath, ['rev-parse', '--verify', '--quiet', `HEAD:${path}`]),
    maybe(repoPath, ['hash-object', '--no-filters', '--', file]),
  ]);
  return committed !== null && committed === local;
}

/**
 * Erzeugt das PDF aus der PowerPoint-Datei und lädt beide ins Folien-Repo hoch, siehe
 * `docs/folien.md`. Vorher wird der Stand von `origin` per Fast-Forward nachgezogen. Committet
 * werden nur die beiden Dateien, auch wenn im Folien-Repo weitere Änderungen liegen. Liegt dieselbe
 * PowerPoint-Datei schon samt PDF im Repo, entsteht weder ein PDF noch ein Commit.
 */
export async function uploadSlides(repoPath: string, pptx: string, name: string): Promise<UploadResult> {
  const branch = await upstreamBranch(repoPath);
  if (branch === null) {
    throw new Error(`Im Folien-Repo ${repoPath} folgt der Branch keinem Branch auf origin.`);
  }
  await runGit(repoPath, ['fetch', 'origin']);
  if ((await runGit(repoPath, ['rev-list', '@{u}..HEAD'])).trim() !== '') {
    throw new Error(`Im Folien-Repo ${repoPath} liegen Commits, die noch nicht gepusht sind. Bitte erst aufräumen.`);
  }
  await runGit(repoPath, ['merge', '--ff-only', '@{u}']);
  const files = [`${name}.pptx`, `${name}.pdf`];
  const url = await rawUrl(repoPath, name);
  const pdfCommitted = (await maybe(repoPath, ['rev-parse', '--verify', '--quiet', `HEAD:${name}.pdf`])) !== null;
  if (pdfCommitted && (await sameAsHead(repoPath, `${name}.pptx`, pptx))) {
    return { committed: false, url };
  }
  await exportPdf(pptx, join(repoPath, `${name}.pdf`));
  await copyFile(pptx, join(repoPath, `${name}.pptx`));
  await runGit(repoPath, ['add', '--', ...files]);
  await runGit(repoPath, ['commit', '--only', '-m', `Folien ${name}`, '--', ...files]);
  await runGit(repoPath, ['push', 'origin', `HEAD:${branch}`]);
  return { committed: true, url };
}

/** Öffnet das PDF in Adobe Acrobat, sonst im Acrobat Reader, nicht in der Vorschau. */
export async function openInAcrobat(file: string): Promise<void> {
  const open = (bundle: string) =>
    new Promise<void>((resolve, reject) => {
      execFile('open', ['-b', bundle, file], (error, _stdout, stderr) => {
        if (error !== null) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve();
      });
    });
  await open('com.adobe.Acrobat.Pro').catch(() =>
    open('com.adobe.Reader').catch((failure: unknown) => {
      throw new Error(`Acrobat ließ sich nicht öffnen: ${failure instanceof Error ? failure.message : String(failure)}`);
    }),
  );
}
