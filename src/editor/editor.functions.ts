import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { runGit } from '../git/process';
import { markdownPath } from '../server/markdownPath';
import { baseName, writeAtomically } from '../server/notes';
import { requested } from '../server/requests';
import { backup } from './backup';
import { formatMarkdown } from './format';
import { isHighlightAnchor } from './highlights';
import type { HighlightAnchor } from './highlights';

/** Eine Datei im Editor mit ihrem Text. */
export interface EditorFile {
  /** Der absolute Pfad der Datei. */
  path: string;
  name: string;
  /** Der Ordner der Datei, gegen den relative Links und Bilder der Vorschau aufgelöst werden. */
  dir: string;
  text: string;
  /** Die letzte Änderung in Millisekunden, um eine Änderung außerhalb des Editors zu bemerken. */
  changed: number;
  /** Die gespeicherten Markierungen, noch nicht im Text wiedergefunden. */
  highlights: HighlightAnchor[];
}

/** Die Programme, in denen sich die Datei des Editors, ihr Ordner oder ihr Repo öffnen lässt. */
export type EditorApp = 'forklift' | 'fork' | 'bbedit';

/** Der Name des Programms für `open -a` und was es öffnet. */
const EDITOR_APPS: Record<EditorApp, { name: string; opens: 'folder' | 'repo' | 'file' }> = {
  forklift: { name: 'ForkLift', opens: 'folder' },
  fork: { name: 'Fork', opens: 'repo' },
  bbedit: { name: 'BBEdit', opens: 'file' },
};

/** Der Speicher: der Ordner aus `SCHRITTMACHER_CONFIG`, sonst `~/.config/schrittmacher`. */
function configFolder(): string {
  return process.env.SCHRITTMACHER_CONFIG ?? join(homedir(), '.config', 'schrittmacher');
}

/** Der Ordner für Kopien außerhalb eines Repos: `sicherung` im Speicher. */
function backupFolder(): string {
  return join(configFolder(), 'sicherung');
}

/** Die Datei mit den Markierungen zu einer Markdown-Datei, im Ordner `markierungen` des Speichers. */
function highlightsFile(path: string): string {
  return join(configFolder(), 'markierungen', `${baseName(path)}.json`);
}

/** Die gespeicherten Markierungen zu einer Markdown-Datei; ohne Datei keine. */
async function readHighlights(path: string): Promise<HighlightAnchor[]> {
  try {
    const raw = JSON.parse(await readFile(highlightsFile(path), 'utf8')) as unknown;
    const list = typeof raw === 'object' && raw !== null ? (raw as { highlights?: unknown }).highlights : undefined;
    return Array.isArray(list) ? list.filter(isHighlightAnchor) : [];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Die Markierungen zu ${path} lassen sich nicht lesen: ${String(error)}`);
  }
}

/** Der Text aus einer Anfrage, oder ein Fehler, wenn er fehlt. */
function textOf(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Der Text der Markdown-Datei fehlt.');
  }
  return value;
}

/** Liest eine Markdown-Datei für den Editor unter `/edit`. */
export const loadEditorFile = createServerFn({ method: 'GET' })
  .validator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<EditorFile> => {
    const path = await markdownPath(data.path);
    const [text, found, highlights] = await Promise.all([readFile(path, 'utf8'), stat(path), readHighlights(path)]);
    return { path, name: basename(path), dir: dirname(path), text, changed: found.mtimeMs, highlights };
  });

/** Die letzte Änderung der Datei in Millisekunden; `null`, wenn es sie nicht mehr gibt. */
export const editorFileChanged = createServerFn({ method: 'GET' })
  .validator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<number | null> => {
    const path = await markdownPath(data.path).catch(() => null);
    return path === null ? null : (await stat(path)).mtimeMs;
  });

/**
 * Öffnet die Datei in einem Programm auf dem Mac: ForkLift zeigt ihren Ordner, Fork ihr Repo und
 * BBEdit die Datei selbst. Das geht, weil der Server auf demselben Mac läuft.
 */
export const openEditorFileIn = createServerFn({ method: 'POST' })
  .validator((data: { path: string; app: EditorApp }) => {
    if (!(data.app in EDITOR_APPS)) {
      throw new Error(`Das Programm '${String(data.app)}' ist unbekannt.`);
    }
    return data;
  })
  .handler(async ({ data }): Promise<void> => {
    const path = await markdownPath(data.path);
    const app = EDITOR_APPS[data.app];
    let target = path;
    if (app.opens === 'folder') {
      target = dirname(path);
    } else if (app.opens === 'repo') {
      target = (await runGit(dirname(path), ['rev-parse', '--show-toplevel']).catch(() => '')).trim();
      if (target === '') {
        throw new Error(`Die Datei liegt in keinem Repo.`);
      }
    }
    await new Promise<void>((resolve, reject) => {
      execFile('open', ['-a', app.name, target], (error, _stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`${app.name} ließ sich nicht öffnen: ${stderr.trim() || error.message}`));
          return;
        }
        resolve();
      });
    });
  });

/** Schreibt den Text aus dem Editor in die Datei. */
export const saveEditorFile = createServerFn({ method: 'POST' })
  .validator((data: { path: string; text: string }) => data)
  .handler(async ({ data }): Promise<number> => {
    const path = await markdownPath(data.path);
    await writeFile(path, textOf(data.text), 'utf8');
    return (await stat(path)).mtimeMs;
  });

/** Schreibt die Markierungen zu einer Markdown-Datei; ohne Markierungen bleibt eine leere Liste stehen. */
export const saveEditorHighlights = createServerFn({ method: 'POST' })
  .validator((data: { path: string; highlights: HighlightAnchor[] }) => {
    if (!Array.isArray(data.highlights) || !data.highlights.every(isHighlightAnchor)) {
      throw new Error('Die Markierungen sind unvollständig.');
    }
    return data;
  })
  .handler(async ({ data }): Promise<void> => {
    const path = await markdownPath(data.path);
    const file = highlightsFile(path);
    await mkdir(dirname(file), { recursive: true });
    await writeAtomically(file, `${JSON.stringify({ file: path, highlights: data.highlights }, null, 2)}\n`);
  });

/** Formatiert den Text aus dem Editor mit Prettier, ohne ihn zu speichern. */
export const formatEditorText = createServerFn({ method: 'POST' })
  .validator((data: { path: string; text: string }) => data)
  .handler(async ({ data }): Promise<string> => formatMarkdown(await markdownPath(data.path), textOf(data.text)));

/**
 * Sichert den Text aus dem Editor: im Repo auf dem Branch `sicherung/<branch>`, sonst als Kopie im
 * Ordner `sicherung` (`docs/editor.md`).
 */
export const backupEditorText = createServerFn({ method: 'POST' })
  .validator((data: { path: string; text: string }) => data)
  .handler(async ({ data }) => backup(await markdownPath(data.path), textOf(data.text), backupFolder()));

/** Merkt sich eine Datei für den Editor, siehe `schrittmacher edit` in `bin/schrittmacher`. */
export const requestEdit = createServerOnlyFn(async (path: string): Promise<void> => {
  requested.next = { kind: 'edit', path: await markdownPath(path) };
});
