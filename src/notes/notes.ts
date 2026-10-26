// Die Hinweise zur Überarbeitung der Commits, ohne Zugriff auf Dateien, für Server und Oberfläche.

/**
 * Die markierten Zeilen eines Hinweises. Die Nummern zählen in der Fassung nach dem Commit, mit
 * `old` in der Fassung davor; `code` ist der Text der Zeilen. War nur ein Teil davon markiert,
 * nennt `marked` ihn als Bereich in `code`; `end` gehört nicht mehr dazu.
 */
export interface NoteLines {
  side: 'old' | 'new';
  from: number;
  to: number;
  code: string;
  marked?: { start: number; end: number };
}

/**
 * Ein Hinweis zur Überarbeitung eines Commits, zu einer Datei und, wenn welche markiert waren, zu
 * Zeilen darin. Nummer und Titel des Commits stehen dabei, damit er sich nach einem Rebase wieder
 * finden lässt.
 */
export interface Note {
  id: string;
  sha: string;
  step: string | null;
  title: string;
  path: string;
  lines: NoteLines | null;
  text: string;
  /** Wann der Hinweis angelegt wurde, als ISO-Datum. */
  created: string;
}

/** Ein Hinweis, wie ihn die Oberfläche schickt; ohne `id` ist er neu. */
export type NoteInput = Omit<Note, 'id' | 'created'> & { id?: string };

/** Die Hinweise eines Repos mit der Markdown-Datei, in der sie stehen. */
export interface Notes {
  notes: Note[];
  file: string;
  markdown: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMarked(value: unknown, code: string): value is { start: number; end: number } {
  return (
    isRecord(value) &&
    typeof value.start === 'number' &&
    typeof value.end === 'number' &&
    0 <= value.start &&
    value.start < value.end &&
    value.end <= code.length
  );
}

function isLines(value: unknown): value is NoteLines {
  return (
    isRecord(value) &&
    (value.side === 'old' || value.side === 'new') &&
    typeof value.from === 'number' &&
    typeof value.to === 'number' &&
    typeof value.code === 'string' &&
    (value.marked === undefined || isMarked(value.marked, value.code))
  );
}

export function isNote(value: unknown): value is Note {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sha === 'string' &&
    (value.step === null || typeof value.step === 'string') &&
    typeof value.title === 'string' &&
    typeof value.path === 'string' &&
    (value.lines === null || isLines(value.lines)) &&
    typeof value.text === 'string' &&
    typeof value.created === 'string'
  );
}

/** Prüft einen Hinweis aus der Oberfläche und liefert nur die Felder, die dazugehören. */
export function noteInputOf(data: unknown): NoteInput {
  const record = isRecord(data) ? data : {};
  const lines = record.lines === null || record.lines === undefined ? null : record.lines;
  const input = { ...record, id: 'neu', created: '', lines };
  if (!isNote(input)) {
    throw new Error('Der Hinweis ist unvollständig.');
  }
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    sha: input.sha,
    step: input.step,
    title: input.title,
    path: input.path,
    lines:
      input.lines === null
        ? null
        : {
            side: input.lines.side,
            from: input.lines.from,
            to: input.lines.to,
            code: input.lines.code,
            ...(input.lines.marked === undefined
              ? {}
              : { marked: { start: input.lines.marked.start, end: input.lines.marked.end } }),
          },
    text: input.text,
  };
}

/**
 * Die Reihenfolge der Commits: nach ihrer Nummer, wobei `10` hinter `9` steht, Commits ohne Nummer
 * am Ende in der Reihenfolge ihres ersten Hinweises.
 */
function compareCommits(a: Note, b: Note): number {
  if (a.step !== null && b.step !== null) {
    return a.step.localeCompare(b.step, 'de', { numeric: true }) || a.created.localeCompare(b.created);
  }
  if (a.step !== b.step) {
    return a.step === null ? 1 : -1;
  }
  return a.created.localeCompare(b.created);
}

/** Innerhalb eines Commits nach Datei, darin zuerst die Hinweise zur ganzen Datei, dann nach Zeile. */
export function compareNotes(a: Note, b: Note): number {
  if (a.path !== b.path) {
    return a.path.localeCompare(b.path);
  }
  if (a.lines === null || b.lines === null) {
    return a.lines === b.lines ? a.created.localeCompare(b.created) : a.lines === null ? -1 : 1;
  }
  if (a.lines.side !== b.lines.side) {
    return a.lines.side === 'new' ? -1 : 1;
  }
  return a.lines.from - b.lines.from || a.created.localeCompare(b.created);
}

/** Die Angabe der Zeilen, etwa „Zeile 23–27“; Zeilen der Fassung davor mit „vor dem Commit“. */
export function linesLabel(lines: NoteLines): string {
  const range = lines.from === lines.to ? `Zeile ${String(lines.from)}` : `Zeilen ${String(lines.from)}–${String(lines.to)}`;
  return lines.side === 'old' ? `${range} vor dem Commit` : range;
}

/** Die längste Folge von Backticks im Text, mindestens `least`. */
function longestTicks(text: string, least: number): number {
  return Math.max(least, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
}

/** Ein Codeblock, dessen Zaun länger ist als jede Folge von Backticks im Code. */
function fenced(code: string, path: string): string {
  const fence = '`'.repeat(longestTicks(code, 2) + 1);
  const name = path.slice(path.lastIndexOf('/') + 1);
  const language = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return `${fence}${language}\n${code}\n${fence}`;
}

/** Code im Fließtext, mit so vielen Backticks, dass keine Folge im Code ihn beendet. */
function inlineCode(code: string): string {
  const ticks = '`'.repeat(longestTicks(code, 0) + 1);
  const padding = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
  return `${ticks}${padding}${code}${padding}${ticks}`;
}

/**
 * Der Teil eines Hinweises, den Schrittmacher ergänzt: die Überschrift mit Datei und Zeilen, der
 * Code der Zeilen und, wenn nur ein Teil davon markiert war, dieser Teil. Danach folgt der Text.
 */
export function noteHeading(note: Pick<Note, 'path' | 'lines'>): string {
  const { lines } = note;
  if (lines === null) {
    return `### ${note.path}`;
  }
  const parts = [`### ${note.path}, ${linesLabel(lines)}`, fenced(lines.code, note.path)];
  if (lines.marked !== undefined) {
    const marked = lines.code.slice(lines.marked.start, lines.marked.end);
    parts.push(marked.includes('\n') ? `Markiert:\n\n${fenced(marked, note.path)}` : `Markiert: ${inlineCode(marked)}`);
  }
  return parts.join('\n\n');
}

/** Die Überschrift eines Commits im Markdown, etwa `## Commit: ba700dc 06b: Thema`. */
export function commitHeading(note: Pick<Note, 'sha' | 'step' | 'title'>): string {
  return `## Commit: ${note.sha.slice(0, 7)} ${note.step === null ? note.title : `${note.step}: ${note.title}`}`;
}

/**
 * Die Hinweise als Markdown, das sich ohne weitere Erklärung an Claude geben lässt: je Commit ein
 * Abschnitt, darin je Hinweis die Datei, die Zeilen mit dem markierten Code und der Hinweis.
 */
export function markdownOf(repoPath: string, notes: Note[]): string {
  const parts = [
    '# Hinweise zur Überarbeitung',
    [
      `Die Hinweise gelten für die Commits im Repo \`${repoPath}\`.`,
      'Setze jeden Hinweis in dem Commit um, unter dem er steht.',
      'Zeilennummern zählen in der Datei im Stand dieses Commits, „vor dem Commit“ im Stand davor.',
      'Der Code der Zeilen steht jeweils dabei, damit sich die Stelle auch nach einer Änderung finden lässt.',
      'War nur ein Teil davon markiert, steht er unter „Markiert“.',
    ].join('\n'),
  ];
  if (notes.length === 0) {
    parts.push('Es gibt keine Hinweise.');
  }
  const commits = new Map<string, Note[]>();
  for (const note of [...notes].sort(compareCommits)) {
    commits.set(note.sha, [...(commits.get(note.sha) ?? []), note]);
  }
  for (const group of commits.values()) {
    const first = group[0];
    if (first !== undefined) {
      parts.push(commitHeading(first));
    }
    for (const note of group.sort(compareNotes)) {
      parts.push(noteHeading(note), note.text.trim());
    }
  }
  return `${parts.join('\n\n')}\n`;
}

