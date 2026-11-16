/**
 * Der Abgleich zwischen einer Zeile im Text und einer Höhe in der Vorschau. Die Blöcke der Vorschau
 * nennen ihre erste Zeile in der Datei (`data-ref-from`); zwischen zwei Blöcken wird gleichmäßig
 * verteilt, damit das Mitscrollen nicht springt.
 */

/** Ein Block der Vorschau: seine erste Zeile in der Datei und seine Höhe im Inhalt der Vorschau. */
export interface Anchor {
  line: number;
  top: number;
}

/**
 * Die Blöcke der Vorschau nach Zeilen geordnet. Behalten wird nur, was weiter unten steht als der
 * Block davor, damit Zeile und Höhe in dieselbe Richtung wachsen.
 */
export function anchorsOf(container: HTMLElement): Anchor[] {
  const box = container.getBoundingClientRect();
  const found: Anchor[] = [];
  for (const element of container.querySelectorAll<HTMLElement>('[data-ref-from]')) {
    const line = Number(element.dataset.refFrom);
    const top = element.getBoundingClientRect().top - box.top + container.scrollTop;
    if (Number.isFinite(line)) {
      found.push({ line, top });
    }
  }
  found.sort((a, b) => a.line - b.line || a.top - b.top);
  const anchors: Anchor[] = [{ line: 1, top: 0 }];
  for (const anchor of found) {
    const last = anchors[anchors.length - 1];
    if (last !== undefined && anchor.line > last.line && anchor.top >= last.top) {
      anchors.push(anchor);
    }
  }
  return anchors;
}

/**
 * Zwischen zwei Punkten gleichmäßig verteilt: zu `value` auf der einen Achse der Wert auf der
 * anderen. Hinter dem letzten Punkt gilt der letzte.
 */
function between(anchors: Anchor[], value: number, from: keyof Anchor, to: keyof Anchor): number {
  for (let index = anchors.length - 1; index >= 0; index--) {
    const current = anchors[index];
    if (current === undefined || current[from] > value) {
      continue;
    }
    const next = anchors[index + 1];
    if (next === undefined || next[from] === current[from]) {
      return current[to];
    }
    const share = (value - current[from]) / (next[from] - current[from]);
    return current[to] + share * (next[to] - current[to]);
  }
  return 0;
}

/** Die Höhe in der Vorschau zu einer Zeile im Text; Bruchteile gelten innerhalb der Zeile. */
export function topForLine(anchors: Anchor[], line: number): number {
  return between(anchors, line, 'line', 'top');
}

/** Die Zeile im Text, mit Bruchteil, zu einer Höhe in der Vorschau. */
export function lineForTop(anchors: Anchor[], top: number): number {
  return between(anchors, top, 'top', 'line');
}
