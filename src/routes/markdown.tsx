import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { loadMarkdown, markdownChanged } from '../server/markdown.functions';
import type { MarkdownFile } from '../server/markdown.functions';
import { MarkdownView, fileScope } from '../viewer/Markdown';
import { marksOf } from '../notes/markdownNotes';
import type { MdMark, MdScope } from '../notes/markdownNotes';
import { NoteIcon } from '../viewer/Icons';
import { MarkdownNotesColumn, useMarkdownNotes } from '../viewer/MarkdownNotes';
import { Tooltips } from '../viewer/Tooltips';
import { useRequests } from '../viewer/useRequests';

/** Der Abstand der Fragen, ob sich die Datei geändert hat, in Millisekunden. */
const CHANGE_INTERVAL = 1500;

/** Die Schriftgröße der Ansicht in Pixeln, mit ihren Grenzen; gemerkt wird sie im Browser. */
const FONT_SIZE = { initial: 16, min: 12, max: 28, key: 'schrittmacher.markdown.fontSize' };

/** So lange bleiben die Hinweise einer angeklickten Markierung hervorgehoben, in Millisekunden. */
const FOCUS_DURATION = 1600;

/** Unter diesem Schlüssel merkt sich der Browser, ob die Hinweise eingeschaltet sind. */
const NOTING_KEY = 'schrittmacher.markdown.noting';

export const Route = createFileRoute('/markdown')({
  validateSearch: (search: Record<string, unknown>): { path: string } => ({
    path: typeof search.path === 'string' ? search.path : '',
  }),
  loaderDeps: ({ search }) => ({ path: search.path }),
  loader: ({ deps }) => loadMarkdown({ data: { path: deps.path } }),
  gcTime: 0,
  component: Page,
  errorComponent: ({ error }) => (
    <Frame file={null}>
      <p className="empty">{error instanceof Error ? error.message : String(error)}</p>
    </Frame>
  ),
});

function Page() {
  const file = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [noting, setNoting] = useState(storedNoting);
  const [scope, setScope] = useState<MdScope | null>(null);
  const [preview, setPreview] = useState<MdScope | null>(null);
  const [draft, setDraft] = useState<MdScope | null>(null);
  const store = useMarkdownNotes(file.path, file.text, noting);
  useEffect(() => {
    setScope(null);
    setPreview(null);
    setDraft(null);
  }, [file.path]);
  // Die Zeilen eines Bezugs gelten nur für den Text, in dem er gewählt wurde; ein Entwurf bleibt.
  useEffect(() => {
    setScope((current) => (draft === null ? null : current));
    setPreview(null);
  }, [file.text]);
  const marks = useMemo(() => marksOf(store.notes, file.text), [store.notes, file.text]);
  const [focused, setFocused] = useState<string[]>([]);
  useEffect(() => {
    if (focused.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setFocused([]);
    }, FOCUS_DURATION);
    return () => {
      clearTimeout(timer);
    };
  }, [focused]);
  const showMark = (mark: MdMark) => {
    setFocused(mark.ids);
    setScope(mark.scope);
    document.querySelector(`[data-note-id="${mark.ids[0] ?? ''}"]`)?.scrollIntoView({ block: 'center' });
  };
  const startDraft = (next: MdScope) => {
    setScope(next);
    setDraft(next);
  };
  const endDraft = () => {
    setDraft(null);
    setScope(null);
  };
  // Eine geänderte Datei lädt die Seite neu, etwa während Claude daran schreibt.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      markdownChanged({ data: { path: file.path } }).then(
        (changed) => {
          if (changed !== null && changed !== file.changed) {
            void router.invalidate();
          }
        },
        () => {
          // Der Server ist kurz nicht erreichbar; die nächste Frage versucht es wieder.
        },
      );
    }, CHANGE_INTERVAL);
    return () => {
      clearInterval(timer);
    };
  }, [file.path, file.changed, router]);
  return (
    <Frame
      file={file}
      noting={noting}
      onToggleNoting={() => {
        setNoting(!noting);
        try {
          localStorage.setItem(NOTING_KEY, String(!noting));
        } catch {
          // Ohne Speicher im Browser gilt die Einstellung bis zum Schließen.
        }
        setScope(null);
        setPreview(null);
        setDraft(null);
      }}
      aside={
        noting && (
          <MarkdownNotesColumn
            path={file.path}
            name={file.name}
            text={file.text}
            store={store}
            focused={focused}
            draft={draft}
            file={fileScope(file.text)}
            onDraft={startDraft}
            onDraftDone={endDraft}
            onScope={setScope}
            onPreview={setPreview}
          />
        )
      }
    >
      <MarkdownView
        text={file.text}
        dir={file.dir}
        noting={
          noting
            ? { scope: draft ?? scope, preview, marks, onMark: showMark, drafting: draft !== null, onScope: setScope, onPreview: setPreview, onDraft: startDraft }
            : null
        }
        onOpen={(path) => {
          void navigate({ to: '/markdown', search: { path } });
        }}
      />
    </Frame>
  );
}

/** Ob die Hinweise beim letzten Mal eingeschaltet waren. */
function storedNoting(): boolean {
  try {
    return localStorage.getItem(NOTING_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Die gemerkte Schriftgröße; ohne Speicher im Browser die anfängliche. */
function storedFontSize(): number {
  try {
    const value = Number(localStorage.getItem(FONT_SIZE.key));
    return value >= FONT_SIZE.min && value <= FONT_SIZE.max ? value : FONT_SIZE.initial;
  } catch {
    return FONT_SIZE.initial;
  }
}

/**
 * Die Kopfzeile mit dem Weg zurück zu den Tabs, dem Namen und Ordner der Datei und der
 * Schriftgröße, darunter der Inhalt. Ein Ordner von `schrittmacher <ordner>` öffnet von hier aus
 * seinen Tab, eine weitere Markdown-Datei ersetzt diese.
 */
function Frame({
  file,
  children,
  noting = false,
  onToggleNoting,
  aside,
}: {
  file: MarkdownFile | null;
  children: ReactNode;
  noting?: boolean;
  onToggleNoting?: () => void;
  aside?: ReactNode;
}) {
  const navigate = useNavigate();
  const [fontSize, setFontSize] = useState(storedFontSize);
  useRequests(async (view) => {
    await navigate({ to: '/', search: view });
  });
  const changeFontSize = (step: number) => {
    const next = Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, fontSize + step));
    setFontSize(next);
    try {
      localStorage.setItem(FONT_SIZE.key, String(next));
    } catch {
      // Ohne Speicher im Browser gilt die Größe bis zum Schließen.
    }
  };
  return (
    <div className="app">
      <header className="header">
        <div className="header-start">
          <button
            type="button"
            className="md-back"
            data-tip="Zurück zu den Tabs"
            onClick={() => {
              void navigate({ to: '/' });
            }}
          >
            ‹ Tabs
          </button>
          <span className="bar-separator" />
          {file !== null && (
            <span className="md-where" data-tip={file.path}>
              <span className="md-name">{file.name}</span>
              <span className="md-dir">{file.dir}</span>
            </span>
          )}
        </div>
        <div className="header-tools">
          {onToggleNoting !== undefined && (
            <button
              type="button"
              className="md-noting"
              aria-pressed={noting}
              aria-label="Hinweise"
              data-tip={noting ? 'Hinweise ausblenden' : 'Hinweise einblenden'}
              onClick={onToggleNoting}
            >
              <NoteIcon />
            </button>
          )}
          <div className="font-size" role="group" aria-label="Schriftgröße">
            <button
              type="button"
              aria-label="Schrift kleiner"
              data-tip={`Schrift kleiner (${String(fontSize)})`}
              onClick={() => {
                changeFontSize(-1);
              }}
            >
              A−
            </button>
            <button
              type="button"
              aria-label="Schrift größer"
              data-tip={`Schrift größer (${String(fontSize)})`}
              onClick={() => {
                changeFontSize(1);
              }}
            >
              A+
            </button>
          </div>
        </div>
      </header>
      <div className="md-body">
        <main className="md-scroll" key={file?.path} style={{ fontSize: `${String(fontSize)}px` }}>
          {children}
        </main>
        {aside}
      </div>
      <Tooltips />
    </div>
  );
}
