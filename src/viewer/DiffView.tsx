import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent, RefObject } from 'react';
import { chunksOf } from '../diff/highlight';
import type { Row, SideLine } from '../diff/rows';
import type { Layout } from './Header';

const SHARE = { min: 0.15, max: 0.85 };

interface DiffViewProps {
  rows: Row[];
  layout: Layout;
  onShare: (share: number) => void;
  /** Ob lange Zeilen umbrechen; ohne Umbruch scrollt jede Seite für sich zur Seite. */
  wrap: boolean;
  /** Klappt die Zeilen eines Trenners auf oder wieder ein; der Trenner heißt nach seiner ersten Zeile. */
  onToggleGap: (start: number) => void;
}

/**
 * Der Diff einer Datei. Nebeneinander steht jede Seite in einer eigenen Spalte, die wie in Fork
 * für sich zur Seite scrollt; nach oben und unten scrollen beide gemeinsam. Mit Umbruch bekommen
 * die Zeilen beider Seiten dieselbe Höhe. Zwischen den Spalten steht eine Trennlinie zum
 * Verschieben, ein Doppelklick stellt 50/50 her. Untereinander stehen alle Zeilen in einer Spalte.
 */
export function DiffView({ rows, layout, onShare, wrap, onToggleGap }: DiffViewProps) {
  const diff = useRef<HTMLDivElement>(null);
  const oldPane = useRef<HTMLDivElement>(null);
  const newPane = useRef<HTMLDivElement>(null);
  const split = layout.mode === 'split';

  useEvenRows(oldPane, newPane, split && wrap, rows);
  useSyncedScroll(oldPane, newPane, split);

  const digits = String(
    rows.reduce((max, row) => (row.type === 'line' ? Math.max(max, row.old?.number ?? 0, row.new?.number ?? 0) : max), 0),
  ).length;
  const style = {
    '--share': split ? String(layout.share) : '0',
    '--number-width': `${String(Math.max(2, digits))}ch`,
  } as CSSProperties;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = diff.current?.getBoundingClientRect();
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || box === undefined) {
      return;
    }
    const share = (event.clientX - box.left) / box.width;
    onShare(Math.min(SHARE.max, Math.max(SHARE.min, share)));
  };

  return (
    <div ref={diff} className={wrap ? 'diff diff-wrap' : 'diff'} style={style}>
      {split && (
        <>
          <div ref={oldPane} className="pane pane-old">
            <Lines rows={rows} side="old" onToggleGap={onToggleGap} />
          </div>
          <div
            className="divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Trennlinie zwischen vorher und nachher"
            data-tip="Ziehen verschiebt, Doppelklick stellt 50/50 her"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onDoubleClick={() => {
              onShare(0.5);
            }}
          />
        </>
      )}
      <div ref={newPane} className="pane pane-new">
        <Lines rows={rows} side="new" onToggleGap={onToggleGap} />
      </div>
    </div>
  );
}

/**
 * Die Zeilen einer Seite. Ein Trenner für ausgelassene Zeilen steht auf beiden Seiten; ein Klick
 * auf ⋯ klappt die Zeilen auf oder wieder ein, seine Überschrift lässt sich markieren.
 */
function Lines({
  rows,
  side,
  onToggleGap,
}: {
  rows: Row[];
  side: 'old' | 'new';
  onToggleGap: (start: number) => void;
}) {
  return (
    <div className="pane-lines">
      {rows.map((row, index) => {
        if (row.type === 'gap') {
          return (
            <div key={index} className={row.expanded ? 'gap gap-expanded' : 'gap'}>
              <button
                type="button"
                className="gap-toggle"
                data-tip={row.expanded ? 'Zeilen wieder einklappen' : 'Ausgelassene Zeilen zeigen'}
                onClick={() => {
                  onToggleGap(row.start);
                }}
              >
                {row.expanded ? '⌃' : '⋯'}
                {side === 'new' && ` ${String(row.skipped)} ${row.skipped === 1 ? 'Zeile' : 'Zeilen'}`}
              </button>
              {row.heading !== null && <span className="gap-heading">{row.heading}</span>}
            </div>
          );
        }
        return <Line key={index} line={row[side]} removedBefore={row.removedBefore ?? 0} />;
      })}
    </div>
  );
}

function Line({ line, removedBefore }: { line: SideLine | null; removedBefore: number }) {
  if (line === null) {
    return <div className="line line-empty" />;
  }
  return (
    <div
      className={`line line-${line.kind}${removedBefore > 0 ? ' line-removed-before' : ''}`}
      data-tip={
        removedBefore > 0
          ? `${String(removedBefore)} ${removedBefore === 1 ? 'Zeile' : 'Zeilen'} davor entfernt`
          : undefined
      }
    >
      <span className="number">{line.number}</span>
      <span className="text">
        <LineText line={line} />
      </span>
    </div>
  );
}

/**
 * Der Text einer Zeile mit den Farben des Codes. Jeder Teil, der sich von der Partnerzeile
 * unterscheidet, steht ganz in einem eigenen Element und ist kräftiger hinterlegt.
 */
function LineText({ line }: { line: SideLine }) {
  const { text, ranges, parts } = line;
  if (text === '') {
    return '​';
  }
  return chunksOf(text, parts, ranges).map((chunk, chunkIndex) => {
    const pieces = chunk.pieces.map((piece, index) =>
      piece.kind === null ? (
        piece.text
      ) : (
        <span key={index} className={`code-${piece.kind}`}>
          {piece.text}
        </span>
      ),
    );
    return chunk.part ? (
      <span key={chunkIndex} className="part">
        {pieces}
      </span>
    ) : (
      <Fragment key={chunkIndex}>{pieces}</Fragment>
    );
  });
}

/**
 * Gibt den Zeilen beider Seiten dieselbe Höhe, solange `active` gilt: die Höhe der höheren Zeile.
 * Gemessen wird neu, wenn sich die Breite einer Spalte oder die Schriftgröße ändert.
 */
function useEvenRows(
  oldPane: RefObject<HTMLDivElement | null>,
  newPane: RefObject<HTMLDivElement | null>,
  active: boolean,
  rows: Row[],
) {
  useLayoutEffect(() => {
    const left = oldPane.current?.firstElementChild;
    const right = newPane.current?.firstElementChild;
    const reset = (lines: Element | null | undefined) => {
      for (const element of lines?.children ?? []) {
        (element as HTMLElement).style.minHeight = '';
      }
    };
    if (!active || left == null || right == null) {
      reset(left);
      reset(right);
      return;
    }
    const even = () => {
      reset(left);
      reset(right);
      const pairs = [...left.children].map((element, index) => [element, right.children[index]] as const);
      const heights = pairs.map(([a, b]) =>
        Math.max(a.getBoundingClientRect().height, b?.getBoundingClientRect().height ?? 0),
      );
      pairs.forEach(([a, b], index) => {
        const height = `${String(heights[index] ?? 0)}px`;
        (a as HTMLElement).style.minHeight = height;
        if (b instanceof HTMLElement) {
          b.style.minHeight = height;
        }
      });
    };
    even();
    let width = { left: left.clientWidth, right: right.clientWidth };
    const observer = new ResizeObserver(() => {
      // Nur eine neue Breite verlangt neue Höhen; die eigenen Höhen lösen das Messen nicht aus.
      if (left.clientWidth !== width.left || right.clientWidth !== width.right) {
        width = { left: left.clientWidth, right: right.clientWidth };
        even();
      }
    });
    observer.observe(left);
    observer.observe(right);
    // Die Schriftgröße ändert die Breite nicht, wohl aber den Umbruch.
    const fonts = new MutationObserver(even);
    const app = left.closest('.app');
    if (app !== null) {
      fonts.observe(app, { attributes: true, attributeFilter: ['style'] });
    }
    return () => {
      observer.disconnect();
      fonts.disconnect();
    };
  }, [oldPane, newPane, active, rows]);
}

/**
 * Scrollt die Spalten nach oben und unten gemeinsam; zur Seite scrollt jede für sich. Senkrecht
 * scrollt nur die rechte Spalte, die linke folgt ihr. Ein Scrollen über der linken Spalte reicht
 * die senkrechte Bewegung an die rechte weiter.
 */
function useSyncedScroll(
  oldPane: RefObject<HTMLDivElement | null>,
  newPane: RefObject<HTMLDivElement | null>,
  active: boolean,
) {
  useEffect(() => {
    const left = oldPane.current;
    const right = newPane.current;
    if (!active || left === null || right === null) {
      return;
    }
    const follow = () => {
      left.scrollTop = right.scrollTop;
    };
    const forward = (event: WheelEvent) => {
      right.scrollTop += event.deltaY;
    };
    follow();
    right.addEventListener('scroll', follow, { passive: true });
    left.addEventListener('wheel', forward, { passive: true });
    return () => {
      right.removeEventListener('scroll', follow);
      left.removeEventListener('wheel', forward);
    };
  }, [oldPane, newPane, active]);
}
