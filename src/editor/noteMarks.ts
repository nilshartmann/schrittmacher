/**
 * Hinweise und Anmerkungen im Text des Editors (`docs/editor.md`): links neben den Zeilennummern
 * je Stelle die Zahl, im Text die Stelle dezent unterlegt und am Ende einer Auswahl der Knopf
 * „Hinweis“. Was wo steht, rechnet die Seite aus und schickt es mit `setNoteLayer`; hier entsteht nur
 * die Anzeige in CodeMirror.
 */
import { Prec, RangeSet, StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter, keymap, showTooltip } from '@codemirror/view';
import type { DecorationSet, Tooltip } from '@codemirror/view';

/** Eine Stelle mit Hinweisen oder einer Anmerkung, mit Zeilen ab 1. */
export interface TextMark {
  key: string;
  kind: 'note' | 'comment';
  /** Abschnitte und die ganze Datei liegen ineinander und werden deshalb nicht unterlegt. */
  lane: 'block' | 'section';
  from: number;
  to: number;
  count: number;
  tip: string;
  /** Bei einer Anmerkung der zitierte Text als Positionen von Zeichen; ohne Zitat `null`. */
  range: { from: number; to: number } | null;
}

/** Was der Editor zeigt: die Stellen und den gewählten oder überfahrenen Bezug. */
export interface NoteLayer {
  marks: TextMark[];
  scope: { from: number; to: number } | null;
}

/** Ersetzt, was der Editor an Hinweisen und Anmerkungen zeigt. */
export const setNoteLayer = StateEffect.define<NoteLayer>();

/** Schaltet den Knopf „Hinweis“ ein und aus, etwa solange ein neuer Hinweis offen ist. */
export const setNoting = StateEffect.define<boolean>();

const NOTE_LINE = Decoration.line({ class: 'cm-note-line' });
const SCOPE_LINE = Decoration.line({ class: 'cm-note-scope' });
const COMMENT_RANGE = Decoration.mark({ class: 'cm-comment-range' });

/** Die Zahlen am Rand einer Zeile: für Hinweise und für Anmerkungen, jeweils mit ihren Schlüsseln. */
class CountMarker extends GutterMarker {
  constructor(
    readonly notes: { count: number; hollow: boolean; keys: string[]; tip: string } | null,
    readonly comments: { count: number; keys: string[]; tip: string } | null,
  ) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof CountMarker && JSON.stringify(other) === JSON.stringify(this);
  }

  override toDOM(): Node {
    const box = document.createElement('span');
    box.className = 'cm-note-counts';
    const badge = (className: string, count: number, keys: string[], tip: string) => {
      const element = document.createElement('span');
      element.className = className;
      element.textContent = String(count);
      element.dataset.keys = keys.join(',');
      element.dataset.tip = tip;
      box.appendChild(element);
    };
    if (this.notes !== null) {
      badge(this.notes.hollow ? 'cm-note-badge cm-note-badge-section' : 'cm-note-badge', this.notes.count, this.notes.keys, this.notes.tip);
    }
    if (this.comments !== null) {
      badge('cm-comment-badge', this.comments.count, this.comments.keys, this.comments.tip);
    }
    return box;
  }
}

/** Die Position am Anfang einer Zeile ab 1, begrenzt auf den Text. */
function lineStart(state: EditorState, line: number): number {
  return state.doc.line(Math.min(state.doc.lines, Math.max(1, line))).from;
}

/** Die Anzeige zu einer Ebene: Unterlegungen und Zahlen am Rand. */
function build(state: EditorState, layer: NoteLayer): { decorations: DecorationSet; markers: RangeSet<GutterMarker> } {
  const decorations: Range<Decoration>[] = [];
  const lines = (from: number, to: number, decoration: Decoration) => {
    for (let line = Math.max(1, from); line <= Math.min(state.doc.lines, to); line++) {
      decorations.push(decoration.range(state.doc.line(line).from));
    }
  };
  const byLine = new Map<number, { notes: TextMark[]; comments: TextMark[] }>();
  for (const mark of layer.marks) {
    if (mark.kind === 'note' && mark.lane === 'block') {
      lines(mark.from, mark.to, NOTE_LINE);
    }
    if (mark.kind === 'comment' && mark.range !== null && mark.range.to > mark.range.from && mark.range.to <= state.doc.length) {
      decorations.push(COMMENT_RANGE.range(mark.range.from, mark.range.to));
    }
    const entry = byLine.get(mark.from) ?? { notes: [], comments: [] };
    (mark.kind === 'note' ? entry.notes : entry.comments).push(mark);
    byLine.set(mark.from, entry);
  }
  if (layer.scope !== null) {
    lines(layer.scope.from, layer.scope.to, SCOPE_LINE);
  }
  const sum = (marks: TextMark[]) => marks.reduce((total, mark) => total + mark.count, 0);
  const markers = [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, { notes, comments }]) =>
      new CountMarker(
        notes.length === 0
          ? null
          : {
              count: sum(notes),
              hollow: notes.every((mark) => mark.lane === 'section'),
              keys: notes.map((mark) => mark.key),
              tip: notes.map((mark) => mark.tip).join('; '),
            },
        comments.length === 0
          ? null
          : { count: sum(comments), keys: comments.map((mark) => mark.key), tip: comments.map((mark) => mark.tip).join('; ') },
      ).range(lineStart(state, line)),
    );
  return { decorations: Decoration.set(decorations, true), markers: RangeSet.of(markers, true) };
}

const layerField = StateField.define<{ decorations: DecorationSet; markers: RangeSet<GutterMarker> }>({
  create: () => ({ decorations: Decoration.none, markers: RangeSet.empty }),
  update: (value, transaction) => {
    let next = transaction.docChanged
      ? { decorations: value.decorations.map(transaction.changes), markers: value.markers.map(transaction.changes) }
      : value;
    for (const effect of transaction.effects) {
      if (effect.is(setNoteLayer)) {
        next = build(transaction.state, effect.value);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const notingField = StateField.define<boolean>({
  create: () => false,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setNoting)) {
        return effect.value;
      }
    }
    return value;
  },
});

/**
 * Wo der Knopf „Hinweis“ steht: am Ende einer Auswahl oder, mit `heading`, am Ende einer
 * Überschrift, in der der Cursor ohne Auswahl steht.
 */
function buttonPlace(state: EditorState, heading = true): number | null {
  if (!state.field(notingField)) {
    return null;
  }
  const { from, to, head } = state.selection.main;
  if (from !== to) {
    return state.sliceDoc(from, to).trim() === '' ? null : to;
  }
  const line = state.doc.lineAt(head);
  return heading && /^#{1,6}(\s|$)/.test(line.text) ? line.to : null;
}

/**
 * Die Erweiterung für CodeMirror. `onRequest` bekommt die Auswahl, wenn der Knopf „Hinweis“ oder
 * ⌘⌥K einen Hinweis anlegen soll, `onMark` die Schlüssel der angeklickten Zahl am Rand.
 */
export function noteMarks(handlers: {
  onRequest: (selection: { from: number; to: number }) => void;
  onMark: (keys: string[]) => void;
}): Extension {
  const request = (view: EditorView): boolean => {
    if (buttonPlace(view.state) === null) {
      return false;
    }
    const { from, to } = view.state.selection.main;
    handlers.onRequest({ from, to });
    return true;
  };
  const buttonField = StateField.define<Tooltip | null>({
    create: () => null,
    update: (value, transaction) => {
      if (!transaction.docChanged && !transaction.selection && !transaction.effects.some((effect) => effect.is(setNoting))) {
        return value;
      }
      // In einer Überschrift erscheint der Knopf erst, wenn der Cursor dorthin bewegt wurde, nicht
      // beim Öffnen und nicht beim Tippen.
      const moved = transaction.isUserEvent('select') && !transaction.docChanged;
      const pos = buttonPlace(transaction.state, moved);
      if (pos === null) {
        return null;
      }
      return {
        pos,
        above: false,
        strictSide: false,
        create: (view) => {
          const dom = document.createElement('div');
          dom.className = 'cm-note-tooltip';
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'note-button';
          button.dataset.tip = view.state.selection.main.empty ? 'Hinweis zum Abschnitt (⌘⌥K)' : 'Hinweis zur Auswahl (⌘⌥K)';
          button.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2.5h9c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5H8l-3 2.5v-2.5H3.5c-.8 0-1.5-.7-1.5-1.5V4c0-.8.7-1.5 1.5-1.5z"/><path d="M5 5.5h6M5 8h4"/></svg>Hinweis';
          // Der Klick nimmt dem Editor nicht den Fokus, damit die Auswahl bleibt.
          button.addEventListener('mousedown', (event) => {
            event.preventDefault();
          });
          button.addEventListener('click', () => {
            request(view);
          });
          dom.appendChild(button);
          return { dom };
        },
      };
    },
    provide: (field) => showTooltip.from(field),
  });
  return [
    layerField,
    notingField,
    buttonField,
    gutter({
      class: 'cm-note-gutter',
      markers: (view) => view.state.field(layerField).markers,
      domEventHandlers: {
        mousedown: (_view, _line, event) => {
          const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-keys]') : null;
          if (target === null) {
            return false;
          }
          event.preventDefault();
          handlers.onMark((target.dataset.keys ?? '').split(',').filter((key) => key !== ''));
          return true;
        },
      },
    }),
    // Vor den Kürzeln des Editors, damit es auch dann gilt, wenn CodeMirror es einmal belegt.
    Prec.high(keymap.of([{ key: 'Mod-Alt-k', preventDefault: true, run: request }])),
  ];
}
