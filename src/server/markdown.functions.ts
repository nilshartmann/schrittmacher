import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { requested } from './requests';

/** Die Endungen einer Markdown-Datei, die die Ansicht zeigt. */
const MARKDOWN_ENDINGS: ReadonlySet<string> = new Set(['.md', '.markdown']);

/** Die Bilder, die eine Markdown-Datei neben sich einbinden darf, mit ihrem Medientyp. */
const IMAGE_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]);

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

/**
 * Der Pfad einer Markdown-Datei, die es gibt. Andere Dateien liest der Server nicht, weil die
 * Server-Funktion jeder Seite im Browser offensteht.
 */
async function markdownPath(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error('Der Pfad der Markdown-Datei fehlt oder ist nicht absolut.');
  }
  const path = resolve(value);
  if (!MARKDOWN_ENDINGS.has(extname(path).toLowerCase())) {
    throw new Error(`'${path}' ist keine Markdown-Datei (.md oder .markdown).`);
  }
  const found = await stat(path).catch(() => null);
  if (found === null || !found.isFile()) {
    throw new Error(`Die Datei '${path}' gibt es nicht.`);
  }
  return path;
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
    const type = IMAGE_TYPES.get(extname(path).toLowerCase());
    if (!isAbsolute(value) || type === undefined) {
      return null;
    }
    const bytes = await readFile(path).catch(() => null);
    return bytes === null ? null : { bytes, type };
  },
);
