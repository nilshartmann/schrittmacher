import { useEffect, useMemo, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import type { Graph, GraphRow } from '../git/graph';
import { reachable } from '../git/repo';
import type { Comparison } from '../git/repo';
import type { Commit, Ref } from '../git/types';

/** Die Nummer des Schritts, für einen Commit ohne Schritt der Anfang seines SHA. */
export function stepLabel(commit: Commit): string {
  return commit.step ?? commit.sha.slice(0, 7);
}

/** Die Breite einer Spalte des Graphen und die Höhe einer Zeile in Pixeln. */
const LANE = 14;
const ROW = 22;

/** Die Farben der Spalten des Graphen, der Reihe nach wie in Fork. */
const LANE_COLORS = ['#2f7cf6', '#af52de', '#34a853', '#f5a623', '#e5484d', '#14b8c4'];

/**
 * Die Grenzen der Höhe des Bands in Pixeln: mindestens eine Zeile, und der Rest bleibt mindestens
 * für Dateien und Diff.
 */
export const LIST_HEIGHT = { min: 24, start: 156, restMin: 240 };

interface CommitListProps {
  commits: Commit[];
  refs: Ref[];
  /** Der Graph, wenn die Liste die Commits aller Branches zeigt; die Zeilen der neueste zuerst. */
  graph: Graph | null;
  /** Die SHAs der Commits des Branches; die anderen stehen im Graphen blasser da. */
  line: ReadonlySet<string>;
  /** Der Branch, dessen Commits die Liste zeigt; sein Badge ist hervorgehoben. */
  branch: string | null;
  /** Ein Klick auf einen Badge zeigt die Commits dieses Branches. */
  onBranch: (name: string) => void;
  comparison: Comparison;
  onChoose: (comparison: Comparison) => void;
  height: number;
  onHeight: (height: number) => void;
}

/**
 * Die Commits als Band über Dateien und Diff, wie in Fork der neueste oben. Das Band
 * scrollt in beide Richtungen, eine Trennlinie darunter ändert seine Höhe. Ein Klick vergleicht
 * einen Commit mit seinem Vorgänger, ein ⇧-Klick den gewählten mit dem geklickten. Ganz
 * einklappen lässt sich das Band nicht, nur bis auf eine Zeile verkleinern. Mit allen Branches
 * steht links der Graph, und Commits anderer Branches sind blasser.
 */
export function CommitList(props: CommitListProps) {
  const { commits, comparison, onChoose } = props;
  const toIndex = commits.findIndex((commit) => commit.sha === comparison.to);
  const fromSha = comparison.from ?? commits[toIndex]?.parents[0] ?? null;
  // Zwischen zwei gewählten Commits liegt, was `to` erreicht und `from` nicht.
  const between = useMemo(() => {
    if (comparison.from === null) {
      return new Set<string>();
    }
    const older = reachable(commits, comparison.from);
    return new Set([...reachable(commits, comparison.to)].filter((sha) => !older.has(sha)));
  }, [commits, comparison.from, comparison.to]);
  const band = useRef<HTMLElement>(null);

  // Der gewählte Commit bleibt im Band sichtbar, auch wenn das Band kleiner geschoben wird.
  useEffect(() => {
    band.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [comparison.to, props.height]);

  const onClick = (event: MouseEvent, index: number, commit: Commit) => {
    if (event.shiftKey && index !== toIndex) {
      const older = commits[Math.min(index, toIndex)];
      const newer = commits[Math.max(index, toIndex)];
      if (older !== undefined && newer !== undefined) {
        onChoose({ from: older.sha, to: newer.sha });
      }
      return;
    }
    onChoose({ from: null, to: commit.sha });
  };

  return (
    <>
      <nav ref={band} className="commit-band" aria-label="Commits" style={{ height: props.height }}>
        <div className="commit-scroll">
        <table className="commit-table">
          <tbody>
            {/* Die Indizes bleiben die der Historie, nur die Anzeige ist umgedreht. */}
            {[...commits.entries()].reverse().map(([index, commit], row) => {
              const state =
                index === toIndex
                  ? 'commit-to'
                  : commit.sha === fromSha && comparison.from !== null
                    ? 'commit-from'
                    : between.has(commit.sha)
                      ? 'commit-between'
                      : '';
              const other = props.graph !== null && !props.line.has(commit.sha) ? ' commit-other' : '';
              const graphRow = props.graph?.rows[row];
              return (
                <tr
                  key={commit.sha}
                  className={`commit ${state}${other}`}
                  aria-current={index === toIndex ? 'true' : undefined}
                  data-tip={commit.step === null ? commit.title : `${commit.step}: ${commit.title}`}
                  onClick={(event) => {
                    onClick(event, index, commit);
                  }}
                >
                  {props.graph !== null && graphRow !== undefined && (
                    <td className="commit-graph">
                      <GraphCell row={graphRow} columns={props.graph.columns} />
                    </td>
                  )}
                  <td className="commit-step">{commit.step ?? ''}</td>
                  <td className="commit-title">
                    {commit.title}
                    <RefBadges
                      refs={props.refs.filter((ref) => ref.sha === commit.sha)}
                      branch={props.branch}
                      onBranch={props.onBranch}
                    />
                  </td>
                  <td className="commit-meta">{commit.author}</td>
                  <td className="commit-meta commit-sha">{commit.sha.slice(0, 7)}</td>
                  <td className="commit-meta">{commit.date}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </nav>
      <HeightSplitter height={props.height} onHeight={props.onHeight} />
    </>
  );
}

/** Die Linien einer Zeile des Graphen und der Punkt des Commits. */
function GraphCell({ row, columns }: { row: GraphRow; columns: number }) {
  const x = (column: number) => (column + 0.5) * LANE;
  const color = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];
  return (
    <svg className="graph" width={columns * LANE} height={ROW} aria-hidden="true">
      {row.lines.map((line, index) => {
        // Oben und unten ragt die Linie ein Pixel über die Zeile, damit sie ohne Lücke weiterläuft.
        const y = (at: number) => (at === 0 ? -1 : at === 1 ? ROW + 1 : at * ROW);
        const [x1, y1, x2, y2] = [x(line.fromColumn), y(line.fromY), x(line.toColumn), y(line.toY)];
        const middle = (y1 + y2) / 2;
        return (
          <path
            key={index}
            d={`M${String(x1)} ${String(y1)}C${String(x1)} ${String(middle)} ${String(x2)} ${String(middle)} ${String(x2)} ${String(y2)}`}
            fill="none"
            stroke={color(line.lane)}
            strokeWidth="2"
          />
        );
      })}
      <circle cx={x(row.column)} cy={ROW / 2} r="4" fill={color(row.column)} stroke="var(--surface)" strokeWidth="1.5" />
    </svg>
  );
}

/** Die Trennlinie unter dem Band. Ziehen ändert die Höhe, ein Doppelklick stellt sie zurück. */
function HeightSplitter({ height, onHeight }: { height: number; onHeight: (height: number) => void }) {
  const drag = useRef<{ y: number; height: number } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, height };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) {
      return;
    }
    const app = event.currentTarget.closest('.app');
    const header = app?.querySelector('.header')?.getBoundingClientRect().height ?? 0;
    const max = (app?.clientHeight ?? 0) - header - LIST_HEIGHT.restMin;
    const next = drag.current.height + event.clientY - drag.current.y;
    onHeight(Math.round(Math.max(LIST_HEIGHT.min, Math.min(max, next))));
  };
  const onPointerEnd = () => {
    drag.current = null;
  };
  return (
    <div
      className="height-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Höhe der Commit-Liste"
      data-tip="Ziehen ändert die Höhe, Doppelklick stellt sie zurück"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => {
        onHeight(LIST_HEIGHT.start);
      }}
    />
  );
}

/**
 * Die Branches eines Commits als Badges rechts in der Spalte des Titels. Ist der Titel lang,
 * überdecken sie sein Ende.
 */
function RefBadges({
  refs,
  branch,
  onBranch,
}: {
  refs: Ref[];
  branch: string | null;
  onBranch: (name: string) => void;
}) {
  if (refs.length === 0) {
    return null;
  }
  return (
    <span className="refs">
      {refs.map((ref) => (
        <RefBadge key={ref.name} branchRef={ref} current={ref.name === branch} onBranch={onBranch} />
      ))}
    </span>
  );
}

/**
 * Ein Branch als Badge, wie in Fork: lokal mit ⑂, auf einem Remote mit ☁. Ein Klick zeigt seine
 * Commits, ohne den Commit der Zeile zu wählen.
 */
function RefBadge({
  branchRef,
  current,
  onBranch,
}: {
  branchRef: Ref;
  current: boolean;
  onBranch: (name: string) => void;
}) {
  return (
    <button
      type="button"
      className={`ref ref-${branchRef.kind}${current ? ' ref-current' : ''}`}
      data-tip={current ? 'Die Liste zeigt diesen Branch' : `Commits von ${branchRef.name} zeigen`}
      onClick={(event) => {
        event.stopPropagation();
        if (!current) {
          onBranch(branchRef.name);
        }
      }}
    >
      <span className="ref-sign" aria-hidden="true">
        {branchRef.kind === 'local' ? '⑂' : '☁'}
      </span>
      {branchRef.name}
    </button>
  );
}
