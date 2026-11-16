import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { imageTypeOf } from '../git/images';
import { markdownPath } from './markdownPath';
import { requested } from './requests';

/** Eine Markdown-Datei mit ihrem Text und dem Zeitpunkt ihrer letzten Änderung. */
export interface MarkdownFile {
  /** Der absolute Pfad der Datei. */
  path: string;
  name: string;
  /** Der Ordner der Datei, gegen den relative Links und Bilder aufgelöst werden. */
  dir: string;
  text: string;
  /** Die letzte Änderung in Millisekunden, um eine geänderte Datei zu bemerken. */
  changed: number;
}

/** Liest eine Markdown-Datei für die Ansicht unter `/markdown`. */
export const loadMarkdown = createServerFn({ method: 'GET' })
  .validator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<MarkdownFile> => {
    const path = await markdownPath(data.path);
    const [text, found] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { path, name: basename(path), dir: dirname(path), text, changed: found.mtimeMs };
  });

/** Die letzte Änderung einer Markdown-Datei in Millisekunden; `null`, wenn es sie nicht mehr gibt. */
export const markdownChanged = createServerFn({ method: 'GET' })
  .validator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<number | null> => {
    const path = await markdownPath(data.path).catch(() => null);
    return path === null ? null : (await stat(path)).mtimeMs;
  });

/** Merkt sich eine Markdown-Datei für die Seite, siehe `bin/schrittmacher`. */
export const requestMarkdown = createServerOnlyFn(async (path: string): Promise<void> => {
  requested.next = { kind: 'markdown', path: await markdownPath(path) };
});

/** Ein Bild neben einer Markdown-Datei, mit seinem Medientyp; `null` für eine andere Datei. */
export const readImage = createServerOnlyFn(
  async (value: string): Promise<{ bytes: Buffer; type: string } | null> => {
    const path = resolve(value);
    const type = imageTypeOf(path);
    if (!isAbsolute(value) || type === undefined) {
      return null;
    }
    const bytes = await readFile(path).catch(() => null);
    return bytes === null ? null : { bytes, type };
  },
);
