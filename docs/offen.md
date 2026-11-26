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
  - Ordner umbenennen, Dateien und Ordner verschieben und löschen, auch einen Entwurf in einen
    anderen Workspace verschieben
  - Beim Umbenennen mit F2 auch die Links in anderen Dateien des Workspace anpassen, und F2 ohne
    Auswahl, wenn der Cursor in einem Link steht
  - Ein Repo im Workspace, das Git ignoriert, mit seinen eigenen Dateien im Baum zeigen
  - Material neben dem Text, also eine zweite Datei anstelle der Vorschau
  - Reihenfolge der Kapitel eines Buchs, anfangs über Präfixe wie `01-einleitung.md`
  - Workspaces mit mehreren Wurzeln, wenn das Material in einem anderen Repo liegt
- Beim Öffnen einer Datei im Editor die neuere Sicherung anbieten, wenn sie vom Stand der Datei
  abweicht. Lädt Vite den Code neu, legt es den Editor neu an und holt den Text von der Platte;
  ungespeicherte Änderungen stehen dann nur noch in der Sicherung.
- Gemeinsames Menü „Zuletzt geöffnet“ für Viewer und Editor, mit zwei Teilen: „Schrittmacher“ mit
  den Projekten und den zuletzt gemerkten Ansichten, „Editor“ mit Workspaces und Dateien. Es
  ersetzt die Uhr im Editor und kommt im Viewer dazu, das Menü der Repos bleibt. Jeder Eintrag
  lässt sich auch in einem neuen Fenster öffnen. Vorher prüfen, ob `window.open` in der Web-App
  aus Safari ein neues Fenster der Web-App öffnet.
- Die Web-App startet aus dem Dock immer im Viewer, auch wenn zuletzt der Editor offen war.
- Bei Viewer und Editor in zwei Fenstern (`docs/editor.md`) holt `schrittmacher` das passende
  Fenster nach vorn. Mit `open -a` kommt nur das zuletzt benutzte nach vorn; ein bestimmtes geht
  über System Events mit Rechten für die Bedienungshilfen.
