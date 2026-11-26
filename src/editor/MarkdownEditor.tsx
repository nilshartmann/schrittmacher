import { defaultKeymap, history, historyKeymap, indentWithTab, invertedEffects, isolateHistory } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { anchorsOf, normalized, resolveAnchors, without } from './highlights';
import type { Highlight } from './highlights';
import { languageFor } from './languages';
import { noteMarks, setNoteLayer, setNoting } from './noteMarks';
import type { NoteLayer } from './noteMarks';

/** Die Farben des Texts, aus denselben Variablen wie die Hervorhebung im Diff, für Markdown und Code. */
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
  { tag: tags.keyword, color: 'var(--code-keyword)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--code-type)' },
  { tag: tags.string, color: 'var(--code-string)' },
  { tag: tags.number, color: 'var(--code-number)' },
  { tag: [tags.bool, tags.null, tags.atom], color: 'var(--code-constant)' },
  { tag: tags.regexp, color: 'var(--code-regexp)' },
  { tag: tags.escape, color: 'var(--code-escape)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-function)' },
  { tag: tags.definition(tags.propertyName), color: 'var(--code-property)' },
  { tag: tags.annotation, color: 'var(--code-annotation)' },
  { tag: tags.tagName, color: 'var(--code-jsx-tag)' },
  { tag: tags.attributeName, color: 'var(--code-jsx-attribute)' },
]);

/** Ersetzt alle Markierungen im Editor; spätere Änderungen am Text verschieben die Bereiche mit. */
const setHighlights = StateEffect.define<Highlight[]>({
  map: (value, mapping) =>
    value
      .map((range) => ({ from: mapping.mapPos(range.from, 1), to: mapping.mapPos(range.to, -1) }))
      .filter((range) => range.to > range.from),
});

/**
 * Ersetzt der Text alle Markierungen zugleich, etwa beim Formatieren, stellt ⌘Z die vorigen wieder
 * her. Ein bloßes Markieren ohne Änderung am Text bleibt außerhalb des Verlaufs.
 */
const restoreHighlights = invertedEffects.of((transaction) =>
  transaction.docChanged && transaction.effects.some((effect) => effect.is(setHighlights))
    ? [setHighlights.of(highlightsIn(transaction.startState))]
    : [],
);

/** Wie eine Markierung aussieht; getippter Text an ihrem Rand gehört nicht dazu. */
const HIGHLIGHT_MARK = Decoration.mark({ class: 'cm-highlight' });

/** Die Markierungen im Editor. Sie wandern mit jeder Änderung am Text mit, ein leer getippter Bereich fällt weg. */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setHighlights)) {
        next = Decoration.set(effect.value.map((range) => HIGHLIGHT_MARK.range(range.from, range.to)));
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Die Markierungen im Editor als Bereiche, sortiert und ohne leere. */
/** Die Beschriftungen des Suchfelds von CodeMirror auf Deutsch. */
const SUCHE_DEUTSCH = EditorState.phrases.of({
  Find: 'Suchen',
  Replace: 'Ersetzen',
  next: 'Weiter',
  previous: 'Zurück',
  all: 'Alle',
  'match case': 'Groß-/Kleinschreibung',
  regexp: 'Regex',
  'by word': 'Ganzes Wort',
  replace: 'Ersetzen',
  'replace all': 'Alle ersetzen',
  close: 'Schließen',
  'current match': 'Aktueller Treffer',
  'on line': 'in Zeile',
  'replaced $ matches': '$ Treffer ersetzt',
  'replaced match on line $': 'Treffer in Zeile $ ersetzt',
  'Go to line': 'Gehe zu Zeile',
  go: 'Los',
});

function highlightsIn(state: EditorState): Highlight[] {
  const found: Highlight[] = [];
  const cursor = state.field(highlightField).iter();
  for (; cursor.value !== null; cursor.next()) {
    found.push({ from: cursor.from, to: cursor.to });
  }
  return normalized(found);
}

/**
 * Markiert die Auswahl oder hebt Markierungen auf: Ohne Auswahl entfernt es die Markierung am
 * Cursor, mit Auswahl den markierten Teil darin. Berührt die Auswahl keine Markierung, wird sie markiert.
 */
function toggleHighlight(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const current = highlightsIn(view.state);
  let next: Highlight[];
  if (from === to) {
    const at = current.find((range) => range.from <= from && from <= range.to);
    if (at === undefined) {
      return false;
    }
    next = current.filter((range) => range !== at);
  } else if (current.some((range) => range.from < to && range.to > from)) {
    next = without(current, from, to);
  } else {
    next = normalized([...current, { from, to }]);
  }
  view.dispatch({ effects: setHighlights.of(next) });
  return true;
}

/** Setzt den Cursor an den Anfang der nächsten Markierung hinter ihm, nach der letzten wieder an die erste. */
function nextHighlight(view: EditorView): boolean {
  const current = highlightsIn(view.state);
  const head = view.state.selection.main.head;
  const target = current.find((range) => range.from > head) ?? current[0];
  if (target === undefined) {
    return false;
  }
  view.dispatch({
    selection: EditorSelection.range(target.from, target.to),
    effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
  });
  view.focus();
  return true;
}

/** Wie nah eine gezogene Breite an der normalen liegen muss, damit sie dort einrastet, in Pixeln. */
const SNAP = 16;

/** Was die Seite am Editor auslösen kann, etwa über einen Knopf in der Kopfzeile. */
export interface EditorHandle {
  format: () => void;
  /** Ersetzt den Text, etwa durch den Stand der Datei, als eigenen Schritt für ⌘Z. */
  replace: (text: string) => void;
  /** Die oberste sichtbare Zeile im scrollenden `container`, mit dem Bruchteil schon gescrollter Höhe. */
  topLine: (container: HTMLElement) => number;
  /** Scrollt `container` so, dass die Zeile, mit Bruchteil, oben steht; zurück kommt die neue Höhe. */
  scrollToLine: (container: HTMLElement, line: number) => number;
  /** Markiert die Auswahl oder hebt Markierungen darin auf, wie ⌘⇧M. */
  toggleHighlight: () => void;
  /** Wählt die nächste Markierung hinter dem Cursor aus. */
  nextHighlight: () => void;
  /** Setzt Text an die Stelle der Auswahl, etwa den Link auf eine eingefügte Abbildung. */
  insert: (text: string) => void;
  /**
   * Ersetzt eine Referenz nach dem Umbenennen ihrer Datei: an der Stelle `from` bis `to` und überall,
   * wo sie als Ziel eines Links `](…)` steht. Alles zusammen ist ein Schritt für ⌘Z.
   */
  replaceReference: (reference: Reference, next: string) => void;
  /** Ersetzt, was der Text an Hinweisen und Anmerkungen zeigt. */
  setNoteLayer: (layer: NoteLayer) => void;
  /** Schaltet den Knopf „Hinweis“ an der Auswahl ein und aus. */
  setNoting: (enabled: boolean) => void;
  /** Setzt den Cursor an den Anfang der Zeile, gezählt ab 1, und scrollt sie in die Mitte. */
  revealLine: (line: number) => void;
}

/** Eine markierte Referenz auf eine Datei, etwa `abb-002.png` in einem Bild. */
export interface Reference {
  text: string;
  from: number;
  to: number;
}

/** Die Stellen im Text, an denen `reference` als Ziel eines Links steht, mit oder ohne `<…>`. */
function linkTargets(doc: string, reference: string): { from: number; to: number }[] {
  const bare = reference.replace(/^<(.*)>$/, '$1');
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\]\\((<${escaped}>|${escaped})(?=[\\s)])`, 'g');
  return [...doc.matchAll(pattern)].map((match) => {
    const from = match.index + 2;
    return { from, to: from + (match[1] ?? '').length };
  });
}

/**
 * Das Bild aus der Zwischenablage, wenn sie eins und keinen Text enthält. Mit Text gilt der Text,
 * etwa bei Inhalt aus einem Textprogramm, das ein Bild dazulegt.
 */
function pastedImage(data: DataTransfer | null): File | null {
  if (data === null || data.types.includes('text/plain')) {
    return null;
  }
  for (const item of data.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
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
  const changes = view.state.changes({ from: start, to: before.length - end, insert: next.slice(start, next.length - end) });
  // Markierungen im ersetzten Bereich fielen sonst weg. Sie werden über ihren Text im neuen
  // wiedergefunden, ausgehend von der Stelle, an die die Änderung ihren Anfang schiebt.
  const anchors = anchorsOf(before, highlightsIn(view.state)).map((anchor) => ({
    ...anchor,
    from: changes.mapPos(anchor.from),
  }));
  view.dispatch({
    changes,
    effects: setHighlights.of(resolveAnchors(next, anchors).found),
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
  /** Die Fläche, in der die gezogene Fläche mittig steht. */
  area: DOMRect;
  /** Welcher Teil der gezogenen Fläche auf den Editor entfällt; neben der Vorschau weniger als 1. */
  share: number;
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
 * Der Text einer Datei in CodeMirror, mit der Hervorhebung zu ihrer Endung. Der Editor übernimmt
 * `text` und `path` nur beim Anlegen; danach gehört der Text ihm, und jede Änderung geht an
 * `onChange`. ⌘S ruft `onSave` auf. Die Breite gilt samt Zeilennummern und Rand. Der Strich neben den Zeilennummern lässt sich greifen;
 * beim Ziehen zeigt eine Fläche die neue Breite, die erst beim Loslassen gilt. Escape bricht ab.
 * Steht der Editor neben der Vorschau, ändert das Ziehen die Breite von `outer`, die beide umfasst.
 */
export function MarkdownEditor({
  path,
  text,
  highlights,
  onHighlights,
  width,
  resizable,
  outer,
  minWidth,
  snapWidth,
  onWidth,
  onCursor,
  handle,
  onFormat,
  onChange,
  onSave,
  onPasteImage,
  onRenameReference,
  onNoteRequest,
  onNoteMark,
}: {
  /** Der Pfad der Datei; seine Endung bestimmt die Hervorhebung. */
  path: string;
  text: string;
  /** Die Markierungen beim Anlegen; danach gehören sie dem Editor wie der Text. */
  highlights: Highlight[];
  /** Die Markierungen nach jeder Änderung an ihnen oder am Text. */
  onHighlights: (highlights: Highlight[]) => void;
  handle: RefObject<EditorHandle | null>;
  /** Formatiert den Text; zurück kommt der neue Text, bei einem Fehler der alte. */
  onFormat: (text: string) => Promise<string>;
  /** Die größte Breite der Textfläche in Pixeln; `null` für die ganze Breite. */
  width: number | null;
  /** Ob sich die Breite am Strich neben den Zeilennummern ziehen lässt. */
  resizable: boolean;
  /** Die Fläche, deren Breite das Ziehen ändert; `null` für den Editor selbst. */
  outer: RefObject<HTMLElement | null> | null;
  minWidth: number;
  /** Die Breite, auf der ein Ziehen einrastet; `null` ohne Einrasten. */
  snapWidth: number | null;
  /** Die Zeile des Cursors, gezählt ab 1, nach jeder Bewegung oder Änderung. */
  onCursor: (line: number) => void;
  /** Die neue Breite nach dem Ziehen am Strich neben den Zeilennummern; `null` für die ganze Breite. */
  onWidth: (width: number | null) => void;
  onChange: (text: string) => void;
  onSave: () => void;
  /** Ein Bild aus der Zwischenablage statt Text; ohne fügt der Editor es nicht ein. */
  onPasteImage?: (image: File) => void;
  /** F2 mit einer Auswahl in einer Zeile: Die Auswahl ist eine Referenz auf eine Datei zum Umbenennen. */
  onRenameReference?: (reference: Reference) => void;
  /** Der Knopf „Hinweis“ oder ⌘⌥K mit der Auswahl, aus der ein neuer Hinweis entstehen soll. */
  onNoteRequest?: (selection: { from: number; to: number }) => void;
  /** Ein Klick auf eine Zahl am Rand, mit den Schlüsseln ihrer Stellen. */
  onNoteMark?: (keys: string[]) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const [edge, setEdge] = useState<Edge | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Die Rückrufe ändern sich mit jedem Rendern, der Editor wird aber nur einmal angelegt.
  const callbacks = useRef({ onChange, onSave, onFormat, onCursor, onHighlights, onPasteImage, onRenameReference, onNoteRequest, onNoteMark });
  callbacks.current = { onChange, onSave, onFormat, onCursor, onHighlights, onPasteImage, onRenameReference, onNoteRequest, onNoteMark };
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
          highlightField.init(() =>
            Decoration.set(normalized(highlights).map((range) => HIGHLIGHT_MARK.range(range.from, range.to))),
          ),
          restoreHighlights,
          SUCHE_DEUTSCH,
          // Vor den Zeilennummern, damit die Zahlen der Hinweise ganz links stehen.
          noteMarks({
            onRequest: (selection) => {
              callbacks.current.onNoteRequest?.(selection);
            },
            onMark: (keys) => {
              callbacks.current.onNoteMark?.(keys);
            },
          }),
          lineNumbers(),
          history(),
          drawSelection(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          languageFor(path),
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
              key: 'Mod-Shift-m',
              preventDefault: true,
              run: toggleHighlight,
            },
            {
              key: 'F2',
              preventDefault: true,
              run: (target) => {
                const { from, to } = target.state.selection.main;
                const text = target.state.sliceDoc(from, to);
                const handle = callbacks.current.onRenameReference;
                if (handle === undefined || text.trim() === '' || text.includes('\n')) {
                  return false;
                }
                handle({ text, from, to });
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
          EditorView.domEventHandlers({
            paste: (event) => {
              const image = pastedImage(event.clipboardData);
              const handle = callbacks.current.onPasteImage;
              if (image === null || handle === undefined) {
                return false;
              }
              event.preventDefault();
              handle(image);
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              callbacks.current.onChange(update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet) {
              callbacks.current.onCursor(update.state.doc.lineAt(update.state.selection.main.head).number);
            }
            if (update.startState.field(highlightField) !== update.state.field(highlightField)) {
              callbacks.current.onHighlights(highlightsIn(update.state));
            }
          }),
        ],
      }),
    });
    editor.current = view;
    const topLine = (container: HTMLElement) => {
      const height = container.getBoundingClientRect().top - view.documentTop;
      if (height <= 0) {
        return 1;
      }
      const block = view.lineBlockAtHeight(height);
      const line = view.state.doc.lineAt(block.from).number;
      return line + Math.min(1, Math.max(0, (height - block.top) / Math.max(1, block.height)));
    };
    const scrollToLine = (container: HTMLElement, line: number) => {
      const number = Math.min(view.state.doc.lines, Math.max(1, Math.floor(line)));
      const block = view.lineBlockAt(view.state.doc.line(number).from);
      const offset = view.documentTop - container.getBoundingClientRect().top + container.scrollTop;
      const part = Math.min(1, Math.max(0, line - number));
      container.scrollTop = offset + block.top + part * block.height;
      return container.scrollTop;
    };
    handle.current = {
      format,
      topLine,
      scrollToLine,
      replace: (next) => {
        replaceText(view, next);
      },
      toggleHighlight: () => {
        toggleHighlight(view);
        view.focus();
      },
      nextHighlight: () => {
        nextHighlight(view);
      },
      insert: (text) => {
        view.dispatch(view.state.replaceSelection(text));
        view.focus();
      },
      setNoteLayer: (layer) => {
        view.dispatch({ effects: setNoteLayer.of(layer) });
      },
      setNoting: (enabled) => {
        view.dispatch({ effects: setNoting.of(enabled) });
      },
      revealLine: (line) => {
        const pos = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, line))).from;
        view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      },
      replaceReference: (reference, next) => {
        const doc = view.state.doc.toString();
        const ranges = linkTargets(doc, reference.text).filter((range) => range.to <= reference.from || range.from >= reference.to);
        // Die Auswahl selbst, falls der Text dort noch derselbe ist.
        const changes = ranges.map((range) => ({ ...range, insert: next }));
        if (view.state.sliceDoc(reference.from, reference.to) === reference.text) {
          // Steht die Auswahl schon in `<…>`, kommen keine zweiten Klammern dazu.
          const wrapped = view.state.sliceDoc(reference.from - 1, reference.from) === '<';
          changes.push({ from: reference.from, to: reference.to, insert: wrapped ? next.replace(/^<(.*)>$/, '$1') : next });
        }
        view.dispatch({ changes });
        view.focus();
      },
    };
    // Hat ein anderes Element den Fokus, etwa die Zeile im Baum nach einem Klick, bleibt er dort.
    if (document.activeElement === null || document.activeElement === document.body) {
      view.focus();
    }
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
    const target = outer?.current ?? frame.current;
    const area = target?.parentElement?.getBoundingClientRect();
    const current = target?.getBoundingClientRect().width;
    const own = frame.current?.getBoundingClientRect().width;
    const view = editor.current;
    if (area === undefined || current === undefined || own === undefined || view === null) {
      return;
    }
    // Für Text bleibt die Breite des Inhalts ohne seine Abstände und die der Zeilen.
    const content = view.contentDOM;
    const text = content.clientWidth - paddingOf(content) - paddingOf(content.querySelector('.cm-line'));
    const overhead = own - text;
    const charWidth = charWidthIn(content);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x: event.clientX, width: current, next: width, area, share: own / current, overhead, charWidth });
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag === null) {
      return;
    }
    // Die Fläche steht mittig, also wächst sie auf beiden Seiten um den Weg der Maus.
    const wanted = drag.width - 2 * (event.clientX - drag.x);
    const clamped = Math.max(minWidth, Math.min(drag.area.width, wanted));
    const snapped = snapWidth !== null && Math.abs(clamped - snapWidth) <= SNAP ? snapWidth : Math.round(clamped);
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
  const columns =
    drag === null || preview === null ? 0 : Math.floor((preview * drag.share - drag.overhead) / drag.charWidth);
  return (
    <div className="md-editor" ref={frame} style={{ maxWidth: width === null ? 'none' : `${String(width)}px` }}>
      <div ref={host} />
      {resizable && edge !== null && (
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
            {drag.next === null ? ', volle Breite' : drag.next === snapWidth ? ', normal' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
