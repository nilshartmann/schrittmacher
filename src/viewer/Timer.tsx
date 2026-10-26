import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { StopwatchIcon } from './Icons';
import { Menu, MenuItem, MenuNote } from './Menu';

/** Die Länge des Vortrags in Minuten, die im Feld steht, und die der Schnellwahl. */
const MINUTES = { start: 60, quick: 45, max: 600 };

/** Der Titel des Fensters ohne Timer, wie ihn `__root.tsx` setzt. */
const TITLE = 'Schrittmacher';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

interface TimerProps {
  /** Das Ende des Vortrags in Millisekunden seit 1970, ohne Timer `null`. */
  end: number | null;
  onEnd: (end: number | null) => void;
}

/**
 * Der Timer für einen Vortrag: ein Knopf in der Kopfzeile, dessen Menü ihn startet und beendet.
 * Solange er läuft, nennt der Titel des Fensters die Uhrzeit und die verbleibende Zeit, und die
 * Plakette am Symbol der Web-App im Dock die verbleibenden Minuten. Die Plakette erscheint auch
 * beim Wechsel der App mit ⌘-Tab, wo der Titel des Fensters fehlt.
 */
export function Timer({ end, onEnd }: TimerProps) {
  const now = useNow(end);
  useEffect(() => {
    const title = end === null ? TITLE : `${clock(now)} - ${remaining(end - now)} - ${TITLE}`;
    if (document.title !== title) {
      document.title = title;
    }
  }, [end, now]);
  // Ohne Timer `null`, nach dem Ende 0 für eine Plakette ohne Zahl.
  const badge = end === null ? null : Math.max(0, Math.ceil((end - now) / MINUTE));
  useEffect(() => {
    showBadge(badge);
  }, [badge]);
  useEffect(
    () => () => {
      document.title = TITLE;
      showBadge(null);
    },
    [],
  );

  return (
    <Menu
      button={<StopwatchIcon />}
      label="Timer"
      tip={end === null ? 'Timer für den Vortrag starten' : `Timer: noch ${remaining(end - now)}`}
      className={end === null ? 'bar-tool' : 'bar-tool bar-tool-active'}
      panelClassName="menu-panel-narrow"
      end
    >
      {(close) =>
        end === null ? (
          <TimerStart
            onStart={(minutes) => {
              askForBadge();
              onEnd(Date.now() + minutes * MINUTE);
              close();
            }}
          />
        ) : (
          <>
            <MenuNote>
              {end > now ? `Noch ${remaining(end - now)}, Ende um ${clock(end)}` : `Seit ${clock(end)} vorbei`}
            </MenuNote>
            <MenuItem
              main="Timer beenden"
              onChoose={() => {
                onEnd(null);
                close();
              }}
            />
          </>
        )
      }
    </Menu>
  );
}

/** Das Feld für die Länge des Vortrags, mit der Schnellwahl daneben. */
function TimerStart({ onStart }: { onStart: (minutes: number) => void }) {
  const [text, setText] = useState(String(MINUTES.start));
  const minutes = Number(text);
  const valid = Number.isInteger(minutes) && minutes > 0 && minutes <= MINUTES.max;
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) {
      onStart(minutes);
    }
  };
  return (
    <form className="timer-form" onSubmit={onSubmit}>
      <input
        className="menu-input timer-minutes"
        type="number"
        min={1}
        max={MINUTES.max}
        value={text}
        aria-label="Länge des Vortrags in Minuten"
        autoFocus
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <span className="timer-unit">Min</span>
      <button type="submit" className="tool tool-primary" disabled={!valid}>
        Starten
      </button>
      <button
        type="button"
        className="tool"
        data-tip={`Mit ${String(MINUTES.quick)} Minuten starten`}
        onClick={() => {
          onStart(MINUTES.quick);
        }}
      >
        {MINUTES.quick} Min
      </button>
    </form>
  );
}

/**
 * Die Zeit in Millisekunden, solange ein Timer läuft. Sie wird kurz nach jedem Sprung der Sekunden
 * bis `end` neu gesetzt, damit keine Sekunde in der Anzeige doppelt steht oder fehlt.
 */
function useNow(end: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (end === null) {
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const offset = (((end - Date.now()) % SECOND) + SECOND) % SECOND;
      timer = setTimeout(() => {
        setNow(Date.now());
        next();
      }, offset + 5);
    };
    next();
    return () => {
      clearTimeout(timer);
    };
  }, [end]);
  return now;
}

/**
 * Zeigt die Plakette am Symbol der Web-App im Dock: die Zahl, bei 0 einen Punkt, bei `null` keine.
 * Ein Browser ohne Badging API und eine Plakette ohne Erlaubnis bleiben ohne Fehler.
 */
function showBadge(minutes: number | null): void {
  if (!('setAppBadge' in navigator)) {
    return;
  }
  const shown =
    minutes === null
      ? navigator.clearAppBadge()
      : minutes === 0
        ? navigator.setAppBadge()
        : navigator.setAppBadge(minutes);
  shown.catch((error: unknown) => {
    console.warn('Die Plakette des Timers ließ sich nicht zeigen.', error);
  });
}

/**
 * Fragt einmal nach der Erlaubnis für Mitteilungen, die Safari für die Plakette einer Web-App
 * verlangen kann. Das geht nur beim Klick, deshalb beim Start des Timers.
 */
function askForBadge(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

/** Die Uhrzeit mit Stunden und Minuten, etwa `14:32`. */
function clock(time: number): string {
  return new Date(time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Die verbleibende Zeit als Minuten und Sekunden, angefangene Sekunden aufgerundet, damit bei 60
 * Minuten zuerst `60:00` steht. Nach dem Ende zählt die Überziehung mit Plus, etwa `+03:12`.
 */
function remaining(left: number): string {
  const seconds = Math.ceil(Math.abs(left) / SECOND);
  const text = `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  return left > 0 ? text : `+${text}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
