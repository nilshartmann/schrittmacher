import type { DiffLine } from './types';

// Portiert aus agent-lab (src/main/java/nh/agentlab/git/Diff.java), nur der Teil zum Lesen. Ein
// Gitlink (Submodul) erscheint als gewöhnliche Datei mit der Zeile `Subproject commit …`.

/** Wie sich eine Datei laut `git diff` geändert hat. */
export type ParsedKind = 'changed' | 'added' | 'deleted' | 'renamed';

/** Eine Datei aus der Ausgabe von `git diff`. */
export interface ParsedFile {
  /** Der Pfad vor der Änderung; derselbe wie `newPath`, außer bei einer Umbenennung. */
  oldPath: string;
  /** Der Pfad nach der Änderung, für eine gelöschte Datei der alte. */
  newPath: string;
  kind: ParsedKind;
  /** Eine Binärdatei hat keine Zeilen. */
  binary: boolean;
  /** Die Zeilen aller Abschnitte, ohne Teile. */
  lines: DiffLine[];
  /** Die Zahl der Abschnitte; mit `--unified=2147483647` höchstens einer. */
  hunks: number;
}

const FILE_START = 'diff --git ';
const HUNK_START = '@@ ';
const NO_FILE = '/dev/null';

/**
 * Liest die Ausgabe von `git diff` mit den Präfixen `a/` und `b/`. Die Exception nennt nur die
 * Nummer der Zeile, die nicht passt, nie die Zeile selbst, weil darin Code steht.
 */
export function parseDiff(text: string): ParsedFile[] {
  const lines = text === '' ? [] : (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
  return new Parser(lines).parse();
}

class Parser {
  private index = 0;

  constructor(private readonly lines: string[]) {}

  parse(): ParsedFile[] {
    const files: ParsedFile[] = [];
    while (this.index < this.lines.length) {
      if (!this.at(this.index).startsWith(FILE_START)) {
        throw error(this.index);
      }
      files.push(this.file());
    }
    return files;
  }

  private at(index: number): string {
    return this.lines[index] ?? '';
  }

  private file(): ParsedFile {
    const start = this.index;
    const header = this.at(this.index).slice(FILE_START.length);
    this.index++;
    let kind: ParsedKind = 'changed';
    let renameFrom = '';
    let renameTo = '';
    let from = '';
    let to = '';
    let binary = false;
    while (this.index < this.lines.length) {
      const line = this.at(this.index);
      if (line.startsWith(FILE_START) || line.startsWith(HUNK_START)) {
        break;
      }
      if (line.startsWith('new file mode ')) {
        kind = 'added';
      } else if (line.startsWith('deleted file mode ')) {
        kind = 'deleted';
      } else if (line.startsWith('rename from ')) {
        renameFrom = unquote(line.slice('rename from '.length), this.index);
      } else if (line.startsWith('rename to ')) {
        renameTo = unquote(line.slice('rename to '.length), this.index);
      } else if (line.startsWith('--- ')) {
        from = marker(line, this.index);
      } else if (line.startsWith('+++ ')) {
        to = marker(line, this.index);
      } else if (line.startsWith('Binary files ')) {
        binary = true;
      }
      this.index++;
    }
    const lines: DiffLine[] = [];
    let hunks = 0;
    while (this.at(this.index).startsWith(HUNK_START) && this.index < this.lines.length) {
      lines.push(...this.hunk());
      hunks++;
    }
    if (this.index < this.lines.length && !this.at(this.index).startsWith(FILE_START)) {
      throw error(this.index);
    }
    if (renameFrom !== '' && renameTo !== '') {
      return { oldPath: renameFrom, newPath: renameTo, kind: 'renamed', binary, lines, hunks };
    }
    const path = to !== '' ? to : from !== '' ? from : fromHeader(header, start);
    return { oldPath: path, newPath: path, kind, binary, lines, hunks };
  }

  private hunk(): DiffLine[] {
    const start = this.index;
    const [oldStart, oldCount, newStart, newCount] = numbers(this.at(start), start);
    let oldNumber = oldStart;
    let newNumber = newStart;
    let oldRemaining = oldCount;
    let newRemaining = newCount;
    this.index++;
    const result: DiffLine[] = [];
    while (oldRemaining > 0 || newRemaining > 0) {
      if (this.index >= this.lines.length) {
        throw error(start);
      }
      const line = this.at(this.index);
      const mark = line === '' ? ' ' : line.charAt(0);
      const text = line.slice(1);
      if (mark === ' ') {
        result.push({ kind: 'context', oldNumber: oldNumber++, newNumber: newNumber++, text, parts: [] });
        oldRemaining--;
        newRemaining--;
      } else if (mark === '-') {
        result.push({ kind: 'removed', oldNumber: oldNumber++, newNumber: null, text, parts: [] });
        oldRemaining--;
      } else if (mark === '+') {
        result.push({ kind: 'added', oldNumber: null, newNumber: newNumber++, text, parts: [] });
        newRemaining--;
      } else if (mark !== '\\') {
        throw error(this.index);
      }
      this.index++;
    }
    // Die Zeile `\ No newline at end of file` fällt weg.
    while (this.at(this.index).startsWith('\\') && this.index < this.lines.length) {
      this.index++;
    }
    if (oldRemaining < 0 || newRemaining < 0) {
      throw error(start);
    }
    return result;
  }
}

/** Anfang und Zahl der alten und der neuen Seite aus `@@ -a,b +c,d @@`. */
function numbers(header: string, line: number): [number, number, number, number] {
  const end = header.indexOf(' @@', HUNK_START.length);
  if (end < 0) {
    throw error(line);
  }
  const parts = header.slice(HUNK_START.length, end).split(' ');
  const [old, current] = parts;
  if (parts.length !== 2 || old === undefined || current === undefined || !old.startsWith('-') || !current.startsWith('+')) {
    throw error(line);
  }
  return [...range(old.slice(1), line), ...range(current.slice(1), line)];
}

function range(text: string, line: number): [number, number] {
  const [start, count = '1'] = text.split(',');
  const numbers = [Number(start), Number(count)] as const;
  if (!numbers.every(Number.isInteger)) {
    throw error(line);
  }
  return [numbers[0], numbers[1]];
}

/** Der Pfad aus `a/<pfad> b/<pfad>` einer Datei, deren Name und Zeilen sich nicht ändern. */
function fromHeader(header: string, line: number): string {
  if (header.startsWith('"')) {
    return stripPrefix(unquote(header.slice(0, closingQuote(header, line) + 1), line), line);
  }
  const length = header.length - 5;
  if (length < 1 || length % 2 !== 0 || !header.startsWith('a/')) {
    throw error(line);
  }
  return header.slice(2, 2 + length / 2);
}

function closingQuote(text: string, line: number): number {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (text[i] === '"') {
      return i;
    }
  }
  throw error(line);
}

/**
 * Der Pfad einer Zeile `--- a/<pfad>` oder `+++ b/<pfad>`, leer für keine Datei. Hinter einem Pfad
 * mit Leerzeichen setzt Git einen Tab, auch hinter einem in Anführungszeichen.
 */
function marker(line: string, number: number): string {
  let value = line.slice(4);
  const tab = value.indexOf('\t');
  if (value.startsWith('"')) {
    value = value.slice(0, closingQuote(value, number) + 1);
  } else if (tab >= 0) {
    value = value.slice(0, tab);
  }
  return value === NO_FILE ? '' : stripPrefix(unquote(value, number), number);
}

function stripPrefix(path: string, line: number): string {
  if (path.length < 3 || path[1] !== '/') {
    throw error(line);
  }
  return path.slice(2);
}

const ESCAPES: Record<string, number> = { t: 9, n: 10, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 };

/** Liest einen Pfad, den Git mit den Escapes von C in Anführungszeichen setzt. */
function unquote(text: string, line: number): string {
  if (!text.startsWith('"')) {
    return text;
  }
  if (text.length < 2 || !text.endsWith('"')) {
    throw error(line);
  }
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  const inner = text.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i] ?? '';
    if (c !== '\\') {
      const point = inner.codePointAt(i) ?? 0;
      const char = String.fromCodePoint(point);
      bytes.push(...encoder.encode(char));
      i += char.length - 1;
      continue;
    }
    i++;
    const escaped = inner[i] ?? '';
    const simple = ESCAPES[escaped];
    if (simple !== undefined) {
      bytes.push(simple);
    } else if (/^[0-3][0-7]{2}$/.test(inner.slice(i, i + 3))) {
      bytes.push(parseInt(inner.slice(i, i + 3), 8));
      i += 2;
    } else {
      throw error(line);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function error(zeroBased: number): Error {
  return new Error(`Zeile ${String(zeroBased + 1)} gehört nicht zu einem Diff, wie Git ihn schreibt.`);
}
