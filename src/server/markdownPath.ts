import { stat } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';

/** Die Endungen einer Markdown-Datei, die die Ansicht zeigt. */
const MARKDOWN_ENDINGS: ReadonlySet<string> = new Set(['.md', '.markdown']);

/**
 * Der Pfad einer Markdown-Datei, die es gibt. Andere Dateien liest der Server nicht, weil die
 * Server-Funktion jeder Seite im Browser offensteht.
 */
export async function markdownPath(value: unknown): Promise<string> {
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
