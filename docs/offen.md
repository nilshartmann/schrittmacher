# Offene Punkte

- Gitlinks (Submodule) erscheinen als Datei mit der Zeile `Subproject commit …`.
- Rebase und Ähnliches sind kein Ziel. Merge und harter Reset gibt es nur gegen den Branch auf dem
  Remote, über den Abstand im Badge.
- Branch-Auswahl im Worktree besprechen, etwa ob der dort ausgecheckte Branch die Vorgabe ist.
- Das Symbol des Knopfs „Alle Branches“ ähnelt dem des Knopfs für den Branch daneben.
- Für den Vortrag die Zusatzangaben ganz ausblenden können, wie die Hinweise, etwa die Zahl der
  Commits, die nicht auf dem Remote sind.
- Worktrees verwalten, etwa einen fehlenden Worktree eines Tabs wieder anlegen. Dafür bräuchte es
  `git worktree add` als weitere Ausnahme vom lesenden Zugriff.
- Workspaces im Editor nach dem ersten Schritt (`docs/editor.md`):
  - Dateien und Ordner umbenennen, verschieben und löschen, auch einen Entwurf in einen anderen
    Workspace verschieben
  - Material neben dem Text, also eine zweite Datei anstelle der Vorschau
  - Reihenfolge der Kapitel eines Buchs, anfangs über Präfixe wie `01-einleitung.md`
  - Workspaces mit mehreren Wurzeln, wenn das Material in einem anderen Repo liegt
