import { useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { commitKey } from '../git/repo';
import type { Comparison } from '../git/repo';
import type { Commit, Ref } from '../git/types';

/** Die Nummer des Schritts, für einen Commit ohne Schritt der Anfang seines SHA. */
export const stepLabel = commitKey;

/**
 * Die Grenzen der Höhe des Bands in Pixeln: mindestens eine Zeile, und der Rest bleibt mindestens
 * für Dateien und Diff.
 */
export const LIST_HEIGHT = { min: 24, start: 156, restMin: 240 };

interface CommitListProps {
  commits: Commit[];
  refs: Ref[];
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
 * einklappen lässt sich das Band nicht, nur bis auf eine Zeile verkleinern.
 */
export function CommitList(props: CommitListProps) {
  const { commits, comparison, onChoose } = props;
  const toIndex = commits.findIndex((commit) => commit.sha === comparison.to);
  const fromIndex =
    comparison.from === null
      ? toIndex - 1
      : commits.findIndex((commit) => commit.sha === comparison.from);
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
            {[...commits.entries()].reverse().map(([index, commit]) => {
              const state =
                index === toIndex
                  ? 'commit-to'
                  : index === fromIndex && comparison.from !== null
                    ? 'commit-from'
                    : index > fromIndex && index < toIndex
                      ? 'commit-between'
                      : '';
              return (
                <tr
                  key={commit.sha}
                  className={`commit ${state}`}
                  aria-current={index === toIndex ? 'true' : undefined}
                  data-tip={commit.step === null ? commit.title : `${commit.step}: ${commit.title}`}
                  onClick={(event) => {
                    onClick(event, index, commit);
                  }}
                >
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
