import type { ReactNode } from 'react';

/**
 * Ein Branch als Symbol im Text: eine Linie mit einem abzweigenden Ast. Es ist so groß wie die
 * Schrift daneben und ersetzt das Zeichen ⑂, das klein wie ein Pfeil nach unten aussieht.
 */
export function BranchIcon() {
  return (
    <svg className="icon-inline" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 4.5v7M11 6c0 3-6 2.5-6 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="3.25" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="12.75" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="4.25" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Ein Symbol der Menüs und der Kopfzeile, gezeichnet als Umriss auf 16 × 16. */
function Outline({ size, width = 1.5, children }: { size: number; width?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Ein Ordner als Knopf für das Menü der Repos. */
export function FolderIcon() {
  return (
    <Outline size={15}>
      <path d="M2 4.5C2 3.7 2.6 3 3.5 3h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5h-9C2.6 13.5 2 12.8 2 12z" />
    </Outline>
  );
}

/** Ein Fenster mit Eingabeaufforderung: im Terminal öffnen. */
export function TerminalIcon() {
  return (
    <Outline size={15}>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" />
      <path d="M4.5 6.5 6.5 8l-2 1.5M8 10h3" />
    </Outline>
  );
}

/** Ein Hammer: das Menü der Werkstatt und die Probe. */
export function WorkshopIcon() {
  return (
    <Outline size={15}>
      <rect x="2.5" y="2" width="9" height="4" rx="1" />
      <path d="M11.5 4h2M7 6v8" />
    </Outline>
  );
}

/** Ein Funke aus vier Strahlen: in Claude Code öffnen. */
export function ClaudeIcon() {
  return (
    <Outline size={15}>
      <path d="M8 2v4M8 10v4M2 8h4M10 8h4M3.8 3.8l2.4 2.4M9.8 9.8l2.4 2.4M12.2 3.8 9.8 6.2M6.2 9.8l-2.4 2.4" />
    </Outline>
  );
}

/** Ein Graph mit Abzweig wie in einem Git-Client: in Fork öffnen. */
export function GitClientIcon() {
  return (
    <Outline size={15}>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 2.5-4.5 2-6.5 4" />
    </Outline>
  );
}

/** Der Haken vor dem aktuellen Eintrag eines Menüs. */
export function CheckMarkIcon() {
  return (
    <Outline size={14} width={2.2}>
      <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
    </Outline>
  );
}

/** Der Pfeil einer Gruppe: nach unten, wenn sie offen ist, sonst nach rechts. */
export function ChevronIcon({ open, size = 12 }: { open: boolean; size?: number }) {
  return (
    <Outline size={size} width={size < 10 ? 2.4 : 2}>
      <polyline points={open ? '4 6 8 10 12 6' : '6 4 10 8 6 12'} />
    </Outline>
  );
}

/** Ein Haus für den Ordner eines Worktrees, so groß wie die kleine Schrift daneben. */
export function HouseIcon() {
  return (
    <Outline size={11} width={1.6}>
      <path d="M2.5 7.5 8 2.75l5.5 4.75V13.5h-11z" />
    </Outline>
  );
}

/** Eine Wolke für ein Remote. */
export function CloudIcon() {
  return (
    <Outline size={14}>
      <path d="M4.75 12.5h6.5a3 3 0 0 0 .3-5.98 3.75 3.75 0 0 0-7.2 1.05A2.5 2.5 0 0 0 4.75 12.5z" />
    </Outline>
  );
}

/** Ein Pfeil im Kreis: die Branches eines Remotes holen. */
export function FetchIcon() {
  return (
    <Outline size={14}>
      <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v3h-3" />
    </Outline>
  );
}

/** Die Lupe im Filterfeld. */
export function SearchIcon() {
  return (
    <Outline size={14} width={1.7}>
      <circle cx="7" cy="7" r="4.75" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </Outline>
  );
}

/** Das × zum Schließen oder Ausschließen eines Eintrags. */
export function CloseIcon() {
  return (
    <Outline size={12} width={1.8}>
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </Outline>
  );
}

/** Ein Rahmen mit einem Pfeil nach außen: in einem neuen Tab öffnen. */
export function LinkIcon() {
  return (
    <Outline size={14}>
      <path d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5v2.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 3 12V6a1.5 1.5 0 0 1 1.5-1.5H7" />
    </Outline>
  );
}

/** Ein Fenster mit Titelleiste: die Ansicht ist schon in einem Tab offen. */
export function WindowIcon() {
  return (
    <Outline size={14}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <line x1="2" y1="6" x2="14" y2="6" />
    </Outline>
  );
}

/** Ein Auge wie in Fork, durchgestrichen für einen ausgeblendeten Branch. */
export function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <Outline size={15}>
      <path d="M1.75 8s2.25-4.5 6.25-4.5S14.25 8 14.25 8 12 12.5 8 12.5 1.75 8 1.75 8z" />
      <circle cx="8" cy="8" r="2" />
      {crossed && <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" />}
    </Outline>
  );
}

/** Das Symbol einer Seitenleiste wie in macOS: ein Rahmen mit einem Streifen links. */
export function SidebarIcon() {
  return (
    <Outline size={15}>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <line x1="6" y1="2.75" x2="6" y2="13.25" />
    </Outline>
  );
}

/** Ein „i“ im Kreis als Knopf für die Angaben zum gewählten Commit. */
export function InfoIcon() {
  return (
    <Outline size={15}>
      <circle cx="8" cy="8" r="6.25" />
      <line x1="8" y1="7.25" x2="8" y2="11.25" />
      <circle cx="8" cy="4.75" r="0.4" fill="currentColor" />
    </Outline>
  );
}

/** Ein Branch, der abzweigt, wie im Graphen der Commit-Liste. */
export function GraphIcon() {
  return (
    <Outline size={15}>
      <path d="M5 2.5v11M5 10c0-3.5 3-5 6.5-5.5" />
      <circle cx="11.75" cy="4.5" r="1.5" />
    </Outline>
  );
}

/** Eine Stoppuhr für den Timer. */
export function StopwatchIcon() {
  return (
    <Outline size={15}>
      <circle cx="8" cy="9" r="5" />
      <line x1="8" y1="9" x2="8" y2="6.5" />
      <line x1="6.5" y1="2" x2="9.5" y2="2" />
    </Outline>
  );
}

/** Eine Sprechblase: ein Hinweis zur Überarbeitung. */
export function NoteIcon({ size = 14 }: { size?: number }) {
  return (
    <Outline size={size}>
      <path d="M3.5 2.5h9c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5H8l-3 2.5v-2.5H3.5c-.8 0-1.5-.7-1.5-1.5V4c0-.8.7-1.5 1.5-1.5z" />
      <path d="M5 5.5h6M5 8h4" />
    </Outline>
  );
}

/** Ein Papierkorb: einen Eintrag löschen. */
export function TrashIcon() {
  return (
    <Outline size={13}>
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4" />
    </Outline>
  );
}

/** Zwei Karten hintereinander: ein Projekt, also eine Sammlung von Tabs. */
export function ProjectIcon() {
  return (
    <Outline size={14}>
      <rect x="2" y="5" width="10" height="8.5" rx="1.5" />
      <path d="M4.5 2.5h8a1.5 1.5 0 0 1 1.5 1.5v6.5" />
    </Outline>
  );
}

/** Ein Bleistift: einen Namen ändern. */
export function PencilIcon() {
  return (
    <Outline size={13}>
      <path d="M10.5 2.5l3 3-8 8H2.5v-3z M9 4l3 3" />
    </Outline>
  );
}

/** Ein Dreieck mit Ausrufezeichen: eine Ansicht, die es nicht mehr gibt. */
export function WarningIcon({ size = 13 }: { size?: number }) {
  return (
    <Outline size={size}>
      <path d="M8 2.25 14.25 13.25H1.75z" />
      <line x1="8" y1="6.5" x2="8" y2="9.5" />
      <circle cx="8" cy="11.4" r="0.4" fill="currentColor" />
    </Outline>
  );
}

/** Ein Plus: etwas Neues anlegen. */
export function PlusIcon() {
  return (
    <Outline size={13}>
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </Outline>
  );
}

/** Ein QR-Code: drei Quadrate in den Ecken und Punkte daneben, für den Kurzlink. */
export function QrIcon() {
  return (
    <Outline size={14} width={1.3}>
      <rect x="2.5" y="2.5" width="4" height="4" rx="0.5" />
      <rect x="9.5" y="2.5" width="4" height="4" rx="0.5" />
      <rect x="2.5" y="9.5" width="4" height="4" rx="0.5" />
      <path d="M9.5 9.5h1.5M12.5 9.5h1M9.5 12v1.5M11.5 11.5h2v2" />
    </Outline>
  );
}
