// Die Hinweise zu einer Markdown-Datei, ohne Zugriff auf Dateien, für Server und Oberfläche.

import { fenced, inlineCode, isRecord } from './notes';

/**
 * Worauf sich ein Hinweis bezieht: die ganze Datei, ein Abschnitt ab einer Überschrift, ein
 * Listenpunkt samt seinen Unterlisten, ein Absatz, ein Codeblock, ein Zitat oder eine Stelle aus
 * ganzen Blöcken. Die Zeilen zählen ab 1 in der Datei, `path` nennt die Überschriften darüber. Deckt
 * eine Markierung die Blöcke nicht ganz ab, steht ihr Text in `marked`.
 */
export interface MdScope {
  kind: 'file' | 'section' | 'item' | 'paragraph' | 'code' | 'quote' | 'place';
  path: string[];
  from: number;
  to: number;
  marked: string | null;
  source: string;
}

/** Ein Hinweis zu einer Markdown-Datei. `source` hält den Stand fest, in dem er entstand. */
export interface MdNote extends MdScope {
  id: string;
  text: string;
  /** Wann der Hinweis angelegt wurde, als ISO-Datum. */
  created: string;
}

/** Ein Hinweis, wie ihn die Oberfläche schickt; ohne `id` ist er neu. */
export type MdNoteInput = Omit<MdNote, 'id' | 'created'> & { id?: string };

/** Die Hinweise einer Datei mit der Markdown-Datei, in der sie gesammelt stehen. */
export interface MdNotes {
  notes: MdNote[];
  file: string;
  markdown: string;
}

const KIND_LABELS: Record<MdScope['kind'], string> = {
  file: 'Ganze Datei',
  section: 'Abschnitt',
  item: 'Listenpunkt',
  paragraph: 'Absatz',
  code: 'Codeblock',
  quote: 'Zitat',
  place: 'Stelle',
};

/** Die Art eines Bezugs als Wort. */
export function scopeLabel(kind: MdScope['kind']): string {
  return KIND_LABELS[kind];
}

/** Die Angabe der Zeilen, etwa „Zeilen 11–30“. */
export function scopeLines(scope: Pick<MdScope, 'from' | 'to'>): string {
  return scope.from === scope.to ? `Zeile ${String(scope.from)}` : `Zeilen ${String(scope.from)}–${String(scope.to)}`;
}

function isScope(value: Record<string, unknown>): boolean {
  return (
    typeof value.kind === 'string' &&
    value.kind in KIND_LABELS &&
    Array.isArray(value.path) &&
    value.path.every((entry) => typeof entry === 'string') &&
    typeof value.from === 'number' &&
    typeof value.to === 'number' &&
    (value.marked === null || typeof value.marked === 'string') &&
    typeof value.source === 'string'
  );
}

export function isMdNote(value: unknown): value is MdNote {
  return (
    isRecord(value) &&
    isScope(value) &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.created === 'string'
  );
}

/** Prüft einen Hinweis aus der Oberfläche und liefert nur die Felder, die dazugehören. */
export function mdNoteInputOf(data: unknown): MdNoteInput {
  const record = isRecord(data) ? data : {};
  const input = { ...record, id: 'neu', created: '' };
  if (!isMdNote(input)) {
    throw new Error('Der Hinweis ist unvollständig.');
  }
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    kind: input.kind,
    path: input.path,
    from: input.from,
    to: input.to,
    marked: input.marked,
    source: input.source,
    text: input.text,
  };
}

/** Die erste Zeile, ab der `wanted` in `lines` steht, der Zeile `near` am nächsten. */
function closestMatch(lines: string[], wanted: string[], near: number): number | null {
  let best: number | null = null;
  for (let start = 0; start + wanted.length <= lines.length; start++) {
    if (wanted.every((line, index) => lines[start + index] === line)) {
      if (best === null || Math.abs(start - near) < Math.abs(best - near)) {
        best = start;
      }
    }
  }
  return best;
}

/** Die letzte Zeile eines Abschnitts ab einer Überschrift mit `#`, ohne leere Zeilen am Ende. */
function sectionEnd(lines: string[], start: number, level: number): number {
  let fence = false;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
    } else if (!fence && (/^#+\s/.exec(line)?.[0].trim().length ?? 7) <= level) {
      end = index;
      break;
    }
  }
  while (end > start + 1 && (lines[end - 1] ?? '').trim() === '') {
    end--;
  }
  return end;
}

/** Die Ebene einer Überschrift mit `#` in einer Zeile; `null` für eine andere Zeile. */
function headingLevelOf(line: string): number | null {
  const found = /^#{1,6}(?=\s|$)/.exec(line);
  return found === null ? null : found[0].length;
}

/** Der Text einer Überschrift ohne `#` und ohne die gängigen Zeichen für Hervorhebung und Code. */
function headingTextOf(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/[*_`]/g, '')
    .trim();
}

/** Die Überschriften im Quelltext außerhalb von Codeblöcken, mit Zeile ab 1, Ebene und Text. */
function headingsIn(lines: string[]): { line: number; level: number; text: string }[] {
  const headings: { line: number; level: number; text: string }[] = [];
  let fence = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    const level = fence ? null : headingLevelOf(line);
    if (level !== null) {
      headings.push({ line: index + 1, level, text: headingTextOf(line) });
    }
  });
  return headings;
}

/** Die Überschriften, unter denen eine Zeile steht, von außen nach innen, mit ihr selbst. */
function headingPathAt(lines: string[], line: number): string[] {
  const path: { level: number; text: string }[] = [];
  for (const heading of headingsIn(lines)) {
    if (heading.line > line) {
      break;
    }
    while ((path.at(-1)?.level ?? 0) >= heading.level) {
      path.pop();
    }
    path.push(heading);
  }
  return path.map((heading) => heading.text);
}

/** Text ohne Unterschiede im Leerraum, damit sich Markierung und Zeilen vergleichen lassen. */
function squeezed(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Ob die Zeile, gezählt ab 1, eine Überschrift mit `#` außerhalb eines Codeblocks ist. */
export function isHeadingLine(text: string, line: number): boolean {
  return headingsIn(text.split('\n')).some((heading) => heading.line === line);
}

/**
 * Der Abschnitt ab der Überschrift in Zeile `line` bis vor die nächste gleicher oder höherer Ebene,
 * wie ihn der Editor aus dem Quelltext bildet; `null`, wenn dort keine Überschrift steht.
 */
export function sectionScopeAt(text: string, line: number): MdScope | null {
  const lines = text.split('\n');
  const heading = headingsIn(lines).find((entry) => entry.line === line);
  if (heading === undefined) {
    return null;
  }
  const to = sectionEnd(lines, line - 1, heading.level);
  return {
    kind: 'section',
    path: headingPathAt(lines, line),
    from: line,
    to,
    marked: null,
    source: lines.slice(line - 1, to).join('\n'),
  };
}

/**
 * Die Stelle zu einer Auswahl im Quelltext, mit `from` und `to` als Positionen von Zeichen. Sie
 * umfasst ganze Zeilen; deckt die Auswahl sie nicht ganz ab, steht der ausgewählte Teil in `marked`.
 * Endet die Auswahl am Anfang einer Zeile, etwa nach einem Dreifachklick, zählt diese Zeile nicht.
 * `null` für eine Auswahl nur aus Leerraum.
 */
export function placeScopeOf(text: string, from: number, to: number): MdScope | null {
  const selected = text.slice(from, to);
  if (selected.trim() === '') {
    return null;
  }
  const lines = text.split('\n');
  const lineAt = (position: number) => text.slice(0, position).split('\n').length;
  const first = lineAt(from);
  const end = to > from && text[to - 1] === '\n' ? to - 1 : to;
  const last = Math.max(first, lineAt(end));
  const source = lines.slice(first - 1, last).join('\n');
  const marked = squeezed(selected);
  return {
    kind: 'place',
    path: headingPathAt(lines, first),
    from: first,
    to: last,
    marked: marked === squeezed(source) ? null : marked,
    source,
  };
}

/**
 * Wo ein Bezug im aktuellen Text steht. Passt der Quelltext nicht mehr an seine Zeilen, zählt die
 * nächste Stelle mit demselben Quelltext. Ein Abschnitt wird über seine Überschrift gefunden, weil
 * sich sein Inhalt ändern darf. `null` heißt, dass die Stelle nicht mehr zu finden ist.
 */
export function locateScope(scope: MdScope, text: string): { from: number; to: number } | null {
  const lines = text.split('\n');
  if (scope.kind === 'file') {
    return { from: 1, to: lines.length };
  }
  const wanted = scope.source.split('\n');
  const near = scope.from - 1;
  if (scope.kind === 'section') {
    const heading = wanted[0] ?? '';
    const start = closestMatch(lines, [heading], near);
    if (start === null) {
      return null;
    }
    const level = /^#+\s/.exec(heading)?.[0].trim().length;
    return { from: start + 1, to: level === undefined ? start + wanted.length : sectionEnd(lines, start, level) };
  }
  const start = closestMatch(lines, wanted, near);
  return start === null ? null : { from: start + 1, to: start + wanted.length };
}

/**
 * Der Teil eines Hinweises, den Schrittmacher ergänzt: Art und Zeilen, die Überschriften darüber,
 * der Quelltext und, wenn nur ein Teil davon markiert war, dieser Teil. Bei einer ganzen Datei und
 * einem Abschnitt fehlt der Quelltext, weil Claude die Datei selbst liest.
 */
export function mdNoteHeading(scope: MdScope, located: { from: number; to: number } | null = scope): string {
  const where = scope.kind === 'file' ? '' : `, ${located === null ? `${scopeLines(scope)}, im aktuellen Stand nicht gefunden` : scopeLines(located)}`;
  const parts = [`### ${scopeLabel(scope.kind)}${where}`];
  if (scope.path.length > 0) {
    parts.push(`Unter: ${scope.path.join(' › ')}`);
  }
  if (scope.kind !== 'file' && scope.kind !== 'section') {
    parts.push(fenced(scope.source, 'datei.md'));
  }
  if (scope.marked !== null) {
    parts.push(`Markiert: ${inlineCode(scope.marked)}`);
  }
  return parts.join('\n\n');
}

/** Die Hinweise als Markdown, das sich ohne weitere Erklärung an Claude geben lässt. */
export function mdMarkdownOf(path: string, notes: MdNote[], text: string): string {
  const parts = [
    '# Hinweise zu einer Markdown-Datei',
    [
      `Die Hinweise gelten für die Datei \`${path}\`.`,
      'Zeilennummern zählen im aktuellen Stand der Datei.',
      'Der Quelltext steht jeweils dabei, damit sich die Stelle auch nach einer Änderung finden lässt.',
      'War nur ein Teil davon markiert, steht er unter „Markiert“.',
      'Steht in einem Hinweis der Pfad einer Bilddatei, ist das ein Screenshot dazu.',
    ].join('\n'),
  ];
  if (notes.length === 0) {
    parts.push('Es gibt keine Hinweise.');
  }
  const located = notes.map((note) => ({ note, where: locateScope(note, text) }));
  located.sort((a, b) => (a.where?.from ?? Infinity) - (b.where?.from ?? Infinity) || a.note.created.localeCompare(b.note.created));
  for (const { note, where } of located) {
    parts.push(mdNoteHeading(note, where), note.text.trim());
  }
  return `${parts.join('\n\n')}\n`;
}

/**
 * Die Markierung am Rand des Texts für alle Hinweise, die an derselben Zeile beginnen. Abschnitte
 * und die ganze Datei stehen in einer eigenen Spur, weil sie ineinander liegen können.
 */
export interface MdMark {
  key: string;
  lane: 'block' | 'section';
  ids: string[];
  /** Der Bezug der Gruppe, bei verschieden langen Hinweisen der längste. */
  scope: MdScope;
}

/** Die Markierungen der Hinweise, die sich im aktuellen Text finden lassen, der Reihe nach. */
export function marksOf(notes: MdNote[], text: string): MdMark[] {
  const marks = new Map<string, MdMark>();
  for (const note of notes) {
    const where = locateScope(note, text);
    if (where === null) {
      continue;
    }
    const lane = note.kind === 'section' || note.kind === 'file' ? 'section' : 'block';
    const key = `${lane}:${String(where.from)}`;
    const scope = { ...note, ...where };
    const found = marks.get(key);
    if (found === undefined) {
      marks.set(key, { key, lane, ids: [note.id], scope });
    } else {
      found.ids.push(note.id);
      if (scope.to > found.scope.to) {
        found.scope = scope;
      }
    }
  }
  return [...marks.values()].sort((a, b) => a.scope.from - b.scope.from);
}
