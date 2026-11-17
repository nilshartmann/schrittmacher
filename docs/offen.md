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
- Viewer und Editor gleichzeitig in zwei Fenstern der Web-App, etwa eine Werkstatt im Viewer und
  einen Artikel im Editor. Heute holen alle Fenster dieselbe Warteschlange ab (`useRequests`), und
  jede Anforderung des Kommandos landet in dem Fenster, das als nächstes fragt. Der Editor wechselt
  bei `schrittmacher <ordner>` sogar zum Viewer. Die Idee:
  1. Beim Abholen sagt jedes Fenster, ob es Viewer oder Editor ist. `schrittmacher <ordner>` und
     `schrittmacher <datei.md>` gehen an den Viewer, `schrittmacher edit …` an den Editor.
  2. Hat sich einige Sekunden lang kein Fenster der passenden Art gemeldet, nimmt das andere die
     Anforderung wie bisher und wechselt die Ansicht. Mit einem Fenster bleibt alles beim Alten.
  3. Das zweite Fenster entsteht in der Web-App mit ⌘N, falls Safari-Web-Apps das können
     (ungeprüft).
  4. Später holt `schrittmacher` das passende Fenster nach vorn. Mit `open -a` kommt nur das
     zuletzt benutzte nach vorn; ein bestimmtes geht über System Events mit Rechten für die
     Bedienungshilfen.
