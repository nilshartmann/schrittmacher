import { readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { markdownPath } from '../server/markdownPath';
import { requested } from '../server/requests';
import { backup } from './backup';
import { formatMarkdown } from './format';

/** Eine Datei im Editor mit ihrem Text. */
export interface EditorFile {
  /** Der absolute Pfad der Datei. */
  path: string;
  name: string;
  /** Der Ordner der Datei, gegen den relative Links und Bilder der Vorschau aufgelöst werden. */
  dir: string;
  text: string;
}

/** Der Ordner für Kopien außerhalb eines Repos: `sicherung` im Ordner aus `SCHRITTMACHER_CONFIG`. */
function backupFolder(): string {
  return join(process.env.SCHRITTMACHER_CONFIG ?? join(homedir(), '.config', 'schrittmacher'), 'sicherung');
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
    return { path, name: basename(path), dir: dirname(path), text: await readFile(path, 'utf8') };
  });

/** Schreibt den Text aus dem Editor in die Datei. */
export const saveEditorFile = createServerFn({ method: 'POST' })
  .validator((data: { path: string; text: string }) => data)
  .handler(async ({ data }): Promise<number> => {
    const path = await markdownPath(data.path);
    await writeFile(path, textOf(data.text), 'utf8');
    return (await stat(path)).mtimeMs;
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
