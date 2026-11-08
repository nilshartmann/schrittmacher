import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMdNote, mdMarkdownOf } from '../notes/markdownNotes';
import type { MdNote, MdNoteInput, MdNotes } from '../notes/markdownNotes';
import { isRecord } from '../notes/notes';
import { baseName, queue, stampOf, writeAtomically } from './notes';

/** Die Bildarten, die sich einfügen lassen, mit der Endung ihrer Datei. */
const IMAGE_ENDINGS: ReadonlyMap<string, string> = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
]);

/** So groß darf ein eingefügtes Bild höchstens sein, in Bytes. */
const IMAGE_LIMIT = 25 * 1024 * 1024;

/**
 * Die Hinweise je Markdown-Datei im Ordner `hinweise/markdown` des Speichers, also außerhalb der
 * Datei. Maßgeblich ist das JSON; die Markdown-Datei daneben wird nach jeder Änderung neu
 * geschrieben.
 */
export function createMarkdownNotes(dir: string) {
  const folder = join(dir, 'hinweise', 'markdown');

  const files = (path: string) => {
    const base = join(folder, baseName(path));
    return { json: `${base}.json`, markdown: `${base}.md` };
  };

  async function read(path: string): Promise<MdNote[]> {
    try {
      const raw = JSON.parse(await readFile(files(path).json, 'utf8')) as unknown;
      return isRecord(raw) && Array.isArray(raw.notes) ? raw.notes.filter(isMdNote) : [];
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw new Error(`Die Hinweise zu ${path} lassen sich nicht lesen: ${String(error)}`);
    }
  }

  /** Der aktuelle Text der Datei; eine gelöschte Datei zählt als leer. */
  const textOf = (path: string) => readFile(path, 'utf8').catch(() => '');

  async function load(path: string): Promise<MdNotes> {
    const notes = await read(path);
    // Die Markdown-Datei wird neu geschrieben, weil ihre Zeilennummern vom Stand der Datei abhängen.
    if (notes.length > 0) {
      return update(path, (same) => same);
    }
    return { notes, file: files(path).markdown, markdown: mdMarkdownOf(path, notes, await textOf(path)) };
  }

  function update(path: string, change: (notes: MdNote[]) => MdNote[]): Promise<MdNotes> {
    const next = queue.writing.then(async () => {
      const notes = change(await read(path));
      const { json, markdown } = files(path);
      await mkdir(folder, { recursive: true });
      await writeAtomically(json, `${JSON.stringify({ file: path, notes }, null, 2)}\n`);
      const text = mdMarkdownOf(path, notes, await textOf(path));
      await writeAtomically(markdown, text);
      return { notes, file: markdown, markdown: text };
    });
    queue.writing = next.catch(() => undefined);
    return next;
  }

  return {
    load,
    textOf,
    /** Legt einen Hinweis an oder ändert den mit derselben `id`. */
    save: (path: string, input: MdNoteInput) =>
      update(path, (notes) => {
        const existing = notes.find((note) => note.id === input.id);
        if (existing === undefined) {
          return [...notes, { ...input, id: randomUUID(), created: new Date().toISOString() }];
        }
        return notes.map((note) => (note.id === existing.id ? { ...existing, ...input, id: existing.id } : note));
      }),
    remove: (path: string, id: string) => update(path, (notes) => notes.filter((note) => note.id !== id)),
    clear: (path: string) => update(path, () => []),
    /**
     * Legt ein eingefügtes Bild im Ordner `claude/bilder` ab und liefert seinen Pfad. Der Ordner
     * liegt unter dem, den Claude Code über `--add-dir` lesen darf.
     */
    saveImage: async (type: string, base64: string): Promise<string> => {
      const ending = IMAGE_ENDINGS.get(type);
      if (ending === undefined) {
        throw new Error(`Bilder der Art '${type}' lassen sich nicht einfügen.`);
      }
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length === 0 || bytes.length > IMAGE_LIMIT) {
        throw new Error('Das Bild ist leer oder zu groß.');
      }
      const images = join(dir, 'hinweise', 'claude', 'bilder');
      await mkdir(images, { recursive: true });
      const file = join(images, `${stampOf(new Date())}-${randomBytes(3).toString('hex')}.${ending}`);
      await writeFile(file, bytes);
      return file;
    },
    /** Schreibt die Hinweise aus dem Dialog und den Prompt für eine Session von Claude Code in eigene Dateien. */
    forClaude: async (path: string, markdown: string, prompt: string) => {
      const claudeDir = join(dir, 'hinweise', 'claude');
      await mkdir(claudeDir, { recursive: true });
      const base = join(claudeDir, `${baseName(path)}-${stampOf(new Date())}`);
      const file = `${base}.md`;
      const promptFile = `${base}.prompt.txt`;
      await writeAtomically(file, markdown);
      await writeAtomically(promptFile, `Lies ${file}.\n\n${prompt.trim()}\n`);
      return { dir: claudeDir, file, promptFile };
    },
  };
}
