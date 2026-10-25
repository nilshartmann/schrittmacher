import { headingBefore, hunksOf } from '../git/diff';
import type { DiffFile, DiffLine, DiffLineKind, Hunk, LinePart } from '../git/types';
import { highlightText, languageOf } from './highlight';
import type { CodeRange } from './highlight';

/** Eine Seite einer Zeile: Nummer, Text, die Farben des Codes und die Teile, die sich ändern. */
export interface SideLine {
  number: number;
  text: string;
  kind: DiffLineKind;
  ranges: CodeRange[];
  parts: LinePart[];
}

/** Eine Zeile der Ansicht. Eine Seite ohne Zeile ist `null` und bleibt leer. */
export interface LineRow {
  type: 'line';
  old: SideLine | null;
  new: SideLine | null;
  /** Untereinander ohne entfernte Zeilen: so viele entfernte Zeilen standen direkt davor. */
  removedBefore?: number;
}

/**
 * Ein Trenner für ausgelassene Zeilen zwischen zwei Abschnitten. Aufgeklappt stehen die Zeilen
 * direkt unter ihm, und er klappt sie wieder ein.
 */
export interface GapRow {
  type: 'gap';
  /** Die Stelle der ersten ausgelassenen Zeile in allen Zeilen der Datei; sie nennt den Trenner. */
  start: number;
  skipped: number;
  /** Die Zeile, die Git als Überschrift des folgenden Abschnitts nimmt; keine am Ende der Datei. */
  heading: string | null;
  expanded: boolean;
}

export type Row = LineRow | GapRow;

/** Die hervorgehobenen Bereiche jeder Zeile einer Fassung, nach Zeilennummer ab 1. */
interface SideRanges {
  old: CodeRange[][];
  new: CodeRange[][];
}

/** Beide Fassungen werden als Ganzes geparst, damit ein Javadoc über mehrere Zeilen stimmt. */
export function rangesOf(file: DiffFile): SideRanges {
  const language = languageOf(file.path, file.newText || file.oldText);
  if (language === null) {
    return { old: [], new: [] };
  }
  return { old: highlightText(language, file.oldText), new: highlightText(language, file.newText) };
}

function side(line: DiffLine, number: number, ranges: CodeRange[][]): SideLine {
  return {
    number,
    text: line.text,
    kind: line.kind,
    ranges: ranges[number - 1] ?? [],
    parts: line.parts,
  };
}

/** Wie viel der Datei zu sehen ist: so viele Zeilen um jede Änderung, oder die ganze Datei. */
export type Extent = number | 'whole';

/**
 * Die Abschnitte für den Umfang, jeder mit einem Trenner davor, wenn Zeilen ausgelassen sind, und
 * mit seiner Überschrift wie bei Git; dazu die Zahl der ausgelassenen Zeilen am Ende der Datei.
 */
function sectionsOf(
  file: DiffFile,
  extent: Extent,
): { hunks: (Hunk & { heading: string | null; gapStart: number })[]; skippedAfter: number; afterStart: number } {
  let start = 0;
  const hunks = hunksOf(file.whole, extent === 'whole' ? Infinity : extent).map((hunk) => {
    const gapStart = start;
    start += hunk.skippedBefore;
    const heading = headingBefore(file.whole, start);
    start += hunk.lines.length;
    return { ...hunk, heading, gapStart };
  });
  return { hunks, skippedAfter: hunks.length === 0 ? 0 : file.whole.length - start, afterStart: start };
}

/**
 * Der Trenner für ausgelassene Zeilen und, wenn er aufgeklappt ist, die Zeilen selbst. Sie sind
 * alle unverändert; nebeneinander stehen sie auf beiden Seiten, untereinander nur einmal.
 */
function gapRows(
  file: DiffFile,
  ranges: SideRanges,
  gap: { start: number; skipped: number; heading: string | null },
  expanded: ReadonlySet<number>,
  unified: boolean,
): Row[] {
  const open = expanded.has(gap.start);
  const rows: Row[] = [{ type: 'gap', ...gap, expanded: open }];
  if (open) {
    for (const line of file.whole.slice(gap.start, gap.start + gap.skipped)) {
      if (line.oldNumber !== null && line.newNumber !== null) {
        const after = side(line, line.newNumber, ranges.new);
        rows.push({ type: 'line', old: unified ? null : side(line, line.oldNumber, ranges.old), new: after });
      }
    }
  }
  return rows;
}

/**
 * Die Abschnitte als Zeilen nebeneinander, wie `splitRows` in agent-lab: eine unveränderte Zeile
 * steht auf beiden Seiten, entfernte und hinzugefügte Zeilen eines Blocks stehen paarweise. Vor
 * jedem Abschnitt steht ein Trenner, wenn Zeilen ausgelassen sind.
 */
export function splitRows(
  file: DiffFile,
  ranges: SideRanges,
  extent: Extent,
  expanded: ReadonlySet<number>,
): Row[] {
  const { hunks, skippedAfter, afterStart } = sectionsOf(file, extent);
  const rows: Row[] = [];
  let removed: SideLine[] = [];
  let added: SideLine[] = [];
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      rows.push({ type: 'line', old: removed[index] ?? null, new: added[index] ?? null });
    }
    removed = [];
    added = [];
  };
  for (const hunk of hunks) {
    if (hunk.skippedBefore > 0) {
      const gap = { start: hunk.gapStart, skipped: hunk.skippedBefore, heading: hunk.heading };
      rows.push(...gapRows(file, ranges, gap, expanded, false));
    }
    for (const line of hunk.lines) {
      if (line.kind === 'context' && line.oldNumber !== null && line.newNumber !== null) {
        flush();
        rows.push({
          type: 'line',
          old: side(line, line.oldNumber, ranges.old),
          new: side(line, line.newNumber, ranges.new),
        });
      } else if (line.kind === 'removed' && line.oldNumber !== null) {
        if (added.length > 0) {
          flush();
        }
        removed.push(side(line, line.oldNumber, ranges.old));
      } else if (line.newNumber !== null) {
        added.push(side(line, line.newNumber, ranges.new));
      }
    }
    flush();
  }
  if (skippedAfter > 0) {
    rows.push(...gapRows(file, ranges, { start: afterStart, skipped: skippedAfter, heading: null }, expanded, false));
  }
  return rows;
}

/**
 * Die Zeilen untereinander wie in Fork ohne Side-by-Side: jede Zeile einmal, entfernte mit ihrer
 * alten Nummer und rot, hinzugefügte mit ihrer neuen Nummer und grün. Alle stehen in der Spalte
 * `new` der Zeile. Ohne `showRemoved` fallen die entfernten Zeilen weg und werden an der Zeile
 * danach gezählt; so lässt sich die neue Fassung am Stück kopieren.
 */
export function unifiedRows(
  file: DiffFile,
  ranges: SideRanges,
  extent: Extent,
  expanded: ReadonlySet<number>,
  showRemoved: boolean,
): Row[] {
  const { hunks, skippedAfter, afterStart } = sectionsOf(file, extent);
  const rows: Row[] = [];
  for (const hunk of hunks) {
    if (hunk.skippedBefore > 0) {
      const gap = { start: hunk.gapStart, skipped: hunk.skippedBefore, heading: hunk.heading };
      rows.push(...gapRows(file, ranges, gap, expanded, true));
    }
    let removed = 0;
    for (const line of hunk.lines) {
      if (line.kind === 'removed' && !showRemoved) {
        removed++;
        continue;
      }
      const shown =
        line.kind === 'removed' && line.oldNumber !== null
          ? side(line, line.oldNumber, ranges.old)
          : line.newNumber !== null
            ? side(line, line.newNumber, ranges.new)
            : null;
      if (shown !== null) {
        rows.push({ type: 'line', old: null, new: shown, removedBefore: removed });
        removed = 0;
      }
    }
  }
  if (skippedAfter > 0) {
    rows.push(...gapRows(file, ranges, { start: afterStart, skipped: skippedAfter, heading: null }, expanded, true));
  }
  return rows;
}

