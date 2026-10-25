// Die Typen des Git-Moduls. Das Modul importiert nichts aus React oder TanStack, damit es später
// auch in einem Server-Prozess oder in Electron läuft.

/** Ein Commit des Workshop-Repos, in der Reihenfolge der Historie. */
export interface Commit {
  sha: string;
  /** Die Nummer des Schritts vor dem Doppelpunkt, etwa `25e`. Ein Commit ohne Schritt hat keine. */
  step: string | null;
  /** Der Titel ohne die Nummer des Schritts. */
  title: string;
  author: string;
  date: string;
  /** Die SHAs der Vorgänger, der erste zuerst; der erste Commit hat keinen. */
  parents: string[];
}

/** Repo, Worktree und Branch, wie sie die Kopfzeile nennt, mit den Pfaden dazu. */
export interface RepoInfo {
  /** Der Name des Repos: der Ordner, in dem sein Verzeichnis `.git` liegt. */
  repo: string;
  repoPath: string;
  /** Der Name des Worktrees: sein Ordner. */
  worktree: string;
  worktreePath: string;
  /** Der Branch, dessen Commits die Liste zeigt; ohne Branch die von `HEAD`. */
  branch: string | null;
  /** Der Branch, der im Worktree ausgecheckt ist; keiner bei einem `HEAD` ohne Branch. */
  checkedOut: string | null;
}

/** Ein Worktree eines Repos, wie ihn `git worktree list` nennt. */
export interface Worktree {
  path: string;
  /** Der Ordner des Worktrees. */
  name: string;
  /** Der ausgecheckte Branch; keiner bei einem `HEAD` ohne Branch. */
  branch: string | null;
}

/** Ein Branch, der auf einen Commit zeigt: ein lokaler oder einer eines Remotes. */
export interface Ref {
  name: string;
  kind: 'local' | 'remote';
  sha: string;
}

export type DiffLineKind = 'context' | 'added' | 'removed';

/** Ein Bereich von Zeichen einer Zeile, in UTF-16-Einheiten; `end` gehört nicht mehr dazu. */
export interface LinePart {
  start: number;
  end: number;
}

/** Eine Zeile des Diffs. Die Nummern zählen ab 1, eine Seite ohne die Zeile hat keine Nummer. */
export interface DiffLine {
  kind: DiffLineKind;
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
  /** Die Teile, die sich von der Partnerzeile unterscheiden; leer ohne Partner. */
  parts: LinePart[];
}

/** Ein Abschnitt um Änderungen herum, mit der Zahl der ausgelassenen Zeilen davor. */
export interface Hunk {
  skippedBefore: number;
  lines: DiffLine[];
}

export type FileKind = 'changed' | 'added' | 'deleted' | 'renamed';

/** Der Vergleich einer Datei zwischen zwei Commits. */
export interface DiffFile {
  /** Der Pfad nach der Änderung, für eine gelöschte Datei der alte. */
  path: string;
  /** Der Pfad vor der Änderung; derselbe wie `path`, außer bei einer Umbenennung. */
  oldPath: string;
  kind: FileKind;
  /** Eine Binärdatei hat keine Zeilen. */
  binary: boolean;
  added: number;
  removed: number;
  /** Alle Zeilen beider Fassungen, in der Reihenfolge der Datei. */
  whole: DiffLine[];
  /** Der Text vorher und nachher, leer für eine Seite ohne die Datei. */
  oldText: string;
  newText: string;
}
