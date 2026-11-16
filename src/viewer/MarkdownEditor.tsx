import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

/** Die Farben des Quelltexts, aus denselben Variablen wie die Hervorhebung im Diff. */
const HIGHLIGHT = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--code-heading)', fontWeight: '600' },
  { tag: tags.processingInstruction, color: 'var(--code-marker)' },
  { tag: tags.strong, color: 'var(--code-strong)', fontWeight: '600' },
  { tag: tags.emphasis, color: 'var(--code-emphasis)', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: 'var(--code-strikethrough)', textDecoration: 'line-through' },
  { tag: tags.monospace, color: 'var(--code-markdown-code)' },
  { tag: tags.link, color: 'var(--code-link-text)' },
  { tag: tags.url, color: 'var(--code-url)' },
  { tag: tags.quote, color: 'var(--code-quote)' },
  { tag: tags.contentSeparator, color: 'var(--code-marker)' },
  { tag: tags.comment, color: 'var(--code-comment)' },
]);

/** Wie nah eine gezogene Breite an der normalen liegen muss, damit sie dort einrastet, in Pixeln. */
const SNAP = 16;

/** Die normale Breite der Textfläche, auf der ein Ziehen einrastet. */
const NORMAL_WIDTH = 900;

/** Was die Seite am Editor auslösen kann, etwa über einen Knopf in der Kopfzeile. */
export interface EditorHandle {
  format: () => void;
}

/**
 * Ersetzt in einem Editor den Text durch einen neuen, als eine Änderung nur zwischen dem gleichen
 * Anfang und dem gleichen Ende. So bleibt der Cursor stehen, und ⌘Z nimmt alles in einem Schritt
 * zurück.
 */
function replaceText(view: EditorView, next: string) {
  const before = view.state.doc.toString();
  if (before === next) {
    return;
  }
  let start = 0;
  while (start < before.length && start < next.length && before[start] === next[start]) {
    start++;
  }
  let end = 0;
  while (
    end < before.length - start &&
    end < next.length - start &&
    before[before.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end++;
  }
  view.dispatch({
    changes: { from: start, to: before.length - end, insert: next.slice(start, next.length - end) },
    // Ein eigener Schritt im Verlauf, auch wenn kurz davor getippt wurde.
    annotations: isolateHistory.of('full'),
  });
}

/** Die Lage des Strichs neben den Zeilennummern in der Textfläche. */
interface Edge {
  left: number;
  top: number;
  height: number;
}

/** Ein laufendes Ziehen am Strich: wo es anfing und welche Breite gerade gilt. */
interface Drag {
  x: number;
  width: number;
  /** Die Breite, die beim Loslassen gilt; `null` für die ganze Breite. */
  next: number | null;
  /** Die Fläche, in der die Textfläche mittig steht. */
  area: DOMRect;
  /** Was von der Breite nicht für Text bleibt: Rand, Zeilennummern und Abstände, in Pixeln. */
  overhead: number;
  /** Die Breite eines Zeichens der Schrift im Editor, in Pixeln. */
  charWidth: number;
}

/**
 * Die Breite eines Zeichens im Inhalt des Editors, in Pixeln. Gemessen wird eine Zeile ohne
 * Umbruch, weil die Schätzung von CodeMirror bei breiter Fläche um ein Zeichen danebenliegt.
 */
function charWidthIn(content: HTMLElement): number {
  const sample = document.createElement('span');
  sample.style.cssText = 'position: absolute; visibility: hidden; white-space: pre';
  sample.textContent = 'x'.repeat(100);
  content.appendChild(sample);
  const width = sample.getBoundingClientRect().width / 100;
  sample.remove();
  return width;
}

/** Die Summe der Abstände links und rechts eines Elements, in Pixeln. */
function paddingOf(element: Element | null): number {
  if (element === null) {
    return 0;
  }
  const style = getComputedStyle(element);
  return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
}

/**
 * Der Quelltext einer Markdown-Datei in CodeMirror. Der Editor übernimmt `text` nur beim Anlegen;
 * danach gehört der Text ihm, und jede Änderung geht an `onChange`. ⌘S ruft `onSave` auf. Die
 * Breite gilt samt Zeilennummern und Rand. Der Strich neben den Zeilennummern lässt sich greifen;
 * beim Ziehen zeigt eine Fläche die neue Breite, die erst beim Loslassen gilt. Escape bricht ab.
 */
export function MarkdownEditor({
  text,
  width,
  minWidth,
  onWidth,
  handle,
  onFormat,
  onChange,
  onSave,
}: {
  text: string;
  handle: RefObject<EditorHandle | null>;
  /** Formatiert den Text; zurück kommt der neue Text, bei einem Fehler der alte. */
  onFormat: (text: string) => Promise<string>;
  /** Die größte Breite der Textfläche in Pixeln; `null` für die ganze Breite. */
  width: number | null;
  minWidth: number;
  /** Die neue Breite nach dem Ziehen am Strich neben den Zeilennummern; `null` für die ganze Breite. */
  onWidth: (width: number | null) => void;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const [edge, setEdge] = useState<Edge | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Die Rückrufe ändern sich mit jedem Rendern, der Editor wird aber nur einmal angelegt.
  const callbacks = useRef({ onChange, onSave, onFormat });
  callbacks.current = { onChange, onSave, onFormat };
  useEffect(() => {
    if (host.current === null) {
      return;
    }
    // Formatiert wird der Stand beim Auslösen; wurde inzwischen weitergetippt, verfällt das Ergebnis.
    const format = () => {
      const before = view.state.doc.toString();
      void callbacks.current.onFormat(before).then((after) => {
        if (view.state.doc.toString() === before) {
          replaceText(view, after);
        }
      });
    };
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(HIGHLIGHT),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            {
              key: 'Mod-Shift-f',
              preventDefault: true,
              run: () => {
                format();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              callbacks.current.onChange(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    editor.current = view;
    handle.current = { format };
    view.focus();
    // Der Strich folgt dem Rand der Zeilennummern, der mit der Zahl der Stellen breiter wird.
    const gutters = view.dom.querySelector('.cm-gutters');
    const measure = () => {
      if (gutters === null || frame.current === null) {
        return;
      }
      const outer = frame.current.getBoundingClientRect();
      const inner = gutters.getBoundingClientRect();
      setEdge({ left: inner.right - outer.left, top: inner.top - outer.top, height: inner.height });
    };
    const observer = new ResizeObserver(measure);
    if (gutters !== null) {
      observer.observe(gutters);
    }
    if (frame.current !== null) {
      observer.observe(frame.current);
    }
    return () => {
      observer.disconnect();
      handle.current = null;
      view.destroy();
    };
    // Der Text gilt nur beim Anlegen, siehe oben.
  }, []);
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const area = frame.current?.parentElement?.getBoundingClientRect();
    const current = frame.current?.getBoundingClientRect().width;
    const view = editor.current;
    if (area === undefined || current === undefined || view === null) {
      return;
    }
    // Für Text bleibt die Breite des Inhalts ohne seine Abstände und die der Zeilen.
    const content = view.contentDOM;
    const text = content.clientWidth - paddingOf(content) - paddingOf(content.querySelector('.cm-line'));
    const overhead = current - text;
    const charWidth = charWidthIn(content);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x: event.clientX, width: current, next: width, area, overhead, charWidth });
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag === null) {
      return;
    }
    // Die Fläche steht mittig, also wächst sie auf beiden Seiten um den Weg der Maus.
    const wanted = drag.width - 2 * (event.clientX - drag.x);
    const clamped = Math.max(minWidth, Math.min(drag.area.width, wanted));
    const snapped = Math.abs(clamped - NORMAL_WIDTH) <= SNAP ? NORMAL_WIDTH : Math.round(clamped);
    setDrag({ ...drag, next: snapped >= drag.area.width ? null : snapped });
  };
  const endDrag = (apply: boolean) => {
    if (drag !== null && apply) {
      onWidth(drag.next);
    }
    setDrag(null);
  };
  useEffect(() => {
    if (drag === null) {
      return;
    }
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrag(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
    };
  }, [drag]);
  const preview = drag === null ? null : (drag.next ?? drag.area.width);
  const columns = drag === null || preview === null ? 0 : Math.floor((preview - drag.overhead) / drag.charWidth);
  return (
    <div className="md-editor" ref={frame} style={{ maxWidth: width === null ? 'none' : `${String(width)}px` }}>
      <div ref={host} />
      {edge !== null && (
        <div
          className={drag === null ? 'md-editor-edge' : 'md-editor-edge md-editor-edge-dragging'}
          style={{ left: `${String(edge.left)}px`, top: `${String(edge.top)}px`, height: `${String(edge.height)}px` }}
          data-tip={drag === null ? 'Ziehen ändert die Breite' : undefined}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={() => {
            endDrag(true);
          }}
          onPointerCancel={() => {
            endDrag(false);
          }}
        />
      )}
      {drag !== null && preview !== null && (
        <div
          className="md-editor-preview"
          style={{
            left: `${String(drag.area.left + (drag.area.width - preview) / 2)}px`,
            top: `${String(drag.area.top)}px`,
            width: `${String(preview)}px`,
            height: `${String(drag.area.height)}px`,
          }}
        >
          <span className="md-editor-preview-label">
            {`${String(columns)} Zeichen`}
            {drag.next === null ? ', volle Breite' : drag.next === NORMAL_WIDTH ? ', normal' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
