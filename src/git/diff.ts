import type { DiffLine, Hunk } from './types';

/** Die Zeilen eines Textes. Ein leerer Text hat keine Zeile, ein Umbruch am Ende keine leere. */
export function linesOf(text: string): string[] {
  if (text === '') {
    return [];
  }
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
}

/**
 * Die Zeilen beider Texte als Diff, über die längste gemeinsame Teilfolge. Ein Block entfernter
 * Zeilen steht vor den hinzugefügten. Für die kleinen Dateien des Dummys reicht die Tabelle mit
 * n × m Feldern; der spätere Server übernimmt das von `git diff`.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const before = linesOf(oldText);
  const after = linesOf(newText);
  const width = after.length + 1;
  // common[i * width + j]: Länge der gemeinsamen Teilfolge von before[i..] und after[j..]
  const common = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      common[i * width + j] =
        before[i] === after[j]
          ? (common[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * width + j] ?? 0, common[i * width + j + 1] ?? 0);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      lines.push({ kind: 'context', oldNumber: i + 1, newNumber: j + 1, text: before[i] ?? '', parts: [] });
      i++;
      j++;
    } else if (
      j >= after.length ||
      (i < before.length &&
        (common[(i + 1) * width + j] ?? 0) >= (common[i * width + j + 1] ?? 0))
    ) {
      lines.push({ kind: 'removed', oldNumber: i + 1, newNumber: null, text: before[i] ?? '', parts: [] });
      i++;
    } else {
      lines.push({ kind: 'added', oldNumber: null, newNumber: j + 1, text: after[j] ?? '', parts: [] });
      j++;
    }
  }
  return lines;
}

/**
 * Die Abschnitte um die Änderungen, mit `context` unveränderten Zeilen davor und danach. Wie in Fork
 * wird nie eine einzelne Zeile ausgelassen, weil ihr Trenner so viel Platz bräuchte wie sie selbst.
 */
export function hunksOf(whole: DiffLine[], context = 3): Hunk[] {
  const keep = whole.map(() => false);
  whole.forEach((line, index) => {
    if (line.kind !== 'context') {
      const from = Math.max(0, index - context);
      const to = Math.min(whole.length - 1, index + context);
      for (let at = from; at <= to; at++) {
        keep[at] = true;
      }
    }
  });
  if (keep.includes(true)) {
    keep.forEach((kept, index) => {
      if (!kept && keep[index - 1] !== false && keep[index + 1] !== false) {
        keep[index] = true;
      }
    });
  }
  const hunks: Hunk[] = [];
  let skipped = 0;
  let current: Hunk | null = null;
  whole.forEach((line, index) => {
    if (keep[index] === true) {
      if (current === null) {
        current = { skippedBefore: skipped, lines: [] };
        hunks.push(current);
        skipped = 0;
      }
      current.lines.push(line);
    } else {
      current = null;
      skipped++;
    }
  });
  return hunks;
}

/** Eine Zeile, die Git ohne eigenen Diff-Treiber als Überschrift eines Abschnitts nimmt. */
const HEADING = /^[A-Za-z_$]/;

/** Git kürzt die Überschrift auf diese Länge. */
const HEADING_LENGTH = 80;

/**
 * Die Überschrift des Abschnitts, der bei `index` beginnt, wie Git sie hinter `@@ … @@` schreibt:
 * die nächste Zeile der alten Fassung davor, die ganz links mit einem Buchstaben, `_` oder `$`
 * beginnt. In Java ist das meist die Klasse oder die Methode. Ohne eine solche Zeile gibt es keine.
 */
export function headingBefore(whole: DiffLine[], index: number): string | null {
  for (let at = index - 1; at >= 0; at--) {
    const line = whole[at];
    if (line !== undefined && line.kind !== 'added' && HEADING.test(line.text)) {
      return line.text.trimEnd().slice(0, HEADING_LENGTH);
    }
  }
  return null;
}
