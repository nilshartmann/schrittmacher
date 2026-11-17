import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { imageTypeOf } from '../git/images';
import { runGit } from '../git/process';
import { baseName, writeAtomically } from '../server/notes';
import { requested } from '../server/requests';
import { backup } from './backup';
import { formatterOf, formatText } from './format';
import { isHighlightAnchor } from './highlights';
import type { HighlightAnchor } from './highlights';
import {
  addRecent,
  configFolder,
  createDraft,
  createWorkspaceFile,
  draftsRoot,
  editorPath,
  kindOf,
  listWorkspace,
  nextFigureName,
  recentEntries,
  removeRecent,
  saveImageBeside,
  workspaceOf,
  workspacePath,
} from './workspace';
import type { RecentEntry, WorkspaceListing } from './workspace';

export type { Draft, RecentEntry, WorkspaceListing } from './workspace';

/**
 * Was der Editor mit einer Datei anfängt: Text bearbeitet er, ein Bild zeigt er an. Andere
 * Binärdateien und zu große Dateien öffnet er nicht.
 */
export type EditorFileKind = 'text' | 'image' | 'binary' | 'large';

/** Eine Datei im Editor mit ihrem Text. */
export interface EditorFile {
  /** Der absolute Pfad der Datei. */
  path: string;
  name: string;
  /** Der Ordner der Datei, gegen den relative Links und Bilder der Vorschau aufgelöst werden. */
  dir: string;
  kind: EditorFileKind;
  /** Ob es die Datei schon gibt; sonst entsteht sie beim ersten Speichern. */
  exists: boolean;
  /** Der Text; leer, wenn es die Datei noch nicht gibt oder sie kein Text ist. */
  text: string;
  /** Die letzte Änderung in Millisekunden, um eine Änderung außerhalb des Editors zu bemerken. */
  changed: number | null;
  /** Ob Prettier die Art von Datei formatieren kann. */
  formattable: boolean;
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

/** Der Ordner für Kopien außerhalb eines Repos: `sicherung` im Speicher. */
function backupFolder(): string {
  return join(configFolder(), 'sicherung');
}

/** Die Datei mit den Markierungen zu einer Datei, im Ordner `markierungen` des Speichers. */
function highlightsFile(path: string): string {
  return join(configFolder(), 'markierungen', `${baseName(path)}.json`);
}

/** Die gespeicherten Markierungen zu einer Datei; ohne Datei keine. */
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
    throw new Error('Der Text der Datei fehlt.');
  }
  return value;
}

/**
 * Liest eine Datei für den Editor unter `/edit` und merkt sie sich als zuletzt geöffnet. Eine Datei,
 * die es noch nicht gibt, ist leer.
 */
export const loadEditorFile = createServerFn({ method: 'GET' })
  .validator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<EditorFile> => {
    const path = await editorPath(data.path);
    const found = await stat(path).catch(() => null);
    if (found !== null && !found.isFile()) {
      throw new Error(`'${path}' ist keine Datei.`);
    }
    const kind = await kindOf(path, imageTypeOf(path));
    const [text, highlights, formatter] = await Promise.all([
      found !== null && kind === 'text' ? readFile(path, 'utf8') : '',
      kind === 'text' ? readHighlights(path) : [],
      kind === 'text' ? formatterOf(path) : null,
    ]);
    await addRecent({ file: path });
    return {
      path,
      name: basename(path),
      dir: dirname(path),
      kind,
      exists: found !== null,
      text,
      changed: found?.mtimeMs ?? null,
      formattable: formatter !== null,
      highlights,
    };
  });

/** Die letzte Änderung der Datei in Millisekunden; `null`, wenn es sie nicht mehr gibt. */
export const editorFileChanged = createServerFn({ method: 'GET' })
  .validator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<number | null> => {
    const path = await editorPath(data.path);
    return (await stat(path).catch(() => null))?.mtimeMs ?? null;
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
    const path = await editorPath(data.path);
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

/** Schreibt den Text aus dem Editor in die Datei; gibt es sie noch nicht, entsteht sie mit ihrem Ordner. */
export const saveEditorFile = createServerFn({ method: 'POST' })
  .validator((data: { path: string; text: string }) => data)
  .handler(async ({ data }): Promise<number> => {
    const path = await editorPath(data.path);
    const text = textOf(data.text);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
    return (await stat(path)).mtimeMs;
  });

/** Schreibt die Markierungen zu einer Datei; ohne Markierungen bleibt eine leere Liste stehen. */
export const saveEditorHighlights = createServerFn({ method: 'POST' })
  .validator((data: { path: string; highlights: HighlightAnchor[] }) => {
    if (!Array.isArray(data.highlights) || !data.highlights.every(isHighlightAnchor)) {
      throw new Error('Die Markierungen sind unvollständig.');
    }
    return data;
  })
  .handler(async ({ data }): Promise<void> => {
    const path = await editorPath(data.path);
    const file = highlightsFile(path);
    await mkdir(dirname(file), { recursive: true });
    await writeAtomically(file, `${JSON.stringify({ file: path, highlights: data.highlights }, null, 2)}\n`);
  });

/** Formatiert den Text aus dem Editor mit Prettier, ohne ihn zu speichern. */
export const formatEditorText = createServerFn({ method: 'POST' })
  .validator((data: { path: string; text: string }) => data)
  .handler(async ({ data }): Promise<string> => formatText(await editorPath(data.path), textOf(data.text)));

/**
 * Sichert den Text aus dem Editor: im Repo auf dem Branch `sicherung/<branch>`, sonst als Kopie im
 * Ordner `sicherung` (`docs/editor.md`).
 */
export const backupEditorText = createServerFn({ method: 'POST' })
  .validator((data: { path: string; text: string }) => data)
  .handler(async ({ data }) => backup(await editorPath(data.path), textOf(data.text), backupFolder()));

/** Der Inhalt eines Workspace für den Baum. */
export const loadWorkspace = createServerFn({ method: 'GET' })
  .validator((data: { root: string }) => data)
  .handler(async ({ data }): Promise<WorkspaceListing> => listWorkspace(await workspacePath(data.root)));

/** Merkt sich einen Workspace als zuletzt geöffnet, etwa beim Öffnen über das Menü. */
export const touchWorkspace = createServerFn({ method: 'POST' })
  .validator((data: { root: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    await addRecent({ workspace: await workspacePath(data.root) });
  });

/** Die Liste „Zuletzt geöffnet“ für das Menü. */
export const loadRecent = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ workspaces: RecentEntry[]; files: RecentEntry[] }> => recentEntries(),
);

/** Nimmt einen Workspace oder eine Datei aus der Liste „Zuletzt geöffnet“. */
export const forgetRecent = createServerFn({ method: 'POST' })
  .validator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    await removeRecent(data.path);
  });

/**
 * Schließt eine Datei: Sie verschwindet aus „Zuletzt geöffnet“, ein leerer Entwurf wird gelöscht.
 * Zurück kommt die nächste Datei der Liste, die es noch gibt, oder `null`.
 */
export const closeEditorFile = createServerFn({ method: 'POST' })
  .validator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<RecentEntry | null> => {
    const path = await editorPath(data.path);
    await removeRecent(path);
    if ((await workspaceOf(path)) === draftsRoot()) {
      const found = await stat(path).catch(() => null);
      if (found !== null && found.isFile() && found.size === 0) {
        await rm(path);
      }
    }
    return (await recentEntries()).files.find((entry) => entry.exists) ?? null;
  });

/** Legt einen leeren Entwurf an; zurück kommen sein Pfad und die Wurzel der Entwürfe. */
export const newDraft = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ path: string; root: string }> => ({ path: await createDraft(), root: draftsRoot() }),
);

/** Legt eine leere Datei im Workspace an, mit einem Pfad relativ zur Wurzel; zurück kommt ihr absoluter Pfad. */
export const newWorkspaceFile = createServerFn({ method: 'POST' })
  .validator((data: { root: string; path: string }) => data)
  .handler(async ({ data }): Promise<string> => {
    if (typeof data.path !== 'string') {
      throw new Error('Der Pfad der neuen Datei fehlt.');
    }
    return createWorkspaceFile(await workspacePath(data.root), data.path);
  });

/** Der Name für eine neue Abbildung zur Datei, etwa `abb-013`, gezählt im Workspace `root`. */
export const suggestFigureName = createServerFn({ method: 'GET' })
  .validator((data: { path: string; root: string | null }) => data)
  .handler(async ({ data }): Promise<string> => {
    const path = await editorPath(data.path);
    return nextFigureName(path, data.root === null ? null : await workspacePath(data.root));
  });

/**
 * Speichert ein Bild aus der Zwischenablage im Ordner der Datei, als Base64 geschickt. Zurück kommt
 * der Name der neuen Datei mit Endung.
 */
export const saveFigure = createServerFn({ method: 'POST' })
  .validator((data: { path: string; name: string; type: string; base64: string }) => {
    if (typeof data.name !== 'string' || typeof data.type !== 'string' || typeof data.base64 !== 'string') {
      throw new Error('Name, Typ oder Inhalt des Bildes fehlen.');
    }
    return data;
  })
  .handler(async ({ data }): Promise<string> => {
    const path = await editorPath(data.path);
    return saveImageBeside(path, data.name, data.type, Buffer.from(data.base64, 'base64'));
  });

/**
 * Merkt sich, was `schrittmacher edit <pfad>` im Editor öffnen soll (`bin/schrittmacher`). Ein
 * Ordner öffnet sich als Workspace. Eine Datei öffnet sich in dem bekannten Workspace, in dem sie
 * liegt, sonst allein. Eine Datei, die es noch nicht gibt, entsteht beim ersten Speichern; ihr
 * Ordner muss aber da sein.
 */
export const requestEdit = createServerOnlyFn(async (value: string): Promise<void> => {
  if (!isAbsolute(value)) {
    throw new Error(`Der Pfad '${value}' ist nicht absolut.`);
  }
  const path = resolve(value);
  const found = await stat(path).catch(() => null);
  if (found?.isDirectory() === true) {
    await addRecent({ workspace: path });
    requested.next = { kind: 'edit', path: null, root: path };
    return;
  }
  if (found === null && (await stat(dirname(path)).catch(() => null))?.isDirectory() !== true) {
    throw new Error(`Den Ordner '${dirname(path)}' gibt es nicht.`);
  }
  await addRecent({ file: path });
  requested.next = { kind: 'edit', path, root: await workspaceOf(path) };
});

/** Legt für `schrittmacher edit --neu` einen Entwurf an und merkt ihn für den Editor. */
export const requestDraft = createServerOnlyFn(async (): Promise<void> => {
  const path = await createDraft();
  await addRecent({ file: path });
  requested.next = { kind: 'edit', path, root: draftsRoot() };
});
