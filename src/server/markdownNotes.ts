import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { commentOf } from '../notes/markdownComments';
import type { MdComment, MdComments } from '../notes/markdownComments';
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

/** So viele Sicherungen der Anmerkungen bleiben je Datei liegen. */
const COMMENT_BACKUPS = 20;

/** Die `id` einer Anmerkung aus ihrem Inhalt; gleicher Inhalt hat dieselbe. */
function commentId(comment: Omit<MdComment, 'id'>): string {
  return createHash('sha1').update(JSON.stringify([comment.quote, comment.before, comment.text])).digest('hex').slice(0, 12);
}

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

  // Die Anmerkungen von Claude liegen unter `claude`, weil Claude Code nur diesen Ordner über
  // `--add-dir` erreicht, siehe `docs/editor.md`.
  const commentsFolder = join(dir, 'hinweise', 'claude', 'anmerkungen');
  const commentsFile = (path: string) => join(commentsFolder, `${baseName(path)}.json`);

  /** Die Einträge der Datei mit den Anmerkungen, wie Claude sie geschrieben hat; ohne Datei `null`. */
  async function readComments(path: string): Promise<{ raw: unknown[]; changed: number } | null> {
    const file = commentsFile(path);
    const found = await stat(file).catch(() => null);
    if (found === null) {
      return null;
    }
    const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return { raw: isRecord(raw) && Array.isArray(raw.comments) ? raw.comments : [], changed: found.mtimeMs };
  }

  async function loadComments(path: string): Promise<MdComments> {
    const file = commentsFile(path);
    try {
      const read = await readComments(path);
      const comments = (read?.raw ?? [])
        .map(commentOf)
        .filter((comment) => comment !== null)
        .map((comment) => ({ ...comment, id: commentId(comment) }));
      return { comments, file, changed: read?.changed ?? null, error: null };
    } catch (error) {
      const changed = (await stat(file).catch(() => null))?.mtimeMs ?? null;
      return { comments: [], file, changed, error: `Die Anmerkungen lassen sich nicht lesen: ${String(error)}` };
    }
  }

  return {
    load,
    textOf,
    commentsFile,
    loadComments,
    /** Die letzte Änderung der Datei mit den Anmerkungen; `null`, solange es sie nicht gibt. */
    commentsChanged: async (path: string) => (await stat(commentsFile(path)).catch(() => null))?.mtimeMs ?? null,
    /** Verwirft eine Anmerkung als erledigt; die übrigen bleiben, wie Claude sie geschrieben hat. */
    dismissComment: async (path: string, id: string): Promise<MdComments> => {
      const read = await readComments(path);
      if (read !== null) {
        const rest = read.raw.filter((entry) => {
          const comment = commentOf(entry);
          return comment === null || commentId(comment) !== id;
        });
        await writeAtomically(commentsFile(path), `${JSON.stringify({ file: path, comments: rest }, null, 2)}\n`);
      }
      return loadComments(path);
    },
    /**
     * Sichert die Anmerkungen vor einer neuen Prüfung unter `sicherung` mit Zeitstempel und entfernt
     * sie danach, damit der Editor bis zum Ergebnis keine alten zeigt. Je Datei bleiben die letzten
     * Sicherungen liegen.
     */
    backupComments: async (path: string): Promise<void> => {
      const file = commentsFile(path);
      if ((await stat(file).catch(() => null)) === null) {
        return;
      }
      const backups = join(commentsFolder, 'sicherung');
      await mkdir(backups, { recursive: true });
      const prefix = `${baseName(path)}-`;
      await copyFile(file, join(backups, `${prefix}${stampOf(new Date())}.json`));
      await rm(file);
      const old = (await readdir(backups)).filter((name) => name.startsWith(prefix) && name.endsWith('.json')).sort();
      await Promise.all(old.slice(0, -COMMENT_BACKUPS).map((name) => rm(join(backups, name))));
    },
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
