/**
 * Markierungen im Text des Editors, etwa für Platzhalter, an die noch einmal heranzugehen ist
 * (`docs/editor.md`). Sie liegen außerhalb der Datei und werden beim Öffnen über ihren Text
 * wiedergefunden. Die Datei importiert nichts aus React oder CodeMirror, weil auch der Server sie nutzt.
 */

/** Ein markierter Bereich im Text, als Positionen von Zeichen. */
export interface Highlight {
  from: number;
  to: number;
}

/** Eine gespeicherte Markierung: ihr Text, ein Stück Text davor und danach und ihre letzte Position. */
export interface HighlightAnchor {
  text: string;
  before: string;
  after: string;
  from: number;
}

/** So viele Zeichen vor und nach einer Markierung helfen beim Wiederfinden. */
const CONTEXT = 32;

/** Ob ein Wert aus der gespeicherten Datei eine Markierung ist. */
export function isHighlightAnchor(value: unknown): value is HighlightAnchor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const anchor = value as Record<string, unknown>;
  return (
    typeof anchor.text === 'string' &&
    anchor.text !== '' &&
    typeof anchor.before === 'string' &&
    typeof anchor.after === 'string' &&
    typeof anchor.from === 'number'
  );
}

/** Sortiert die Bereiche und fasst sich überlappende oder berührende zusammen; leere fallen weg. */
export function normalized(highlights: readonly Highlight[]): Highlight[] {
  const sorted = highlights.filter((range) => range.to > range.from).sort((a, b) => a.from - b.from);
  const merged: Highlight[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Die Bereiche ohne den Teil zwischen `from` und `to`; ein Bereich darüber hinaus wird geteilt. */
export function without(highlights: readonly Highlight[], from: number, to: number): Highlight[] {
  return highlights.flatMap((range) => {
    if (range.to <= from || range.from >= to) {
      return [range];
    }
    return [
      { from: range.from, to: from },
      { from: to, to: range.to },
    ].filter((part) => part.to > part.from);
  });
}

/** Die Markierungen zum Speichern, mit dem Text, den sie im Dokument haben. */
export function anchorsOf(text: string, highlights: readonly Highlight[]): HighlightAnchor[] {
  return highlights.map((range) => ({
    text: text.slice(range.from, range.to),
    before: text.slice(Math.max(0, range.from - CONTEXT), range.from),
    after: text.slice(range.to, range.to + CONTEXT),
    from: range.from,
  }));
}

/** Wie viele Zeichen vom Ende von `a` und `b` übereinstimmen. */
function commonSuffix(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) {
    count++;
  }
  return count;
}

/** Wie viele Zeichen vom Anfang von `a` und `b` übereinstimmen. */
function commonPrefix(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) {
    count++;
  }
  return count;
}

/**
 * Findet die gespeicherten Markierungen im Text wieder. Unter mehreren Stellen mit demselben Text
 * gilt die, deren Umgebung am meisten übereinstimmt, bei Gleichstand die nächste zur alten Position.
 * Was sich nicht mehr finden lässt, kommt unter `lost` zurück.
 */
export function resolveAnchors(
  text: string,
  anchors: readonly HighlightAnchor[],
): { found: Highlight[]; lost: HighlightAnchor[] } {
  const found: Highlight[] = [];
  const lost: HighlightAnchor[] = [];
  for (const anchor of anchors) {
    let best: { from: number; score: number; distance: number } | null = null;
    for (let index = text.indexOf(anchor.text); index !== -1; index = text.indexOf(anchor.text, index + 1)) {
      const score =
        commonSuffix(text.slice(Math.max(0, index - CONTEXT), index), anchor.before) +
        commonPrefix(text.slice(index + anchor.text.length, index + anchor.text.length + CONTEXT), anchor.after);
      const distance = Math.abs(index - anchor.from);
      if (best === null || score > best.score || (score === best.score && distance < best.distance)) {
        best = { from: index, score, distance };
      }
    }
    if (best === null) {
      lost.push(anchor);
    } else {
      found.push({ from: best.from, to: best.from + anchor.text.length });
    }
  }
  return { found: normalized(found), lost };
}
