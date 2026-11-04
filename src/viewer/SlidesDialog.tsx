import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { slidesUploadData, uploadWerkstattSlides } from '../server/repo.functions';
import type { SlidesUploadData } from '../server/repo.functions';
import type { UploadResult } from '../server/slides';

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Der Name ohne Endung, wie ihn der Server prüft; leer, wenn er nicht taugt. */
function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\.(pptx|pdf)$/i, '');
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : '';
}

/**
 * Der Dialog „PDF hochladen“, siehe `docs/folien.md`. Er nennt Folien-Repo und Namen, beim ersten Mal
 * mit Vorschlag, danach mit der gemerkten Zuordnung. „Hochladen“ erzeugt das PDF in PowerPoint und
 * pusht beide Dateien. Danach zeigt er den Link zum PDF zum Kopieren.
 */
export function SlidesDialog({
  worktree,
  file,
  onDone,
  onClose,
}: {
  worktree: string;
  /** Die PowerPoint-Datei als Pfad im Worktree von `werkstatt`. */
  file: string;
  /** Lädt den Stand der Werkstatt neu, nachdem hochgeladen wurde. */
  onDone: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<SlidesUploadData | null>(null);
  const [repo, setRepo] = useState('');
  const [name, setName] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    slidesUploadData({ data: { worktree, file } }).then(
      (loaded) => {
        setData(loaded);
        setRepo(loaded.saved?.repo ?? loaded.repos[0]?.name ?? '');
        setName(loaded.saved?.name ?? loaded.suggestion);
      },
      (failure: unknown) => {
        setError(messageOf(failure));
      },
    );
  }, []);
  const clean = cleanName(name);
  const chosen = data?.repos.find((candidate) => candidate.name === repo) ?? null;
  const upload = (event: FormEvent) => {
    event.preventDefault();
    if (running || chosen === null || clean === '') {
      return;
    }
    setRunning(true);
    setError(null);
    uploadWerkstattSlides({ data: { worktree, file, repo, name: clean } }).then(
      (uploaded) => {
        setRunning(false);
        setResult(uploaded);
        onDone();
      },
      (failure: unknown) => {
        setRunning(false);
        setError(messageOf(failure));
        onDone();
      },
    );
  };
  const copy = (url: string) => {
    setError(null);
    navigator.clipboard.writeText(url).then(
      () => {
        setNote('Der Link liegt in der Zwischenablage.');
      },
      (failure: unknown) => {
        setError(`Der Link ließ sich nicht kopieren: ${messageOf(failure)}`);
      },
    );
  };
  const fileName = file.slice(file.lastIndexOf('/') + 1);
  return (
    <dialog
      ref={dialog}
      className="sync-dialog gist-dialog slides-dialog"
      aria-labelledby="slides-title"
      onCancel={(event) => {
        if (running) {
          event.preventDefault();
        } else {
          onClose();
        }
      }}
    >
      <form onSubmit={upload}>
        <h2 id="slides-title">PDF hochladen</h2>
        {result === null ? (
          <>
            <p>
              PowerPoint speichert <b>{fileName}</b> als PDF. Danach werden beide Dateien ins Folien-Repo
              committet und gepusht.
            </p>
            {data === null && error === null && <p className="sync-quiet">Liest die Folien-Repos …</p>}
            {data?.problems.map((problem) => (
              <p key={problem} className="sync-error">
                {problem}
              </p>
            ))}
            {data !== null && data.repos.length > 0 && (
              <>
                <label className="shortlink-label" htmlFor="slides-repo">
                  Folien-Repo
                </label>
                <select
                  id="slides-repo"
                  className="menu-input"
                  value={repo}
                  disabled={running}
                  onChange={(event) => {
                    setRepo(event.target.value);
                  }}
                >
                  {data.repos.map((candidate) => (
                    <option key={candidate.name} value={candidate.name}>
                      {candidate.github ?? candidate.name}
                    </option>
                  ))}
                </select>
                <label className="shortlink-label" htmlFor="slides-name">
                  Name ohne Endung
                </label>
                <input
                  id="slides-name"
                  className="menu-input"
                  type="text"
                  value={name}
                  disabled={running}
                  autoFocus
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
                {clean === '' ? (
                  <p className="sync-error">Erlaubt sind Buchstaben, Ziffern, Punkt, Unter- und Bindestrich.</p>
                ) : (
                  <p className="sync-quiet">
                    {clean}.pptx und {clean}.pdf in {chosen?.github ?? repo}
                  </p>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <p>
              {result.committed
                ? 'PDF erzeugt, beide Dateien committet und gepusht.'
                : 'Die PowerPoint-Datei liegt unverändert samt PDF im Folien-Repo. Es gab nichts zu tun.'}
            </p>
            {result.url !== null && (
              <p>
                <span className="sync-path">{result.url}</span>
              </p>
            )}
          </>
        )}
        {running && <p className="sync-quiet">PowerPoint speichert das PDF, danach wird gepusht …</p>}
        {note !== null && <p className="sync-quiet">{note}</p>}
        {error !== null && <p className="sync-error">{error}</p>}
        <div className="sync-buttons">
          {result === null ? (
            <>
              <button type="button" className="tool" disabled={running} onClick={onClose}>
                Abbrechen
              </button>
              <button type="submit" className="tool tool-primary" disabled={running || chosen === null || clean === ''}>
                {running ? 'Läuft …' : 'Hochladen'}
              </button>
            </>
          ) : (
            <>
              {result.url !== null && (
                <button
                  type="button"
                  className="tool"
                  onClick={() => {
                    if (result.url !== null) {
                      copy(result.url);
                    }
                  }}
                >
                  Link kopieren
                </button>
              )}
              <button type="button" className="tool tool-primary" autoFocus onClick={onClose}>
                Schließen
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
