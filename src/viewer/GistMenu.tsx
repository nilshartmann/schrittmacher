import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { openGist } from '../server/repo.functions';
import type { SavedGist } from '../server/store';
import { CopyIcon } from './HoverTools';
import { LinkIcon, PlusIcon } from './Icons';
import { MenuItem, MenuNote } from './Menu';

/** Was die Bestätigung vor dem Hochladen nennt, siehe `checkGist`. */
export interface GistCheck {
  name: string;
  description: string;
  replaces: boolean;
}

/** Die Gists des Repos und das Kopieren einer Datei hinein, für eine bestimmte Datei. */
export interface GistCopy {
  /** Der Name der Datei im Gist. */
  name: string;
  load: () => Promise<SavedGist[]>;
  check: (id: string) => Promise<GistCheck>;
  upload: (id: string) => Promise<void>;
  /** Legt einen Gist mit der Datei an und liefert seine URL. */
  create: (description: string) => Promise<string>;
  /** Nimmt einen vorhandenen Gist über seine URL oder Kennung auf und liefert seine Kennung. */
  add: (gist: string) => Promise<string>;
}

/** Der Dialog, den eine Wahl im Abschnitt „Gists“ öffnet. */
export type GistRequest = { kind: 'upload'; id: string } | { kind: 'new' } | { kind: 'add' };

/** Die URL eines Gists; GitHub leitet sie auf die mit dem Namen des Besitzers um. */
export function gistUrl(id: string): string {
  return `https://gist.github.com/${id}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Der Abschnitt „Gists“ im Untermenü „Kopieren nach …“, siehe `docs/gist.md`. Ein Klick auf einen
 * Gist, auf „Neuer Gist …“ oder auf „Gist eintragen …“ öffnet über `onRequest` einen Dialog. Beim
 * Überfahren hat jeder Gist Knöpfe, die ihn im Standardbrowser des Macs öffnen oder seine URL
 * kopieren; danach schließt `onDone` das Menü.
 */
export function GistSection({
  gists,
  onRequest,
  onDone,
}: {
  gists: GistCopy;
  onRequest: (request: GistRequest) => void;
  onDone: () => void;
}) {
  const [list, setList] = useState<SavedGist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Geladen wird einmal beim Öffnen, auch wenn `gists` bei jedem Rendern neu entsteht.
  const load = useRef(gists.load);
  useEffect(() => {
    load.current().then(setList, (failure: unknown) => {
      setList([]);
      setError(messageOf(failure));
    });
  }, []);
  const browse = (id: string) => {
    openGist({ data: { id } }).then(onDone, (failure: unknown) => {
      setError(messageOf(failure));
    });
  };
  const copyUrl = (id: string) => {
    navigator.clipboard.writeText(gistUrl(id)).then(onDone, (failure: unknown) => {
      setError(`Die URL ließ sich nicht kopieren: ${messageOf(failure)}`);
    });
  };
  return (
    <>
      <div className="menu-section">Gists</div>
      {list === null && <p className="menu-note">Lädt …</p>}
      {list?.map((gist) => (
        <div key={gist.id} className="menu-row">
          <MenuItem
            main={gist.description || 'Ohne Beschreibung'}
            sub={`Secret Gist ${gist.id.slice(0, 8)}`}
            tip={gistUrl(gist.id)}
            onChoose={() => {
              onRequest({ kind: 'upload', id: gist.id });
            }}
          />
          <span className="menu-actions">
            <button
              type="button"
              className="menu-action"
              aria-label="Im Browser öffnen"
              data-tip="Im Browser öffnen"
              onClick={() => {
                browse(gist.id);
              }}
            >
              <LinkIcon />
            </button>
            <button
              type="button"
              className="menu-action"
              aria-label="URL kopieren"
              data-tip="URL kopieren"
              onClick={() => {
                copyUrl(gist.id);
              }}
            >
              <CopyIcon />
            </button>
          </span>
        </div>
      ))}
      <div className="menu-row">
        <MenuItem
          main="Neuer Gist …"
          icon={<PlusIcon />}
          tip="Einen secret Gist mit dieser Datei anlegen"
          onChoose={() => {
            onRequest({ kind: 'new' });
          }}
        />
      </div>
      <div className="menu-row">
        <MenuItem
          main="Gist eintragen …"
          icon={<LinkIcon />}
          tip="Einen vorhandenen Gist über seine URL aufnehmen"
          onChoose={() => {
            onRequest({ kind: 'add' });
          }}
        />
      </div>
      {error !== null && <MenuNote error>{error}</MenuNote>}
    </>
  );
}

type Step =
  | { kind: 'checking'; id: string }
  | { kind: 'confirm'; id: string; check: GistCheck }
  | { kind: 'new' }
  | { kind: 'add' }
  | { kind: 'failed'; message: string };

/**
 * Der Dialog zu einer Wahl im Abschnitt „Gists“. Beim Hochladen nennt er vorher, ob die Datei neu
 * hinzukommt oder eine vorhandene ersetzt; der Fokus steht auf „Hochladen“, damit Return bestätigt.
 * Ein neuer Gist braucht eine Beschreibung, seine URL landet danach in der Zwischenablage. Ein
 * eingetragener Gist führt gleich zur Bestätigung für die Datei. Escape und „Abbrechen“ schließen
 * den Dialog, solange nichts läuft.
 */
export function GistDialog({
  gists,
  request,
  onClose,
}: {
  gists: GistCopy;
  request: GistRequest;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>(request.kind === 'upload' ? { kind: 'checking', id: request.id } : request);
  const [value, setValue] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  // Geprüft wird bei jedem Wechsel zu einem Gist, auch wenn `gists` bei jedem Rendern neu entsteht.
  const check = useRef(gists.check);
  const checking = step.kind === 'checking' ? step.id : null;
  useEffect(() => {
    if (checking === null) {
      return;
    }
    check.current(checking).then(
      (result) => {
        setStep({ kind: 'confirm', id: checking, check: result });
      },
      (failure: unknown) => {
        setStep({ kind: 'failed', message: messageOf(failure) });
      },
    );
  }, [checking]);

  const run = (note: string, work: Promise<unknown>, then: () => void) => {
    setRunning(note);
    setError(null);
    work.then(then, (failure: unknown) => {
      setRunning(null);
      setError(messageOf(failure));
    });
  };
  const upload = (id: string) => {
    run('Lädt hoch …', gists.upload(id), onClose);
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    const url = gists.create(value.trim());
    // Safari legt nach einer Anfrage an den Server nichts mehr in die Zwischenablage. Mit einem
    // `ClipboardItem` geht das noch im Klick, die URL folgt nach.
    const copied = navigator.clipboard.write([
      new ClipboardItem({ 'text/plain': url.then((text) => new Blob([text], { type: 'text/plain' })) }),
    ]);
    run('Legt den Gist an …', url, () => {
      copied.then(onClose, () => {
        setRunning(null);
        void url.then((text) => {
          setError(`Der Gist ist angelegt, seine URL ließ sich aber nicht kopieren: ${text}`);
        });
      });
    });
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    const added = gists.add(value.trim());
    run('Liest den Gist …', added, () => {
      setRunning(null);
      void added.then((id) => {
        setStep({ kind: 'checking', id });
      });
    });
  };

  let title: string;
  let body: ReactNode;
  let primary: ReactNode = null;
  if (step.kind === 'new' || step.kind === 'add') {
    const isNew = step.kind === 'new';
    title = isNew ? 'Neuer Gist' : 'Gist eintragen';
    body = (
      <>
        <p>
          {isNew
            ? `Legt einen secret Gist mit „${gists.name}“ an. Seine URL landet danach in der Zwischenablage.`
            : 'Nimmt einen vorhandenen Gist in die Liste dieses Repos auf.'}
        </p>
        <input
          className="menu-input"
          type="text"
          placeholder={isNew ? 'Beschreibung des Gists' : 'URL oder Kennung des Gists'}
          aria-label={isNew ? 'Beschreibung des Gists' : 'URL oder Kennung des Gists'}
          value={value}
          autoFocus
          disabled={running !== null}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </>
    );
    primary = (
      <button type="submit" className="tool tool-primary" disabled={running !== null || value.trim() === ''}>
        {isNew ? 'Anlegen' : 'Eintragen'}
      </button>
    );
  } else if (step.kind === 'confirm') {
    title = 'In Gist hochladen';
    body = (
      <p>
        <b>{step.check.name}</b> {step.check.replaces ? 'ersetzt die vorhandene Datei' : 'kommt neu hinzu'} in{' '}
        <b>{step.check.description || step.id}</b>.
      </p>
    );
    const id = step.id;
    primary = (
      <button
        type="button"
        className="tool tool-primary"
        autoFocus
        disabled={running !== null}
        onClick={() => {
          upload(id);
        }}
      >
        Hochladen
      </button>
    );
  } else {
    title = 'In Gist hochladen';
    body = step.kind === 'checking' ? <p className="sync-quiet">Prüft den Gist …</p> : null;
    if (step.kind === 'failed') {
      body = <p className="sync-error">{step.message}</p>;
    }
  }
  const onSubmit = step.kind === 'new' ? create : step.kind === 'add' ? add : undefined;
  return (
    <dialog
      ref={dialog}
      className="sync-dialog gist-dialog"
      aria-labelledby="gist-title"
      onCancel={(event) => {
        if (running !== null) {
          event.preventDefault();
        } else {
          onClose();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          if (onSubmit === undefined) {
            event.preventDefault();
          } else {
            onSubmit(event);
          }
        }}
      >
        <h2 id="gist-title">{title}</h2>
        {body}
        {running !== null && <p className="sync-quiet">{running}</p>}
        {error !== null && <p className="sync-error">{error}</p>}
        <div className="sync-buttons">
          <button type="button" className="tool" disabled={running !== null} onClick={onClose}>
            Abbrechen
          </button>
          {primary}
        </div>
      </form>
    </dialog>
  );
}
