import { useEffect, useRef, useState } from 'react';
import { saveSettings } from '../server/repo.functions';
import { LIST_HEIGHT } from './CommitList';
import { FILES_WIDTH } from './FileList';
import { NOTES_WIDTH } from './Notes';

export const FONT_SIZES = { min: 9, max: 24, start: 12 };

/** Die Zahl der Zeilen um jede Änderung, ohne „ganze Datei“. */
export const CONTEXT = { min: 0, max: 30, start: 3, step: 3 };

/**
 * Die Einstellungen der Oberfläche. Sie gelten für alle Ansichten gleich, weil sie am Bildschirm
 * unter Sidecar hängen und nicht am Workshop.
 */
export interface Settings {
  fontSize: number;
  wrap: boolean;
  sideBySide: boolean;
  /** Der Anteil der linken Seite nebeneinander. */
  share: number;
  showRemoved: boolean;
  whole: boolean;
  context: number;
  filesOpen: boolean;
  filesWidth: number;
  /** Ob rechts vom Diff die Spalte mit den Hinweisen zur Überarbeitung steht. */
  notesOpen: boolean;
  notesWidth: number;
  /** Die Höhe des Felds für einen Hinweis, wenn sie von Hand gezogen wurde; sonst wächst es mit. */
  noteHeight: number | null;
  listHeight: number;
  /** Ob die Commit-Liste alle Branches zeigt; der Server liest das beim Laden. */
  allBranches: boolean;
  /**
   * Das Ende des Vortrags in Millisekunden seit 1970, ohne Timer `null`. Es steht hier, damit der
   * Timer ein Neuladen der Web-App übersteht.
   */
  timerEnd: number | null;
  /** Die Wurzel, deren Projekte das Menü der Repos zeigt, wie in `config.json`; `null` für alle. */
  root: string | null;
}

const DEFAULTS: Settings = {
  fontSize: FONT_SIZES.start,
  wrap: false,
  sideBySide: true,
  share: 0.5,
  showRemoved: true,
  whole: false,
  context: CONTEXT.start,
  filesOpen: true,
  filesWidth: FILES_WIDTH.start,
  notesOpen: false,
  notesWidth: NOTES_WIDTH.start,
  noteHeight: null,
  listHeight: LIST_HEIGHT.start,
  allBranches: false,
  timerEnd: null,
  root: null,
};

/** Die Zeit in Millisekunden, nach der eine Änderung gespeichert wird, wenn keine weitere folgt. */
const SAVE_DELAY = 400;

function number(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Die gespeicherten Einstellungen; was fehlt oder nicht passt, hat seine Vorgabe. */
export function settingsOf(raw: Record<string, unknown>): Settings {
  return {
    fontSize: number(raw.fontSize, DEFAULTS.fontSize, FONT_SIZES.min, FONT_SIZES.max),
    wrap: flag(raw.wrap, DEFAULTS.wrap),
    sideBySide: flag(raw.sideBySide, DEFAULTS.sideBySide),
    share: number(raw.share, DEFAULTS.share, 0.05, 0.95),
    showRemoved: flag(raw.showRemoved, DEFAULTS.showRemoved),
    whole: flag(raw.whole, DEFAULTS.whole),
    context: number(raw.context, DEFAULTS.context, CONTEXT.min, CONTEXT.max),
    filesOpen: flag(raw.filesOpen, DEFAULTS.filesOpen),
    filesWidth: number(raw.filesWidth, DEFAULTS.filesWidth, FILES_WIDTH.min, 2000),
    notesOpen: flag(raw.notesOpen, DEFAULTS.notesOpen),
    notesWidth: number(raw.notesWidth, DEFAULTS.notesWidth, NOTES_WIDTH.min, 2000),
    noteHeight: typeof raw.noteHeight === 'number' && Number.isFinite(raw.noteHeight) ? raw.noteHeight : DEFAULTS.noteHeight,
    listHeight: number(raw.listHeight, DEFAULTS.listHeight, LIST_HEIGHT.min, 2000),
    allBranches: flag(raw.allBranches, DEFAULTS.allBranches),
    timerEnd: typeof raw.timerEnd === 'number' && Number.isFinite(raw.timerEnd) ? raw.timerEnd : DEFAULTS.timerEnd,
    root: typeof raw.root === 'string' ? raw.root : DEFAULTS.root,
  };
}

/**
 * Die Einstellungen, anfangs aus `saved`, und eine Funktion, die einen Teil ändert. Jede Änderung
 * wird kurz danach im Server gespeichert, beim Ziehen einer Trennlinie also nur am Ende. Die
 * dritte Funktion speichert sofort, für eine Einstellung, die der Server beim Laden braucht.
 */
export function useSettings(
  saved: Record<string, unknown>,
): [Settings, (change: Partial<Settings>) => void, (change: Partial<Settings>) => Promise<void>] {
  const [settings, setSettings] = useState(() => settingsOf(saved));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      saveSettings({ data: { ...settings } }).catch((error: unknown) => {
        console.error('Die Einstellungen ließen sich nicht speichern.', error);
      });
    }, SAVE_DELAY);
    return () => {
      clearTimeout(timer);
    };
  }, [settings]);
  const set = (change: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...change }));
  };
  const saveNow = (change: Partial<Settings>) => {
    const next = { ...settings, ...change };
    setSettings(next);
    return saveSettings({ data: { ...next } });
  };
  return [settings, set, saveNow];
}
