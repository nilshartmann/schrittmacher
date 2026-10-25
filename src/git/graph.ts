import type { Commit } from './types';

/**
 * Eine Linie in einer Zeile des Graphen. Die Spalten zählen von links, die Höhe läuft von 0 (oben)
 * über 0.5 (Mitte, der Punkt des Commits) bis 1 (unten).
 */
export interface GraphLine {
  fromColumn: number;
  fromY: 0 | 0.5;
  toColumn: number;
  toY: 0.5 | 1;
  /** Die Spalte, deren Farbe die Linie hat. */
  lane: number;
}

/** Eine Zeile des Graphen: die Spalte des Commits und die Linien durch die Zeile. */
export interface GraphRow {
  column: number;
  lines: GraphLine[];
}

export interface Graph {
  /** Die Zeilen in der Reihenfolge der Commits, die übergeben wurden. */
  rows: GraphRow[];
  /** So viele Spalten braucht der breiteste Teil des Graphen. */
  columns: number;
}

/**
 * Der Graph wie in Fork, für Commits mit dem neuesten zuerst und jedem Commit vor seinen
 * Vorgängern. Jede Spalte wartet auf einen Commit. Ein Commit nimmt die Spalte, die auf ihn
 * wartet, und gibt sie an seinen ersten Parent weiter; jeder weitere Parent bekommt eine eigene.
 * Warten mehrere Spalten auf denselben Commit, laufen sie bei ihm zusammen. Eine Spalte, die frei
 * wird, nimmt der nächste neue Branch. Die erste Spalte wartet von Anfang an auf `first`, damit
 * der gewählte Branch links steht.
 */
export function graphOf(newestFirst: Commit[], first: string): Graph {
  const lanes: (string | null)[] = [first];
  // Bis zum Commit `first` ist die erste Spalte nur freigehalten und hat noch keine Linie.
  let reserved = true;
  let columns = 0;
  const rows = newestFirst.map((commit): GraphRow => {
    const before = [...lanes];
    let column = lanes.indexOf(commit.sha);
    if (column === -1) {
      column = free(lanes);
    }
    const lines: GraphLine[] = [];
    before.forEach((sha, lane) => {
      if (sha === commit.sha && !(reserved && lane === 0)) {
        lines.push({ fromColumn: lane, fromY: 0, toColumn: column, toY: 0.5, lane });
        lanes[lane] = null;
      }
    });
    const [parent, ...others] = commit.parents;
    lanes[column] = parent ?? null;
    if (parent !== undefined) {
      lines.push({ fromColumn: column, fromY: 0.5, toColumn: column, toY: 1, lane: column });
    }
    for (const other of others) {
      const waiting = lanes.indexOf(other);
      const lane = waiting === -1 ? free(lanes) : waiting;
      lanes[lane] = other;
      lines.push({ fromColumn: column, fromY: 0.5, toColumn: lane, toY: 1, lane });
    }
    if (commit.sha === first) {
      reserved = false;
    }
    before.forEach((sha, lane) => {
      if (sha !== null && sha !== commit.sha && !(reserved && lane === 0)) {
        lines.push({ fromColumn: lane, fromY: 0, toColumn: lane, toY: 1, lane });
      }
    });
    while (lanes.length > 0 && lanes.at(-1) === null) {
      lanes.pop();
    }
    columns = Math.max(columns, column + 1, lanes.length);
    return { column, lines };
  });
  return { rows, columns };
}

/** Die erste freie Spalte; ohne freie eine neue rechts. */
function free(lanes: (string | null)[]): number {
  const index = lanes.indexOf(null);
  if (index !== -1) {
    return index;
  }
  lanes.push(null);
  return lanes.length - 1;
}
