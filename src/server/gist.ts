import { execFile } from 'node:child_process';
import { basename } from 'node:path';

/** Ein Gist, wie ihn das Menü „Kopieren nach …“ zeigt. */
export interface GistInfo {
  id: string;
  description: string;
  url: string;
  /** Die Namen der Dateien im Gist. */
  files: string[];
}

/** Die größte Antwort von GitHub, die gelesen wird. */
const MAX_OUTPUT = 16 * 1024 * 1024;

/** Mit diesem Code beendet sich `gh`, wenn es nicht angemeldet ist. */
export const NOT_LOGGED_IN = 4;

/** Die Orte von `gh`, falls es nicht im `PATH` des Servers liegt. */
export const GH_FALLBACKS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'];

/**
 * Ruft `gh api` mit `args` auf und liefert die Antwort als JSON. Mit `input` geht der Inhalt als
 * Request an GitHub. Fehlt `gh` oder ist es nicht angemeldet, nennt der Fehler `gh auth login`.
 */
async function ghApi(args: string[], input?: unknown): Promise<unknown> {
  for (const program of ['gh', ...GH_FALLBACKS]) {
    try {
      return await run(program, args, input);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }
  throw new Error('Das Programm gh fehlt. Installiere es mit „brew install gh“ und melde dich mit „gh auth login“ an.');
}

function run(program: string, args: string[], input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      program,
      ['api', ...args, ...(input === undefined ? [] : ['--input', '-'])],
      { maxBuffer: MAX_OUTPUT, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error !== null) {
          if ('code' in error && error.code === 'ENOENT') {
            reject(error);
            return;
          }
          const output = stderr.trim() || error.message;
          const hint = error.code === NOT_LOGGED_IN ? ' Melde dich mit „gh auth login“ an.' : '';
          reject(new Error(`GitHub meldet einen Fehler: ${output}${hint}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as unknown);
        } catch {
          reject(new Error(`Die Antwort von GitHub ist kein JSON: ${stdout.slice(0, 200)}`));
        }
      },
    );
    child.stdin?.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

/** Die Kennung aus einer URL wie `https://gist.github.com/name/<kennung>` oder die Kennung selbst. */
export function gistIdOf(text: string): string {
  const last = text.trim().replace(/[#?].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '';
  if (!/^[0-9a-f]+$/i.test(last)) {
    throw new Error(`In „${text}“ steht keine Kennung eines Gists.`);
  }
  return last.toLowerCase();
}

/** Die URL eines Gists; GitHub leitet sie auf die mit dem Namen des Besitzers um. */
export function gistUrl(id: string): string {
  return `https://gist.github.com/${id}`;
}

/** Der Name einer Datei im Gist: ihr Name ohne Pfad, weil ein Gist keine Ordner kennt. */
export function gistNameOf(path: string): string {
  return basename(path);
}

/** Der Inhalt einer Datei als Text; ein Gist nimmt nur Text an. */
export function gistTextOf(path: string, content: Uint8Array): string {
  if (content.includes(0)) {
    throw new Error(`Die Datei ${path} ist keine Textdatei und lässt sich nicht in ein Gist kopieren.`);
  }
  return new TextDecoder().decode(content);
}

function infoOf(raw: unknown): GistInfo {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const files = typeof record.files === 'object' && record.files !== null ? Object.keys(record.files) : [];
  if (typeof record.id !== 'string' || typeof record.html_url !== 'string') {
    throw new Error('Die Antwort von GitHub enthält keinen Gist.');
  }
  return {
    id: record.id,
    description: typeof record.description === 'string' ? record.description : '',
    url: record.html_url,
    files,
  };
}

/** Liest den Gist mit seinen Dateien. */
export async function readGist(id: string): Promise<GistInfo> {
  return infoOf(await ghApi([`gists/${id}`]));
}

/** Schreibt eine Datei in den Gist; eine vorhandene gleichen Namens wird ersetzt. */
export async function writeToGist(id: string, name: string, text: string): Promise<GistInfo> {
  return infoOf(await ghApi(['--method', 'PATCH', `gists/${id}`], { files: { [name]: { content: text } } }));
}

/** Legt einen secret Gist mit einer ersten Datei an, denn ein leerer ist bei GitHub nicht möglich. */
export async function createGist(description: string, name: string, text: string): Promise<GistInfo> {
  return infoOf(
    await ghApi(['--method', 'POST', 'gists'], { description, public: false, files: { [name]: { content: text } } }),
  );
}
