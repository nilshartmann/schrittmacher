import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  assignShortlink,
  checkShortlinkTarget,
  createShortlink,
  saveShortlinkQr,
  shortlinkData,
  shortlinkLive,
  shortlinkQr,
} from '../server/repo.functions';
import type { ShortlinkData, Talk } from '../server/shortlink';
import type { SavedShortlink } from '../server/store';

/** So oft fragt der Dialog, ob Netlify den neuen Kurzlink schon ausliefert. */
const LIVE_INTERVAL = 5000;
/** So lange fragt er höchstens. */
const LIVE_LIMIT = 5 * 60 * 1000;
/** So lange wartet die Prüfung des Ziels nach der letzten Eingabe. */
const CHECK_DELAY = 600;
/** Die Kantenlänge des QR-Codes als Bild in der Zwischenablage. */
const PNG_SIZE = 1024;

/**
 * Die Domain zum Thema einer Veranstaltung, nach Stichwörtern in Titel und Event. Frontend steht vor
 * Spring, weil ein Vortrag zu Next.js für Java-Entwickler sonst bei spring.schule landet.
 */
const TOPICS: [RegExp, string][] = [
  [/graphql/i, 'graphql.schule'],
  [/react|next|tanstack|typescript|javascript|frontend/i, 'react.schule'],
  [/spring|java|modulith/i, 'spring.schule'],
];

/** Stichwörter, die einen vergebenen Pfad unterscheiden, das genaueste zuerst. */
const KEYWORDS = ['tanstack', 'nextjs', 'next', 'modulith', 'graphql', 'typescript', 'react', 'spring', 'ki'];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wie `slugify` der Homepage, für Vorschläge reicht die einfache Fassung. */
function simpleSlug(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replace(/[^a-z\d]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Der vorgeschlagene Pfad aus Event und Jahr, etwa `wjax-2026` oder `jughh-2026`. Ein Event aus
 * mehr als zwei Wörtern wird zu seinen Anfangsbuchstaben. Ist der Pfad vergeben, kommt ein
 * Stichwort aus dem Titel dazu, danach eine Zahl.
 */
function suggestPath(talk: Talk, taken: Set<string>): string {
  const words = simpleSlug(talk.event).split('-').filter((word) => word !== '');
  const event = words.length > 2 ? words.map((word) => word[0]).join('') : words.join('');
  const year = /\d{4}/.exec(talk.date)?.[0];
  const base = [event, year].filter((part) => part !== undefined && part !== '').join('-');
  if (!taken.has(base)) {
    return base;
  }
  const title = simpleSlug(talk.title);
  const keyword = KEYWORDS.find((word) => title.split('-').includes(word));
  const withKeyword = keyword === undefined ? base : `${base}-${keyword}`;
  let candidate = withKeyword;
  for (let count = 2; taken.has(candidate); count++) {
    candidate = `${withKeyword}-${String(count)}`;
  }
  return candidate;
}

function suggestDomain(talk: Talk, domains: string[]): string | undefined {
  const text = `${talk.title} ${talk.event}`;
  return TOPICS.find(([pattern, domain]) => pattern.test(text) && domains.includes(domain))?.[1];
}

/** Zeichnet das SVG als PNG mit weißem Grund, damit Keynote und PowerPoint es als Bild einfügen. */
export function pngOf(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = PNG_SIZE;
      canvas.height = PNG_SIZE;
      const context = canvas.getContext('2d');
      if (context === null) {
        reject(new Error('Das Bild ließ sich nicht zeichnen.'));
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, PNG_SIZE, PNG_SIZE);
      context.drawImage(image, 0, 0, PNG_SIZE, PNG_SIZE);
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error('Das Bild ließ sich nicht erzeugen.'));
        } else {
          resolve(blob);
        }
      }, 'image/png');
    };
    image.onerror = () => {
      reject(new Error('Das SVG ließ sich nicht zeichnen.'));
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * Legt den QR-Code des Kurzlinks als Bild in die Zwischenablage. Safari nimmt etwas nur im Klick
 * an; Code und Bild folgen deshalb als Promise.
 */
export function copyQr(url: string, svg?: string): Promise<void> {
  const png = (svg === undefined ? shortlinkQr({ data: { url } }) : Promise.resolve(svg)).then(pngOf);
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** Der Kurzlink, zu dem der Dialog den QR-Code zeigt; `created` nach dem Anlegen. */
interface Result {
  url: string;
  target: string;
  created: boolean;
}

/**
 * Der Dialog „Kurzlink anlegen“, siehe `docs/kurzlink.md`. Er sucht eine Veranstaltung der
 * Homepage als Ziel oder nimmt ein frei eingegebenes, schlägt Domain und Pfad vor und trägt den
 * Kurzlink im Redirect-Repo ein. Danach zeigt er den QR-Code, der sich als Bild kopieren und im
 * Worktree `werkstatt` ablegen lässt. Ein Klick auf einen vorhandenen Kurzlink zeigt dessen Code.
 */
export function ShortlinkDialog({
  worktree,
  initial = null,
  onClose,
}: {
  worktree: string | null;
  /** Ein zugeordneter Kurzlink, mit dessen QR-Code der Dialog beginnt. */
  initial?: SavedShortlink | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<ShortlinkData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<Talk | null>(null);
  const [target, setTarget] = useState('');
  const [domain, setDomain] = useState('');
  const [path, setPath] = useState('');
  const [result, setResult] = useState<Result | null>(initial === null ? null : { ...initial, created: false });
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    // `showModal` setzt den Fokus auf das erste Element. Beginnt der Dialog mit dem QR-Code, steht
    // „Schließen“ schon da und bekommt ihn über `data-autofocus`; später Erscheinendes über `autoFocus`.
    dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    shortlinkData({ data: { worktree } }).then(
      (loaded) => {
        setData(loaded);
        setDomain(loaded.domains[0]?.domain ?? '');
      },
      (failure: unknown) => {
        setLoadError(messageOf(failure));
      },
    );
  }, [worktree]);

  const talks = useMemo(() => {
    // Ohne Satz- und Leerzeichen verglichen findet „wjax“ auch „W-Jax“.
    const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\d]+/gu, '');
    const words = search.split(/\s+/).map(squash).filter((word) => word !== '');
    return (data?.talks ?? []).filter((talk) => {
      const text = squash(`${talk.title} ${talk.event} ${talk.location} ${talk.date}`);
      return words.every((word) => text.includes(word));
    });
  }, [data, search]);
  const current = data?.domains.find((candidate) => candidate.domain === domain) ?? null;
  const taken = useMemo(() => new Set(current?.redirects.map((redirect) => redirect.path)), [current]);
  const cleanPath = path.trim().replace(/^\/+/, '');
  const pathTaken = taken.has(cleanPath);
  const existing = (current?.redirects ?? []).filter((redirect) => redirect.path.includes(cleanPath)).reverse();

  const choose = (talk: Talk) => {
    setChosen(talk);
    setTarget(talk.url);
    const suggested = suggestDomain(talk, data?.domains.map((candidate) => candidate.domain) ?? []);
    const nextDomain = suggested ?? domain;
    setDomain(nextDomain);
    const redirects = data?.domains.find((candidate) => candidate.domain === nextDomain)?.redirects ?? [];
    setPath(suggestPath(talk, new Set(redirects.map((redirect) => redirect.path))));
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (current === null) {
      return;
    }
    setRunning('Trägt den Kurzlink ein und pusht …');
    setError(null);
    createShortlink({ data: { worktree, domain, path: cleanPath, target: target.trim() } }).then(
      (url) => {
        setRunning(null);
        setResult({ url, target: target.trim(), created: true });
      },
      (failure: unknown) => {
        setRunning(null);
        setError(messageOf(failure));
      },
    );
  };

  const formReady =
    running === null && current !== null && cleanPath !== '' && !pathTaken && /^https?:\/\/\S+$/.test(target.trim());

  return (
    <dialog
      ref={dialog}
      className="sync-dialog shortlink-dialog"
      aria-labelledby="shortlink-title"
      onCancel={(event) => {
        if (running !== null) {
          event.preventDefault();
        } else {
          onClose();
        }
      }}
    >
      {result === null ? (
        <form onSubmit={create}>
          <h2 id="shortlink-title">Kurzlink anlegen</h2>
          {loadError !== null && <p className="sync-error">{loadError}</p>}
          {data === null && loadError === null && <p className="sync-quiet">Liest Veranstaltungen und Kurzlinks …</p>}
          {data?.problems.map((problem) => (
            <p key={problem} className="sync-error">
              {problem}
            </p>
          ))}
          {data !== null && (
            <>
              <label className="shortlink-label" htmlFor="shortlink-search">
                Veranstaltung
              </label>
              <input
                id="shortlink-search"
                className="menu-input"
                type="search"
                placeholder="Suchen nach Titel, Event, Ort oder Datum"
                value={search}
                autoFocus
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
              <ul className="shortlink-talks" aria-label="Veranstaltungen">
                {talks.map((talk, index) => (
                  // Die Homepage kennt Seiten, die mehrere Veranstaltungen teilen; der Index bleibt eindeutig.
                  <li key={index}>
                    <button
                      type="button"
                      className={talk === chosen ? 'shortlink-talk shortlink-talk-chosen' : 'shortlink-talk'}
                      onClick={() => {
                        choose(talk);
                      }}
                    >
                      <span className="shortlink-talk-title">{talk.title}</span>
                      <span className="shortlink-talk-sub">
                        {[talk.event, talk.date, talk.location].filter((part) => part !== '').join(' · ')}
                        {talk.upcoming && <span className="shortlink-badge">kommend</span>}
                      </span>
                    </button>
                  </li>
                ))}
                {talks.length === 0 && <li className="sync-quiet">Keine Veranstaltung gefunden.</li>}
              </ul>
              <label className="shortlink-label" htmlFor="shortlink-target">
                Ziel
              </label>
              <input
                id="shortlink-target"
                className="menu-input"
                type="url"
                placeholder="https://nilshartmann.net/t/…"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                }}
              />
              <TargetCheck url={target.trim()} />
              <label className="shortlink-label" htmlFor="shortlink-path">
                Kurzlink
              </label>
              <div className="shortlink-link">
                <select
                  className="menu-input shortlink-domain"
                  aria-label="Domain"
                  value={domain}
                  onChange={(event) => {
                    setDomain(event.target.value);
                  }}
                >
                  {data.domains.map((candidate) => (
                    <option key={candidate.domain} value={candidate.domain}>
                      {candidate.domain}
                    </option>
                  ))}
                </select>
                <span className="shortlink-slash">/</span>
                <input
                  id="shortlink-path"
                  className="menu-input"
                  type="text"
                  placeholder="wjax-2026"
                  value={path}
                  onChange={(event) => {
                    setPath(event.target.value);
                  }}
                />
              </div>
              {pathTaken && <p className="sync-error">Den Pfad /{cleanPath} gibt es schon.</p>}
              <ul className="shortlink-existing" aria-label="Vorhandene Kurzlinks">
                {existing.map((redirect) => (
                  <li key={redirect.path}>
                    <button
                      type="button"
                      className="shortlink-redirect"
                      data-tip="QR-Code zeigen"
                      onClick={() => {
                        if (current !== null) {
                          setResult({ url: `${current.baseUrl}/${redirect.path}`, target: redirect.target, created: false });
                        }
                      }}
                    >
                      <span className="shortlink-redirect-path">/{redirect.path}</span>
                      <span className="shortlink-redirect-target">{redirect.target}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {running !== null && <p className="sync-quiet">{running}</p>}
          {error !== null && <p className="sync-error">{error}</p>}
          <div className="sync-buttons">
            <button type="button" className="tool" disabled={running !== null} onClick={onClose}>
              Abbrechen
            </button>
            <button type="submit" className="tool tool-primary" disabled={!formReady}>
              Anlegen
            </button>
          </div>
        </form>
      ) : (
        <QrView
          result={result}
          worktree={worktree}
          werkstatt={data?.werkstatt === true}
          assigned={result.created || (data?.assigned.some((link) => link.url === result.url) ?? false)}
          onAssigned={(link) => {
            setData((loaded) => (loaded === null ? loaded : { ...loaded, assigned: [link, ...loaded.assigned] }));
          }}
          onBack={
            result.created
              ? null
              : () => {
                  setResult(null);
                }
          }
          onClose={onClose}
        />
      )}
    </dialog>
  );
}

/** Ob das Ziel antwortet, geprüft kurz nach der letzten Eingabe. */
function TargetCheck({ url }: { url: string }) {
  const [state, setState] = useState<{ url: string; status: number | null } | null>(null);
  useEffect(() => {
    if (!/^https?:\/\/\S+$/.test(url)) {
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      checkShortlinkTarget({ data: { url } }).then(
        (status) => {
          if (current) {
            setState({ url, status });
          }
        },
        () => {
          if (current) {
            setState({ url, status: null });
          }
        },
      );
    }, CHECK_DELAY);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [url]);
  if (url === '') {
    return null;
  }
  if (!/^https?:\/\/\S+$/.test(url)) {
    return <p className="sync-error">Das Ziel braucht eine Adresse mit http oder https.</p>;
  }
  if (state?.url !== url) {
    return <p className="sync-quiet">Prüft das Ziel …</p>;
  }
  if (state.status !== null && state.status < 400) {
    return <p className="sync-quiet">Das Ziel antwortet.</p>;
  }
  return (
    <p className="shortlink-warning">
      {state.status === null
        ? 'Das Ziel antwortet nicht. Anlegen geht trotzdem, etwa für eine Seite, die noch kommt.'
        : `Das Ziel antwortet mit ${String(state.status)}. Anlegen geht trotzdem, etwa für eine Seite, die noch kommt.`}
    </p>
  );
}

/**
 * Der QR-Code zu einem Kurzlink. Nach dem Anlegen fragt der Dialog, bis Netlify den Kurzlink
 * ausliefert. Der Code lässt sich als Bild kopieren und, wenn es den Worktree gibt, in `werkstatt`
 * ablegen.
 */
function QrView({
  result,
  worktree,
  werkstatt,
  assigned,
  onAssigned,
  onBack,
  onClose,
}: {
  result: Result;
  /** Der Worktree des offenen Tabs; ohne ihn lässt sich nichts zuordnen oder ablegen. */
  worktree: string | null;
  /** Ob sein Repo einen Worktree `werkstatt` hat. */
  werkstatt: boolean;
  /** Ob der Kurzlink dem Repo schon zugeordnet ist. */
  assigned: boolean;
  onAssigned: (link: SavedShortlink) => void;
  onBack: (() => void) | null;
  onClose: () => void;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [live, setLive] = useState<'waiting' | 'live' | 'timeout'>('waiting');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    shortlinkQr({ data: { url: result.url } }).then(setSvg, (failure: unknown) => {
      setError(messageOf(failure));
    });
  }, [result.url]);

  useEffect(() => {
    if (!result.created) {
      return;
    }
    const started = Date.now();
    let stopped = false;
    const ask = () => {
      shortlinkLive({ data: { url: result.url, target: result.target } }).then(
        (isLive) => {
          if (stopped) {
            return;
          }
          if (isLive) {
            setLive('live');
          } else if (Date.now() - started > LIVE_LIMIT) {
            setLive('timeout');
          } else {
            timer = window.setTimeout(ask, LIVE_INTERVAL);
          }
        },
        () => {
          if (!stopped) {
            timer = window.setTimeout(ask, LIVE_INTERVAL);
          }
        },
      );
    };
    let timer = window.setTimeout(ask, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [result]);

  const copyUrl = () => {
    setError(null);
    navigator.clipboard.writeText(result.url).then(
      () => {
        setNote('Der Kurzlink liegt in der Zwischenablage.');
      },
      (failure: unknown) => {
        setError(`Der Kurzlink ließ sich nicht kopieren: ${messageOf(failure)}`);
      },
    );
  };
  const assign = () => {
    if (worktree === null) {
      return;
    }
    setError(null);
    const link = { url: result.url, target: result.target };
    assignShortlink({ data: { worktree, ...link } }).then(
      () => {
        onAssigned(link);
      },
      (failure: unknown) => {
        setError(messageOf(failure));
      },
    );
  };
  const copy = () => {
    if (svg === null) {
      return;
    }
    setError(null);
    copyQr(result.url, svg).then(
      () => {
        setNote('Der QR-Code liegt als Bild in der Zwischenablage.');
      },
      (failure: unknown) => {
        setError(`Das Bild ließ sich nicht kopieren: ${messageOf(failure)}`);
      },
    );
  };
  const save = () => {
    if (worktree === null || !werkstatt) {
      return;
    }
    setSaving(true);
    setError(null);
    saveShortlinkQr({ data: { worktree, url: result.url } }).then(
      (file) => {
        setSaving(false);
        setNote(`Abgelegt und auf werkstatt committet: ${file}`);
      },
      (failure: unknown) => {
        setSaving(false);
        setError(messageOf(failure));
      },
    );
  };

  return (
    <div>
      <h2 id="shortlink-title">{result.created ? 'Kurzlink angelegt' : 'QR-Code'}</h2>
      <p>
        <span className="shortlink-url">{result.url}</span>
        <span className="sync-path">→ {result.target}</span>
      </p>
      {result.created && (
        <p className={live === 'timeout' ? 'shortlink-warning' : 'sync-quiet'}>
          {live === 'waiting' && 'Wartet, bis Netlify den Kurzlink ausliefert …'}
          {live === 'live' && 'Der Kurzlink leitet auf das Ziel weiter.'}
          {live === 'timeout' && 'Nach fünf Minuten leitet der Kurzlink noch nicht weiter. Sieh bei Netlify nach.'}
        </p>
      )}
      <div className="shortlink-qr">
        {svg === null ? (
          <span className="sync-quiet">Erzeugt den QR-Code …</span>
        ) : (
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`QR-Code für ${result.url}`} />
        )}
      </div>
      <div className="shortlink-qr-tools">
        <button type="button" className="tool tool-small" onClick={copyUrl}>
          URL kopieren
        </button>
        <button type="button" className="tool tool-small" disabled={svg === null} onClick={copy}>
          QR-Code als Bild kopieren
        </button>
        <button
          type="button"
          className="tool tool-small"
          disabled={svg === null || worktree === null || !werkstatt || saving}
          data-tip={werkstatt ? undefined : 'Das Repo dieses Tabs hat keinen Worktree mit dem Branch werkstatt'}
          onClick={save}
        >
          In werkstatt ablegen
        </button>
      </div>
      {note !== null && <p className="sync-quiet">{note}</p>}
      {error !== null && <p className="sync-error">{error}</p>}
      <div className="sync-buttons">
        {onBack !== null && (
          <button type="button" className="tool shortlink-back" onClick={onBack}>
            Zurück
          </button>
        )}
        {assigned ? (
          <span className="sync-quiet shortlink-assigned">Diesem Repo zugeordnet</span>
        ) : (
          <button
            type="button"
            className="tool"
            disabled={worktree === null}
            data-tip="Das Repo-Menü bietet den Kurzlink dann zum Kopieren an"
            onClick={assign}
          >
            Diesem Repo zuordnen
          </button>
        )}
        <button type="button" className="tool tool-primary" autoFocus data-autofocus onClick={onClose}>
          Schließen
        </button>
      </div>
    </div>
  );
}
