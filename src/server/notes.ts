import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { isNote, isRecord, markdownOf } from '../notes/notes';
import type { Note, NoteInput, Notes } from '../notes/notes';
import { shared } from './shared';

/**
 * Die Schreibzugriffe auf die Hinweise, nacheinander, damit keiner den anderen überschreibt. Sie
 * gelten für alle Instanzen dieses Moduls, siehe `shared`.
 */
export const queue = shared('notes-queue', () => ({ writing: Promise.resolve() as Promise<unknown> }));

/**
 * Der Name der Dateien zu einem Repo: sein Pfad ab dem Home-Verzeichnis, mit `-` statt `/`. Der
 * Name des Repos allein reicht nicht, weil etwa jeder Workshop ein Repo `prepare` haben kann.
 */
export function baseName(repoPath: string): string {
  const home = homedir() + sep;
  const relative = repoPath.startsWith(home) ? repoPath.slice(home.length) : repoPath;
  return relative.split(sep).filter((part) => part !== '').join('-').replace(/^\.+/, '');
}

/** Schreibt eine Datei über eine temporäre daneben, damit nie eine halbe Fassung dasteht. */
export async function writeAtomically(file: string, content: string): Promise<void> {
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, file);
}

/**
 * Die Hinweise je Repo im Ordner `hinweise` des Speichers. Sie stehen als JSON, aus dem nach jeder
 * Änderung die Markdown-Datei daneben neu geschrieben wird; eine Änderung von Hand an der
 * Markdown-Datei geht dabei verloren.
 */
export function createNotes(dir: string) {
  const folder = join(dir, 'hinweise');

  const files = (repoPath: string) => {
    const base = join(folder, baseName(repoPath));
    return { json: `${base}.json`, markdown: `${base}.md` };
  };

  async function read(repoPath: string): Promise<Note[]> {
    try {
      const raw = JSON.parse(await readFile(files(repoPath).json, 'utf8')) as unknown;
      return isRecord(raw) && Array.isArray(raw.notes) ? raw.notes.filter(isNote) : [];
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw new Error(`Die Hinweise zu ${repoPath} lassen sich nicht lesen: ${String(error)}`);
    }
  }

  async function load(repoPath: string): Promise<Notes> {
    const notes = await read(repoPath);
    return { notes, file: files(repoPath).markdown, markdown: markdownOf(repoPath, notes) };
  }

  function update(repoPath: string, change: (notes: Note[]) => Note[]): Promise<Notes> {
    const next = queue.writing.then(async () => {
      const notes = change(await read(repoPath));
      const { json, markdown } = files(repoPath);
      await mkdir(folder, { recursive: true });
      await writeAtomically(json, `${JSON.stringify({ repo: repoPath, notes }, null, 2)}\n`);
      const text = markdownOf(repoPath, notes);
      await writeAtomically(markdown, text);
      return { notes, file: markdown, markdown: text };
    });
    queue.writing = next.catch(() => undefined);
    return next;
  }

  return {
    load,
    /** Legt einen Hinweis an oder ändert den mit derselben `id`. */
    save: (repoPath: string, input: NoteInput) =>
      update(repoPath, (notes) => {
        const existing = notes.find((note) => note.id === input.id);
        if (existing === undefined) {
          return [...notes, { ...input, id: randomUUID(), created: new Date().toISOString() }];
        }
        return notes.map((note) => (note.id === existing.id ? { ...existing, ...input, id: existing.id } : note));
      }),
    remove: (repoPath: string, id: string) => update(repoPath, (notes) => notes.filter((note) => note.id !== id)),
    clear: (repoPath: string) => update(repoPath, () => []),
    /**
     * Schreibt die Hinweise, wie sie im Dialog stehen, für eine Session von Claude Code in eigene
     * Dateien im Ordner `claude`, je Aufruf mit Zeitstempel. Die Hinweise selbst bleiben unverändert.
     * Die Datei mit dem Prompt beginnt mit dem Auftrag, die Hinweise zu lesen.
     */
    forClaude: async (repoPath: string, markdown: string, prompt: string) => {
      const dir = join(folder, 'claude');
      await mkdir(dir, { recursive: true });
      const base = join(dir, `${baseName(repoPath)}-${stampOf(new Date())}`);
      const file = `${base}.md`;
      const promptFile = `${base}.prompt.txt`;
      await writeAtomically(file, markdown);
      await writeAtomically(promptFile, `Lies ${file}.\n\n${prompt.trim()}\n`);
      return { dir, file, promptFile };
    },
  };
}

/** Datum und Uhrzeit für einen Dateinamen, etwa `2026-10-31-174512`. */
export function stampOf(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

export type NotesStore = ReturnType<typeof createNotes>;
