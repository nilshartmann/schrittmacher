import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { chunksOf } from '../diff/highlight';
import type { Row, SideLine } from '../diff/rows';
import type { NoteLines } from '../notes/notes';
import type { Layout } from './Header';
import { NoteIcon } from './Icons';

const SHARE = { min: 0.15, max: 0.85 };

/** Zeilen mit einem Hinweis; die des gewählten Hinweises sind kräftiger hervorgehoben. */
export interface LineMark {
  side: 'old' | 'new';
  from: number;
  to: number;
  active: boolean;
}

/** Eine Zeile, zu der der Diff scrollen soll; `at` unterscheidet zwei Wünsche nach derselben Zeile. */
export interface LineFocus {
  side: 'old' | 'new';
  line: number;
  at: number;
}

/** Wie sich die Marke einer Zeile zeigt: hervorgehoben, kräftiger hervorgehoben oder gar nicht. */
type MarkOf = (side: 'old' | 'new', number: number) => 'noted' | 'active' | null;

interface DiffViewProps {
  rows: Row[];
  layout: Layout;
  onShare: (share: number) => void;
  /** Ob lange Zeilen umbrechen; ohne Umbruch scrollt jede Seite für sich zur Seite. */
  wrap: boolean;
  /** Klappt die Zeilen eines Trenners auf oder wieder ein; der Trenner heißt nach seiner ersten Zeile. */
  onToggleGap: (start: number) => void;
  marks?: LineMark[];
  focus?: LineFocus | null;
  /** Mit `onNote` erscheint an markierten Zeilen ein Knopf, der einen Hinweis zu ihnen anlegt. */
  onNote?: (lines: NoteLines) => void;
}

/**
 * Der Diff einer Datei. Nebeneinander steht jede Seite in einer eigenen Spalte, die wie in Fork
 * für sich zur Seite scrollt; nach oben und unten scrollen beide gemeinsam. Mit Umbruch bekommen
 * die Zeilen beider Seiten dieselbe Höhe. Zwischen den Spalten steht eine Trennlinie zum
 * Verschieben, ein Doppelklick stellt 50/50 her. Untereinander stehen alle Zeilen in einer Spalte.
 * Zeilen mit einem Hinweis sind am Rand der Nummer hervorgehoben.
 */
export function DiffView({ rows, layout, onShare, wrap, onToggleGap, marks = [], focus, onNote }: DiffViewProps) {
  const diff = useRef<HTMLDivElement>(null);
  const oldPane = useRef<HTMLDivElement>(null);
  const newPane = useRef<HTMLDivElement>(null);
  const split = layout.mode === 'split';

  useEvenRows(oldPane, newPane, split && wrap, rows);
  useSyncedScroll(oldPane, newPane, split);
  useEffect(() => {
    if (focus == null) {
      return;
    }
    const selector = `.line[data-side="${focus.side}"][data-number="${String(focus.line)}"]`;
    const target = newPane.current?.querySelector(selector) ?? oldPane.current?.querySelector(selector);
    target?.scrollIntoView({ block: 'center' });
  }, [focus?.at]);

  const markOf: MarkOf = (side, number) => {
    const found = marks.filter((mark) => mark.side === side && mark.from <= number && number <= mark.to);
    return found.length === 0 ? null : found.some((mark) => mark.active) ? 'active' : 'noted';
  };

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
            <Lines rows={rows} side="old" onToggleGap={onToggleGap} markOf={markOf} />
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
        <Lines rows={rows} side="new" onToggleGap={onToggleGap} markOf={markOf} />
      </div>
      {onNote !== undefined && <NoteButton container={diff} onNote={onNote} />}
    </div>
  );
}

/** Die Seite, deren Nummer eine Zeile zeigt: untereinander hat eine entfernte Zeile ihre alte. */
function sideOf(pane: 'old' | 'new', line: SideLine): 'old' | 'new' {
  return pane === 'old' || line.kind === 'removed' ? 'old' : 'new';
}

/**
 * Die Zeilen, die die Markierung im Diff berührt, alle aus der Spalte, in der sie beginnt. Stehen
 * darin Zeilen beider Seiten, zählen die der Fassung nachher. Eine Markierung, die am Anfang einer
 * Zeile endet, etwa nach einem Dreifachklick, nimmt diese Zeile nicht mit. Deckt sie die Zeilen
 * nicht ganz ab, steht der markierte Teil in `marked`.
 */
function pickedLines(container: HTMLElement): NoteLines | null {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) {
    return null;
  }
  const touched = [...container.querySelectorAll<HTMLElement>('.line[data-number]')].filter((line) => {
    const text = line.querySelector('.text');
    if (text === null) {
      return false;
    }
    const whole = document.createRange();
    whole.selectNodeContents(text);
    return (
      range.compareBoundaryPoints(Range.START_TO_END, whole) === 1 &&
      range.compareBoundaryPoints(Range.END_TO_START, whole) === -1
    );
  });
  const pane = touched[0]?.closest('.pane');
  const inPane = touched.filter((line) => line.closest('.pane') === pane);
  const side = inPane.some((line) => line.dataset.side === 'new') ? 'new' : 'old';
  const lines = inPane.filter((line) => line.dataset.side === side);
  const numbers = lines.map((line) => Number(line.dataset.number));
  const first = lines[0]?.querySelector('.text');
  const last = lines.at(-1)?.querySelector('.text');
  if (numbers.length === 0 || first == null || last == null) {
    return null;
  }
  const texts = lines.map((line) => (line.querySelector('.text')?.textContent ?? '').replaceAll('\u200b', ''));
  const code = texts.join('\n');
  // Wie weit die Markierung in die erste Zeile hinein beginnt und in der letzten endet.
  const into = (text: Element, node: Node, offset: number) => {
    const before = document.createRange();
    before.setStart(text, 0);
    before.setEnd(node, offset);
    return before.toString().replaceAll('\u200b', '').length;
  };
  const lastText = texts.at(-1) ?? '';
  const start = first.contains(range.startContainer) ? into(first, range.startContainer, range.startOffset) : 0;
  const end =
    code.length -
    lastText.length +
    (last.contains(range.endContainer) ? Math.min(lastText.length, into(last, range.endContainer, range.endOffset)) : lastText.length);
  // Ohne die Einrückung davor und die Leerzeichen danach gilt eine Markierung als ganze Zeilen.
  const indent = (texts[0] ?? '').length - (texts[0] ?? '').trimStart().length;
  const whole = start <= indent && end >= code.trimEnd().length;
  return {
    side,
    from: Math.min(...numbers),
    to: Math.max(...numbers),
    code,
    ...(whole || start >= end ? {} : { marked: { start, end } }),
  };
}

/** Wie weit der Knopf vom Ende der Markierung steht, in Pixeln. */
const NOTE_BUTTON_GAP = 6;

/**
 * Ein schwebender Knopf am Ende der Markierung, sobald die Maus losgelassen ist. Er legt einen
 * Hinweis zu den markierten Zeilen an und verschwindet, wenn die Markierung aufgehoben ist. Er
 * hängt an `body`, damit keine Spalte ihn abschneidet, und folgt der Markierung beim Scrollen.
 */
function NoteButton({ container, onNote }: { container: RefObject<HTMLDivElement | null>; onNote: (lines: NoteLines) => void }) {
  const [shown, setShown] = useState<{ lines: NoteLines; top: number; left: number } | null>(null);
  const visible = useRef(false);
  visible.current = shown !== null;
  useEffect(() => {
    const element = container.current;
    if (element === null) {
      return;
    }
    const place = () => {
      const lines = pickedLines(element);
      const rects = lines === null ? [] : [...(window.getSelection()?.getRangeAt(0).getClientRects() ?? [])];
      const last = rects.filter((rect) => rect.width > 0).at(-1) ?? rects.at(-1);
      const box = element.getBoundingClientRect();
      if (lines === null || last === undefined || last.bottom < box.top || last.top > box.bottom) {
        setShown(null);
        return;
      }
      setShown({
        lines,
        top: Math.min(last.bottom + NOTE_BUTTON_GAP, window.innerHeight - 40),
        left: Math.min(Math.max(box.left, last.right), box.right - 40),
      });
    };
    const onSelection = () => {
      if (window.getSelection()?.isCollapsed !== false) {
        setShown(null);
      }
    };
    const onPointerUp = () => {
      requestAnimationFrame(place);
    };
    // Nur ein sichtbarer Knopf folgt beim Scrollen; ohne ihn erscheint er erst beim Loslassen.
    const onScroll = () => {
      if (visible.current) {
        place();
      }
    };
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('pointerup', onPointerUp);
    element.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [container]);
  if (shown === null) {
    return null;
  }
  return createPortal(
    <button
      type="button"
      className="note-button"
      style={{ top: shown.top, left: shown.left }}
      data-tip="Hinweis zu den markierten Zeilen"
      // Der Klick hebt die Markierung nicht auf, bevor der Knopf sie liest.
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        onNote(shown.lines);
        window.getSelection()?.removeAllRanges();
        setShown(null);
      }}
    >
      <NoteIcon />
      Hinweis
    </button>,
    document.body,
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
  markOf,
}: {
  rows: Row[];
  side: 'old' | 'new';
  onToggleGap: (start: number) => void;
  markOf: MarkOf;
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
        return <Line key={index} line={row[side]} pane={side} removedBefore={row.removedBefore ?? 0} markOf={markOf} />;
      })}
    </div>
  );
}

function Line({
  line,
  pane,
  removedBefore,
  markOf,
}: {
  line: SideLine | null;
  pane: 'old' | 'new';
  removedBefore: number;
  markOf: MarkOf;
}) {
  if (line === null) {
    return <div className="line line-empty" />;
  }
  const side = sideOf(pane, line);
  const mark = markOf(side, line.number);
  return (
    <div
      className={`line line-${line.kind}${removedBefore > 0 ? ' line-removed-before' : ''}${mark === null ? '' : ` line-${mark}`}`}
      data-side={side}
      data-number={line.number}
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
