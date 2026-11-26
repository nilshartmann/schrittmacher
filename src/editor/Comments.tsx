import { useEffect, useState } from 'react';
import { locateComment } from '../notes/markdownComments';
import type { MdComment, MdComments } from '../notes/markdownComments';
import { dismissMarkdownComment, loadMarkdownComments, markdownCommentsChanged } from '../server/repo.functions';
import { CheckMarkIcon, ClaudeIcon } from '../viewer/Icons';
import { Colored, MARKDOWN } from '../viewer/Notes';
import type { TextMark } from './noteMarks';

/** Der Abstand der Fragen, ob Claude neue Anmerkungen geschrieben hat, in Millisekunden. */
const CHANGE_INTERVAL = 1500;

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Eine Anmerkung mit ihrer Stelle im aktuellen Text: Zeichen und Zeilen, ohne Zitat oder nicht gefunden `null`. */
export interface LocatedComment {
  comment: MdComment;
  range: { from: number; to: number } | null;
  lines: { from: number; to: number } | null;
}

/**
 * Die Anmerkungen von Claude zu einer Markdown-Datei. Solange die Seite sichtbar ist, fragt sie
 * regelmäßig, ob sich die Datei mit den Anmerkungen geändert hat, und lädt sie dann neu.
 */
export function useMarkdownComments(path: string, active: boolean) {
  const [data, setData] = useState<MdComments | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) {
      return;
    }
    let current = true;
    let known: number | null | undefined;
    const load = () => {
      loadMarkdownComments({ data: { path } }).then(
        (loaded) => {
          if (current) {
            known = loaded.changed;
            setData(loaded);
            setError(null);
          }
        },
        (failure: unknown) => {
          if (current) {
            setError(messageOf(failure));
          }
        },
      );
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      markdownCommentsChanged({ data: { path } }).then(
        (changed) => {
          if (current && known !== undefined && changed !== known) {
            load();
          }
        },
        () => {
          // Der Server ist kurz nicht erreichbar; die nächste Frage versucht es wieder.
        },
      );
    }, CHANGE_INTERVAL);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [path, active]);
  return {
    comments: data?.comments ?? [],
    file: data?.file ?? '',
    error: error ?? data?.error ?? null,
    dismiss: async (id: string) => {
      try {
        setData(await dismissMarkdownComment({ data: { path, id } }));
        setError(null);
      } catch (failure) {
        setError(messageOf(failure));
      }
    },
  };
}

/** Die Anmerkungen mit ihren Stellen im Text, der Reihe nach; die ganze Datei vorn, nicht gefundene hinten. */
export function locateComments(comments: MdComment[], text: string): LocatedComment[] {
  const lineAt = (position: number) => text.slice(0, position).split('\n').length;
  return comments
    .map((comment) => {
      const range = locateComment(comment, text);
      const lines = range === null ? null : { from: lineAt(range.from), to: lineAt(Math.max(range.from, range.to - 1)) };
      return { comment, range, lines };
    })
    .sort((a, b) => order(a) - order(b));
}

/** Die Stelle in der Reihenfolge: die ganze Datei vor allem, nicht gefundene nach allem. */
function order(located: LocatedComment): number {
  if (located.comment.quote.trim() === '') {
    return 0;
  }
  return located.range === null ? Infinity : located.range.from + 1;
}

/** Die Zahlen am Rand und die unterlegten Zitate für die Anmerkungen. */
export function commentTextMarks(located: LocatedComment[]): TextMark[] {
  return located.flatMap(({ comment, range, lines }) => {
    const whole = comment.quote.trim() === '';
    if (!whole && lines === null) {
      return [];
    }
    return [
      {
        key: `comment:${comment.id}`,
        kind: 'comment' as const,
        lane: whole ? ('section' as const) : ('block' as const),
        from: lines?.from ?? 1,
        to: lines?.to ?? 1,
        count: 1,
        tip: `Anmerkung: ${shortened(comment.text)}`,
        range,
      },
    ];
  });
}

/** Der Anfang eines Texts in einer Zeile, für Tooltips. */
function shortened(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/**
 * Die Anmerkungen von Claude oben in der Spalte der Hinweise. Ein Klick auf den Kopf zeigt die
 * Stelle im Text, der Haken verwirft eine Anmerkung als erledigt.
 */
export function CommentList({
  located,
  focused,
  error,
  onShow,
  onPreview,
  onDismiss,
}: {
  located: LocatedComment[];
  focused: string[];
  error: string | null;
  onShow: (located: LocatedComment) => void;
  onPreview: (lines: { from: number; to: number } | null) => void;
  onDismiss: (id: string) => Promise<void>;
}) {
  if (located.length === 0 && error === null) {
    return null;
  }
  return (
    <section className="comments" aria-label="Anmerkungen von Claude">
      <h3 className="comments-heading">
        <ClaudeIcon />
        Anmerkungen von Claude
        <span className="comments-count">{located.length}</span>
      </h3>
      {error !== null && <p className="notes-error">{error}</p>}
      {located.map((entry) => {
        const { comment, lines } = entry;
        const whole = comment.quote.trim() === '';
        return (
          <article
            key={comment.id}
            className={focused.includes(comment.id) ? 'note comment comment-focused' : 'note comment'}
            data-comment-id={comment.id}
            onPointerEnter={() => {
              onPreview(lines);
            }}
            onPointerLeave={() => {
              onPreview(null);
            }}
          >
            <div className="note-top">
              <button
                type="button"
                className="note-show"
                disabled={!whole && lines === null}
                data-tip={!whole && lines === null ? 'Das Zitat steht nicht im aktuellen Text' : 'Stelle zeigen'}
                onClick={() => {
                  onPreview(null);
                  onShow(entry);
                }}
              >
                <span className="note-head">
                  <span className="note-where">
                    <span className="note-file">{whole ? 'Ganze Datei' : 'Stelle'}</span>
                    {!whole && (
                      <span className="note-lines">
                        {lines === null
                          ? 'Stelle nicht gefunden'
                          : lines.from === lines.to
                            ? `Zeile ${String(lines.from)}`
                            : `Zeilen ${String(lines.from)}–${String(lines.to)}`}
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="hover-tool comment-done"
                aria-label="Anmerkung erledigt"
                data-tip="Erledigt: Anmerkung verwerfen"
                onClick={() => {
                  onPreview(null);
                  void onDismiss(comment.id);
                }}
              >
                <CheckMarkIcon />
              </button>
            </div>
            {!whole && <mark className="comment-quote">{shortened(comment.quote)}</mark>}
            <p className="note-text">
              <Colored text={comment.text.trim()} language={MARKDOWN} />
            </p>
          </article>
        );
      })}
    </section>
  );
}
